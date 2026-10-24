import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeSettings, DEFAULT_INCOGNITO_SETTINGS, websiteKnowledgeControlState,
  validateWebsiteKnowledgeValue } from '../extension/core/config.js';
import { createWebsiteKnowledgeControlProduct } from '../extension/background/products/standing/website-knowledge-control.js';
import { createChineseResponseClaudeProduct } from '../extension/background/products/operations/chinese-response-claude.js';

let documentSequence=0;
const loadDocument=(product,settings,tab)=>product.sync({tabId:tab.id,frameId:0,
  documentId:'fixture-document-'+(++documentSequence),topUrl:tab.url},settings);

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
      language: { configurable: true, get: function language() { if(this!==navigator)throw new TypeError('Illegal invocation');return 'fr-FR'; } },
      languages: { configurable: true, get: function languages() { if(this!==navigator)throw new TypeError('Illegal invocation');return ['fr-FR', 'fr']; } }
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

test('request-profile capacity covers all Settings language and GPC combinations retained by open tabs', async () => {
  const html = readFileSync(new URL('../extension/settings/satellites.html', import.meta.url), 'utf8');
  const menu = html.match(/id="websiteKnowledgeLanguagesValue"[\s\S]*?<\/select>/)[0];
  const languages = [...menu.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
  const profiles = languages.flatMap(language => [false, true].map(globalPrivacyControl => ({language, globalPrivacyControl})));
  profiles.push({language:'',globalPrivacyControl:true});
  const tabs = profiles.map((_, i) => ({id:i + 1,url:'https://example.com/',incognito:false}));
  const updates = [];
  globalThis.chrome = {
    tabs:{query:async()=>tabs},
    storage:{session:{get:async key=>({[key]:{version:2,tabs:Object.fromEntries(profiles.map((value,i)=>[i+1,value]))}}),set:async()=>{}}},
    declarativeNetRequest:{updateSessionRules:async update=>updates.push(update)}
  };
  const product = createWebsiteKnowledgeControlProduct({sync:async()=>true}, {isIncognitoContext:()=>false,readSettings:async()=>normalizeSettings()});
  assert.equal(await product.initialize(),true);
  assert.equal(updates.at(-1).addRules.length, profiles.length);
  for (const tab of tabs) {
    const rule = updates.at(-1).addRules.find(rule=>rule.condition.tabIds.includes(tab.id));
    const profile = profiles[tab.id-1];
    assert.equal(rule.action.requestHeaders.find(header=>header.header==='Accept-Language')?.value || '',profile.language);
    assert.equal(rule.action.requestHeaders.some(header=>header.header==='Sec-GPC'),profile.globalPrivacyControl);
    assert.ok(rule.id < 910101, 'regular rules cannot overlap incognito rule IDs');
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
  assert.equal(updates.at(-1).addRules.every(rule=>rule.condition.resourceTypes.length===1&&rule.condition.resourceTypes[0]==='main_frame'),true,
    'a non-web tab may prepare its next navigation but cannot inherit a page-resource profile');
});

test('request profiles preserve disabled tabs across worker restart and cannot revive after reset', async () => {
  let settings = normalizeSettings({ websiteKnowledgeControl: { enabled: true, languages: { enabled: true } } });
  const tabs = [{ id: 8, url: 'https://example.com', incognito: false }];
  const stored = {}, updates = [];
  let failRead = false;
  globalThis.chrome = {
    storage: { session: {
      get: async key => { if (failRead) throw Error('storage unavailable'); return structuredClone({ [key]: stored[key] }); },
      set: async values => Object.assign(stored, structuredClone(values))
    } },
    tabs: { query: async () => tabs, get: async id => tabs.find(tab => tab.id === id) },
    declarativeNetRequest: { updateSessionRules: async update => updates.push(update) }
  };
  const create = () => createWebsiteKnowledgeControlProduct({sync:async()=>true}, {
    isIncognitoContext: () => false, readSettings: async () => settings
  });
  let product = create();
  await product.initialize();
  settings = normalizeSettings();
  await loadDocument(product,settings,tabs[0]);
  settings = normalizeSettings({ websiteKnowledgeControl: { enabled: true, languages: { enabled: true, value: 'ja-JP' } } });
  product = create();
  await product.initialize();
  assert.deepEqual(updates.at(-1).addRules, [], 'an explicitly inactive loaded tab waits for its own next load');
  await loadDocument(product,settings,tabs[0]);
  assert.equal(updates.at(-1).addRules[0].action.requestHeaders[0].value, 'ja-JP');
  await product.reset();
  settings = normalizeSettings();
  tabs.push({ id: 9, url: 'https://another.example', incognito: false });
  await product.handleTabCreated(tabs[1]);
  assert.deepEqual(updates.at(-1).addRules, [], 'reset removes retained profiles before later navigation');
  failRead = true;
  product = create();
  await assert.rejects(product.initialize(), /storage unavailable/);
  failRead = false;
  await product.initialize();
  assert.deepEqual(updates.at(-1).addRules, []);
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
    tabs: { async query() { return tabs; }, async get(id) { return tabs.find(tab=>tab.id===id); } },
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
  assert.equal(rule.condition.resourceTypes.includes('main_frame'), false, 'current-page rules exclude future main-frame navigation');
  assert.equal(updates.some(update=>update.addRules.some(rule=>rule.condition.resourceTypes.includes('main_frame')&&rule.condition.tabIds.includes(1))),true);
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
  assert.equal(updates.length, beforeLanguageChange+1, 'saving prepares only the next navigation');
  assert.deepEqual(updates.at(-1).addRules[0].condition.resourceTypes,['main_frame']);
  assert.equal(updates.at(-1).addRules[0].action.requestHeaders.find(header=>header.header==='Accept-Language').value,'de-DE');
  await loadDocument(product,settings,tabs[0]);
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
  assert.equal(updates.length, beforeDisable+1, 'turning language off prepares the next navigation without changing page requests');
  assert.deepEqual(updates.at(-1).addRules[0].condition.resourceTypes,['main_frame']);
  await loadDocument(product,settings,tabs[0]);
  assert.deepEqual(updates.at(-1).addRules.map(item => item.condition.tabIds), [[1], [3]]);
  await loadDocument(product,settings,thirdTab);
  assert.deepEqual(updates.at(-1).addRules.map(item => item.condition.tabIds), [[1, 3]]);
  assert.equal(updates.at(-1).addRules[0].action.requestHeaders.some(header => header.header === 'Accept-Language'), false);
  assert.equal(updates.at(-1).addRules[0].action.requestHeaders.find(header => header.header === 'Sec-GPC').value, '1');
  const beforeGpcDisable = updates.length;
  await product.handleMessage({ type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', category: 'globalPrivacyControl', enabled: false });
  assert.equal(updates.length, beforeGpcDisable+1, 'turning GPC off clears its next-navigation rule');
  assert.deepEqual(updates.at(-1).addRules,[]);
  await loadDocument(product,settings,tabs[0]);
  assert.deepEqual(updates.at(-1).addRules.map(item => item.condition.tabIds), [[3]]);
  await loadDocument(product,settings,thirdTab);
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


test('selected language keeps browser getter contracts without adding unrelated legacy properties', () => {
  const f=runtimeFixture();
  f.run(`globalThis.originalLanguage=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),'language').get;
    globalThis.originalNumber=Number.prototype.toLocaleString;globalThis.originalString=String.prototype.localeCompare;`);
  f.configure({languages:{enabled:true,value:'de-DE'},timeZone:{enabled:false},globalPrivacyControl:{enabled:false}});
  assert.equal(f.run("['userLanguage','browserLanguage','systemLanguage','globalPrivacyControl'].some(key=>key in navigator)"),false);
  assert.equal(f.run(`(() => {const getter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),'language').get;
    return getter.name===originalLanguage.name&&getter.length===originalLanguage.length&&Object.getPrototypeOf(getter)===Object.getPrototypeOf(originalLanguage);})()`),true);
  assert.throws(()=>f.run("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),'language').get.call({})"),/Illegal invocation/);
  assert.equal(f.run('Number.prototype.toLocaleString.name===originalNumber.name&&Number.prototype.toLocaleString.length===originalNumber.length'),true);
  assert.equal(f.run('String.prototype.localeCompare.name===originalString.name&&String.prototype.localeCompare.length===originalString.length'),true);
  assert.throws(()=>f.run('new Number.prototype.toLocaleString()'),/not a constructor/);
  assert.equal(f.run('Date===native.Date'),true,'unselected time zone must not replace Date');
});

test('matching locale and time zone leave native formatting APIs untouched', () => {
  const f=runtimeFixture();
  f.run(`globalThis.nativeMethods=[Date.prototype.toLocaleString,Number.prototype.toLocaleString,String.prototype.localeCompare,Intl.NumberFormat,Intl.Collator];
    globalThis.zone=new Intl.DateTimeFormat().resolvedOptions().timeZone;`);
  f.configure({languages:{enabled:true,value:f.run('native.locale')},timeZone:{enabled:true,value:f.run('zone')},globalPrivacyControl:{enabled:false}});
  assert.equal(f.run('Intl.DateTimeFormat===native.format&&Date===native.Date'),true);
  assert.equal(f.run('[Date.prototype.toLocaleString,Number.prototype.toLocaleString,String.prototype.localeCompare,Intl.NumberFormat,Intl.Collator].every((value,i)=>value===nativeMethods[i])'),true);
});

test('each browser-information category changes only its selected surface', () => {
  for(const category of ['languages','timeZone','globalPrivacyControl']){
    const f=runtimeFixture();
    f.run(`globalThis.snapshot={nav:Object.getOwnPropertyDescriptors(Object.getPrototypeOf(navigator)),intl:Object.getOwnPropertyDescriptors(Intl),
      date:Object.getOwnPropertyDescriptors(Date.prototype),number:Object.getOwnPropertyDescriptors(Number.prototype),array:Object.getOwnPropertyDescriptors(Array.prototype),string:Object.getOwnPropertyDescriptors(String.prototype)};
      globalThis.userAgent=navigator.userAgent;globalThis.devicePlatform=navigator.platform;globalThis.webdriver=navigator.webdriver;`);
    f.configure({languages:{enabled:category==='languages',value:'de-DE'},timeZone:{enabled:category==='timeZone',value:'Asia/Tokyo'},globalPrivacyControl:{enabled:category==='globalPrivacyControl'}});
    const changed=f.run(`(() => {const result={};for(const [name,owner] of Object.entries({nav:Object.getPrototypeOf(navigator),intl:Intl,date:Date.prototype,number:Number.prototype,array:Array.prototype,string:String.prototype})){
      const before=snapshot[name],after=Object.getOwnPropertyDescriptors(owner);result[name]=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>{
      const a=before[key],b=after[key];return !a||!b||a.value!==b.value||a.get!==b.get||a.set!==b.set;});}return result;})()`);
    assert.equal(f.run('navigator.userAgent===userAgent&&navigator.platform===devicePlatform&&navigator.webdriver===webdriver'),true);
    if(category==='globalPrivacyControl'){
      assert.deepEqual([...changed.nav],['globalPrivacyControl']);
      for(const key of ['intl','date','number','array','string'])assert.deepEqual([...changed[key]],[]);
      assert.equal(f.run('Date===native.Date'),true);
    }else if(category==='timeZone'){
      assert.deepEqual([...changed.nav],[]);
      assert.deepEqual([...changed.intl],['DateTimeFormat']);
      for(const key of ['number','array','string'])assert.deepEqual([...changed[key]],[]);
    }else{
      assert.deepEqual([...changed.nav],['language','languages']);
      assert.equal(f.run("new Date('2026-01-15T12:00:00Z').getTimezoneOffset()===native.offset"),true);
      assert.equal(changed.date.every(key=>['toLocaleString','toLocaleDateString','toLocaleTimeString'].includes(key)),true);
    }
  }
});

test('time-zone format options preserve getter receivers, frozen objects, and native option reads', () => {
  const f=runtimeFixture();
  f.configure({languages:{enabled:false},timeZone:{enabled:true,value:'Asia/Tokyo'},globalPrivacyControl:{enabled:false}});
  assert.equal(f.run(`(() => {class Options{#year='numeric';get year(){return this.#year;}get timeZone(){return undefined;}}
    const options=Object.freeze(new Options());return new Intl.DateTimeFormat('en-US',options).resolvedOptions().timeZone;})()`),'Asia/Tokyo');
  assert.match(f.run(`(() => {const values=new WeakMap();const options={get year(){return values.get(this).year;}};values.set(options,{year:'numeric'});
    return new Date('2026-01-15T18:00:00Z').toLocaleDateString('en-US',Object.freeze(options));})()`),/2026/);
  assert.equal(f.run(`(() => {const before=[],after=[];const source={year:'numeric',month:'long',timeZone:'UTC'};
    new native.format('en-US',new Proxy(source,{get(t,k,r){before.push(k);return Reflect.get(t,k,r);}}));
    new Intl.DateTimeFormat('en-US',new Proxy(source,{get(t,k,r){after.push(k);return Reflect.get(t,k,r);}}));
    return JSON.stringify(before)===JSON.stringify(after);})()`),true);
  assert.throws(()=>f.run('new Intl.DateTimeFormat(undefined,null)'),/null|object/i);
});

test('same-document URL changes do not replace a retained request profile with new preferences', async () => {
  const originalChrome=globalThis.chrome;
  let settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,languages:{enabled:true,value:'de-DE'},globalPrivacyControl:{enabled:true}}});
  const updates=[],tab={id:7,url:'https://example.test/a',incognito:false};
  globalThis.chrome={tabs:{query:async()=>[tab],get:async()=>tab},declarativeNetRequest:{updateSessionRules:async value=>updates.push(value)}};
  const product=createWebsiteKnowledgeControlProduct({sync:async()=>true}, {isIncognitoContext:()=>false,readSettings:async()=>settings});
  try{
    await product.initialize();
    settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,languages:{enabled:true,value:'fr-FR'},globalPrivacyControl:{enabled:false}}});
    const count=updates.length;
    for(const url of ['https://example.test/a#section','https://example.test/spa']){tab.url=url;await product.handleTabUpdated(tab.id,{url},tab);}
    assert.equal(updates.length,count);
    assert.equal(updates.at(-1).addRules[0].action.requestHeaders.find(value=>value.header==='Accept-Language').value,'de-DE');
    assert.equal(updates.at(-1).addRules[0].action.requestHeaders.some(value=>value.header==='Sec-GPC'),true);
    await product.handleTabUpdated(tab.id,{status:'loading'},tab);
    assert.deepEqual(updates.at(-1).addRules[0].condition.resourceTypes,['main_frame'],
      'loading may prepare navigation but never changes retained page rules');
    await loadDocument(product,settings,tab);
    assert.equal(updates.at(-1).addRules[0].action.requestHeaders.find(value=>value.header==='Accept-Language').value,'fr-FR');
    assert.equal(updates.at(-1).addRules[0].action.requestHeaders.some(value=>value.header==='Sec-GPC'),false);
  }finally{globalThis.chrome=originalChrome;}
});

