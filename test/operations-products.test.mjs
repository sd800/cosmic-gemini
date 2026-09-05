import assert from 'node:assert/strict';
import test from 'node:test';
import { featureState, normalizeSettings } from '../extension/core/config.js';
import { createAnyCopyProduct } from '../extension/background/products/operations/any-copy.js';
import { createAnyCopyEnhancedProduct } from '../extension/background/products/operations/any-copy-enhanced.js';
import { createPageDisplayProduct } from '../extension/background/products/operations/page-display.js';
import { createXhsImageDarkModeProduct } from '../extension/background/products/operations/xhs-image-dark-mode.js';
import { createStandingProvince } from '../extension/background/provinces/standing.js';
import { createAdministrationProduct } from '../extension/background/products/operations/administration.js';

test('popup cache receives saved preferences separately from effective state', async () => {
  const base = 'chrome-extension://cosmic-gemini/';
  globalThis.chrome = {
    runtime: { getURL: path => base + path },
    tabs: { async query() { return [{ id: 11, url: 'https://example.com/' }]; } }
  };
  const preferences = normalizeSettings({ mailtoCapture: { enabled: true } });
  const product = createAdministrationProduct({});
  const result = await product.handleMessage({ type: 'UI_GET_ACTIVE_PAGE_STATE' }, {
    sender: { url: base + 'popup/index.html' },
    async collectPageState(url, tabId, options) {
      assert.equal(tabId, 11);
      assert.equal(url, 'https://example.com/');
      return { mailtoCapture: { enabled: false, status: 'unavailable' },
        ...(options.includePreferences ? { preferences } : {}) };
    }
  });
  assert.equal(result.state.mailtoCapture.enabled, false);
  assert.equal(result.state.preferences.mailtoCapture.enabled, true);
});

test('other rule editors accept Settings navigation and keep product rules independent', async () => {
  const base = 'chrome-extension://cosmic-gemini/';
  globalThis.chrome = { runtime: { getURL: path => base + path } };
  let settings = normalizeSettings();
  const platform = { async mutateSettings(update) { settings = normalizeSettings(update(settings)); return settings; } };
  const standing = createStandingProvince(platform);
  const anyCopy = createAnyCopyProduct({ sync: async () => true }, platform);
  for (const entry of ['all-settings', 'satellites', 'any-copy', 'image-download', 'video-download', 'native-scroll', 'no-autoplay']) {
    const context = { sender: { url: `${base}settings/${entry}.html` } };
    for (const product of ['nativeScroll', 'noAutoplay']) {
      for (const behavior of ['inactive', 'standard', 'enhanced']) {
        await standing.handleMessage(product, { type: 'UI_SET_BEHAVIOR_RULE', rule: '*.163.com', behavior }, context);
        assert.equal(featureState(settings, product, 'https://mail.163.com/').behavior, behavior);
      }
      await standing.handleMessage(product, { type: 'UI_DELETE_BEHAVIOR_RULE', rule: '*.163.com' }, context);
      assert.equal(settings[product].enhancedRules.length, 0);
    }
    for (const type of ['UI_ADD_RULE', 'UI_DELETE_RULE']) {
      const result = await standing.handleMessage('noAutoplay', {
        type, listName: 'permanentAudioAllowRules', rule: '*.163.com'
      }, context);
      assert.equal(result.permanentAudioAllowRules.length, type === 'UI_ADD_RULE' ? 1 : 0);
      const copy = await anyCopy.handleMessage({ type, listName: 'siteRules', rule: '*.163.com' }, context);
      assert.equal(copy.siteRules.length, type === 'UI_ADD_RULE' ? 1 : 0);
    }
    assert.deepEqual(settings.nsna.whitelistRules, []);
  }
});

test('shared whitelist edits work from every Settings entry after in-page navigation', async () => {
  const base = 'chrome-extension://cosmic-gemini/';
  globalThis.chrome = { runtime: { getURL: path => base + path } };
  let settings = normalizeSettings();
  const standing = createStandingProvince({
    async mutateSettings(update) {
      settings = normalizeSettings(update(settings));
      return settings;
    }
  });
  for (const entry of ['all-settings', 'satellites', 'any-copy', 'image-download', 'video-download', 'native-scroll', 'no-autoplay']) {
    const context = { sender: { url: `${base}settings/${entry}.html` } };
    const result = await standing.handleMessage('nativeScroll', {
      type: 'UI_ADD_NSNA_WHITELIST_RULE', rule: '  *.Douyin.com  '
    }, context);
    assert.deepEqual(result.whitelistRules, ['*.douyin.com']);
    for (const product of ['nativeScroll', 'noAutoplay']) {
      for (const hostname of ['douyin.com', 'www.douyin.com', 'live.douyin.com']) {
        const state = featureState(settings, product, `https://${hostname}/`);
        assert.equal(state.sharedWhitelisted, true);
        assert.equal(state.active, false);
      }
    }
    const removed = await standing.handleMessage('nativeScroll', {
      type: 'UI_DELETE_NSNA_WHITELIST_RULE', rule: '*.douyin.com'
    }, context);
    assert.deepEqual(removed.whitelistRules, []);
  }
});

