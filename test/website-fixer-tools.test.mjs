import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from '../extension/core/config.js';
import { createContextSessionStorage } from '../extension/background/commissions/central-cc.js';
import { createWebsiteFixerProduct } from '../extension/background/products/standing/website-fixer.js';

function fixture() {
  const session = {}, scripts = new Map();
  let settings = normalizeSettings(), rules = [{ id: 880001, action: { type: 'block' } }];
  let failWrite = false, failRegistration = 0, mutations = 0;
  const tabs = new Map([[1, { id: 1, url: 'https://deep.example.co.uk/path', incognito: false }],
    [2, { id: 2, url: 'https://private.example.co.uk/path', incognito: true }]]);
  globalThis.chrome = {
    runtime: { getURL: value => 'chrome-extension://test/' + value },
    storage: { session: {
      async get(key) { const keys = key == null ? Object.keys(session) : Array.isArray(key) ? key : [key];
        return structuredClone(Object.fromEntries(keys.filter(k => k in session).map(k => [k, session[k]]))); },
      async set(values) { if (failWrite) throw new Error('session write failed'); Object.assign(session, structuredClone(values)); },
      async remove(key) { if (failWrite) throw new Error('session write failed'); for (const k of Array.isArray(key) ? key : [key]) delete session[k]; }
    } },
    tabs: { get: async id => tabs.get(id), query: async () => [...tabs.values()] },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => [...scripts.values()].filter(s => ids.includes(s.id)),
      registerContentScripts: async values => {
        if (failRegistration-- > 0) throw new Error('registration failed');
        for (const script of values) scripts.set(script.id, script);
      },
      updateContentScripts: async values => { for (const script of values) scripts.set(script.id, script); },
      unregisterContentScripts: async ({ ids }) => { for (const id of ids) scripts.delete(id); },
      executeScript: async () => []
    },
    declarativeNetRequest: {
      getSessionRules: async () => structuredClone(rules),
      updateSessionRules: async ({ removeRuleIds, addRules = [] }) => {
        rules = rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    }
  };
  const product = (incognito = false) => createWebsiteFixerProduct({
    isIncognitoContext: () => incognito, sessionStorage: createContextSessionStorage(incognito),
    readSettings: async () => settings,
    mutateSettings: async revise => { mutations++; return settings = normalizeSettings(await revise(settings)); }
  });
  const send = (p, kind, enabled, extra = {}, sender = 'popup/index.html') => p.handleMessage({
    type: 'UI_SET_WEBSITE_FIXER_TOOL', featureId: 'websiteFixer', kind, enabled,
    expectedSite: 'example.co.uk', tabId: 1, ...extra
  }, { sender: { url: chrome.runtime.getURL(sender) } });
  const active = (p, kind, url) => p.handleMessage({ type: 'CG_WEBSITE_FIXER_ACTIVATE', kind },
    { sender: { url } });
  return { product, send, active, session, scripts, tabs, settings: () => settings,
    rules: () => rules, mutations: () => mutations, failWrite: value => { failWrite = value; },
    failRegistration: value => { failRegistration = value; },
    setSettings: value => { settings = normalizeSettings(value); } };
}