test('time-zone adaptations retain Date method signatures, errors, and invalid-date behavior', () => {
  const f=runtimeFixture();
  f.run(`globalThis.nativeDateMethods=Object.getOwnPropertyDescriptors(Date.prototype);globalThis.nativeParseMethod=Date.parse;`);
  f.configure({languages:{enabled:false},timeZone:{enabled:true,value:'Asia/Tokyo'},globalPrivacyControl:{enabled:false}});
  assert.equal(f.run(`Object.entries(nativeDateMethods).filter(([,d])=>typeof d.value==='function').every(([name,d])=>
    Date.prototype[name].name===d.value.name&&Date.prototype[name].length===d.value.length)`),true);
  assert.equal(f.run('Date.parse.name===nativeParseMethod.name&&Date.parse.length===nativeParseMethod.length'),true);
  for(const method of ['getFullYear','getTimezoneOffset','setHours','setYear','toString','toLocaleString']){
    assert.throws(()=>f.run(`new Date.prototype.${method}()`),/not a constructor/);
    assert.throws(()=>f.run(`Date.prototype.${method}.call({})`),/Date|this|incompatible/i);
  }
  assert.throws(()=>f.run('new Date(2026n,0)'),/BigInt/);
  assert.throws(()=>f.run('new Date().setYear(2026n)'),/BigInt/);
  assert.throws(()=>f.run('Date.parse(Symbol())'),/Symbol/);
  assert.throws(()=>f.run('new Date.parse()'),/not a constructor/);
  assert.equal(f.run('Number.isNaN(new Date(9e15,0).getTime())'),true);
  assert.equal(f.run("new Date(NaN).toString()"),'Invalid Date');
  assert.equal(f.run('Number.isNaN(new Date(NaN).setHours(1))'),true);
  assert.equal(f.run('Date.UTC(2026,0,1)'),Date.UTC(2026,0,1));
  assert.match(f.run("new Date('0042-01-02T12:00:00Z').toDateString()"),/0042$/);
  assert.equal(f.run("new Date('-000001-01-02T12:00:00Z').getFullYear()"),-1);
});


