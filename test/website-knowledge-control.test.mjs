import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeSettings, DEFAULT_INCOGNITO_SETTINGS, websiteKnowledgeControlState,
  validateWebsiteKnowledgeValue } from '../extension/core/config.js';
import { createWebsiteKnowledgeControlProduct } from '../extension/background/products/standing/website-knowledge-control.js';
import { createChineseResponseClaudeProduct } from '../extension/background/products/operations/chinese-response-claude.js';

function runtimeFixture(crypto = { randomUUID: () => 'test-token' }) {
  const context = vm.createContext({ crypto, location: { hostname: 'claude.ai' }, queueMicrotask });
  vm.runInContext(`
    globalThis.window = new class {
      listeners = new Map();
      addEventListener(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) || []), listener]); }
      removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== listener)); }
      dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); }
    };
    globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
    globalThis.navigator = Object.create(Object.defineProperties({}, {
      language: { configurable: true, get: () => 'fr-FR' },
      languages: { configurable: true, get: () => ['fr-FR', 'fr'] }
    }));
    globalThis.document = { documentElement: {}, querySelectorAll: () => [] };
    globalThis.native = { Date, format: Intl.DateTimeFormat, locale: new Intl.NumberFormat().resolvedOptions().locale,
      offset: new Date('2026-01-15T12:00:00Z').getTimezoneOffset() };
  `, context);
  const load = name => vm.runInContext(readFileSync(new URL('../extension/content/' + name, import.meta.url), 'utf8'), context);
  load('shared/browser-identity.js');
  load('website-knowledge-control/website-knowledge-control-runtime.js');
  const run = source => vm.runInContext(source, context);
  const configure = preferences => {
    const settings = normalizeSettings({ websiteKnowledgeControl: {
      enabled: true, globalPrivacyControl: { enabled: true }, ...preferences
    } });
    context.configuration = websiteKnowledgeControlState(settings, 'https://example.com');
    run(`window.dispatchEvent(new CustomEvent('cosmic-gemini:website-knowledge-control:configure', {
      detail: JSON.stringify({ token: 'test-token', config: configuration })
    }))`);
  };
  return { context, run, configure, load };
}

test('Website Knowledge Control starts when randomUUID is unavailable on an HTTP page', () => {
  const f = runtimeFixture({
    getRandomValues(values) { values.fill(0xab); return values; }
  });
  assert.equal(f.run(`globalThis[Symbol.for('cosmic-gemini.website-knowledge-control.runtime')].token`), 'ab'.repeat(18));
});

test('Website Knowledge Control validates independent preferences and starts disabled', () => {
  const settings = normalizeSettings();
  assert.equal(websiteKnowledgeControlState(settings, 'https://example.com').active, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.websiteKnowledgeControl.enabled, false);
  assert.equal(settings.websiteKnowledgeControl.globalPrivacyControl.enabled, false);
  assert.equal(validateWebsiteKnowledgeValue('languages', 'zh-cn'), 'zh-CN');
  assert.equal(validateWebsiteKnowledgeValue('languages', 'zh-hans'), 'zh-Hans');
  assert.equal(validateWebsiteKnowledgeValue('languages', 'zh-hant'), 'zh-Hant');
  assert.equal(validateWebsiteKnowledgeValue('languages', 'zh-mo'), 'zh-MO');
  assert.equal(validateWebsiteKnowledgeValue('languages', 'zh-tw'), 'zh-TW');
  assert.equal(validateWebsiteKnowledgeValue('languages', 'zh-my'), 'zh-MY');
  assert.equal(validateWebsiteKnowledgeValue('languages', 'zh-sg'), 'zh-SG');
  assert.throws(() => validateWebsiteKnowledgeValue('languages', 'made up'));
  assert.throws(() => validateWebsiteKnowledgeValue('timeZone', 'Not/A_Zone'));
  assert.equal(validateWebsiteKnowledgeValue('languages', 'fr-fr'), 'fr-FR');
  assert.equal(websiteKnowledgeControlState(normalizeSettings({ websiteKnowledgeControl: { enabled: true } }), 'chrome://settings').active, false);
  const malformed = normalizeSettings({ websiteKnowledgeControl: { enabled: true,
    languages: { value: 'bad_locale' }, locale: { enabled: true, value: 'de-DE' }, timeZone: { value: 'bad' } } });
  assert.equal(malformed.websiteKnowledgeControl.languages.value, 'en-US');
  assert.equal('locale' in malformed.websiteKnowledgeControl, false, 'the retired independent locale setting is ignored');
  assert.equal(malformed.websiteKnowledgeControl.timeZone.value, 'America/New_York');
});

