import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from '../extension/core/config.js';
import { createAnyCopyProduct } from '../extension/background/products/operations/any-copy.js';
import { centralPageDirectives } from '../extension/background/central-policy.js';

function fixture(saved = {}) {
  const session = {}, refreshed = [], activity = [];
  const tabs = new Map([
    [1, { id: 1, url: 'https://www.example.co.uk/one' }],
    [2, { id: 2, url: 'https://sub.example.co.uk/two' }],
    [3, { id: 3, url: 'https://other.co.uk/' }],
    [4, { id: 4, url: 'https://www.example.co.uk/', incognito: true }]
  ]);
  let settings = normalizeSettings(saved), failWrite = false, failSettings = false;
  const base = 'chrome-extension://test/';
  globalThis.chrome = {
    runtime: { getURL: path => base + path },
    storage: { session: {
      async get(key) { return key === null ? { ...session } : { [key]: session[key] }; },
      async set(values) { if (failWrite) throw Error('write failed'); Object.assign(session, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key]; }
    } },
    tabs: { async get(id) { return tabs.get(id); }, async query() { return [...tabs.values()]; } }
  };
  const platform = incognito => ({
    isIncognitoContext: () => incognito,
    async readSettings() { return settings; },
    async mutateSettings(update) { const next = normalizeSettings(await update(settings));
      if (failSettings) throw Error('settings write failed'); settings = next; return settings; },
    async setFeatureActivity(...args) { activity.push(args); },
    async refreshTabPage(id) { refreshed.push(id); }
  });
  const create = (incognito = false) => createAnyCopyProduct({ async sync() {} }, platform(incognito));
  const product = create();
  const context = { sender: { url: base + 'popup/index.html' },
    async resolvePageDirectives(url) { return centralPageDirectives(settings, url); } };
  const toggle = (id = 1, p = product, extra = {}) => p.handleMessage({
    type: 'UI_TOGGLE_SITE_FEATURE', tabId: id,
    expectedHostname: new URL(tabs.get(id).url).hostname, ...extra
  }, context);
  const state = (url, p = product) => p.state(settings, url, undefined, centralPageDirectives(settings, url));
  return { session, tabs, refreshed, activity, product, create, context, toggle, state,
    settings: () => settings, failWrite: value => { failWrite = value; }, failSettings: value => { failSettings = value; } };
}

test('Any Copy popup shares a temporary eTLD+1 choice across tabs without changing saved sites', async () => {
  const f = fixture(), original = structuredClone(f.settings());
  const enabled = await f.toggle();
  assert.equal(enabled.active, true);
  assert.equal(enabled.persistentPolicy, false);
  for (const url of ['https://example.co.uk/', 'http://deep.sub.example.co.uk:8080/path']) {
    assert.equal((await f.state(url)).active, true);
  }
  for (const url of ['https://other.co.uk/', 'https://notexample.co.uk/', 'https://example.co.uk.evil.test/']) {
    assert.equal((await f.state(url)).active, false);
  }
  assert.deepEqual(f.refreshed.sort(), [1, 2]);
  assert.equal((await f.toggle(2)).active, false);
  assert.deepEqual(f.activity.map(args => args[0]).sort(), [1, 2]);
  assert.deepEqual(f.settings(), original);
});

test('temporary off overrides saved wildcard rules and survives the last matching tab closing', async () => {
  const f = fixture({ anyCopy: { siteRules: ['*.example.co.uk', 'other.co.uk'] } });
  const disabled = await f.toggle();
  assert.equal(disabled.active, false);
  assert.equal(disabled.persistentPolicy, true);
  f.tabs.delete(1); f.tabs.delete(2);
  const restarted = f.create();
  assert.equal((await f.state('https://new.example.co.uk/', restarted)).active, false);
  assert.equal((await f.state('https://other.co.uk/', restarted)).active, true);
  assert.deepEqual(f.settings().anyCopy.siteRules, ['*.example.co.uk', 'other.co.uk']);
  // Chrome clears storage.session on browser exit; the saved rules then resume.
  for (const key of Object.keys(f.session)) delete f.session[key];
  assert.equal((await f.state('https://new.example.co.uk/', f.create())).active, true);
});

test('Central coordinated activation obeys the same domain-session choice and copy-guard priority', async () => {
  const f = fixture({ adMarshal: { managedSites: { zhihu: true } } });
  f.tabs.get(1).url = 'https://www.zhihu.com/question/1';
  f.tabs.get(2).url = 'https://zhuanlan.zhihu.com/p/2';
  assert.equal((await f.toggle()).active, false);
  const paused = await f.state(f.tabs.get(2).url);
  assert.equal(paused.active, false);
  assert.equal(paused.persistentPolicy, true);
  assert.equal(centralPageDirectives(f.settings(), f.tabs.get(2).url,
    { anyCopyActive: paused.active }).clipboardProtect.yieldToAnyCopy, false);
  assert.equal((await f.toggle(2)).active, true);
  assert.deepEqual(f.settings().anyCopy.siteRules, []);
});