test('shared whitelist still rejects non-Settings senders and malformed rules without saving', async () => {
  const base = 'chrome-extension://cosmic-gemini/';
  globalThis.chrome = { runtime: { getURL: path => base + path } };
  let writes = 0;
  const standing = createStandingProvince({ async mutateSettings() { writes += 1; } });
  for (const url of [base + 'popup/index.html', base + 'settings-fake/index.html', 'https://example.com/settings/native-scroll.html', 'chrome-extension://other/settings/native-scroll.html']) {
    for (const type of ['UI_ADD_NSNA_WHITELIST_RULE', 'UI_DELETE_NSNA_WHITELIST_RULE']) {
      await assert.rejects(standing.handleMessage('nativeScroll', {
        type, rule: '*.douyin.com', url: base + 'settings/native-scroll.html'
      }, { sender: { url } }), /only from Settings/);
    }
  }
  await assert.rejects(standing.handleMessage('nativeScroll', {
    type: 'UI_ADD_NSNA_WHITELIST_RULE', rule: 'https://douyin.com/path'
  }, { sender: { url: base + 'settings/all-settings.html' } }));
  assert.equal(writes, 0);
});

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

test('turning Any Copy Enhanced off succeeds even if activity bookkeeping fails', async () => {
  let active = true;
  globalThis.chrome = {
    storage: { session: {
      async get(key) { return { [key]: { active } }; },
      async remove() { active = false; }
    } },
    tabs: { async get() { return { url: 'https://example.com/' }; } }
  };
  let refreshed = false;
  const product = createAnyCopyEnhancedProduct({}, {
    async setFeatureActivity() { throw Error('activity storage unavailable'); },
    async refreshTabPage() { refreshed = true; }
  });
  const result = await product.handleMessage({ type: 'UI_TOGGLE_TAB_FEATURE', tabId: 7 });
  assert.equal(result.active, false);
  assert.equal(active, false);
  assert.equal(refreshed, true);
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

test('Page Display runs only in the top frame while either visual feature is enabled', async () => {
  let settings = normalizeSettings();
  const syncs = [];
  let refreshes = 0;
  const product = createPageDisplayProduct({
    async sync(descriptor, context, active) {
      syncs.push({ id: descriptor.id, frameId: context.frameId, active });
    }
  }, {
    async mutateSettings(update, refresh) {
      assert.equal(refresh, false);
      settings = normalizeSettings(update(settings));
      return settings;
    },
    async refreshOpenPages() { refreshes += 1; }
  });

  assert.equal(await product.sync({
    tabId: 9,
    frameId: 0,
    documentId: 'top',
    topUrl: 'https://example.com/'
  }, settings), false);
  await product.handleMessage({
    type: 'UI_SET_PAGE_DISPLAY_SETTING',
    name: 'greyscaleEnabled',
    value: true
  });
  assert.equal(await product.sync({
    tabId: 9,
    frameId: 0,
    documentId: 'top',
    topUrl: 'https://example.com/'
  }, settings), true);
  assert.equal(await product.sync({
    tabId: 9,
    frameId: 3,
    documentId: 'child',
    topUrl: 'https://example.com/'
  }, settings), false);
  const updated = await product.handleMessage({
    type: 'UI_SET_PAGE_DISPLAY_SETTING',
    name: 'reduction',
    value: 0.55
  });
  assert.equal(updated.reduceWhitePoint.reduction, 0.55);
  assert.equal(updated.greyscale.enabled, true);
  await product.handleMessage({
    type: 'UI_SET_PAGE_DISPLAY_SETTING',
    name: 'greyscaleEnabled',
    value: false
  });
  assert.equal(await product.sync({
    tabId: 9,
    frameId: 0,
    documentId: 'top',
    topUrl: 'https://example.com/'
  }, settings), false);
  await product.handleMessage({
    type: 'UI_SET_PAGE_DISPLAY_SETTING',
    name: 'reduceWhitePointEnabled',
    value: true
  });
  assert.equal(await product.sync({
    tabId: 9,
    frameId: 0,
    documentId: 'top',
    topUrl: 'https://example.com/'
  }, settings), true);
  await product.handleMessage({
    type: 'UI_SET_PAGE_DISPLAY_SETTING',
    name: 'reduceWhitePointEnabled',
    value: false
  });
  assert.equal(await product.sync({
    tabId: 9,
    frameId: 0,
    documentId: 'top',
    topUrl: 'https://example.com/'
  }, settings), false);
  assert.equal(refreshes, 5);
  assert.deepEqual(syncs.map(({ frameId, active }) => ({ frameId, active })), [
    { frameId: 0, active: false },
    { frameId: 0, active: true },
    { frameId: 3, active: false },
    { frameId: 0, active: false },
    { frameId: 0, active: true },
    { frameId: 0, active: false }
  ]);
});
