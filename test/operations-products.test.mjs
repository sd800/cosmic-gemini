import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from '../extension/core/config.js';
import { createAnyCopyProduct } from '../extension/background/products/operations/any-copy.js';
import { createAnyCopyEnhancedProduct } from '../extension/background/products/operations/any-copy-enhanced.js';
import { createXhsImageDarkModeProduct } from '../extension/background/products/operations/xhs-image-dark-mode.js';
import { createStandingProvince } from '../extension/background/provinces/standing.js';

test('Any Copy settings remove the submitted rule instead of an empty hostname', async () => {
  let settings = normalizeSettings({ anyCopy: { siteRules: ['copy.example', 'keep.example'] } });
  const platform = {
    async mutateSettings(update) {
      settings = normalizeSettings(update(settings));
      return settings;
    }
  };
  const product = createAnyCopyProduct({ sync: async () => true }, platform);
  await product.handleMessage({ type: 'UI_DELETE_RULE', listName: 'siteRules', rule: 'copy.example' });
  assert.deepEqual(settings.anyCopy.siteRules, ['keep.example']);
});

test('concurrent Any Copy Enhanced clicks are applied in order', async () => {
  const session = {};
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { await Promise.resolve(); return key in session ? { [key]: session[key] } : {}; },
        async set(values) { await Promise.resolve(); Object.assign(session, values); },
        async remove(key) { await Promise.resolve(); delete session[key]; }
      }
    },
    tabs: { async get(tabId) { await Promise.resolve(); return { id: tabId, url: 'https://example.com/' }; } }
  };
  let refreshes = 0;
  const product = createAnyCopyEnhancedProduct({ sync: async () => true }, {
    async setFeatureActivity() {},
    async refreshTabPage() { refreshes += 1; }
  });
  const message = { type: 'UI_TOGGLE_TAB_FEATURE', tabId: 12 };
  const [first, second] = await Promise.all([product.handleMessage(message), product.handleMessage(message)]);
  assert.equal(first.active, true);
  assert.equal(second.active, false);
  assert.equal(await product.isActive(12), false);
  assert.equal(refreshes, 2);
});

test('popup website actions stop when the source tab has navigated elsewhere', async () => {
  globalThis.chrome = { tabs: { async get() { return { url: 'https://new.example/' }; } } };
  let writes = 0;
  const platform = {
    async mutateSettings() { writes += 1; },
    async readSettings() { return normalizeSettings({}); },
    async setFeatureActivity() {}
  };
  const standing = createStandingProvince(platform);
  await assert.rejects(standing.handleMessage('nativeScroll', {
    type: 'UI_TOGGLE_PAGE_FEATURE',
    featureId: 'nativeScroll',
    tabId: 4,
    hostname: 'old.example'
  }, { sender: {} }), /page changed/i);
  const anyCopy = createAnyCopyProduct({ sync: async () => true }, platform);
  await assert.rejects(anyCopy.handleMessage({
    type: 'UI_TOGGLE_SITE_FEATURE',
    tabId: 4,
    hostname: 'old.example',
    expectedHostname: 'old.example'
  }), /page changed/i);
  assert.equal(writes, 0);
});

test('XHS Image Dark Mode settings synchronize open pages before returning', async () => {
  let settings = normalizeSettings({ xhsImageDarkMode: { enabled: true } });
  let refreshes = 0;
  const product = createXhsImageDarkModeProduct({ sync: async () => true }, {
    async mutateSettings(update, refresh) {
      assert.equal(refresh, false);
      settings = normalizeSettings(update(settings));
      return settings;
    },
    async refreshOpenPages() { refreshes += 1; }
  });
  const result = await product.handleMessage({
    type: 'UI_SET_XHS_IMAGE_DARK_MODE_SETTING',
    name: 'overrideDarkMode',
    value: true
  });
  assert.equal(result.overrideDarkMode, true);
  assert.equal(refreshes, 1);
});
