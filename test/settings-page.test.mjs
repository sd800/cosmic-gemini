import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSettingsState } from '../extension/settings/state.js';
import { ACCESS_CONTROL_ALIAS_GROUPS } from '../extension/core/website-rule-input.js';
import { PRODUCT_META, featureFromPath, viewFor, documentOpenShortcutMarkup, SETTINGS_DIRECTORIES, featureDirectoryMarkup } from '../extension/settings/views.js';
import { FEATURE_IDS, normalizeLeetcodeDarkModeTone, normalizeWhiteSofterTone, WHITE_TONES } from '../extension/core/config.js';
import { DEVELOPER_FEATURES, featureAffiliation } from '../extension/settings/developer-mode.js';
import { translator } from '../extension/shared/localization.js';

test('developer metadata follows Central ownership and attaches only to existing feature titles', () => {
  const central = readFileSync(new URL('../extension/background/central.js', import.meta.url), 'utf8');
  const expression = central.match(/export const PROVINCE_PRODUCTS = (Object\.freeze\([\s\S]*?\n\}\));/)[1];
  const provinces = vm.runInNewContext(expression, { FEATURE_IDS });
  assert.ok(provinces.standing.includes(FEATURE_IDS.BILI_DAILY_LOGIN));
  assert.ok(!provinces.operations.includes(FEATURE_IDS.BILI_DAILY_LOGIN));
  assert.ok(!provinces.operations.includes('satellites'));
  for (const [province, products] of Object.entries(provinces)) {
    for (const id of products.filter(id => id !== 'administration')) {
      assert.equal(DEVELOPER_FEATURES[id]?.province, province, `${id} ownership must match Central`);
    }
  }
  const markup = Object.keys(PRODUCT_META).map(id => viewFor(id).primary).join('');
  for (const feature of Object.values(DEVELOPER_FEATURES)) {
    assert.ok(markup.includes(`data-i18n="${feature.title}"`), `${feature.tag} has a Settings title`);
    if (feature.parent) assert.ok(DEVELOPER_FEATURES[feature.parent], `${feature.tag} has a valid parent`);
  }
  const t = translator('en-US');
  assert.equal(featureAffiliation('stayOnPage', t), 'Central > Standing Province > Website Fixer > Stay on the page');
  assert.equal(featureAffiliation('biliDailyLogin', t), 'Central > Standing Province > Bilibili – Daily Login');
});

function settingsRegion(html, pattern, label) {
  const match = html.match(pattern);
  assert.ok(match, `Missing ${label}`);
  return match[1];
}