test('next-navigation language and GPC rules are ready before loading without changing retained page rules', async () => {
  const originalChrome=globalThis.chrome;
  let settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,languages:{enabled:true,value:'de-DE'},globalPrivacyControl:{enabled:true}}});
  const rules=new Map(),tabs=[{id:3,url:'https://example.test',incognito:false},{id:4,url:'about:blank',incognito:false},{id:5,url:'about:blank',incognito:true}];
  globalThis.chrome={tabs:{query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id)},
    declarativeNetRequest:{updateSessionRules:async({removeRuleIds,addRules})=>{for(const id of removeRuleIds)rules.delete(id);for(const rule of addRules)rules.set(rule.id,rule);}}};
  const product=createWebsiteKnowledgeControlProduct({sync:async()=>true}, {isIncognitoContext:()=>false,readSettings:async()=>settings,
    mutateSettings:async update=>(settings=normalizeSettings(update(settings)))});
  try{
    await product.initialize();
    const pageRule=()=>[...rules.values()].find(rule=>rule.condition.resourceTypes.includes('xmlhttprequest'));
    const navRule=()=>rules.get(910065);
    assert.deepEqual(navRule().condition.tabIds,[3,4],'blank owned tabs prepare their first HTTP navigation');
    assert.deepEqual(pageRule().condition.tabIds,[3]);
    const before=JSON.stringify(pageRule());
    await product.handleMessage({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'languages',value:'fr-FR'});
    assert.equal(navRule().action.requestHeaders.find(header=>header.header==='Accept-Language').value,'fr-FR');
    assert.equal(JSON.stringify(pageRule()),before);
    await product.handleMessage({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'globalPrivacyControl',enabled:false});
    assert.equal(navRule().action.requestHeaders.some(header=>header.header==='Sec-GPC'),false);
    assert.equal(JSON.stringify(pageRule()),before);
    await product.handleMessage({type:'UI_SET_ENABLED',enabled:false});
    assert.equal(navRule(),undefined,'next navigation uses the original browser request headers when master is off');
    assert.equal(JSON.stringify(pageRule()),before);
    await product.reset();assert.equal(rules.size,0);
  }finally{globalThis.chrome=originalChrome;}
});

