import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from '../extension/core/config.js';
import { createContextSessionStorage } from '../extension/background/commissions/central-cc.js';
import { createWebsiteFixerProduct } from '../extension/background/products/standing/website-fixer.js';

function fixture() {
  const session = {}, scripts = new Map();
  let settings = normalizeSettings(), rules = [{ id: 880001, action: { type: 'block' } }];
  let failWrite = false, failRegistration = 0, mutations = 0, failSettings = false;
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
    mutateSettings: async revise => { mutations++; const next = normalizeSettings(await revise(settings));
      if (failSettings) throw Error('settings write failed'); return settings = next; }
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
    failSettings: value => { failSettings = value; },
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
    { site: 'example.co.uk', supported: true, persistent: { translateOverride: false, stayOnPage: false }, persistentEnabled: { translateOverride: false, stayOnPage: false }, translateOverride: true, stayOnPage: true });
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

test('tools do not authorize dormant child lists and temporary off overrides saved policy', async () => {
  const f = fixture();
  f.setSettings({ websiteFixer: { enabled: false,
    translateOverride: { enabled: false, whitelistDomains: ['saved.test'] },
    stayOnPage: { enabled: false, whitelistDomains: ['saved.test'] } } });
  const p = f.product();
  await f.send(p, 'stayOnPage', true);
  for (const kind of ['translateOverride', 'stayOnPage']) {
    assert.equal((await f.active(p, kind, 'https://saved.test/')).active, false);
  }
  f.setSettings({ websiteFixer: { enabled: true,
    stayOnPage: { enabled: true, whitelistDomains: ['example.co.uk'] } } });
  await f.send(p, 'stayOnPage', false);
  assert.equal((await f.active(p, 'stayOnPage', 'https://example.co.uk/')).active, false,
    'temporary off overrides the independently saved policy');
  assert.deepEqual(f.settings().websiteFixer.stayOnPage.whitelistDomains, ['example.co.uk']);
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


for (const kind of ['translateOverride', 'stayOnPage']) {
  test(`${kind}: holding an active tool preserves its temporary choice`, async () => {
    const f = fixture();
    f.setSettings({ websiteFixer: { enabled: false, [kind]: { enabled: false, whitelistDomains: ['dormant.test'] } } });
    const p = f.product();
    await f.send(p, kind, true);
    const sessionBefore = structuredClone(f.session);
    await f.send(p, kind, true, { scope: 'persistent' });
    assert.deepEqual(f.session, sessionBefore);
    const saved = f.settings().websiteFixer[kind];
    assert.equal(saved.enabled, false, 'holding must not enable the entire saved child list');
    assert.deepEqual(saved.whitelistDomains, ['dormant.test', 'example.co.uk']);
    assert.equal((await f.active(p, kind, 'https://sub.example.co.uk/')).active, true);
    assert.equal((await f.active(p, kind, 'https://dormant.test/')).active, false);
    await f.send(p, kind, false);
    const state = (await p.state(f.settings(), 'https://example.co.uk/')).tools;
    assert.equal(state[kind], false);
    assert.equal(state.persistent[kind], true);
    assert.equal(state.persistentEnabled[kind], false);
    assert.deepEqual(f.settings().websiteFixer[kind], saved);
    for (const key of Object.keys(f.session)) delete f.session[key];
    await f.product().initialize();
    assert.equal((await f.active(p, kind, 'https://sub.example.co.uk/')).active, false,
      'after Chrome exits, saved rules follow the child switch');
    f.setSettings({ ...f.settings(), websiteFixer: { ...f.settings().websiteFixer,
      [kind]: { ...f.settings().websiteFixer[kind], enabled: true } } });
    await p.initialize();
    assert.equal((await f.active(p, kind, 'https://sub.example.co.uk/')).active, true);
    await f.send(p, kind, false, { scope: 'persistent' });
    assert.deepEqual(f.settings().websiteFixer[kind].whitelistDomains, ['dormant.test']);
    assert.equal((await f.active(p, kind, 'https://example.co.uk/')).active, false);
  });
}

test('persistent tool changes roll back registrations and temporary choices if saving fails', async () => {
  const f = fixture(), p = f.product();
  f.failSettings(true);
  await assert.rejects(f.send(p, 'translateOverride', true, { scope: 'persistent' }), /settings write failed/);
  assert.deepEqual(f.settings().websiteFixer.translateOverride.whitelistDomains, []);
  assert.equal(f.scripts.size, 0);
  f.failSettings(false);
  f.setSettings({ websiteFixer: { stayOnPage: { enabled: true } } });
  f.failRegistration(3);
  await assert.rejects(f.send(p, 'stayOnPage', true, { scope: 'persistent' }), /registration failed/);
  assert.deepEqual(f.settings().websiteFixer.stayOnPage.whitelistDomains, []);
  assert.deepEqual(f.session, {});
});

test('legacy positive session entries remain temporary and stored-list deletion removes ongoing authorization', async () => {
  const f = fixture(), p = f.product();
  f.session.cosmicGeminiWebsiteFixerTools = { translateOverride: ['example.co.uk'], stayOnPage: [] };
  assert.equal((await f.active(p, 'translateOverride', 'https://example.co.uk/')).active, true);
  assert.deepEqual(f.settings().websiteFixer.translateOverride.whitelistDomains, []);
  await f.send(p, 'translateOverride', true, { scope: 'persistent' });
  await p.handleMessage({ type: 'UI_DELETE_RULE', settingGroup: 'translateOverride', listName: 'whitelistDomains', rule: 'example.co.uk' },
    { sender: { url: chrome.runtime.getURL('settings/satellites.html') } });
  assert.deepEqual(f.settings().websiteFixer.translateOverride.whitelistDomains, []);
  for (const key of Object.keys(f.session)) delete f.session[key];
  assert.equal((await f.active(p, 'translateOverride', 'https://example.co.uk/')).active, false);
});


for (const kind of ['translateOverride', 'stayOnPage']) {
  for (const listed of [false, true]) {
    for (const temporary of [false, true]) {
      test(`${kind} hold: listed=${listed}, temporary=${temporary}`, async () => {
        const f = fixture();
        f.setSettings({ websiteFixer: { [kind]: { enabled: false,
          whitelistDomains: listed ? ['dormant.test', 'example.co.uk'] : ['dormant.test'] } } });
        const p = f.product();
        await f.send(p, kind, temporary);
        await f.send(p, kind, !listed, { scope: 'persistent' });
        const state = (await p.state(f.settings(), 'https://example.co.uk/')).tools;
        const expected = !listed && !temporary ? true : temporary;
        assert.equal(state[kind], expected);
        assert.equal(state.persistent[kind], !listed);
        assert.equal(state.persistentEnabled[kind], false);
        assert.deepEqual(f.session.cosmicGeminiWebsiteFixerTools[kind], [{ site: 'example.co.uk', enabled: expected }]);
        assert.deepEqual(f.settings().websiteFixer[kind].whitelistDomains,
          listed ? ['dormant.test'] : ['dormant.test', 'example.co.uk']);
      });
    }
  }
}
