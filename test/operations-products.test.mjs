import assert from 'node:assert/strict';
import test from 'node:test';
import { featureState, normalizeSettings } from '../extension/core/config.js';
import { createAnyCopyProduct } from '../extension/background/products/operations/any-copy.js';
import { createAnyCopyEnhancedProduct } from '../extension/background/products/operations/any-copy-enhanced.js';
import { createPageDisplayProduct } from '../extension/background/products/operations/page-display.js';
import { createXhsImageDarkModeProduct } from '../extension/background/products/operations/xhs-image-dark-mode.js';
import { createChineseResponseClaudeProduct } from '../extension/background/products/operations/chinese-response-claude.js';
import { createOperationsProvince } from '../extension/background/provinces/operations.js';
import { createStandingProvince } from '../extension/background/provinces/standing.js';
import { createAdministrationProduct } from '../extension/background/products/operations/administration.js';
import { centralPageDirectives, syncCentralPageProducts } from '../extension/background/central-policy.js';

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

test('Claude response display product saves independently and refreshes page decisions', async () => {
  let settings = normalizeSettings();
  let refreshes = 0;
  const product = createChineseResponseClaudeProduct({ sync: async () => true }, {
    async mutateSettings(update) {
      settings = normalizeSettings(update(settings));
      return settings;
    },
    async refreshOpenPages() { refreshes += 1; }
  });
  const result = await product.handleMessage({
    type: 'UI_SET_ENABLED',
    featureId: 'chineseResponseClaude',
    enabled: true
  });
  assert.equal(result.enabled, true);
  assert.equal(settings.chineseResponseClaude.enabled, true);
  assert.equal(settings.mailtoCapture.enabled, true);
  assert.equal(refreshes, 1);
});

test('Claude browser identity setting stays active until the final governed tab closes', async () => {
  const session = {};
  const ruleUpdates = [];
  let tabs = [
    { id: 61, url: 'https://claude.ai/chat/example' },
    { id: 62, url: 'https://example.com/' }
  ];
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    storage: { session: {
      async get(key) { return key in session ? { [key]: session[key] } : {}; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; }
    } },
    declarativeNetRequest: {
      async updateSessionRules(update) { ruleUpdates.push(update); }
    },
    tabs: { async query() { return tabs; } }
  };
  let settings = normalizeSettings({
    chineseResponseClaude: { enabled: true, browserIdentityEnabled: true }
  });
  let refreshes = 0;
  const platform = {
    isIncognitoContext() { return false; },
    async readSettings() { return settings; },
    async mutateSettings(update) {
      settings = normalizeSettings(update(settings));
      return settings;
    },
    async refreshOpenPages() { refreshes += 1; }
  };
  const product = createChineseResponseClaudeProduct({ sync: async () => true }, platform);

  const disabled = await product.handleMessage({
    type: 'UI_SET_CLAUDE_BROWSER_IDENTITY',
    featureId: 'chineseResponseClaude',
    enabled: false
  });
  assert.equal(disabled.enabled, true);
  assert.equal(disabled.browserIdentityEnabled, false);
  assert.equal((await product.state(settings, tabs[0].url)).browserIdentityActive, true);
  assert.equal(session['chineseResponseClaudeIdentitySession:regular'].retained, true);
  assert.deepEqual(ruleUpdates[0].removeRuleIds, [900001, 900002]);
  assert.equal(ruleUpdates[0].addRules.length, 2);
  assert.deepEqual(ruleUpdates[0].addRules[0], {
    id: 900001,
    priority: 100,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Accept-Language', operation: 'set', value: 'en-US' }]
    },
    condition: {
      requestDomains: ['claude.ai', 'claude.com', 'anthropic.com'],
      resourceTypes: ['main_frame'], tabIds: [61, 62]
    }
  });
  assert.deepEqual(ruleUpdates[0].addRules[1].condition, {
    initiatorDomains: ['claude.ai', 'claude.com', 'anthropic.com'],
    excludedResourceTypes: ['main_frame'], tabIds: [61, 62]
  });

  const restarted = createChineseResponseClaudeProduct({ sync: async () => true }, platform);
  await restarted.initialize();
  assert.equal((await restarted.state(settings, tabs[0].url)).browserIdentityActive, true);

  await restarted.handleTabRemoved(61);
  assert.equal((await restarted.state(settings, 'https://console.anthropic.com/')).browserIdentityActive, false);
  assert.equal('chineseResponseClaudeIdentitySession:regular' in session, false);
  assert.deepEqual(ruleUpdates[2], { removeRuleIds: [900001, 900002], addRules: [] });
  assert.equal(refreshes, 1);

  tabs = [{ id: 63, url: 'https://platform.claude.com/' }];
  await restarted.handleMessage({
    type: 'UI_SET_CLAUDE_BROWSER_IDENTITY',
    featureId: 'chineseResponseClaude',
    enabled: true
  });
  const reenabled = await restarted.state(settings, tabs[0].url);
  assert.equal(reenabled.browserIdentityActive, true);
  assert.equal(reenabled.responseDisplay, false);
  assert.equal(settings.chineseResponseClaude.enabled, true);
  assert.equal(ruleUpdates.at(-1).addRules.length, 2);
  assert.equal(refreshes, 2);
});

