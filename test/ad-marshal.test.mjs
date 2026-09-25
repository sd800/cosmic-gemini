import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdMarshalProduct } from '../extension/background/products/standing/ad-marshal.js';
import { normalizeSettings } from '../extension/core/config.js';

test('Ad Marshal does not save a site selection until network rules can be reconciled', async () => {
  let settings = normalizeSettings();
  let failedReads = 3;
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() {
        if (failedReads > 0) { failedReads -= 1; throw new Error('DNR is temporarily unavailable.'); }
        return [];
      },
      async updateSessionRules() {}
    },
    tabs: { async query() { return []; } }
  };
  const platform = {
    async mutateSettings(update) {
      settings = normalizeSettings(await update(settings));
      return settings;
    },
    async readSettings() { return settings; },
    isIncognitoContext() { return false; }
  };
  const runtimeHost = { async sync() { return false; } };
  const product = createAdMarshalProduct(runtimeHost, platform);

  const message = {
    type: 'UI_SET_AD_MARSHAL_SITE', siteId: 'zhihu', enabled: true
  };
  await assert.rejects(product.handleMessage(message), /DNR is temporarily unavailable/);
  assert.equal(settings.adMarshal.managedSites.zhihu, false);

  failedReads = 1;
  const result = await product.handleMessage(message);
  assert.equal(result.managedSites.zhihu, true);
  assert.equal(settings.adMarshal.managedSites.zhihu, true);
  assert.equal(settings.adMarshal.managedSites.tencentNews, false);
});

test('Ad Marshal rejects unknown managed-site controls', async () => {
  let settings = normalizeSettings();
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() { return []; },
      async updateSessionRules() {}
    },
    tabs: { async query() { return []; } }
  };
  const platform = {
    async mutateSettings(update) {
      settings = normalizeSettings(await update(settings));
      return settings;
    },
    async readSettings() { return settings; },
    isIncognitoContext() { return false; }
  };
  const product = createAdMarshalProduct({ async sync() { return false; } }, platform);
  await assert.rejects(product.handleMessage({
    type: 'UI_SET_AD_MARSHAL_SITE', siteId: 'unknown', enabled: true
  }), /does not support this command/);
});

test('Ad Marshal does not save a site choice when Chrome omits its active-tab rules', async () => {
  let settings = normalizeSettings();
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() { return []; },
      async updateSessionRules() {}
    },
    tabs: { async query() { return [{ id: 18, url: 'https://www.zhihu.com/', incognito: false }]; } }
  };
  const product = createAdMarshalProduct({ async sync() { return false; } }, {
    async mutateSettings(update) { return (settings = normalizeSettings(await update(settings))); },
    async readSettings() { return settings; },
    isIncognitoContext() { return false; }
  });
  await assert.rejects(product.handleMessage({
    type: 'UI_SET_AD_MARSHAL_SITE', siteId: 'zhihu', enabled: true
  }), /could not verify/);
  assert.equal(settings.adMarshal.managedSites.zhihu, false);
});

test('Ad Marshal routes the Tencent News timeline host through the news.qq.com policy', async () => {
  const settings = normalizeSettings({ adMarshal: { managedSites: { tencentNews: true } } });
  const runtimeCalls = [];
  const ruleUpdates = [];
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() { return []; },
      async updateSessionRules(update) { ruleUpdates.push(update); }
    },
    tabs: { async query() { return []; } }
  };
  const platform = {
    async mutateSettings(update) { return normalizeSettings(await update(settings)); },
    async readSettings() { return settings; },
    isIncognitoContext() { return false; }
  };
  const runtimeHost = {
    async sync(_product, context, active) {
      runtimeCalls.push({ context, active });
      return active;
    }
  };
  const product = createAdMarshalProduct(runtimeHost, platform);
  const url = 'https://view.inews.qq.com/timeline/example';

  assert.equal(await product.sync({
    settings,
    tabId: 18,
    topUrl: url,
    frameId: 0,
    frameUrl: url,
    documentId: ''
  }, settings), true);
  assert.equal(runtimeCalls[0].active, true);
  assert.equal(ruleUpdates.length, 1);
  assert.equal(ruleUpdates[0].addRules.length, 9);
  assert.equal(ruleUpdates[0].addRules[0].condition.urlFilter, 'universal-report.min.js');
  assert.ok(ruleUpdates[0].addRules.some(rule => (
    rule.condition.urlFilter === '/qqcdn/news-share/js/custom_'
      && rule.action.redirect.extensionPath === '/assets/ad-marshal-qq-emonitor.js'
  )));
  assert.ok(ruleUpdates[0].addRules.some(rule => rule.condition.requestDomains?.includes('n.ssp.qq.com')));
  assert.ok(ruleUpdates[0].addRules.every(rule => rule.condition.tabIds[0] === 18));
});

test('Ad Marshal keeps regular and private tab rules independent', async () => {
  let rules = [];
  const tabs = [
    { id: 17, url: 'https://www.zhihu.com/', incognito: false },
    { id: 18, url: 'https://www.zhihu.com/', incognito: true }
  ];
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() { return rules.map(rule => structuredClone(rule)); },
      async updateSessionRules({ removeRuleIds, addRules = [] }) {
        rules = rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    },
    tabs: { async query() { return tabs; }, async get(id) { return tabs.find(tab => tab.id === id); } }
  };
  let regularSettings = normalizeSettings({ adMarshal: { managedSites: { zhihu: true } } });
  const privateSettings = normalizeSettings({ adMarshal: { managedSites: { zhihu: true } } });
  const host = { async sync() {} };
  const regular = createAdMarshalProduct(host, {
    isIncognitoContext: () => false, readSettings: async () => regularSettings
  });
  const privateProduct = createAdMarshalProduct(host, {
    isIncognitoContext: () => true, readSettings: async () => privateSettings
  });
  await regular.reconcile();
  await privateProduct.reconcile();
  assert.equal(rules.filter(rule => rule.condition.tabIds[0] === 17).length, 6);
  assert.equal(rules.filter(rule => rule.condition.tabIds[0] === 18).length, 6);
  assert.equal(new Set(rules.map(rule => rule.id)).size, 12);
  const oldTab = { ...tabs[0] };
  tabs[0] = { ...tabs[0], url: 'https://outside.test/' };
  await regular.handleTabUpdated(17, { status: 'loading' }, oldTab);
  assert.equal(rules.filter(rule => rule.condition.tabIds[0] === 17).length, 0,
    'a late event cannot retain rules for the previous site');
  assert.equal(rules.filter(rule => rule.condition.tabIds[0] === 18).length, 6);
  regularSettings = normalizeSettings();
  await regular.reconcile();
  assert.equal(rules.filter(rule => rule.condition.tabIds[0] === 17).length, 0);
  assert.equal(rules.filter(rule => rule.condition.tabIds[0] === 18).length, 6);
});
