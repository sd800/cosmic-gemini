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