test('retired shared identity wrappers return to native behavior without undoing later property changes', () => {
  const f=runtimeFixture();
  f.run(`globalThis.shared=globalThis[Symbol.for('cosmic-gemini.browser-identity')];
    globalThis.oldNumeric=Number.prototype.toLocaleString;
    shared.set('probe',{language:'de-DE',locale:'de-DE',timeZone:'Asia/Tokyo',globalPrivacyControl:true},20);
    globalThis.heldGetter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),'language').get;
    globalThis.heldNumber=Number.prototype.toLocaleString;globalThis.heldFormat=Intl.DateTimeFormat;
    globalThis.heldHours=Date.prototype.getHours;
    const d=Object.getOwnPropertyDescriptor(Number.prototype,'toLocaleString');
    Object.defineProperty(Number.prototype,'toLocaleString',{...d,enumerable:!d.enumerable});
    shared.remove('probe');`);
  assert.equal(f.run('heldGetter.call(navigator)'),'fr-FR');
  assert.throws(()=>f.run('heldGetter.call({})'),/Illegal invocation/);
  assert.equal(f.run('heldNumber.call(1234.5)===oldNumeric.call(1234.5)'),true);
  assert.equal(f.run('new heldFormat().resolvedOptions().timeZone===new native.format().resolvedOptions().timeZone'),true);
  assert.equal(f.run('heldHours.call(new Date(0))===new Date(0).getHours()'),true);
  assert.equal(f.run("Object.getOwnPropertyDescriptor(Number.prototype,'toLocaleString').enumerable"),true,'later descriptor changes are preserved');
  assert.equal(f.run("'globalPrivacyControl' in navigator"),false);
});

