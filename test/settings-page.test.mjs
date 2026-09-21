import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSettingsState } from '../extension/settings/state.js';
import { PRODUCT_META, featureFromPath, viewFor } from '../extension/settings/views.js';

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
}

function controller(feature = 'satellites') {
  const nodes = new Map();
  const groups = new Map();
  const timers = [];
  let transport = async () => { throw Error('readback unavailable'); };
  const root = { lang: 'en-US' };
  const body = new Element('body');
  const document = {
    documentElement: root, body,
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector => groups.get(selector) || [],
    createElement: tag => new Element(tag)
  };
  const context = vm.createContext({
    document, chrome: {}, location: { pathname: '' },
    featureFromPath: () => feature, translator: () => key => key,
    createSettingsState, saveSettingsViewCache() {}, icon: () => '',
    send: message => transport(message),
    retryRead: task => task(), setTimeout: task => { timers.push(task); return timers.length; }, clearTimeout() {}
  });
  const source = readFileSync(new URL('../extension/settings/page.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '');
  vm.runInContext(source.slice(0, source.indexOf("\nfor (const link of document.querySelectorAll('[data-feature-link]')) {")) + `
    globalThis.controller = { render, renderList, renderBehaviorList, update, savePreference,
      bindEmptyRuleSort, isRuleOrderReset, isRuleListClean,
      async hydrate(snapshot) { await settingsState.read(async () => snapshot); states = settingsState.value; },
      pendingControls, listSignatures };
  `, context);
  return { api: context.controller, nodes, groups, timers, setTransport: task => { transport = task; } };
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

test('Access Control renders its saved authorization and explains every domain rule at the same list level', async () => {
  const { api, nodes } = controller();
  const master = new Element('input');
  const options = new Element('fieldset');
  nodes.set('#accessControlEnabled', master);
  nodes.set('#accessControlOptions', options);
  await api.hydrate({ preferences: { satellites: {}, accessControl: {
    enabled: false, blockedDomains: ['example.com']
  } } });
  api.render();
  assert.equal(master.checked, false);
  assert.equal(options.disabled, true);

  const section = new Element();
  section.dataset.listSection = 'blockedDomains';
  section.dataset.featureId = 'accessControl';
  const list = new Element('ul', 'rule-list');
  section.append(list);
  api.renderList(section);
  assert.equal(list.children[0].children[0].children[0].textContent, 'example.com');
  assert.equal(list.children[0].children[0].children[1].textContent, 'accessControlSubdomainsSuffix');

  await api.hydrate({ preferences: { satellites: {}, accessControl: {
    enabled: true, blockedDomains: ['example.com']
  } } });
  api.render();
  assert.equal(master.checked, true);
  assert.equal(options.disabled, false);
});

test('Clipboard Protect settings follow the saved switch regardless of current page support', async () => {
  const { api, nodes, setTransport } = controller();
  const card = new Element('section', 'card');
  const control = new Element('input');
  card.append(control);
  nodes.set('#clipboardProtectEnabled', control);
  await api.hydrate({ preferences: { satellites: {}, clipboardProtect: { enabled: true } }, clipboardProtect: { enabled: false, supported: false } });
  api.render();
  assert.equal(control.checked, true);
  control.checked = false;
  setTransport(message => {
    if (message.type === 'UI_GET') throw Error('readback unavailable');
    assert.equal(message.featureId, 'clipboardProtect');
    return { enabled: false };
  });
  await api.update(null, () => api.savePreference('clipboardProtect', {
    type: 'UI_SET_ENABLED', featureId: 'clipboardProtect', enabled: false
  }), [control]);
  assert.equal(control.checked, false);
  assert.equal(control.disabled, false);
});

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

test('Page Display master switch disables every subordinate control without discarding its values', async () => {
  const { api, nodes } = controller('pageDisplay');
  const master = new Element('input');
  const reduce = new Element('input');
  const slider = new Element('input');
  const greyscale = new Element('input');
  nodes.set('#enabled', master);
  nodes.set('#pageDisplayReduceWhitePointEnabled', reduce);
  nodes.set('#reduceWhitePointReduction', slider);
  nodes.set('#pageDisplayGreyscaleEnabled', greyscale);
  await api.hydrate({ preferences: { pageDisplay: {
    enabled: false,
    reduceWhitePoint: { enabled: true, reduction: 0.4 },
    greyscale: { enabled: true }
  } } });
  api.render();
  assert.equal(master.checked, false);
  assert.equal(reduce.checked, true);
  assert.equal(greyscale.checked, true);
  assert.equal(reduce.disabled, true);
  assert.equal(greyscale.disabled, true);
  assert.equal(slider.disabled, true);
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