test('Website Knowledge Control applies region-neutral Chinese language and locale identities', () => {
  for (const language of ['zh-Hans', 'zh-Hant']) {
    const f = runtimeFixture();
    f.configure({ languages: { enabled: true, value: language }, timeZone: { enabled: false } });
    assert.equal(f.run('navigator.language'), language);
    assert.equal(f.run('[...navigator.languages].join(",")'), language);
    assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), language);
  }
});

test('Website Knowledge Control sends region-neutral Chinese Accept-Language values unchanged', async () => {
  for (const language of ['zh-Hans', 'zh-Hant']) {
    const updates = [];
    globalThis.chrome = {
      tabs: { async query() { return [{ id: 8, url: 'https://example.com', incognito: false }]; } },
      declarativeNetRequest: { async updateSessionRules(update) { updates.push(update); } }
    };
    const settings = normalizeSettings({ websiteKnowledgeControl: {
      enabled: true,
      languages: { enabled: true, value: language },
      timeZone: { enabled: false },
      globalPrivacyControl: { enabled: false }
    } });
    const product = createWebsiteKnowledgeControlProduct({ sync: async () => true }, {
      isIncognitoContext: () => false,
      readSettings: async () => settings
    });
    await product.initialize();
    const requestHeaders = updates.at(-1).addRules[0].action.requestHeaders;
    assert.equal(requestHeaders.find(header => header.header === 'Accept-Language').value, language);
  }
});

test('Website Knowledge Control ignores delayed events for closed or changed tabs', async () => {
  const snapshot = { id: 9, url: 'https://example.com', incognito: false };
  const tabs = new Map([[9, snapshot]]);
  const updates = [];
  globalThis.chrome = {
    tabs: {
      async query() { return [...tabs.values()]; },
      async get(id) { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); }
    },
    declarativeNetRequest: { async updateSessionRules(update) { updates.push(update); } }
  };
  const settings = normalizeSettings({ websiteKnowledgeControl: { enabled: true,
    languages: { enabled: true, value: 'en-US' } } });
  const product = createWebsiteKnowledgeControlProduct({ sync: async () => true }, {
    isIncognitoContext: () => false, readSettings: async () => settings
  });
  await product.initialize();
  assert.deepEqual(updates.at(-1).addRules[0].condition.tabIds, [9]);
  tabs.delete(9);
  await product.handleTabUpdated(9, { status: 'loading' }, snapshot);
  assert.deepEqual(updates.at(-1).addRules, [], 'a late update removes the closed tab’s request rule');
  tabs.set(9, { id: 9, url: 'chrome://settings', incognito: false });
  await product.handleTabCreated(snapshot);
  assert.deepEqual(updates.at(-1).addRules, [], 'a stale web snapshot cannot scope a new page');
});

test('Website Knowledge Control freezes the initial document policy until the next page load', () => {
  const f = runtimeFixture();
  assert.equal(f.run('navigator.language'), 'fr-FR', 'loading an authorized runtime does not apply policy before configuration');
  f.configure({ languages: { enabled: true, value: 'de-DE' }, timeZone: { enabled: false } });
  assert.equal(f.run('navigator.language'), 'de-DE');
  assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'de-DE');
  assert.equal(f.run('navigator.globalPrivacyControl'), true);
  assert.equal(f.run('new Intl.NumberFormat("ja-JP").resolvedOptions().locale'), 'ja-JP');
  assert.equal(f.run('Date === native.Date'), true);
  f.configure({ languages: { enabled: true, value: 'fr-FR' }, timeZone: { enabled: false } });
  assert.equal(f.run('navigator.language'), 'de-DE');
  assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'de-DE');
  assert.equal(f.run('navigator.globalPrivacyControl'), true);
  f.configure({ enabled: false });
  assert.equal(f.run('navigator.language'), 'de-DE');
  assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'de-DE');
  f.run(`window.dispatchEvent(new CustomEvent('cosmic-gemini:website-knowledge-control:dispose', { detail: 'test-token' }))`);
  assert.equal(f.run('[...window.listeners.values()].flat().length'), 0);
  assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'de-DE');
  f.load('website-knowledge-control/website-knowledge-control-runtime.js');
  f.configure({ languages: { enabled: true, value: 'fr-FR' }, timeZone: { enabled: false } });
  assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'de-DE');
  const nextDocument = runtimeFixture();
  assert.equal(nextDocument.run('new Intl.NumberFormat().resolvedOptions().locale === native.locale'), true);
  assert.equal(nextDocument.run('navigator.globalPrivacyControl'), undefined);
});

