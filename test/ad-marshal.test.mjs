import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdMarshalProduct } from '../extension/background/products/standing/ad-marshal.js';
import { normalizeSettings } from '../extension/core/config.js';

test('Ad Marshal saves its unified switch without waiting for network-rule reconciliation', async () => {
  let settings = normalizeSettings();
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() { throw new Error('DNR is temporarily unavailable.'); },
      async updateSessionRules() {}
    },
    tabs: { async query() { return []; } }
  };
  const platform = {
    async mutateSettings(update) {
      settings = normalizeSettings(update(settings));
      return settings;
    },
    async readSettings() { return settings; },
    isIncognitoContext() { return false; }
  };
  const runtimeHost = { async sync() { return false; } };
  const product = createAdMarshalProduct(runtimeHost, platform);

  const result = await product.handleMessage({ type: 'UI_SET_AD_MARSHAL_ENABLED', enabled: true });
  assert.deepEqual(result, { enabled: true });
  assert.equal(settings.adMarshal.enabled, true);
  await new Promise(resolve => setImmediate(resolve));
});

test('Ad Marshal limits Gmail request neutralization to its tab and trusted embedded frames', async () => {
  const settings = normalizeSettings({ adMarshal: { enabled: true } });
  const runtimeCalls = [];
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() { return []; },
      async updateSessionRules() {}
    },
    tabs: { async query() { return []; } }
  };
  const platform = {
    async mutateSettings(update) { return normalizeSettings(update(settings)); },
    async readSettings() { return settings; },
    isIncognitoContext() { return false; }
  };
  const runtimeHost = {
    async sync(_product, context, active) {
      runtimeCalls.push({ frameUrl: context.frameUrl, active });
      return active;
    }
  };
  const product = createAdMarshalProduct(runtimeHost, platform);
  const base = {
    settings,
    tabId: 12,
    topUrl: 'https://mail.google.com/mail/u/1/#inbox',
    documentId: ''
  };

  assert.equal(await product.sync({ ...base, frameId: 1, frameUrl: 'https://chat.google.com/u/1/frame' }, settings), true);
  assert.equal(await product.sync({ ...base, frameId: 2, frameUrl: 'https://ogs.google.com/u/1/widget' }, settings), true);
  assert.equal(await product.sync({ ...base, frameId: 3, frameUrl: 'https://www.gstatic.com/blank.html' }, settings), false);
  assert.equal(await product.sync({
    ...base,
    frameId: 0,
    frameUrl: 'https://chat.google.com/',
    topUrl: 'https://chat.google.com/'
  }, settings), false);
  assert.deepEqual(runtimeCalls.map(call => call.active), [true, true, false, false]);
});

test('Ad Marshal routes the Tencent News timeline host through the news.qq.com policy', async () => {
  const settings = normalizeSettings({ adMarshal: { enabled: true } });
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
    async mutateSettings(update) { return normalizeSettings(update(settings)); },
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