test('popup tools are eTLD+1 browser-session choices independent of saved switches and lists', async () => {
  const f = fixture(), p = f.product(), before = structuredClone(f.settings());
  await p.initialize();
  await f.send(p, 'translateOverride', true);
  await f.send(p, 'stayOnPage', true);
  assert.deepEqual(f.settings(), before);
  assert.equal(f.mutations(), 0);
  assert.deepEqual((await p.state(before, 'https://other.example.co.uk/')).tools,
    { site: 'example.co.uk', supported: true, translateOverride: true, stayOnPage: true });
  assert.equal((await p.state(before, 'https://other.example.co.uk/')).active, true);
  assert.equal((await p.state(before, 'https://example.co.uk.evil.test/')).tools.stayOnPage, false);
  assert.equal((await p.state(before, 'chrome://settings/')).tools.supported, false);
  assert.equal((await p.state(before, 'https://192.0.2.1/')).tools.supported, false);
  assert.equal((await p.state(before, 'https://github.io/')).tools.supported, false);
  assert.equal((await p.state(before, 'https://co.uk/')).tools.supported, false);
  assert.equal((await p.state(before, 'https://employee.corporate-server.corp/')).tools.site, 'corporate-server.corp');
  assert.equal(f.scripts.size, 3);
  for (const script of f.scripts.values()) {
    assert.equal(script.persistAcrossSessions, false);
    assert.deepEqual(script.matches, ['*://*.example.co.uk/*']);
  }
  assert.equal((await f.active(p, 'translateOverride', 'https://www.example.co.uk/')).active, true);
  assert.equal((await f.active(p, 'stayOnPage', 'https://evil.test/')).active, false);
  assert.equal(f.rules().some(rule => rule.id === 880001), true, 'other products retain their network rules');

  const restarted = f.product();
  await restarted.initialize();
  assert.equal((await restarted.state(before, 'https://example.co.uk/')).tools.stayOnPage, true,
    'worker suspension does not end the Chrome session');
  await f.send(restarted, 'translateOverride', false);
  assert.equal((await f.active(restarted, 'translateOverride', 'https://example.co.uk/')).active, false);
  assert.equal((await f.active(restarted, 'stayOnPage', 'https://example.co.uk/')).active, true);
  for (const key of Object.keys(f.session)) delete f.session[key]; // Chrome session ends.
  await f.product().initialize();
  assert.equal(f.scripts.size, 0);
  assert.deepEqual(f.rules().map(rule => rule.id), [880001]);
});

test('tools do not authorize saved domains while the Website Fixer master is off', async () => {
  const f = fixture();
  f.setSettings({ websiteFixer: { enabled: false,
    translateOverride: { enabled: true, whitelistDomains: ['saved.test'] },
    stayOnPage: { enabled: true, whitelistDomains: ['saved.test'] } } });
  const p = f.product();
  await f.send(p, 'stayOnPage', true);
  for (const kind of ['translateOverride', 'stayOnPage']) {
    assert.equal((await f.active(p, kind, 'https://saved.test/')).active, false);
  }
  f.setSettings({ websiteFixer: { enabled: true,
    stayOnPage: { enabled: true, whitelistDomains: ['example.co.uk'] } } });
  await f.send(p, 'stayOnPage', false);
  assert.equal((await f.active(p, 'stayOnPage', 'https://example.co.uk/')).active, true,
    'cancelling a temporary choice preserves the independently saved policy');
});

test('session choices roll back on storage or registration failure and validate tab ownership', async () => {
  const f = fixture(), p = f.product();
  await assert.rejects(f.send(p, 'stayOnPage', true, {}, 'settings/satellites.html'), /only from the popup/);
  await assert.rejects(f.send(p, 'stayOnPage', true, { expectedSite: 'evil.test' }), /page changed/);
  await assert.rejects(f.send(p, 'stayOnPage', true, { tabId: 2 }), /page changed/);
  f.tabs.get(1).pendingUrl = 'https://elsewhere.test/';
  await assert.rejects(f.send(p, 'stayOnPage', true), /page changed/);
  delete f.tabs.get(1).pendingUrl;
  f.failWrite(true);
  await assert.rejects(f.send(p, 'stayOnPage', true), /session write failed/);
  assert.equal(f.scripts.size, 0);
  assert.deepEqual(f.rules().map(rule => rule.id), [880001]);
  f.failWrite(false); f.failRegistration(3);
  await assert.rejects(f.send(p, 'stayOnPage', true), /registration failed/);
  assert.deepEqual(f.session, {});
  assert.equal(f.scripts.size, 0);
});

test('ordinary and private tools remain independent and reset only their own registrations and records', async () => {
  const f = fixture(), normal = f.product(), privateProduct = f.product(true);
  await f.send(normal, 'translateOverride', true);
  assert.equal((await privateProduct.state(f.settings(), 'https://example.co.uk/')).tools.translateOverride, false);
  await f.send(privateProduct, 'stayOnPage', true, { tabId: 2 });
  await privateProduct.reset();
  assert.equal((await normal.state(f.settings(), 'https://example.co.uk/')).tools.translateOverride, true);
  assert.equal((await privateProduct.state(f.settings(), 'https://example.co.uk/')).tools.stayOnPage, false);
  assert.equal(f.scripts.size, 1);
  await normal.reset();
  assert.deepEqual(f.session, {});
  assert.equal(f.scripts.size, 0);
});