test('Claude browser identity scopes request language before an existing blank tab navigates', async () => {
  const ruleUpdates = [];
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    storage: { session: {
      async get() { return {}; },
      async set() {},
      async remove() {}
    } },
    declarativeNetRequest: {
      async updateSessionRules(update) { ruleUpdates.push(update); }
    },
    tabs: { async query() { return [{ id: 71, url: "chrome://newtab/", incognito: false }]; } }
  };
  const settings = normalizeSettings({
    chineseResponseClaude: { enabled: false, browserIdentityEnabled: true }
  });
  const product = createChineseResponseClaudeProduct({ sync: async () => true }, {
    isIncognitoContext() { return false; },
    async readSettings() { return settings; }
  });

  assert.equal(await product.initialize(), true);
  assert.equal(ruleUpdates.length, 1);
  assert.equal(ruleUpdates[0].addRules.length, 2);
  assert.equal(ruleUpdates[0].addRules[0].action.requestHeaders[0].value, 'en-US');

  await product.reset();
  assert.deepEqual(ruleUpdates[1], { removeRuleIds: [900001, 900002], addRules: [] });
});

test('Claude browser identity saves even when optional session metadata is unavailable', async () => {
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    storage: { session: {
      async get() { return {}; },
      async set() { throw new Error('session storage unavailable'); },
      async remove() { throw new Error('session storage unavailable'); }
    } },
    tabs: { async query() { return []; } }
  };
  let settings = normalizeSettings({
    chineseResponseClaude: { enabled: false, browserIdentityEnabled: true }
  });
  const product = createChineseResponseClaudeProduct({ sync: async () => true }, {
    isIncognitoContext() { return false; },
    async mutateSettings(update) {
      settings = normalizeSettings(update(settings));
      return settings;
    },
    async refreshOpenPages() {}
  });

  const result = await product.handleMessage({
    type: 'UI_SET_CLAUDE_BROWSER_IDENTITY',
    featureId: 'chineseResponseClaude',
    enabled: false
  });

  assert.equal(result.browserIdentityEnabled, false);
  assert.equal(settings.chineseResponseClaude.enabled, false);
});

test('Claude response display records and clears live page activity for popup state', async () => {
  const activity = [];
  const settings = normalizeSettings({ chineseResponseClaude: { enabled: true } });
  const province = createOperationsProvince({
    async readSettings() { return settings; },
    async setFeatureActivity(tabId, featureId, active) {
      activity.push({ tabId, featureId, active });
    }
  });
  const result = await province.handleMessage('chineseResponseClaude', {
    type: 'CG_FEATURE_ACTIVITY',
    featureId: 'chineseResponseClaude',
    active: true,
    pageUrl: 'https://claude.ai/chat/example'
  }, {
    sender: {
      frameId: 0,
      url: 'https://claude.ai/chat/example',
      tab: { id: 19, url: 'https://claude.ai/chat/example' }
    }
  });
  assert.deepEqual(result, { recorded: true, active: true });
  const cleared = await province.handleMessage('chineseResponseClaude', {
    type: 'CG_FEATURE_ACTIVITY',
    featureId: 'chineseResponseClaude',
    active: false,
    pageUrl: 'https://claude.ai/chat/example'
  }, {
    sender: {
      frameId: 0,
      url: 'https://claude.ai/chat/example',
      tab: { id: 19, url: 'https://claude.ai/chat/example' }
    }
  });
  assert.deepEqual(cleared, { recorded: true, active: false });
  assert.deepEqual(activity, [
    { tabId: 19, featureId: 'chineseResponseClaude', active: true },
    { tabId: 19, featureId: 'chineseResponseClaude', active: false }
  ]);
});

