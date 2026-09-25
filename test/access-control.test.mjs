import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  normalizeAccessControlDomain,
  normalizeSettings
} from '../extension/core/config.js';
import { createAccessControlProduct } from '../extension/background/products/standing/access-control.js';
import { createWebsiteFixerProduct } from '../extension/background/products/standing/website-fixer.js';

test('Access Control starts disabled and stores canonical domains and exact IP addresses', () => {
  assert.deepEqual(DEFAULT_SETTINGS.accessControl, { enabled: false, allowTemporaryVisits: false, blockedDomains: [] });
  assert.deepEqual(DEFAULT_INCOGNITO_SETTINGS.accessControl, { enabled: false, allowTemporaryVisits: false, blockedDomains: [] });
  assert.equal(normalizeAccessControlDomain('Example.COM'), 'example.com');
  assert.equal(normalizeAccessControlDomain('*.Example.COM'), 'example.com');
  assert.equal(normalizeAccessControlDomain('192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeAccessControlDomain('2001:0db8::1'), '[2001:db8::1]');
  assert.throws(() => normalizeAccessControlDomain('https://example.com/path'));
  assert.throws(() => normalizeAccessControlDomain('localhost'));
  assert.deepEqual(normalizeSettings({ accessControl: {
    enabled: true,
    blockedDomains: ['z.example', '*.Example.com', 'z.example', 'bad/path', 'a.example', '192.0.2.1', '2001:db8::1']
  } }).accessControl, {
    enabled: true,
    allowTemporaryVisits: false,
    blockedDomains: ['z.example', 'example.com', 'a.example', '192.0.2.1', '[2001:db8::1]']
  });
  assert.equal(normalizeSettings({ accessControl: { blockedDomains: Array.from({ length: 1001 },
    (_, index) => `site${index}.example`) } }).accessControl.blockedDomains.length, 1000);
});

test('Access Control installs root-and-subdomain navigation blocks and removes them when disabled', async () => {
  let settings = normalizeSettings({ accessControl: { enabled: true, blockedDomains: ['example.com', 'media.example'] } });
  let installed = [];
  const updates = [];
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    declarativeNetRequest: {
      async getSessionRules() { return installed; },
      async updateSessionRules(update) {
        updates.push(update);
        const removed = new Set(update.removeRuleIds || []);
        installed = installed.filter(rule => !removed.has(rule.id)).concat(update.addRules || []);
      }
    }
  };
  const platform = {
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async update => (settings = normalizeSettings(await update(settings)))
  };
  const product = createAccessControlProduct(platform);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => [rule.id, rule.condition.urlFilter]), [
    [920001, '||example.com^'],
    [920002, '||media.example^']
  ]);
  assert.deepEqual(installed[0].condition.resourceTypes, ['main_frame', 'sub_frame']);
  const installedOnce = updates.length;
  await product.reconcile();
  assert.equal(updates.length, installedOnce, 'unchanged rules are not reinstalled');

  const saved = await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: '*.docs.example.com'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(saved.blockedDomains, ['example.com', 'media.example', 'docs.example.com']);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), [
    '||example.com^', '||media.example^', '||docs.example.com^'
  ]);

  await product.handleMessage({
    type: 'UI_DELETE_RULE', listName: 'blockedDomains', rule: 'example.com'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  const reordered = await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: 'example.com'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(reordered.blockedDomains, ['media.example', 'docs.example.com', 'example.com']);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), [
    '||media.example^', '||docs.example.com^', '||example.com^'
  ]);

  const alphabetized = await product.handleMessage({
    type: 'UI_ALPHABETIZE_RULES', listName: 'blockedDomains'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(alphabetized.blockedDomains, ['docs.example.com', 'example.com', 'media.example']);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), [
    '||docs.example.com^', '||example.com^', '||media.example^'
  ]);

  const appended = await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: 'a-later.example'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(appended.blockedDomains, [
    'docs.example.com', 'example.com', 'media.example', 'a-later.example'
  ]);

  await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: '192.0.2.1'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: '2001:0db8::1'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  await product.reconcile();
  assert.equal(installed.at(-2).condition.urlFilter, undefined);
  assert.equal(new RegExp(installed.at(-2).condition.regexFilter).test('http://192.0.2.1:8080/path'), true);
  assert.equal(new RegExp(installed.at(-2).condition.regexFilter).test('http://x.192.0.2.1/path'), false);
  assert.equal(installed.at(-1).condition.urlFilter, undefined);
  assert.match(installed.at(-1).condition.regexFilter, /2001:db8::1/);
  assert.equal(new RegExp(installed.at(-1).condition.regexFilter).test('https://[2001:db8::1]:8443/path'), true);

  const cleared = await product.handleMessage({
    type: 'UI_CLEAR_RULES', listName: 'blockedDomains'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(cleared.blockedDomains, []);
  await product.reconcile();
  assert.deepEqual(installed, []);

  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false }, {
    sender: { url: 'chrome-extension://test/settings/satellites.html' }
  });
  await product.reconcile();
  assert.deepEqual(installed, []);
  assert.ok(updates.at(-1).removeRuleIds.length > 0);
});