test('new frames keep their tab policy across settings changes and worker restart', async () => {
  const originalChrome=globalThis.chrome,stored={},tabs=[{id:6,url:'https://example.test',incognito:false},{id:7,url:'https://private.test',incognito:true}];
  let settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,languages:{enabled:true,value:'de-DE'},timeZone:{enabled:true,value:'Asia/Tokyo'},globalPrivacyControl:{enabled:true}}});
  globalThis.chrome={tabs:{query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id)},storage:{session:{
    get:async key=>structuredClone({[key]:stored[key]}),set:async values=>Object.assign(stored,structuredClone(values))}},
    declarativeNetRequest:{updateSessionRules:async()=>{}}};
  const create=()=>createWebsiteKnowledgeControlProduct({sync:async()=>true}, {isIncognitoContext:()=>false,readSettings:async()=>settings});
  let product=create();
  try{
    await product.initialize();
    settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,languages:{enabled:true,value:'fr-FR'},timeZone:{enabled:true,value:'America/New_York'}}});
    const frame=await product.state(settings,'https://frame.test',6);
    assert.equal(frame.languages.value,'de-DE');assert.equal(frame.timeZone.value,'Asia/Tokyo');assert.equal(frame.globalPrivacyControl.enabled,true);
    product=create();await product.initialize();
    const restored=await product.state(settings,'https://late-frame.test',6);
    assert.equal(restored.languages.value,'de-DE');assert.equal(restored.timeZone.value,'Asia/Tokyo');
    assert.equal((await product.state(settings,'https://private.test',7)).active,false,'foreign-context tabs never acquire ordinary policy');
    await loadDocument(product,settings,tabs[0]);
    const next=await product.state(settings,'https://frame.test',6);
    assert.equal(next.languages.value,'fr-FR');assert.equal(next.timeZone.value,'America/New_York');assert.equal(next.globalPrivacyControl.enabled,false);
    settings=normalizeSettings();
    assert.equal((await product.state(settings,'https://frame.test',6)).active,true,'saving master-off does not rewrite the loaded page');
    await loadDocument(product,settings,tabs[0]);
    assert.equal((await product.state(settings,'https://frame.test',6)).active,false);
  }finally{globalThis.chrome=originalChrome;}
});