test('other rule editors accept Settings navigation and keep product rules independent', async () => {
  const base = 'chrome-extension://cosmic-gemini/';
  globalThis.chrome = { runtime: { getURL: path => base + path } };
  let settings = normalizeSettings();
  const platform = { async mutateSettings(update) { settings = normalizeSettings(update(settings)); return settings; } };
  const standing = createStandingProvince(platform);
  const anyCopy = createAnyCopyProduct({ sync: async () => true }, platform);
  for (const entry of ['all-settings', 'satellites', 'page-display', 'any-copy', 'image-download', 'video-download', 'native-scroll', 'no-autoplay']) {
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
  for (const entry of ['all-settings', 'satellites', 'page-display', 'any-copy', 'image-download', 'video-download', 'native-scroll', 'no-autoplay']) {
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

test('Central persistently authorizes Any Copy across the Zhihu domain family only when Ad Marshal manages it', () => {
  const enabled = normalizeSettings({ adMarshal: { managedSites: { zhihu: true } } });
  for (const url of ['https://zhihu.com/', 'https://www.zhihu.com/', 'https://zhuanlan.zhihu.com/p/example']) {
    assert.deepEqual(centralPageDirectives(enabled, url).anyCopy, {
      persistent: true,
      source: 'adMarshalZhihu'
    });
  }
  assert.equal(centralPageDirectives(enabled, 'https://notzhihu.com/').anyCopy.persistent, false);
  assert.equal(centralPageDirectives(normalizeSettings(), 'https://www.zhihu.com/').anyCopy.persistent, false);
});

test('Central gives effective Any Copy priority over Clipboard Protect', async () => {
  const productIds = ['nativeScroll', 'clipboardProtect', 'anyCopy', 'mailtoCapture'];
  for (const anyCopyActive of [true, false]) {
    const directives = centralPageDirectives(normalizeSettings(), 'https://example.com/', { anyCopyActive });
    assert.equal(directives.clipboardProtect.yieldToAnyCopy, anyCopyActive);
    const calls = [];
    const states = await syncCentralPageProducts(productIds, directives, async productId => {
      calls.push(productId);
      return productId === (anyCopyActive ? 'anyCopy' : 'clipboardProtect');
    });
    const pair = calls.filter(productId => ['anyCopy', 'clipboardProtect'].includes(productId));
    assert.deepEqual(pair, anyCopyActive ? ['clipboardProtect', 'anyCopy'] : ['anyCopy', 'clipboardProtect']);
    assert.equal(states.anyCopy, anyCopyActive);
    assert.equal(states.clipboardProtect, !anyCopyActive);
  }
});

test('Central does not start the incoming copy guard when the outgoing guard fails to stop', async () => {
  const calls = [];
  const directives = centralPageDirectives(normalizeSettings(), 'https://example.com/', { anyCopyActive: true });
  await assert.rejects(syncCentralPageProducts(['clipboardProtect', 'anyCopy'], directives, async productId => {
    calls.push(productId);
    if (productId === 'clipboardProtect') throw Error('cleanup failed');
    return true;
  }), /cleanup failed/);
  assert.deepEqual(calls, ['clipboardProtect']);
});

test('coordinated Zhihu Any Copy can be paused only for the current tab', async () => {
  const session = {};
  const tabs = new Map([
    [51, { id: 51, url: 'https://www.zhihu.com/question/1' }],
    [52, { id: 52, url: 'https://zhuanlan.zhihu.com/p/2' }]
  ]);
  globalThis.chrome = {
    storage: { session: {
      async get(key) {
        if (key === null) return { ...session };
        return key in session ? { [key]: session[key] } : {};
      },
      async set(values) { Object.assign(session, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key]; }
    } },
    tabs: {
      async get(tabId) { return tabs.get(tabId); },
      async query() { return [...tabs.values()]; }
    }
  };
  const settings = normalizeSettings({ adMarshal: { managedSites: { zhihu: true } } });
  const directivesFor = url => centralPageDirectives(settings, url);
  let refreshes = 0;
  const product = createAnyCopyProduct({ async sync() {} }, {
    async readSettings() { return settings; },
    async setFeatureActivity() {},
    async refreshTabPage() { refreshes += 1; }
  });

  assert.equal((await product.state(settings, tabs.get(51).url, 51, directivesFor(tabs.get(51).url))).active, true);
  assert.equal((await product.state(settings, tabs.get(52).url, 52, directivesFor(tabs.get(52).url))).active, true);
  const context = { async resolvePageDirectives(url) { return directivesFor(url); } };
  const paused = await product.handleMessage({
    type: 'UI_TOGGLE_COORDINATED_TAB_FEATURE',
    tabId: 51,
    expectedHostname: 'www.zhihu.com'
  }, context);
  assert.equal(paused.active, false);
  assert.equal(paused.coordinated, true);
  assert.equal(paused.tabPaused, true);
  assert.equal(centralPageDirectives(settings, tabs.get(51).url, {
    anyCopyActive: paused.active
  }).clipboardProtect.yieldToAnyCopy, false);
  assert.equal((await product.state(settings, tabs.get(52).url, 52, directivesFor(tabs.get(52).url))).active, true);
  assert.deepEqual(settings.anyCopy.siteRules, []);

  const resumed = await product.handleMessage({
    type: 'UI_TOGGLE_COORDINATED_TAB_FEATURE',
    tabId: 51,
    expectedHostname: 'www.zhihu.com'
  }, context);
  assert.equal(resumed.active, true);
  assert.equal(resumed.tabPaused, false);
  assert.equal(centralPageDirectives(settings, tabs.get(51).url, {
    anyCopyActive: resumed.active
  }).clipboardProtect.yieldToAnyCopy, true);
  await product.handleMessage({
    type: 'UI_TOGGLE_COORDINATED_TAB_FEATURE',
    tabId: 51,
    expectedHostname: 'www.zhihu.com'
  }, context);
  assert.equal(await product.isCoordinatedPaused(51), true);
  await product.removeTab(51);
  assert.equal(await product.isCoordinatedPaused(51), false);
  assert.equal(refreshes, 3);
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

test('XHS Image Dark Mode keeps the newest status report for the current document', async () => {
  const session = {};
  globalThis.chrome = {
    storage: { session: {
      async get(key) { return key in session ? { [key]: session[key] } : {}; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; }
    } },
    tabs: { async query() { return []; } }
  };
  const settings = normalizeSettings({ xhsImageDarkMode: { enabled: true } });
  let activity = false;
  const product = createXhsImageDarkModeProduct({ sync: async () => true }, {
    async getLocale() { return 'en-US'; },
    async readSettings() { return settings; },
    notifyCentralUi() {},
    async setFeatureActivity(_tabId, _featureId, value) { activity = value; }
  });
  await product.sync({
    tabId: 17,
    frameId: 0,
    documentId: 'document-current',
    topUrl: 'https://www.xiaohongshu.com/user/profile/669cf72a000000002401e0fc'
  }, settings);
  const context = {
    sender: {
      frameId: 0,
      documentId: 'document-current',
      tab: { id: 17, url: 'https://www.xiaohongshu.com/user/profile/669cf72a000000002401e0fc' }
    }
  };
  const newest = await product.handleMessage({
    type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
    status: { sequence: 2, darkModeDetected: true, processing: true, intervened: true }
  }, context);
  const newerSameState = await product.handleMessage({
    type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
    status: { sequence: 4, darkModeDetected: true, processing: true, intervened: true }
  }, context);
  const stale = await product.handleMessage({
    type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
    status: { sequence: 3, darkModeDetected: false, processing: false }
  }, context);
  const state = await product.state(settings, context.sender.tab.url, 17);
  assert.equal(newest.recorded, true);
  assert.equal(newerSameState.recorded, true);
  assert.equal(stale.recorded, false);
  assert.equal(state.darkModeDetected, true);
  assert.equal(state.processing, true);
  assert.equal(state.intervened, true);
  assert.equal(activity, true);
});

test('XHS Image Dark Mode status survives Xiaohongshu same-document navigation', async () => {
  const session = {};
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    storage: { session: {
      async get(key) { return key in session ? { [key]: session[key] } : {}; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; }
    } },
    tabs: { async query() { return []; } }
  };
  const settings = normalizeSettings({ xhsImageDarkMode: { enabled: true } });
  let activityClears = 0;
  const province = createOperationsProvince({
    async getLocale() { return 'en-US'; },
    async readSettings() { return settings; },
    notifyCentralUi() {},
    async setFeatureActivity() {},
    async clearTabActivity() { activityClears += 1; }
  });
  const context = {
    sender: {
      frameId: 0,
      documentId: 'document-spa',
      tab: { id: 23, url: 'https://www.xiaohongshu.com/explore' }
    }
  };
  await province.products.xhsImageDarkMode.handleMessage({
    type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
    status: { sequence: 1, darkModeDetected: true, processing: true, intervened: true }
  }, context);
  await province.handleTabUpdated(23, {
    url: 'https://www.xiaohongshu.com/user/profile/669cf72a000000002401e0fc'
  });
  const state = await province.products.xhsImageDarkMode.state(
    settings,
    'https://www.xiaohongshu.com/user/profile/669cf72a000000002401e0fc',
    23
  );
  assert.equal(activityClears, 0);
  assert.equal(state.darkModeDetected, true);
  assert.equal(state.processing, true);
  assert.equal(state.intervened, true);
});

test('XHS Image Dark Mode status survives a late loading event for its current document', async () => {
  const session = {};
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    storage: { session: {
      async get(key) { return key in session ? { [key]: session[key] } : {}; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; }
    } },
    tabs: { async query() { return []; } }
  };
  const settings = normalizeSettings({ xhsImageDarkMode: { enabled: true } });
  let activityClears = 0;
  const province = createOperationsProvince({
    async getLocale() { return 'en-US'; },
    async readSettings() { return settings; },
    notifyCentralUi() {},
    async setFeatureActivity() {},
    async clearTabActivity() { activityClears += 1; }
  });
  const url = 'https://www.xiaohongshu.com/explore/6a97d678000000001001f028';
  const context = {
    sender: {
      frameId: 0,
      documentId: 'document-current',
      tab: { id: 29, url }
    }
  };
  await province.products.xhsImageDarkMode.handleMessage({
    type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
    status: { sequence: 1, darkModeDetected: true, processing: true, intervened: true }
  }, context);
  await province.handleTabUpdated(29, { status: 'loading' });
  const state = await province.products.xhsImageDarkMode.state(settings, url, 29);
  assert.equal(activityClears, 1);
  assert.equal(state.darkModeDetected, true);
  assert.equal(state.processing, true);
  assert.equal(state.intervened, true);
});

test('XHS Image Dark Mode resets state only when a new document takes ownership', async () => {
  const session = {};
  globalThis.chrome = {
    storage: { session: {
      async get(key) { return key in session ? { [key]: session[key] } : {}; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; }
    } },
    tabs: { async query() { return []; } }
  };
  const settings = normalizeSettings({ xhsImageDarkMode: { enabled: true } });
  const activity = [];
  let notifications = 0;
  const product = createXhsImageDarkModeProduct({ async sync() { return true; } }, {
    async getLocale() { return 'en-US'; },
    async readSettings() { return settings; },
    notifyCentralUi() { notifications += 1; },
    async setFeatureActivity(_tabId, _featureId, value) { activity.push(value); }
  });
  const url = 'https://www.xiaohongshu.com/explore/6a97d678000000001001f028';
  await product.sync({
    tabId: 31,
    frameId: 0,
    documentId: 'document-old',
    topUrl: url
  }, settings);
  const oldDocument = {
    sender: { frameId: 0, documentId: 'document-old', tab: { id: 31, url } }
  };
  await product.handleMessage({
    type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
    status: { sequence: 1, darkModeDetected: true, processing: true }
  }, oldDocument);
  await product.sync({
    tabId: 31,
    frameId: 0,
    documentId: 'document-new',
    topUrl: url
  }, settings);
  const stale = await product.handleMessage({
    type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
    status: { sequence: 2, darkModeDetected: true, processing: true }
  }, oldDocument);
  const state = await product.state(settings, url, 31);
  assert.equal(stale.recorded, false);
  assert.equal(state.darkModeDetected, false);
  assert.equal(state.processing, false);
  assert.equal(activity.at(-1), false);
  assert.equal(notifications, 3);
});

test('Page Display master authorization gates its independent top-frame visual features', async () => {
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
  assert.equal(settings.pageDisplay.enabled, true);
  await product.handleMessage({
    type: 'UI_SET_ENABLED',
    featureId: 'pageDisplay',
    enabled: false
  });
  assert.equal(settings.pageDisplay.greyscale.enabled, true);
  assert.equal(await product.sync({
    tabId: 9,
    frameId: 0,
    documentId: 'top',
    topUrl: 'https://example.com/'
  }, settings), false);
  await product.handleMessage({
    type: 'UI_SET_ENABLED',
    featureId: 'pageDisplay',
    enabled: true
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
  assert.equal(refreshes, 7);
  assert.deepEqual(syncs.map(({ frameId, active }) => ({ frameId, active })), [
    { frameId: 0, active: false },
    { frameId: 0, active: true },
    { frameId: 0, active: false },
    { frameId: 0, active: true },
    { frameId: 3, active: false },
    { frameId: 0, active: false },
    { frameId: 0, active: true },
    { frameId: 0, active: false }
  ]);
});
