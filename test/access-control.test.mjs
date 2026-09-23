import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  DEFAULT_SETTINGS,
  normalizeAccessControlDomain,
  normalizeSettings
} from '../extension/core/config.js';
import { createAccessControlProduct } from '../extension/background/products/standing/access-control.js';

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
    mutateSettings: async update => (settings = normalizeSettings(update(settings)))
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
    mutateSettings: async update => normalizeSettings(update(settings))
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
  let errorListener;
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
    mutateSettings: async update => (settings = normalizeSettings(update(settings)))
  });
  await product.reconcile();
  assert.equal(typeof errorListener, 'function');
  assert.equal(popups.get(tab.id), undefined, 'normal pages retain the normal popup');
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.get('accessControlPendingVisit:17'), 'https://docs.example.com/guide');
  assert.equal(popups.get(tab.id), '', 'the blocked tab routes its toolbar click to the background');

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
  errorListener({ tabId: tab.id, url: 'https://docs.example.com/guide' });
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

  await product.handleTabUpdated(tab.id, { url: 'https://sub.example.com/next' }, {
    url: 'https://sub.example.com/next'
  });
  assert.ok(installed.some(rule => rule.action.type === 'allow'), 'the visit survives within the blocked domain');
  await product.handleTabUpdated(tab.id, { url: 'https://allowed.example.net/' }, {
    url: 'https://allowed.example.net/'
  });
  assert.equal(installed.some(rule => rule.action.type === 'allow'), false);

  tab.url = 'https://elsewhere.example/';
  await product.handleTabUpdated(tab.id, { url: tab.url }, tab);
  assert.equal(popups.get(tab.id), '');
  await product.handleActionClicked(tab);
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