test('stale top-document configuration cannot replace the active tab policy', async () => {
  const originalChrome=globalThis.chrome,tab={id:8,url:'https://example.test',incognito:false};
  let settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,languages:{enabled:true,value:'de-DE'}}});
  let topDocument='current-a';
  globalThis.chrome={tabs:{query:async()=>[tab],get:async()=>tab},
    scripting:{executeScript:async()=>[{documentId:topDocument,result:true}]},declarativeNetRequest:{updateSessionRules:async()=>{}}};
  const product=createWebsiteKnowledgeControlProduct({sync:async()=>true},{isIncognitoContext:()=>false,readSettings:async()=>settings});
  const sync=documentId=>product.sync({tabId:8,frameId:0,documentId,topUrl:tab.url},settings);
  try{
    await product.initialize();await sync('current-a');
    settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,languages:{enabled:true,value:'fr-FR'}}});
    await sync('retired-b');
    assert.equal((await product.state(settings,tab.url,8)).languages.value,'de-DE');
    await product.handleTabUpdated(8,{status:'loading'},tab);
    assert.equal((await product.state(settings,tab.url,8)).languages.value,'de-DE');
    topDocument='current-c';await sync(topDocument);
    assert.equal((await product.state(settings,tab.url,8)).languages.value,'fr-FR');
  }finally{globalThis.chrome=originalChrome;}
});

test('inactive Website Knowledge Control performs no page execution and waits for reload when enabled', async () => {
  const originalChrome=globalThis.chrome,tab={id:8,url:'https://example.test',incognito:false};
  let settings=normalizeSettings(),executions=0,topDocument='inactive-a';
  globalThis.chrome={tabs:{query:async()=>[tab],get:async()=>tab},
    scripting:{executeScript:async()=>{executions++;return[{documentId:topDocument,result:true}];}},declarativeNetRequest:{updateSessionRules:async()=>{}}};
  const hostStates=[],product=createWebsiteKnowledgeControlProduct({sync:async(_p,_c,active)=>hostStates.push(active)},
    {isIncognitoContext:()=>false,readSettings:async()=>settings});
  try{
    await product.initialize();
    await product.sync({tabId:8,frameId:0,documentId:topDocument,topUrl:tab.url},settings);
    await product.sync({tabId:8,frameId:2,documentId:'inactive-frame',topUrl:tab.url,frameUrl:'https://frame.test'},settings);
    assert.equal(executions,0);
    settings=normalizeSettings({websiteKnowledgeControl:{enabled:true,globalPrivacyControl:{enabled:true}}});
    await product.sync({tabId:8,frameId:0,documentId:topDocument,topUrl:tab.url},settings);
    assert.equal(hostStates.at(-1),false);
    topDocument='active-b';await product.sync({tabId:8,frameId:0,documentId:topDocument,topUrl:tab.url},settings);
    assert.equal(hostStates.at(-1),true);assert.equal(executions,1);
  }finally{globalThis.chrome=originalChrome;}
});