test('Website Knowledge Control time zone follows DST and keeps local Date operations coherent', () => {
  const f = runtimeFixture();
  f.configure({ languages: { enabled: false }, timeZone: { enabled: true, value: 'America/New_York' } });
  assert.equal(f.run('new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'America/New_York');
  assert.equal(f.run('new Intl.DateTimeFormat(undefined, { timeZone: undefined }).resolvedOptions().timeZone'), 'America/New_York');
  assert.equal(f.run('new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions().timeZone'), 'UTC');
  assert.equal(f.run(`new Date('2026-01-15T12:00:00Z').getTimezoneOffset()`), 300);
  assert.equal(f.run(`new Date('2026-07-15T12:00:00Z').getTimezoneOffset()`), 240);
  assert.equal(f.run(`new Date('2026-01-15T07:00:00').toISOString()`), '2026-01-15T12:00:00.000Z');
  assert.equal(f.run(`new Date(Date.parse('2026-01-15T07:00:00')).toISOString()`), '2026-01-15T12:00:00.000Z');
  assert.equal(f.run(`new Date('2026-01-15').toISOString()`), '2026-01-15T00:00:00.000Z');
  assert.equal(f.run(`new Date(2026, 2, 8, 2, 30).toISOString()`), '2026-03-08T07:30:00.000Z');
  assert.equal(f.run(`new Date(2026, 10, 1, 1, 30).toISOString()`), '2026-11-01T05:30:00.000Z');
  assert.equal(f.run(`(() => { const d = new Date('2026-01-15T12:00:00Z'); d.setHours(9); return d.toISOString(); })()`), '2026-01-15T14:00:00.000Z');
  assert.equal(f.run(`(() => { const d = new Date('2026-01-15T12:00:00Z'); d.setMonth(6); return d.toISOString(); })()`), '2026-07-15T11:00:00.000Z');
  f.run(`globalThis.oldFormat = Intl.DateTimeFormat; globalThis.oldRead = Date.prototype.getHours`);
  f.configure({ enabled: false });
  assert.equal(f.run('new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'America/New_York');
  assert.equal(f.run(`oldRead.call(new Date(0)) === new Date(0).getHours()`), true);
});

test('Claude dedicated identity wins as a whole in either activation order and yields on disposal', () => {
  for (const claudeFirst of [false, true]) {
    const f = runtimeFixture();
    f.load('chinese-response-claude/chinese-response-claude-runtime.js');
    f.run(`globalThis.claude = globalThis[Symbol.for('cosmic-gemini.chinese-response-claude.runtime')];
      claude.detectSystemTimeZone = () => 'Europe/Paris'; claude.detectSystemTimeZoneOffset = () => -60;`);
    const startClaude = () => f.run(`claude.onConfigure({ detail: JSON.stringify({ token: claude.token, config: {
      active: true, responseDisplay: false, browserIdentityActive: true
    } }) });`);
    if (claudeFirst) startClaude();
    f.configure({ languages: { enabled: true, value: 'de-DE' }, timeZone: { enabled: true, value: 'Asia/Tokyo' } });
    if (!claudeFirst) startClaude();
    assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'en-US');
    assert.equal(f.run('new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'Europe/Paris');
    assert.equal(f.run('navigator.globalPrivacyControl'), true);
    f.run('claude.disable()');
    assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'de-DE');
    assert.equal(f.run('new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'Asia/Tokyo');
    f.configure({ enabled: false });
    assert.equal(f.run('new Intl.NumberFormat().resolvedOptions().locale'), 'de-DE');
    assert.equal(f.run('new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'Asia/Tokyo');
  }
});

test('Website Knowledge Control scopes request language by context, retries rules, and saves independently', async () => {
  let settings = normalizeSettings({ websiteKnowledgeControl: {
    languages: { enabled: true }, globalPrivacyControl: { enabled: true }
  } });
  const updates = [];
  let failRules = false;
  let tabs = [{ id: 1, url: 'https://example.com', incognito: false }, { id: 2, url: 'https://private.example', incognito: true }];
  globalThis.chrome = {
    tabs: { async query() { return tabs; } },
    declarativeNetRequest: { async updateSessionRules(update) { if (failRules) throw Error('busy'); updates.push(update); } }
  };
  const platform = {
    isIncognitoContext: () => false, readSettings: async () => settings,
    mutateSettings: async update => (settings = normalizeSettings(update(settings))),
    refreshOpenPages: async () => { throw Error('tab closed'); }
  };
  const syncs = [];
  const host = { sync: async (product, context, active) => syncs.push({ product, context, active }) };
  const product = createWebsiteKnowledgeControlProduct(host, platform);
  await product.initialize();
  assert.equal(updates[0].addRules.length, 0);
  failRules = true;
  const saved = await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true });
  assert.equal(saved.enabled, true);
  failRules = false;
  await product.handleTabCreated(tabs[0]);
  const rule = updates.at(-1).addRules[0];
  assert.deepEqual(rule.condition.tabIds, [1]);
  assert.ok(rule.condition.resourceTypes.includes('main_frame'));
  assert.ok(rule.condition.resourceTypes.includes('xmlhttprequest'));
  assert.equal(rule.action.requestHeaders.find(header => header.header === 'Accept-Language').value, 'en-US');
  assert.equal(rule.action.requestHeaders.find(header => header.header === 'Sec-GPC').value, '1');
  const previous = updates.length;
  await product.initialize();
  assert.equal(updates.length, previous, 'unchanged rules are not reinstalled');
  const incognito = createWebsiteKnowledgeControlProduct(host, { ...platform, isIncognitoContext: () => true });
  await incognito.initialize();
  assert.notEqual(updates.at(-1).addRules[0].id, rule.id);
  assert.deepEqual(updates.at(-1).addRules[0].condition.tabIds, [2]);
  const claude = createChineseResponseClaudeProduct(host, { ...platform,
    readSettings: async () => normalizeSettings({ chineseResponseClaude: { browserIdentityEnabled: true } }) });
  await claude.initialize();
  assert.ok(updates.at(-1).addRules[0].priority > rule.priority);
  assert.deepEqual(updates.at(-1).addRules[0].condition.tabIds, [1]);
  const beforeLanguageChange = updates.length;
  await product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'languages', enabled: true, value: 'de-DE' });
  assert.equal(updates.length, beforeLanguageChange, 'saving does not replace the current page request language');
  await product.handleTabUpdated(1, { status: 'loading' }, tabs[0]);
  assert.equal(updates.at(-1).addRules[0].action.requestHeaders.find(header => header.header === 'Accept-Language').value, 'de-DE');
  await product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'languages', enabled: true, value: 'fr-FR' });
  const thirdTab = { id: 3, url: 'https://new.example', incognito: false };
  tabs.push(thirdTab);
  await product.handleTabCreated(thirdTab);
  assert.deepEqual(updates.at(-1).addRules.map(item => [
    item.action.requestHeaders.find(header => header.header === 'Accept-Language')?.value || '',
    item.condition.tabIds
  ]), [['de-DE', [1]], ['fr-FR', [3]]]);
  const beforeDisable = updates.length;
  await product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'languages', enabled: false });
  assert.equal(updates.length, beforeDisable, 'turning the setting off waits for the next page load');
  await product.handleTabUpdated(1, { status: 'loading' }, tabs[0]);
  assert.deepEqual(updates.at(-1).addRules.map(item => item.condition.tabIds), [[1], [3]]);
  await product.handleTabUpdated(3, { status: 'loading' }, thirdTab);
  assert.deepEqual(updates.at(-1).addRules.map(item => item.condition.tabIds), [[1, 3]]);
  assert.equal(updates.at(-1).addRules[0].action.requestHeaders.some(header => header.header === 'Accept-Language'), false);
  assert.equal(updates.at(-1).addRules[0].action.requestHeaders.find(header => header.header === 'Sec-GPC').value, '1');
  const beforeGpcDisable = updates.length;
  await product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'globalPrivacyControl', enabled: false });
  assert.equal(updates.length, beforeGpcDisable, 'turning GPC off waits for the next page load');
  await product.handleTabUpdated(1, { status: 'loading' }, tabs[0]);
  assert.deepEqual(updates.at(-1).addRules.map(item => item.condition.tabIds), [[3]]);
  await product.handleTabUpdated(3, { status: 'loading' }, thirdTab);
  assert.equal(updates.at(-1).addRules.length, 0);
  assert.equal(settings.websiteKnowledgeControl.languages.enabled, false);
  await product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'timeZone',
    enabled: true, value: 'America/New_York' });
  await product.sync({ frameId: 3, frameUrl: 'https://frame.example', topUrl: 'https://example.com' }, settings);
  assert.equal(syncs.at(-1).active, true);
  await assert.rejects(product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'timeZone', value: 'broken' }));
  await assert.rejects(product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'locale',
    enabled: true, value: 'de-DE' }));
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false });
  await product.sync({ frameId: 0, topUrl: 'https://example.com' }, settings);
  assert.equal(syncs.at(-1).active, false);
  tabs = [];
  await product.handleTabRemoved(1);
  assert.equal(updates.at(-1).addRules.length, 0);
});