test('concurrent clicks across subdomains serialize the shared choice and keep unrelated domains', async () => {
  const f = fixture();
  const result = await Promise.all([f.toggle(), f.toggle(2), f.toggle(3)]);
  assert.deepEqual(result.map(state => state.active), [true, false, true]);
  assert.equal((await f.state('https://example.co.uk/')).active, false);
  assert.equal((await f.state('https://other.co.uk/')).active, true);
});

test('regular and private website policies remain isolated, including reset', async () => {
  const f = fixture();
  await f.toggle();
  const privateProduct = f.create(true);
  assert.equal((await f.state(f.tabs.get(4).url, privateProduct)).active, false);
  await f.toggle(4, privateProduct);
  await f.toggle();
  assert.equal((await f.state(f.tabs.get(4).url, privateProduct)).active, true);
  await f.product.reset();
  assert.equal((await f.state(f.tabs.get(4).url, privateProduct)).active, true);
  await privateProduct.reset();
  assert.deepEqual(f.session, {});
});

test('stale navigation, foreign contexts, untrusted controls, and failed writes cannot change policies', async () => {
  const f = fixture();
  f.tabs.get(1).pendingUrl = 'https://other.co.uk/';
  await assert.rejects(f.toggle(), /page changed/i);
  delete f.tabs.get(1).pendingUrl;
  await assert.rejects(f.toggle(4), /page changed/i);
  await assert.rejects(f.product.handleMessage({ type: 'UI_TOGGLE_SITE_FEATURE' },
    { sender: { url: 'https://example.co.uk/' } }), /only.*popup/);
  await assert.rejects(f.product.handleMessage({ type: 'UI_DELETE_RULE', listName: 'siteRules',
    rule: 'example.co.uk' }, f.context), /only.*Settings/);
  f.failWrite(true);
  await assert.rejects(f.toggle(), /write failed/);
  assert.deepEqual(f.session, {});
  assert.deepEqual(f.refreshed, []);
  f.failWrite(false);
  assert.equal((await f.toggle()).active, true, 'the command queue recovers after failure');
});

test('IP addresses are exact, and unsupported pages never inherit a session choice', async () => {
  const f = fixture();
  f.tabs.get(1).url = 'http://127.0.0.1:9999/';
  await f.toggle();
  assert.equal((await f.state('http://127.0.0.1:80/')).active, true);
  assert.equal((await f.state('http://127.0.0.2/')).active, false);
  assert.equal((await f.state('chrome://settings/')).active, false);
});


for (const listed of [false, true]) {
  for (const temporary of [false, true]) {
    test(`Any Copy hold: listed=${listed}, temporary=${temporary}`, async () => {
      const f = fixture({ anyCopy: { siteRules: listed ? ['other.co.uk', '*.example.co.uk'] : ['other.co.uk'] } });
      f.session['anyCopySite:example.co.uk'] = { active: temporary };
      const result = await f.toggle(1, f.product, { scope: 'persistent' });
      const expected = !listed && !temporary ? true : temporary;
      assert.equal(result.active, expected);
      assert.equal(result.persistentPolicy, !listed);
      assert.deepEqual(f.session['anyCopySite:example.co.uk'], { active: expected });
      assert.deepEqual(f.settings().anyCopy.siteRules, listed ? ['other.co.uk'] : ['other.co.uk', '*.example.co.uk']);
    });
  }
}

test('holding removes same-family legacy rules together and preserves unrelated websites', async () => {
  const f = fixture({ anyCopy: { siteRules: ['example.co.uk', '*.example.co.uk', 'deep.example.co.uk', 'other.co.uk'] } });
  await f.toggle(1, f.product, { scope: 'persistent' });
  assert.deepEqual(f.settings().anyCopy.siteRules, ['other.co.uk']);
  assert.equal((await f.state('https://deep.example.co.uk/')).active, false);
});


test('holding on a bare public suffix cannot authorize independent tenant domains', async () => {
  const f = fixture();
  f.tabs.get(1).url = 'https://co.uk/';
  await f.toggle(1, f.product, { scope: 'persistent' });
  assert.deepEqual(f.settings().anyCopy.siteRules, ['co.uk']);
  assert.equal((await f.state('https://example.co.uk/')).active, false);
});


test('automatic temporary activation rolls back when the persistent Any Copy save fails', async () => {
  const f = fixture();
  f.session['anyCopySite:example.co.uk'] = { active: false };
  f.failSettings(true);
  await assert.rejects(f.toggle(1, f.product, { scope: 'persistent' }), /settings write failed/);
  assert.deepEqual(f.settings().anyCopy.siteRules, []);
  assert.deepEqual(f.session['anyCopySite:example.co.uk'], { active: false });
  f.failSettings(false);
  assert.equal((await f.toggle(1, f.product, { scope: 'persistent' })).active, true);
});