function normalizeSettingsMarkup(markup) {
  return markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

test('static Settings documents and in-page navigation views stay identical', () => {
  const expectedNavigation = Object.entries(PRODUCT_META).map(([featureId, meta]) => [featureId, meta.path]);
  for (const [featureId, meta] of Object.entries(PRODUCT_META)) {
    const html = readFileSync(new URL(`../extension/settings/${meta.path}`, import.meta.url), 'utf8');
    const staticPrimary = settingsRegion(
      html,
      /<div class="primary">([\s\S]*?)<\/div>\s*<div class="sidebar">/,
      `${meta.path} primary view`
    );
    const staticHelp = settingsRegion(
      html,
      /<aside class="help card">([\s\S]*?)<\/aside>/,
      `${meta.path} help view`
    );
    const dynamicView = viewFor(featureId);
    assert.equal(
      normalizeSettingsMarkup(staticPrimary),
      normalizeSettingsMarkup(dynamicView.primary),
      `${meta.path} must match its in-page navigation primary view`
    );
    assert.equal(
      normalizeSettingsMarkup(staticHelp),
      normalizeSettingsMarkup(dynamicView.help),
      `${meta.path} must match its in-page navigation help view`
    );

    const navigation = [...html.matchAll(/<a class="feature-link(?: active)?" href="([^"]+)" data-feature-link="([^"]+)"/g)]
      .map(match => [match[2], match[1]]);
    assert.deepEqual(navigation, expectedNavigation, `${meta.path} must expose every Settings destination in order`);
    const activeLinks = [...html.matchAll(/<a class="feature-link active"[^>]+data-feature-link="([^"]+)"/g)]
      .map(match => match[1]);
    assert.deepEqual(activeLinks, [featureId], `${meta.path} must identify only its own navigation destination as active`);
    assert.equal(featureFromPath(`/settings/${meta.path}`), featureId);
    if (featureId === 'allSettings') {
      const shortcut = settingsRegion(html, /(<div class="document-shortcut"[\s\S]*?)\n      <\/section>/, 'All Settings document shortcut');
      assert.equal(normalizeSettingsMarkup(shortcut), normalizeSettingsMarkup(documentOpenShortcutMarkup()));
      assert.match(shortcut, /data-i18n="allSettingsDocumentPreview"/);
      assert.equal(translator('zh-CN')('allSettingsDocumentPreview'), '文件预览');
      assert.equal(translator('en-US')('allSettingsDocumentPreview'), 'Document Preview');
      assert.equal(translator('zh-CN')('documentPreviewName'), 'Document Preview');
      assert.match(html, /class="card compact language-card has-document">[\s\S]*?class="language-row">[\s\S]*?id="document-preview-shortcut"[\s\S]*?<\/section>/);
      assert.ok(html.indexOf('language-card') < html.indexOf('document-preview-shortcut'));
      assert.ok(html.indexOf('document-preview-shortcut') < html.indexOf('reset-settings-card'));
    }
  }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('settings ignore late reads and preserve a confirmed save if readback fails', async () => {
  const model = createSettingsState();
  const old = deferred();
  const first = model.read(() => old.promise);
  const current = { preferences: { nsna: { whitelistRules: [] } } };
  await model.read(async () => current);
  old.resolve({ preferences: {} });
  assert.equal(await first, false);
  assert.equal(model.value, current);

  const stale = deferred();
  const reading = model.read(() => stale.promise);
  const saved = { whitelistRules: ['*.douyin.com'] };
  const saving = deferred();
  const writing = model.write('nsna', () => saving.promise);
  assert.equal(await model.read(() => assert.fail('no read while saving')), false);
  saving.resolve(saved);
  await writing;
  stale.resolve(current);
  assert.equal(await reading, false);
  await assert.rejects(model.read(async () => { throw Error('offline'); }));
  assert.deepEqual(model.value.preferences.nsna, saved);
  assert.equal(model.loaded, true);
});

test('parallel preference responses cannot replace a newer save or poison later writes', async () => {
  const model = createSettingsState();
  const old = deferred();
  const first = model.write('pageDisplay', () => old.promise);
  await model.write('pageDisplay', async () => ({ enabled: false }));
  await model.write('mailtoCapture', async () => ({ enabled: true }));
  old.resolve({ enabled: true });
  await first;
  assert.deepEqual(model.value.preferences, { pageDisplay: { enabled: false }, mailtoCapture: { enabled: true } });

  const slow = deferred();
  const success = model.write('nsna', () => slow.promise);
  await assert.rejects(model.write('nsna', async () => { throw Error('write failed'); }));
  slow.resolve({ whitelistRules: ['*.163.com'] });
  await success;
  assert.deepEqual(model.value.preferences.nsna.whitelistRules, ['*.163.com']);
  await model.write('nsna', async () => ({ whitelistRules: [] }));
  assert.deepEqual(model.value.preferences.nsna.whitelistRules, []);
});

// Execute the actual Settings controller with a small DOM, without opening a browser.
class Element {
  constructor(tag = 'div', className = '') {
    this.tagName = tag.toUpperCase(); this.className = className;
    this.children = []; this.dataset = {}; this.value = ''; this.checked = false;
    this.disabled = false; this.hidden = false; this.isConnected = true; this.events = {};
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren() { for (const child of this.children) child.isConnected = false; this.children = []; }
  matches(selector) { return selector[0] === '.' ? this.className.split(' ').includes(selector.slice(1)) : this.tagName.toLowerCase() === selector; }
  querySelector(selector) { for (const child of this.children) { if (child.matches(selector)) return child; const result = child.querySelector(selector); if (result) return result; } return null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  addEventListener(type, listener) { this.events[type] = listener; }
  setAttribute() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function controller(feature = 'satellites') {
  const nodes = new Map();
  const groups = new Map();
  const timers = [];
  const paletteUpdates = [];
  const events = new Map(), ports = [], cacheWrites = [];
  let transport = async () => { throw Error('readback unavailable'); };
  const root = { lang: 'en-US' };
  const body = new Element('body');
  const document = {
    documentElement: root, body,
    addEventListener() {},
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector => groups.get(selector) || [],
    createElement: tag => new Element(tag)
  };
  const context = vm.createContext({
    document, chrome: { runtime: { connect() {
      const port = { disconnected: false, onMessage: { addListener() {} }, onDisconnect: { addListener() {} },
        disconnect() { this.disconnected = true; } };
      ports.push(port); return port;
    } } }, location: { pathname: '' }, performance: { timeOrigin: 100, now: () => 1 },
    addEventListener: (type, listener) => events.set(type, listener),
    featureFromPath: () => feature, translator: () => key => key,
    isIpAddress: value => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || /^\[[0-9a-f:]+\]$/i.test(value),
    ACCESS_CONTROL_ALIAS_GROUPS, createSettingsState, normalizeLeetcodeDarkModeTone, normalizeWhiteSofterTone, WHITE_TONES,
    createCardDisclosures: () => ({ mount() {}, localize() {}, reveal() {}, reset() {} }),
    loadLocale: async () => 'en-US', saveSettingsViewCache: value => cacheWrites.push(value), icon: () => '',
    send: message => transport(message),
    retryRead: task => task(), setTimeout: task => { timers.push(task); return timers.length; }, clearTimeout() {}
  });
  context[Symbol.for('cosmic-gemini.settings.white-softer-palette')] = {
    apply: preference => paletteUpdates.push(preference)
  };
  const source = readFileSync(new URL('../extension/settings/page.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '');
  vm.runInContext(source.slice(0, source.indexOf("\nfor (const link of document.querySelectorAll('[data-feature-link]')) {")) + `
    globalThis.controller = { render, renderList, renderBehaviorList, bindView, update, savePreference,
      reload, reloadAfterUpdate, connectSettingsUi, scheduleStoredStateSync,
      bindEmptyRuleSort, bindRuleInputHelp, isRuleOrderReset, isRuleListClean, isRuleInputHelpRequest,
      async hydrate(snapshot) { await settingsState.read(async () => snapshot); states = settingsState.value; },
      pendingControls, listSignatures };
  `, context);
  return { api: context.controller, body, nodes, groups, timers, paletteUpdates, ports, cacheWrites,
    fire: (type, event = {}) => events.get(type)?.(event),
    setTransport: task => { transport = task; } };
}

test('an empty rule input exposes alphabetizing only through a completed long press', () => {
  const { api, timers } = controller();
  const input = new Element('input');
  const button = new Element('button');
  let sorts = 0;
  api.bindEmptyRuleSort(button, input, () => { sorts += 1; });

  button.events.pointerdown({ button: 0, isPrimary: true, clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(timers.length, 1);
  assert.equal(sorts, 0);
  timers[0]();
  assert.equal(sorts, 1);

  let prevented = false;
  button.events.click({ preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true, 'the submit click following a long press is suppressed');

  input.value = 'later.example';
  button.events.pointerdown({ button: 0, isPrimary: true, clientX: 10, clientY: 10, pointerId: 2 });
  assert.equal(timers.length, 1, 'a non-empty input keeps the ordinary Add behavior');
});

test('Settings suspends late reads and reconnects after a persisted history return', async () => {
  const f = controller('nativeScroll');
  const old = deferred(); const calls = [];
  f.setTransport(message => { calls.push(message.type); return old.promise; });
  f.api.connectSettingsUi();
  const reading = f.api.reload();
  f.fire('pagehide');
  assert.equal(f.ports[0].disconnected, true);
  old.resolve({ preferences: { nativeScroll: { enabled: true } } });
  await reading;
  assert.equal(f.cacheWrites.length, 0, 'the departed page cannot publish an old read');
  await f.api.reload();
  assert.equal(calls.filter(type => type === 'UI_GET').length, 1, 'closed views do not request state');
  f.setTransport(async () => ({ preferences: { nativeScroll: { enabled: false } } }));
  f.fire('pageshow', { persisted: true });
  assert.equal(f.ports.length, 2, 'history return renews the Central subscription');
  await f.api.reload();
  assert.equal(f.cacheWrites.at(-1).nativeScroll.enabled, false);
});

test('a save failure after Settings teardown cannot display an error or enqueue recovery', async () => {
  const f = controller('nativeScroll');
  const section = new Element('section'), button = new Element('button'); section.append(button);
  const old = deferred();
  const saving = f.api.update(section, () => old.promise, [button]);
  f.fire('pagehide');
  old.reject(Error('late failure')); await saving;
  assert.equal(section.querySelector('.form-message').hidden, true);
  assert.equal(f.timers.length, 0);
  assert.equal(f.api.pendingControls.has(button), false);
});

test('the reset rule command accepts Add or Enter input without becoming a domain', () => {
  const { api } = controller();
  assert.equal(api.isRuleOrderReset('reset'), true);
  assert.equal(api.isRuleOrderReset('  RESET  '), true);
  assert.equal(api.isRuleOrderReset('reset.example'), false);
  assert.equal(api.isRuleOrderReset(''), false);
});

test('the clean rule command is reserved for confirmed card clearing', () => {
  const { api } = controller();
  assert.equal(api.isRuleListClean('clean'), true);
  assert.equal(api.isRuleListClean('  CLEAN  '), true);
  assert.equal(api.isRuleListClean('clean.example'), false);
  assert.equal(api.isRuleListClean(''), false);
});

test('a question mark opens contextual help without becoming a website rule', () => {
  const { api, body } = controller();
  const input = new Element('input');
  input.closest = () => null;
  api.bindRuleInputHelp(input);
  assert.equal(api.isRuleInputHelpRequest(' ? '), true);
  assert.equal(api.isRuleInputHelpRequest(' ？ '), true);
  input.value = '？';
  input.events.input();
  assert.equal(input.value, '');
  assert.equal(input.dataset.ruleInputHelpBound, 'true');
  assert.equal(typeof input.events.input, 'function');
  const dialog = body.children.find(child => child.tagName === 'DIALOG');
  assert.equal(dialog?.open, true);
  const aliasSection = dialog.querySelector('.rule-input-help-aliases');
  const shortcuts = dialog.querySelector('.rule-input-help-commands');
  assert.equal(aliasSection.hidden, true, 'ordinary rule inputs hide the empty alias section');
  assert.ok(shortcuts.parent.children.indexOf(shortcuts) < shortcuts.parent.children.indexOf(aliasSection));
  dialog.events.click({ target: dialog });
  assert.equal(dialog.open, false, 'clicking the backdrop closes contextual help');

  const accessSection = new Element('section');
  accessSection.dataset.featureId = 'accessControl';
  const accessInput = new Element('input');
  accessInput.closest = selector => selector === '[data-list-section]' ? accessSection : null;
  api.bindRuleInputHelp(accessInput);
  accessInput.value = '?';
  accessInput.events.input();
  assert.equal(aliasSection.hidden, false, 'Access Control exposes its site aliases');
});

test('clearing a rule input immediately clears its validation message', () => {
  const { api } = controller();
  for (const selector of ['[data-list-section]', '[data-behavior-card]']) {
    const container = new Element('section');
    const message = new Element('p', 'form-message');
    container.append(message);
    const input = new Element('input');
    input.closest = candidate => candidate === selector ? container : null;
    api.bindRuleInputHelp(input);
    message.textContent = 'invalidRule';
    input.value = 'bad/path';
    input.events.input();
    assert.equal(message.textContent, 'invalidRule');
    input.value = '  ';
    input.events.input();
    assert.equal(message.textContent, '');
    message.textContent = 'invalidRule';
    assert.equal(message.textContent, 'invalidRule', 'the next invalid submission remains visible');
  }
});

test('unchanged settings refreshes preserve rule controls and pending removals', async () => {
  const { api } = controller('nativeScroll');
  const section = new Element();
  section.dataset.listSection = 'whitelistRules'; section.dataset.featureId = 'nsna';
  const list = new Element('ul', 'rule-list'); section.append(list);
  await api.hydrate({ preferences: { nsna: { whitelistRules: ['*.douyin.com'] } } });
  api.renderList(section);
  const item = list.children[0]; const remove = item.children[1];
  api.renderList(section);
  assert.equal(list.children[0], item);
  api.pendingControls.add(remove);
  await api.hydrate({ preferences: { nsna: { whitelistRules: [] } } });
  api.renderList(section);
  assert.equal(list.children[0], item);
  api.pendingControls.delete(remove);
  api.renderList(section);
  assert.equal(list.children[0].className, 'empty');
});

test('Access Control renders saved domains and IP addresses at the same list level', async () => {
  const { api, nodes } = controller();
  const master = new Element('input');
  const temporaryVisits = new Element('input');
  const options = new Element('fieldset');
  nodes.set('#accessControlEnabled', master);
  nodes.set('#accessControlTemporaryVisits', temporaryVisits);
  nodes.set('#accessControlOptions', options);
  await api.hydrate({ preferences: { satellites: {}, accessControl: {
    enabled: false, allowTemporaryVisits: false, blockedDomains: ['example.com', '192.0.2.1']
  } } });
  api.render();
  assert.equal(master.checked, false);
  assert.equal(temporaryVisits.checked, false);
  assert.equal(options.disabled, true);

  const section = new Element();
  section.dataset.listSection = 'blockedDomains';
  section.dataset.featureId = 'accessControl';
  const note = new Element('p', 'rule-list-note');
  note.hidden = true;
  const list = new Element('ul', 'rule-list');
  section.append(list, note);
  api.renderList(section);
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'generalDomainListNote');
  assert.equal(section.children.at(-1), note, 'scope note follows the complete domain list');
  assert.equal(list.children[0].children[0].textContent, 'example.com');
  assert.equal(list.children[1].children[0].textContent, '192.0.2.1');
  assert.equal(list.children[0].children.length, 2, 'domain entries have no repeated scope suffix');

  await api.hydrate({ preferences: { satellites: {}, accessControl: {
    enabled: true, allowTemporaryVisits: true, blockedDomains: ['example.com']
  } } });
  api.render();
  api.renderList(section);
  assert.equal(note.textContent, 'generalDomainListNote');
  assert.equal(master.checked, true);
  assert.equal(temporaryVisits.checked, true);
  assert.equal(options.disabled, false);

  await api.hydrate({ preferences: { satellites: {}, accessControl: {
    enabled: true, allowTemporaryVisits: true, blockedDomains: []
  } } });
  api.renderList(section);
  assert.equal(note.hidden, true);

  await api.hydrate({ preferences: { satellites: {}, accessControl: {
    enabled: true, allowTemporaryVisits: true, blockedDomains: ['192.0.2.1']
  } } });
  api.renderList(section);
  assert.equal(note.hidden, true, 'IP-only lists do not show a subdomain note');
});

for (const feature of ['clipboardProtect', 'langGoogle', 'leetcodeDarkMode']) {
  test(`${feature} settings follow the saved switch regardless of current page support`, async () => {
    const { api, nodes, setTransport } = controller();
    const card = new Element('section', 'card');
    const control = new Element('input');
    card.append(control);
    nodes.set(`#${feature}Enabled`, control);
    if (feature === 'leetcodeDarkMode') {
      nodes.set('#leetcodeDarkModeOptions', new Element('fieldset'));
      nodes.set('#leetcodeDarkModeTone', new Element('select'));
    }
    await api.hydrate({ preferences: { satellites: {}, [feature]: { enabled: true } }, [feature]: { enabled: false, supported: false } });
    api.render();
    assert.equal(control.checked, true);
    control.checked = false;
    setTransport(message => {
      if (message.type === 'UI_GET') throw Error('readback unavailable');
      assert.equal(message.featureId, feature);
      return { enabled: false };
    });
    await api.update(null, () => api.savePreference(feature, {
      type: 'UI_SET_ENABLED', featureId: feature, enabled: false
    }), [control]);
    assert.equal(control.checked, false);
    assert.equal(control.disabled, false);
  });
}

test('failed behavior changes restore the saved choice without hiding later validation errors', async () => {
  const { api, groups } = controller('nativeScroll');
  const card = new Element('section', 'card');
  const message = new Element('p', 'form-message');
  const section = new Element(); section.dataset.behaviorList = 'standardRules';
  const list = new Element('ul', 'rule-list'); section.append(list); card.append(message, section);
  groups.set('[data-behavior-list]', [section]);
  await api.hydrate({ preferences: { nativeScroll: { standardRules: ['*.163.com'] } } });
  api.render();
  const item = list.children[0]; const select = item.querySelector('select');
  api.render();
  assert.equal(list.children[0], item);
  select.value = 'enhanced';
  await api.update(card, async () => { throw Error('save failed'); }, [select]);
  assert.equal(list.children[0].querySelector('select').value, 'standard');
  await api.update(card, async () => {}, []);
  message.textContent = 'invalidRule';
  assert.equal(message.hidden, false);
});

test('settings show a write error, do not repeat commands, and retain confirmed values after failed readback', async () => {
  const { api, nodes, setTransport } = controller('nativeScroll');
  const card = new Element('section', 'card');
  const control = new Element('input'); card.append(control); nodes.set('#enabled', control);
  await api.hydrate({ preferences: { nativeScroll: { enabled: false } } });
  control.checked = true;
  const saved = deferred(); let writes = 0;
  const updating = api.update(null, () => api.savePreference('nativeScroll', {}), [control]);
  // This first request fails through the harness transport, so display a save error.
  await updating;
  assert.equal(control.checked, false);
  assert.equal(card.querySelector('.form-message').textContent, 'settingsSaveFailed');
  assert.equal(card.querySelector('.form-message').hidden, false);

  control.checked = true;
  setTransport(message => {
    if (message.type === 'UI_GET') throw Error('readback unavailable');
    writes += 1;
    return saved.promise;
  });
  const success = api.update(null, () => api.savePreference('nativeScroll', { type: 'UI_SET_ENABLED' }), [control]);
  await api.update(null, async () => { writes += 1; }, [control]);
  api.render();
  assert.equal(control.checked, true);
  assert.equal(control.disabled, true);
  saved.resolve({ enabled: true }); await success;
  assert.equal(writes, 1);
  assert.equal(control.checked, true);
  assert.equal(control.disabled, false);
  assert.equal(card.querySelector('.form-message').hidden, true);
});

test('finishing a slider save never unlocks it after the parent setting turns off', async () => {
  const { api, nodes } = controller();
  const card = new Element('section', 'card');
  const parent = new Element('input'); const slider = new Element('input');
  card.append(parent, slider);
  nodes.set('#pageDisplayReduceWhitePointEnabled', parent);
  nodes.set('#reduceWhitePointReduction', slider);
  const snapshot = enabled => ({ preferences: { satellites: {}, pageDisplay: { enabled: true, reduceWhitePoint: { enabled, reduction: 0.5 } } } });
  await api.hydrate(snapshot(true)); api.render();
  const saved = deferred();
  const updating = api.update(null, () => saved.promise, [slider]);
  await api.hydrate(snapshot(false)); api.render();
  saved.resolve(); await updating;
  assert.equal(parent.checked, false);
  assert.equal(slider.disabled, true);
});

test('Page Display preload uses the same Reduction availability before the module loads', () => {
  const source=readFileSync(new URL('../extension/settings/preload.js',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('  const pageDisplayEnabled ='),source.indexOf('  const xhsImageDarkModeEnabled ='));
  for(const enabled of [false,true])for(const global of [false,true])for(const siteSpecific of [false,true]){
    const nodes=new Map(['pageDisplayReduceWhitePointEnabled','reduceWhitePointSiteSpecific',
      'reduceWhitePointWebsites','reduceWhitePointReduction','reduceWhitePointReductionValue'].map(id=>['#'+id,{}]));
    vm.runInNewContext(block,{cached:{pageDisplay:{enabled,reduceWhitePoint:{enabled:global,siteSpecific,reduction:.4}}},
      feature:'pageDisplay',document:{body:{dataset:{}},querySelector:selector=>nodes.get(selector)}});
    assert.equal(nodes.get('#reduceWhitePointReduction').disabled,!enabled||!(global||siteSpecific));
  }
});

test('Page Display Reduction is adjustable when either Reduce White Point switch is on', async () => {
  const {api,nodes}=controller('pageDisplay');
  const master=new Element('input'),global=new Element('input'),site=new Element('input'),slider=new Element('input');
  nodes.set('#enabled',master);
  nodes.set('#pageDisplayReduceWhitePointEnabled',global);
  nodes.set('#reduceWhitePointSiteSpecific',site);
  nodes.set('#reduceWhitePointReduction',slider);
  for(const enabled of [false,true])for(const general of [false,true])for(const siteSpecific of [false,true]){
    await api.hydrate({preferences:{pageDisplay:{enabled,reduceWhitePoint:{enabled:general,siteSpecific,reduction:.4}}}});
    api.render();
    assert.equal(slider.disabled,!enabled||!(general||siteSpecific),JSON.stringify({enabled,general,siteSpecific}));
    assert.equal(slider.value,'40');
  }
  // A pending website toggle must retain its optimistic slider availability.
  await api.hydrate({preferences:{pageDisplay:{enabled:true,reduceWhitePoint:{enabled:false,siteSpecific:false,reduction:.4}}}});
  site.checked=true;api.pendingControls.add(site);api.render();
  assert.equal(slider.disabled,false);
  api.pendingControls.delete(site);
});

test('Page Display master switch disables every subordinate control without discarding its values', async () => {
  const { api, nodes } = controller('pageDisplay');
  const master = new Element('input');
  const reduce = new Element('input');
  const slider = new Element('input');
  const greyscale = new Element('input');
  const siteSpecific = new Element('input');
  const websites = new Element('fieldset');
  nodes.set('#enabled', master);
  nodes.set('#pageDisplayReduceWhitePointEnabled', reduce);
  nodes.set('#reduceWhitePointReduction', slider);
  nodes.set('#pageDisplayGreyscaleEnabled', greyscale);
  nodes.set('#reduceWhitePointSiteSpecific', siteSpecific);
  nodes.set('#reduceWhitePointWebsites', websites);
  await api.hydrate({ preferences: { pageDisplay: {
    enabled: false,
    reduceWhitePoint: { enabled: true, reduction: 0.4, siteSpecific: true, siteRules: ['example.com'] },
    greyscale: { enabled: true }
  } } });
  api.render();
  assert.equal(master.checked, false);
  assert.equal(reduce.checked, true);
  assert.equal(greyscale.checked, true);
  assert.equal(reduce.disabled, true);
  assert.equal(greyscale.disabled, true);
  assert.equal(slider.disabled, true);
  assert.equal(siteSpecific.checked, true);
  assert.equal(siteSpecific.disabled, true);
  assert.equal(websites.hidden, false);
  assert.equal(websites.disabled, true);
});

test('No Autoplay main switch disables audio autoplay settings without clearing saved choices', async () => {
  const { api, nodes, setTransport } = controller('noAutoplay');
  const master = new Element('input');
  const audioOptions = new Element('fieldset');
  const audioAllSites = new Element('input');
  nodes.set('#enabled', master);
  nodes.set('#noAutoplayAudioOptions', audioOptions);
  nodes.set('#audioAutoplayAllSites', audioAllSites);
  nodes.set('#language', new Element('select'));
  let snapshot = { preferences: { noAutoplay: {
    enabled: false, audioAutoplayAllSites: true, permanentAudioAllowRules: ['music.example']
  } } };
  await api.hydrate(snapshot);
  api.render();
  assert.equal(audioOptions.disabled, true);
  assert.equal(audioAllSites.checked, true);
  api.bindView();
  const saving = deferred();
  setTransport(message => message.type === 'UI_GET' ? Promise.resolve(snapshot) : saving.promise);
  master.checked = true;
  master.events.change();
  assert.equal(audioOptions.disabled, false, 'the audio section is available immediately');
  snapshot = { preferences: { noAutoplay: { ...snapshot.preferences.noAutoplay, enabled: true } } };
  saving.resolve(snapshot.preferences.noAutoplay);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audioOptions.disabled, false);
  assert.equal(audioAllSites.checked, true);

  await api.hydrate({ preferences: { noAutoplay: { ...snapshot.preferences.noAutoplay, enabled: false } } });
  api.render();
  assert.equal(audioOptions.disabled, true);
  assert.equal(audioAllSites.checked, true);
});

test('popup readback caches only saved ordinary-window preferences', async () => {
  const source = readFileSync(new URL('../extension/popup/popup.js', import.meta.url), 'utf8');
  const reload = source.slice(source.indexOf('async function reload('), source.indexOf('async function reloadAfterAction('));
  const cached = [];
  let snapshot;
  const context = vm.createContext({
    send: async () => snapshot,
    saveSettingsViewCache: value => cached.push(value),
    render() {}, showView() {}
  });
  vm.runInContext(`let stateReadGeneration = 0, popupClosing = false, currentTab, state, videoSelectionTabId = null, videoPanelSignature,
    videoPickerActive, videoPanelRenderPending, viewMode = null;
    const selectedVideoCandidateIds = new Set();
    ${reload}
    globalThis.reload = reload;`, context);
  const preferences = { mailtoCapture: { enabled: true } };
  snapshot = { tab: { id: 10 }, state: { preferences, mailtoCapture: { enabled: false } } };
  await context.reload(false);
  assert.equal(cached[0], preferences);
  snapshot = { tab: { id: 11 }, state: { incognito: true, preferences: { mailtoCapture: { enabled: false } } } };
  await context.reload(false);
  assert.equal(cached.length, 1);
});

test('Website Knowledge Control renders master authorization separately from saved category choices', async () => {
  const { api, nodes } = controller('satellites');
  const master = new Element('input');
  const fieldset = new Element('fieldset');
  nodes.set('#websiteKnowledgeEnabled', master);
  nodes.set('#websiteKnowledgeOptions', fieldset);
  for (const [suffix, selected] of [['Languages', 'fr-FR'], ['TimeZone', 'Asia/Tokyo'], ['GlobalPrivacyControl', null]]) {
    nodes.set('#websiteKnowledge' + suffix, new Element('input'));
    if (selected) {
      const select = new Element('select');
      select.options = [{ value: selected }];
      nodes.set('#websiteKnowledge' + suffix + 'Value', select);
    }
  }
  const preference = { enabled: false, languages: { enabled: true, value: 'fr-FR' },
    timeZone: { enabled: false, value: 'Asia/Tokyo' },
    globalPrivacyControl: { enabled: true } };
  await api.hydrate({ preferences: { satellites: {}, websiteKnowledgeControl: preference } });
  api.render();
  assert.equal(fieldset.disabled, true);
  assert.equal(nodes.get('#websiteKnowledgeLanguages').checked, true);
  assert.equal(nodes.get('#websiteKnowledgeLanguagesValue').value, 'fr-FR');
  assert.equal(nodes.get('#websiteKnowledgeGlobalPrivacyControl').checked, true);
  await api.hydrate({ preferences: { satellites: {}, websiteKnowledgeControl: { ...preference, enabled: true } } });
  api.render();
  assert.equal(fieldset.disabled, false);
  assert.equal(nodes.get('#websiteKnowledgeLanguagesValue').disabled, false);
  assert.equal(nodes.get('#websiteKnowledgeTimeZoneValue').disabled, true);
  assert.equal(nodes.get('#websiteKnowledgeTimeZoneValue').value, 'Asia/Tokyo');
});


test('White Softer uses saved preferences and retains its tone when the master is off', async () => {
  const { api, nodes, paletteUpdates } = controller();
  const master = new Element('input');
  const options = new Element('fieldset');
  const tone = new Element('select');
  nodes.set('#whiteSofterEnabled', master);
  nodes.set('#whiteSofterOptions', options);
  nodes.set('#whiteSofterTone', tone);
  await api.hydrate({ preferences: { satellites: {}, whiteSofter: { enabled: true, tone: 'cool' } },
    whiteSofter: { enabled: false, supported: false, tone: 'warm' } });
  api.render();
  assert.equal(master.checked, true);
  assert.equal(options.disabled, false);
  assert.equal(tone.value, 'cool');
  assert.equal(paletteUpdates.at(-1).enabled, true);
  assert.equal(paletteUpdates.at(-1).tone, 'cool');
  await api.hydrate({ preferences: { satellites: {}, whiteSofter: { enabled: false, tone: 'cool' } } });
  api.render();
  assert.equal(master.checked, false);
  assert.equal(options.disabled, true);
  assert.equal(tone.value, 'cool');
  assert.equal(paletteUpdates.at(-1).enabled, false);
});

test('White Softer pending palette and subordinate availability survive unrelated Settings renders', async () => {
  const { api, nodes, paletteUpdates } = controller();
  const master = new Element('input'), options = new Element('fieldset'), tone = new Element('select');
  nodes.set('#whiteSofterEnabled', master); nodes.set('#whiteSofterOptions', options); nodes.set('#whiteSofterTone', tone);
  await api.hydrate({ preferences: { satellites: {}, whiteSofter: { enabled: true, tone: 'cool' } } });
  api.render();
  api.pendingControls.add(tone); tone.value = 'warm';
  api.render();
  assert.equal(paletteUpdates.at(-1).tone, 'warm', 'an unrelated render cannot undo the pending color');
  api.pendingControls.add(master); master.checked = false;
  api.render();
  assert.equal(paletteUpdates.at(-1).enabled, false, 'pending disable keeps the palette inactive');
  assert.equal(options.disabled, true, 'subordinate controls follow the pending master value');
  api.pendingControls.clear(); api.render();
  assert.equal(paletteUpdates.at(-1).tone, 'cool', 'a failed save rolls back to confirmed preferences');
  assert.equal(paletteUpdates.at(-1).enabled, true);
  assert.equal(options.disabled, false);
});


test('Satellites and Orbiters keep independent content and directories with dedicated navigation', () => {
  const general = viewFor('satellites').primary, site = viewFor('orbiters').primary;
  assert.match(general, /data-i18n="satellitesName"/);
  assert.match(site, /data-section-icon="orbiters"[\s\S]*data-i18n="orbitersName"/);
  for (const [index, [id, markup]] of [['satellites', general], ['orbiters', site]].entries()) {
    const directory = featureDirectoryMarkup(id);
    assert.doesNotMatch(markup, /satellite-category-heading|satellitesGeneralFeatures|orbitersFeatures/);
    assert.doesNotMatch(directory, /<h3|directory-group/);
    assert.equal(PRODUCT_META[id].name, translator('en-US')(`${id}Name`));
    for (const entry of SETTINGS_DIRECTORIES[index].items) {
      assert.ok(markup.includes(`id="${entry.target}"`));
      assert.ok(directory.includes(`data-feature-target="${entry.target}"`));
    }
    for (const entry of SETTINGS_DIRECTORIES[1-index].items) {
      assert.ok(!markup.includes(`id="${entry.target}"`));
      assert.ok(!directory.includes(`data-feature-target="${entry.target}"`));
    }
  }
  assert.equal(translator('en-US')('orbitersName'), 'Orbiters');
  assert.equal(translator('en-US')('allSettingsOrbitersDescription'), 'Manage tools for specific websites.');
  assert.equal(translator('zh-CN')('orbitersName'), 'Orbiters');
  assert.equal(featureDirectoryMarkup('allSettings'), '');
  assert.equal(featureAffiliation('orbiters', translator('en-US')), 'Central > Operations Province > Orbiters');
  assert.ok(viewFor('allSettings').primary.includes('data-settings-card="orbiters"'));
  const svg = source => source.match(/orbiters: '([^']+)'/)[1];
  assert.equal(svg(readFileSync(new URL('../extension/shared/ui.js', import.meta.url),'utf8')),
    svg(readFileSync(new URL('../extension/settings/preload.js', import.meta.url),'utf8')));
});


test('URL Tracking Cleaner renders saved master/UTM state and dims only by its master',async()=>{
  const {api,nodes}=controller();const master=new Element('input'),options=new Element('fieldset'),utm=new Element('input'),bilibili=new Element('input');
  nodes.set('#urlTrackingCleanerEnabled',master);nodes.set('#urlTrackingCleanerOptions',options);nodes.set('#urlTrackingUtmParameters',utm);nodes.set('#urlTrackingBilibiliParameters',bilibili);
  for(const enabled of [true,false])for(const selected of [true,false])for(const bili of [true,false]){
    await api.hydrate({preferences:{urlTrackingCleaner:{enabled,utmParameters:selected,bilibiliParameters:bili}},urlTrackingCleaner:{enabled:!enabled,active:!enabled}});api.render();
    assert.equal(master.checked,enabled);assert.equal(utm.checked,selected);assert.equal(bilibili.checked,bili);assert.equal(options.disabled,!enabled);
  }
});