test('Access Control rejects changes outside Settings', async () => {
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    declarativeNetRequest: { async getSessionRules() { return []; }, async updateSessionRules() {} }
  };
  const settings = normalizeSettings();
  const product = createAccessControlProduct({
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async update => normalizeSettings(await update(settings))
  });
  await assert.rejects(product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true }, {
    sender: { url: 'https://example.com/' }
  }));
});

test('Access Control uses the toolbar button to retry a blocked navigation in the current tab', async () => {
  const tab = { id: 17, windowId: 2, active: true, incognito: false, url: 'chrome-error://chromewebdata/' };
  const retried = [];
  const popups = new Map();
  const session = new Map();
  let errorListener, completeListener;
  let installed = [];
  let settings = normalizeSettings({
    accessControl: { enabled: true, allowTemporaryVisits: true, blockedDomains: ['example.com', 'elsewhere.example'] }
  });
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    webRequest: { onErrorOccurred: {
      hasListener: listener => errorListener === listener,
      addListener: listener => { errorListener = listener; },
      removeListener: listener => { if (errorListener === listener) errorListener = undefined; }
    }, onCompleted: {
      addListener: listener => { completeListener = listener; }
    } },
    storage: { session: {
      async get(key) { return { [key]: session.get(key) }; },
      async set(values) { for (const [key, value] of Object.entries(values)) session.set(key, value); },
      async remove(key) { session.delete(key); }
    } },
    action: {
      async getPopup({ tabId }) { return popups.get(tabId) ?? 'popup/index.html'; },
      async setPopup({ tabId, popup }) { popups.set(tabId, popup); }
    },
    tabs: {
      async query() { return [tab]; },
      async get(tabId) { return tabId === tab.id ? tab : null; },
      async sendMessage() {
        if (!/^https?:/.test(tab.url)) throw new Error('No page receiver');
        return { url: tab.url };
      },
      async update(tabId, options) { retried.push([tabId, options.url]); tab.url = options.url; }
    },
    declarativeNetRequest: {
      async getSessionRules() { return installed; },
      async updateSessionRules(update) {
        const removed = new Set(update.removeRuleIds || []);
        installed = installed.filter(rule => !removed.has(rule.id)).concat(update.addRules || []);
      }
    }
  };
  const product = createAccessControlProduct({
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async update => (settings = normalizeSettings(await update(settings)))
  });
  await product.reconcile();
  assert.equal(typeof errorListener, 'function');
  assert.equal(typeof completeListener, 'function');
  assert.equal(popups.get(tab.id), undefined, 'normal pages retain the normal popup');
  const blockRules = installed;
  installed = [];
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide', error: 'net::ERR_CONNECTION_RESET' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.has('accessControlPendingVisit:17'), false,
    'a failed request without an installed Access Control block is not offered as a visit');
  installed = blockRules;
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide',
    error: 'net::ERR_BLOCKED_BY_CLIENT', requestId: 'blocked-1', timeStamp: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.get('accessControlPendingVisit:17').url, 'https://docs.example.com/guide');
  assert.equal(popups.get(tab.id), '', 'the blocked tab routes its toolbar click to the background');
  completeListener({ tabId: tab.id, requestId: 'older', timeStamp: 999 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(popups.get(tab.id), '', 'an older successful request cannot erase a newer block');
  completeListener({ tabId: tab.id, requestId: 'newer', timeStamp: 1001 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.has('accessControlPendingVisit:17'), false);
  assert.equal(popups.get(tab.id), 'popup/index.html', 'successful navigation clears the retry action');
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide',
    error: 'net::ERR_BLOCKED_BY_CLIENT', requestId: 'blocked-late', timeStamp: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.has('accessControlPendingVisit:17'), false,
    'a delayed error from before the successful navigation cannot restore the retry action');
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide',
    error: 'net::ERR_BLOCKED_BY_CLIENT', requestId: 'blocked-2', timeStamp: 1002 });
  await new Promise(resolve => setImmediate(resolve));
  const beforeRemoval = settings;
  settings = normalizeSettings({ accessControl: { enabled: true, allowTemporaryVisits: true,
    blockedDomains: ['elsewhere.example'] } });
  await product.reconcile();
  assert.equal(session.has('accessControlPendingVisit:17'), false,
    'removing a blocked domain discards its pending retry');
  assert.equal(popups.get(tab.id), 'popup/index.html');
  settings = beforeRemoval;
  await product.reconcile();
  assert.equal(popups.get(tab.id), 'popup/index.html',
    're-adding a domain does not resurrect its old retry action');
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide',
    error: 'net::ERR_BLOCKED_BY_CLIENT', requestId: 'blocked-3', timeStamp: 1003 });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(await product.state(settings, 'https://docs.example.com/guide', tab.id), {
    enabled: true,
    allowTemporaryVisits: true,
    blockedDomains: ['example.com', 'elsewhere.example'],
    active: true,
    supported: true,
    matchedRule: 'example.com',
    blocked: true,
    temporarilyAllowed: false
  });
  tab.url = 'https://allowed.example.net/';
  await product.handleTabUpdated(tab.id, { url: tab.url }, tab);
  assert.equal(session.has('accessControlPendingVisit:17'), false, 'leaving discards the blocked destination');
  assert.equal(popups.get(tab.id), 'popup/index.html');
  tab.url = 'chrome-error://chromewebdata/';
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide', error: 'net::ERR_BLOCKED_BY_CLIENT' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(popups.get(tab.id), '');
  assert.deepEqual(await product.handleActionClicked(tab), {
    allowed: true,
    domain: 'example.com'
  });
  assert.deepEqual(retried, [[17, 'https://docs.example.com/guide']]);
  assert.equal(popups.get(tab.id), 'popup/index.html');
  assert.equal(session.has('accessControlPendingVisit:17'), false);
  const visit = installed.find(rule => rule.action.type === 'allow');
  assert.equal(visit.id, 924001);
  assert.equal(visit.priority, 200);
  assert.equal(visit.condition.urlFilter, '||example.com^');
  assert.deepEqual(visit.condition.tabIds, [17]);
  assert.equal((await product.state(settings, tab.url, tab.id)).blocked, false);
  assert.equal((await product.state(settings, tab.url, tab.id)).temporarilyAllowed, true);

  const originalSettings = settings;
  settings = normalizeSettings({ accessControl: { enabled: true, allowTemporaryVisits: true,
    blockedDomains: ['docs.example.com', 'example.com', 'elsewhere.example'] } });
  await product.reconcile();
  assert.equal((await product.state(settings, tab.url, tab.id)).temporarilyAllowed, true,
    'a parent-domain visit also covers a more specific listed domain');
  await product.handleTabUpdated(tab.id, { url: tab.url }, tab);
  assert.ok(installed.some(rule => rule.id === visit.id),
    'overlapping saved domains cannot accidentally revoke the current visit');
  settings = originalSettings;
  await product.reconcile();

  installed = installed.filter(rule => rule.action.type !== 'allow');
  session.set('accessControlPendingVisit:17', { url: 'https://elsewhere.example/', at: 1003, requestId: 'stale' });
  popups.set(tab.id, '');
  assert.equal(await product.handleActionClicked(tab), false,
    'a stale pending destination cannot navigate away from a loaded document');
  assert.deepEqual(retried, [[17, 'https://docs.example.com/guide']]);
  session.set('accessControlPendingVisit:17', { url: tab.url, at: 1003, requestId: 'stale' });
  popups.set(tab.id, '');
  await product.reconcile();
  assert.equal(session.has('accessControlPendingVisit:17'), false,
    'a real loaded document invalidates a stale blocked-navigation record');
  assert.equal(popups.get(tab.id), 'popup/index.html');
  errorListener({ tabId: tab.id, url: tab.url, requestId: 'late-error', timeStamp: Date.now() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.has('accessControlPendingVisit:17'), false,
    'a delayed failure cannot replace the popup on a live document');

  await product.reconcile();
  assert.equal(popups.get(tab.id), 'popup/index.html',
    'losing a visit rule does not turn an already loaded page into a retry action');
  installed.push(visit);

  await product.handleTabUpdated(tab.id, { url: 'https://sub.example.com/next' }, {
    url: 'https://sub.example.com/next'
  });
  assert.ok(installed.some(rule => rule.action.type === 'allow'), 'the visit survives within the blocked domain');
  await product.handleTabUpdated(tab.id, { url: 'https://allowed.example.net/' }, {
    url: 'https://sub.example.com/next'
  });
  assert.equal(installed.some(rule => rule.action.type === 'allow'), false,
    'the authoritative changed URL wins over a stale tab snapshot when leaving the site');

  tab.url = 'https://elsewhere.example/';
  await product.handleTabUpdated(tab.id, { status: 'complete' }, tab);
  assert.equal(popups.get(tab.id), 'popup/index.html',
    'a loaded page without a visit rule still opens the normal popup');
  popups.set(tab.id, '');
  assert.equal(await product.handleActionClicked(tab), false,
    'a stale one-time-visit action cannot retry a loaded page');
  assert.deepEqual(retried, [[17, 'https://docs.example.com/guide']]);
  assert.equal(popups.get(tab.id), 'popup/index.html');
  const blockedElsewhere = tab.url;
  tab.url = 'chrome-error://chromewebdata/';
  errorListener({ tabId: tab.id, url: blockedElsewhere, error: 'net::ERR_BLOCKED_BY_CLIENT' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(popups.get(tab.id), '');
  await product.handleActionClicked(tab);
  assert.deepEqual(retried.at(-1), [17, 'https://elsewhere.example/']);
  assert.ok(installed.some(rule => rule.action.type === 'allow'));
  const disabled = await product.handleMessage({
    type: 'UI_SET_ACCESS_CONTROL_TEMPORARY_VISITS', enabled: false
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.equal(disabled.allowTemporaryVisits, false);
  await product.reconcile();
  assert.equal(installed.some(rule => rule.action.type === 'allow'), false, 'disabling one-time visits revokes the exception');
  assert.equal(typeof errorListener, 'function', 'MV3 listener remains registered through worker lifetime');
  assert.equal(popups.get(tab.id), 'popup/index.html');

  await product.handleMessage({
    type: 'UI_SET_ACCESS_CONTROL_TEMPORARY_VISITS', enabled: true
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  await product.reconcile();
  await product.handleActionClicked(tab);
  await product.handleTabRemoved(tab.id);
  assert.equal(installed.some(rule => rule.action.type === 'allow'), false);
});

test('Access Control restores the previous visit if a new retry fails', async () => {
  const tab = { id: 31, windowId: 4, active: true, incognito: false, url: 'chrome-error://chromewebdata/' };
  const previousVisit = { id: 924001, priority: 200, action: { type: 'allow' },
    condition: { urlFilter: '||example.com^', tabIds: [tab.id], resourceTypes: ['main_frame', 'sub_frame'] } };
  let installed = [previousVisit], failRetry = true;
  const session = new Map();
  const popups = new Map([[tab.id, '']]);
  const settings = normalizeSettings({ accessControl: { enabled: true, allowTemporaryVisits: true,
    blockedDomains: ['example.com', 'other.example'] } });
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    storage: { session: {
      async get(key) { return { [key]: session.get(key) }; },
      async set(values) { for (const [key, value] of Object.entries(values)) session.set(key, value); },
      async remove(key) { session.delete(key); }
    } },
    action: {
      async getPopup({ tabId }) { return popups.get(tabId) ?? 'popup/index.html'; },
      async setPopup({ tabId, popup }) { popups.set(tabId, popup); }
    },
    tabs: {
      async query() { return [tab]; },
      async get() { return tab; },
      async update(_, { url }) { if (failRetry) throw new Error('navigation failed'); tab.url = url; }
    },
    declarativeNetRequest: {
      async getSessionRules() { return installed; },
      async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
        installed = installed.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    }
  };
  const product = createAccessControlProduct({
    isIncognitoContext: () => false, readSettings: async () => settings
  });
  await product.reconcile();
  session.set('accessControlPendingVisit:31', { url: 'https://other.example/', at: 1, requestId: 'blocked' });
  popups.set(tab.id, '');
  await assert.rejects(product.handleActionClicked(tab), /navigation failed/);
  assert.deepEqual(installed.filter(rule => rule.action.type === 'allow'), [previousVisit]);
  assert.equal(session.get('accessControlPendingVisit:31').url, 'https://other.example/',
    'the blocked destination remains available for a later retry');

  failRetry = false;
  assert.deepEqual(await product.handleActionClicked(tab), { allowed: true, domain: 'other.example' });
  assert.deepEqual(installed.filter(rule => rule.action.type === 'allow').map(rule => rule.condition.urlFilter),
    ['||other.example^']);
  assert.equal(session.has('accessControlPendingVisit:31'), false);
});

test('removing a Stay on the page site leaves Access Control blocks intact and repairs missing blocks', async () => {
  let settings = normalizeSettings({
    accessControl: { enabled: true, blockedDomains: ['example.com'] },
    websiteFixer: { enabled: true, stayOnPage: { enabled: true, whitelistDomains: ['example.com'] } }
  });
  let installed = [];
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    tabs: { query: async () => [] },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {}
    },
    declarativeNetRequest: {
      getSessionRules: async () => installed,
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        installed = installed.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    }
  };
  const platform = {
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async update => (settings = normalizeSettings(await update(settings)))
  };
  const access = createAccessControlProduct(platform);
  const fixer = createWebsiteFixerProduct(platform);
  await access.reconcile();
  await fixer.initialize();
  assert.deepEqual(installed.map(rule => rule.id), [920001, 930002]);

  const before = settings;
  await fixer.handleMessage({ type: 'UI_DELETE_RULE', listName: 'whitelistDomains',
    settingGroup: 'stayOnPage', rule: 'https://www.example.com/article' },
  { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  await access.handleStorageChanged({ [SETTINGS_KEY]: { oldValue: before, newValue: settings } }, 'local');
  assert.deepEqual(settings.accessControl.blockedDomains, ['example.com']);
  assert.deepEqual(installed.map(rule => rule.id), [920001]);

  installed = [];
  const changed = { ...settings, websiteFixer: { ...settings.websiteFixer,
    stayOnPage: { ...settings.websiteFixer.stayOnPage, whitelistDomains: ['another.test'] } } };
  await access.handleStorageChanged({ [SETTINGS_KEY]: { oldValue: settings, newValue: changed } }, 'local');
  assert.deepEqual(installed.map(rule => rule.id), [920001], 'related settings changes repair a missing block');
  installed[0].condition.tabIds = [7];
  await access.reconcile();
  assert.equal(installed[0].condition.tabIds, undefined, 'a tab-limited block is not accepted as global');
});

test('Access Control does not save a new blocked site when network rules cannot be installed', async () => {
  let settings = normalizeSettings({ accessControl: { enabled: true, blockedDomains: ['example.com'] } });
  let installed = [], failNetwork = false, transientFailures = 0, ignoreNetworkUpdate = false, failStorage = false;
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    declarativeNetRequest: {
      getSessionRules: async () => installed,
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        if (failNetwork) throw new Error('network rules unavailable');
        if (transientFailures > 0) {
          transientFailures -= 1;
          throw new Error('temporary network rule failure');
        }
        if (ignoreNetworkUpdate) return;
        installed = installed.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    }
  };
  const access = createAccessControlProduct({
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async update => {
      const next = normalizeSettings(await update(settings));
      if (failStorage) throw new Error('settings unavailable');
      return (settings = next);
    }
  });
  await access.reconcile();
  const message = { type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: 'another.test' };
  const context = { sender: { url: 'chrome-extension://test/settings/satellites.html' } };
  failNetwork = true;
  await assert.rejects(access.handleMessage(message, context), /network rules unavailable/);
  failNetwork = false;
  assert.deepEqual(settings.accessControl.blockedDomains, ['example.com']);
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), ['||example.com^']);

  transientFailures = 1;
  const recovered = await access.handleMessage(message, context);
  assert.deepEqual(recovered.blockedDomains, ['example.com', 'another.test']);
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), ['||example.com^', '||another.test^']);
  await access.handleMessage({ ...message, type: 'UI_DELETE_RULE' }, context);

  ignoreNetworkUpdate = true;
  await assert.rejects(access.handleMessage(message, context), /could not verify/);
  ignoreNetworkUpdate = false;
  assert.deepEqual(settings.accessControl.blockedDomains, ['example.com']);

  failStorage = true;
  await assert.rejects(access.handleMessage(message, context), /settings unavailable/);
  failStorage = false;
  assert.deepEqual(settings.accessControl.blockedDomains, ['example.com']);
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), ['||example.com^'],
    'a failed settings write restores the previous network block list');
});
