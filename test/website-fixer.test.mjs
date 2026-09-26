import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  normalizeSettings,
  normalizeWebsiteFixerDomain,
  normalizeWebsiteFixerSite,
  websiteFixerState
} from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { normalizeStayOnPageCommand } from '../extension/core/website-rule-input.js';
import { createWebsiteFixerProduct } from '../extension/background/products/standing/website-fixer.js';
import { createStayOnPage } from '../extension/background/products/standing/website-fixer-stay.js';
import { createStandingProvince } from '../extension/background/provinces/standing.js';
import { defineProvince } from '../extension/background/provinces/interface.js';

test('Standing exposes the navigation hook and rejects silently dropped province hooks', () => {
  globalThis.chrome = { webRequest: {} };
  const standing = createStandingProvince({});
  assert.equal(typeof standing.handleNavigationRequest, 'function');
  assert.equal(standing.handleNavigationRequest({ tabId: -1 }), undefined);
  assert.throws(() => defineProvince({ id: 'unknown', products: {}, lostHook() {} }), /Unknown province hook/);
});

test('Website Fixer defaults off and matches only selected domains and their subdomains', () => {
  assert.deepEqual(DEFAULT_INCOGNITO_SETTINGS.websiteFixer, {
    enabled: false, translateOverride: { enabled: false, whitelistDomains: [] }, stayOnPage: { enabled: false, whitelistDomains: [] }
  });
  assert.equal(normalizeWebsiteFixerDomain('*.ILSOS.gov'), 'ilsos.gov');
  assert.throws(() => normalizeWebsiteFixerDomain('192.0.2.1'));
  const settings = normalizeSettings({ websiteFixer: {
    enabled: true, translateOverride: {
      enabled: true, whitelistDomains: ['ILSOS.gov', '*.example.com', 'ilsos.gov', 'bad/path']
    }
  } });
  assert.deepEqual(settings.websiteFixer.translateOverride.whitelistDomains, ['ilsos.gov', 'example.com']);
  for (const url of ['https://ilsos.gov/', 'https://www.ilsos.gov/news', 'http://deep.www.ilsos.gov/']) {
    assert.equal(websiteFixerState(settings, url).active, true, url);
  }
  for (const url of ['https://notilsos.gov/', 'https://ilsos.gov.evil.test/', 'chrome://settings/']) {
    assert.equal(websiteFixerState(settings, url).active, false, url);
  }
  assert.equal(websiteFixerState(normalizeSettings({ websiteFixer: {
    enabled: true, translateOverride: { enabled: false, whitelistDomains: ['ilsos.gov'] }
  } }), 'https://www.ilsos.gov/').active, false);
});

test('Stay on the page interprets a leading minus as an eTLD+1 removal command', () => {
  assert.deepEqual(normalizeStayOnPageCommand('example.com'),
    { type: 'UI_ADD_RULE', rule: 'example.com' });
  assert.deepEqual(normalizeStayOnPageCommand('-https://www.world.example.com/hello/world'),
    { type: 'UI_DELETE_RULE', rule: 'example.com' });
  assert.deepEqual(normalizeStayOnPageCommand('-www.world.example.com'),
    { type: 'UI_DELETE_RULE', rule: 'example.com' });
  assert.throws(() => normalizeStayOnPageCommand('-'));
});

test('Website Fixer registers only allowlisted document-start scripts and unregisters when disabled', async () => {
  let settings = normalizeSettings();
  let registered = [];
  const calls = [];
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    declarativeNetRequest: { getSessionRules: async () => [], updateSessionRules: async () => {} },
    scripting: {
      async getRegisteredContentScripts() { return registered; },
      async registerContentScripts(scripts) { calls.push('register'); registered = scripts; },
      async updateContentScripts(scripts) { calls.push('update'); registered = scripts; },
      async unregisterContentScripts() { calls.push('unregister'); registered = []; }
    }
  };
  const product = createWebsiteFixerProduct({
    readSettings: async () => settings,
    mutateSettings: async mutate => (settings = normalizeSettings(await mutate(settings))),
    isIncognitoContext: () => false
  });
  const sender = { sender: { url: 'chrome-extension://test/settings/satellites.html' } };
  await product.initialize();
  assert.deepEqual(calls, []);
  await product.handleMessage({ type: 'UI_ADD_RULE', listName: 'whitelistDomains', rule: 'ilsos.gov' }, sender);
  assert.deepEqual(calls, [], 'a saved domain alone does not register a page script');
  await product.handleMessage({ type: 'UI_SET_WEBSITE_FIXER_TRANSLATE_OVERRIDE', enabled: true }, sender);
  assert.deepEqual(calls, [], 'the subfeature still needs its master switch');
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true }, sender);
  assert.deepEqual(calls, ['register']);
  assert.deepEqual(registered[0].matches, ['*://*.ilsos.gov/*']);
  assert.equal(registered[0].runAt, 'document_start');
  assert.equal(registered[0].world, 'ISOLATED');
  assert.equal(registered[0].allFrames, false);
  await product.handleMessage({ type: 'UI_ADD_RULE', listName: 'whitelistDomains', rule: 'example.com' }, sender);
  assert.deepEqual(calls, ['register', 'update']);
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false }, sender);
  assert.deepEqual(calls, ['register', 'update', 'unregister']);
  await assert.rejects(product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true }, {
    sender: { url: 'https://www.ilsos.gov/' }
  }));
});

test('Website Fixer keeps saved sites and installed protection together when registration or storage fails', async () => {
  let settings = normalizeSettings({ websiteFixer: { enabled: true, stayOnPage: { enabled: true } } });
  let rules = [], registered = [], failedRegistrations = 3, failStorage = false, ignoreNetworkUpdate = false;
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    tabs: { query: async () => [] },
    declarativeNetRequest: {
      getSessionRules: async () => rules,
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        if (ignoreNetworkUpdate) return;
        rules = rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => registered.filter(script => ids.includes(script.id)),
      registerContentScripts: async scripts => {
        if (failedRegistrations > 0) {
          failedRegistrations -= 1;
          throw new Error('registration unavailable');
        }
        registered.push(...scripts);
      },
      unregisterContentScripts: async ({ ids }) => {
        registered = registered.filter(script => !ids.includes(script.id));
      }
    }
  };
  const product = createWebsiteFixerProduct({
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async revise => {
      const next = normalizeSettings(await revise(settings));
      if (failStorage) throw new Error('storage unavailable');
      return (settings = next);
    }
  });
  const message = { type: 'UI_ADD_RULE', listName: 'whitelistDomains',
    settingGroup: 'stayOnPage', rule: 'example.com' };
  const context = { sender: { url: 'chrome-extension://test/settings/satellites.html' } };
  await assert.rejects(product.handleMessage(message, context), /registration unavailable/);
  assert.deepEqual(settings.websiteFixer.stayOnPage.whitelistDomains, []);
  assert.deepEqual(rules, []);
  assert.deepEqual(registered, []);

  failStorage = true;
  await assert.rejects(product.handleMessage(message, context), /storage unavailable/);
  assert.deepEqual(settings.websiteFixer.stayOnPage.whitelistDomains, []);
  assert.deepEqual(rules, []);
  assert.deepEqual(registered, []);

  failStorage = false;
  failedRegistrations = 1;
  const recovered = await product.handleMessage(message, context);
  assert.deepEqual(recovered.stayOnPage.whitelistDomains, ['example.com']);
  assert.deepEqual(rules.map(rule => rule.id), [930002]);
  assert.equal(registered.length, 2);

  ignoreNetworkUpdate = true;
  await assert.rejects(product.handleMessage({ ...message, type: 'UI_DELETE_RULE' }, context), /could not verify/);
  assert.deepEqual(settings.websiteFixer.stayOnPage.whitelistDomains, ['example.com']);
  assert.deepEqual(rules.map(rule => rule.id), [930002]);
});

test('Translate Override clears page-wide and nested opt-outs, including late rewrites', () => {
  const observers = [];
  const timers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; this.active = true; }
    disconnect() { this.active = false; }
  }
  function element(localName, attributes = {}, children = []) {
    const values = { ...attributes };
    return {
      nodeType: 1, localName, children, connected: true,
      getAttribute(attribute) { return values[attribute] ?? null; },
      hasAttribute(attribute) { return Object.hasOwn(values, attribute); },
      setAttribute(attribute, value) { values[attribute] = value; },
      removeAttribute(attribute) { delete values[attribute]; },
      remove() { this.connected = false; },
      querySelectorAll() {
        return this.children.flatMap(child => child.connected ? [child, ...child.querySelectorAll()] : []);
      }
    };
  }
  const denied = element('meta', { name: 'google', content: 'notranslate' });
  const ordinary = element('meta', { name: 'viewport', content: 'width=device-width' });
  const nested = element('article', { translate: 'No', class: 'copy notranslate' });
  const head = element('head', {}, [denied, ordinary]);
  const body = element('body', { class: 'notranslate layout' }, [nested]);
  const root = element('html', { translate: 'no', class: 'page notranslate' }, [head, body]);
  const document = { documentElement: root };
  const context = vm.createContext({ document, MutationObserver: Observer,
    setTimeout(callback) { timers.push(callback); return timers.length; }
  });
  vm.runInContext(readFileSync(new URL('../extension/content/website-fixer/website-fixer-translate.js', import.meta.url), 'utf8'), context);

  assert.equal(denied.connected, false);
  assert.equal(ordinary.connected, true);
  assert.equal(root.hasAttribute('translate'), false, 'the page root must not suppress Chrome Translate');
  assert.equal(root.getAttribute('class'), 'page');
  assert.equal(body.getAttribute('class'), 'layout');
  assert.equal(nested.hasAttribute('translate'), false);
  assert.equal(nested.getAttribute('class'), 'copy');

  const lateMeta = element('meta', { name: 'GOOGLE', content: 'other, NOTRANSLATE' });
  const lateSection = element('section', { translate: 'no' }, [lateMeta]);
  body.children.push(lateSection);
  observers[0].callback([{ type: 'childList', addedNodes: [lateSection] }]);
  assert.equal(lateSection.hasAttribute('translate'), false);
  assert.equal(lateMeta.getAttribute('content'), 'other');
  root.setAttribute('translate', 'no');
  observers[0].callback([{ type: 'attributes', target: root }]);
  assert.equal(root.hasAttribute('translate'), false);
  assert.deepEqual(Array.from(observers[0].options.attributeFilter), ['name', 'content', 'value', 'translate', 'class']);
  assert.equal(timers.length, 1, 'the broad mutation watch is time-bounded');
  timers[0]();
  assert.equal(observers[0].active, false);
});

test('Translate Override catches the document root when the script starts before parsing', () => {
  let callback;
  const root = {
    nodeType: 1, localName: 'html', attributes: { translate: 'no' },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    querySelectorAll() { return []; }
  };
  const document = { documentElement: null };
  const context = vm.createContext({ document, setTimeout() {}, MutationObserver: class {
    constructor(listener) { callback = listener; }
    observe() {}
    disconnect() {}
  } });
  vm.runInContext(readFileSync(new URL('../extension/content/website-fixer/website-fixer-translate.js', import.meta.url), 'utf8'), context);
  document.documentElement = root;
  callback([{ type: 'childList', addedNodes: [root] }]);
  assert.equal(root.getAttribute('translate'), null);
});

test('Stay on the page normalizes site boundaries without authorizing the other fix', () => {
  for (const [input, expected] of [['deep.example.co.uk', 'example.co.uk'], ['employee.corporate-server.corp', 'corporate-server.corp'], ['a.tenant.github.io', 'tenant.github.io'], ['*.SUB.example.com', 'example.com']]) {
    assert.equal(normalizeWebsiteFixerSite(input), expected);
  }
  const settings = normalizeSettings({ websiteFixer: { enabled: true, stayOnPage: {
    enabled: true, whitelistDomains: ['sub.example.com', 'example.com', 'bad/path']
  } } });
  assert.deepEqual(settings.websiteFixer.stayOnPage.whitelistDomains, ['example.com']);
  const cached = settingsViewCache(settings).websiteFixer;
  assert.equal(cached.stayOnPage.enabled, true);
  assert.equal(cached.stayOnPage.savedCount, 1);
  assert.equal(Object.hasOwn(cached.stayOnPage, 'whitelistDomains'), false, 'hidden list is not duplicated into the first-frame cache');
  assert.equal(settings.websiteFixer.translateOverride.enabled, false);
  assert.equal(websiteFixerState(settings, 'https://deep.example.com').active, true);
  assert.equal(websiteFixerState(settings, 'https://example.com.evil.test').active, false);
});

test('Stay on the page owns bounded independent rules and preserves per-site add/delete APIs', async () => {
  let settings = normalizeSettings(), registered = [], network = [{ id: 10, action: { type: 'block' } }], writes = 0;
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    tabs: { query: async () => [{ id: 7, url: 'https://deep.example.co.uk/', incognito: false }] },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => registered.filter(script => ids.includes(script.id)),
      registerContentScripts: async scripts => { registered.push(...scripts); },
      updateContentScripts: async scripts => { registered = registered.map(script => scripts.find(next => next.id === script.id) || script); },
      unregisterContentScripts: async ({ ids }) => { registered = registered.filter(script => !ids.includes(script.id)); }
    },
    declarativeNetRequest: {
      getSessionRules: async () => network,
      updateSessionRules: async ({ removeRuleIds, addRules = [] }) => {
        writes++; network = network.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    }
  };
  const product = createWebsiteFixerProduct({ readSettings: async () => settings,
    mutateSettings: async revise => settings = normalizeSettings(await revise(settings)) });
  const sender = { sender: { url: 'chrome-extension://test/settings/satellites.html' } };
  const rule = (type, value, group = 'stayOnPage') => product.handleMessage({ type,
    listName: 'whitelistDomains', settingGroup: group, rule: value }, sender);
  await rule('UI_ADD_RULE', 'https//a.example.co.uk/path');
  await rule('UI_ADD_RULE', 'translate.test', 'translateOverride');
  await product.handleMessage({ type: 'UI_SET_WEBSITE_FIXER_STAY_ON_PAGE', enabled: true }, sender);
  assert.equal(registered.length, 0);
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true }, sender);
  assert.equal(registered.length, 2);
  assert.deepEqual(registered.map(script => script.world), ['MAIN', 'ISOLATED']);
  assert.ok(registered.every(script => script.allFrames && script.matchOriginAsFallback && script.runAt === 'document_start'));
  assert.deepEqual(registered[0].matches, ['*://*.example.co.uk/*']);
  assert.deepEqual(network[1].condition, { initiatorDomains: ['example.co.uk'], excludedRequestDomains: ['example.co.uk'],
    resourceTypes: ['main_frame'], tabIds: [7] });
  assert.equal(network[1].action.type, 'block');
  assert.deepEqual(network[2].condition.resourceTypes, ['sub_frame']);
  assert.doesNotMatch(network[2].action.responseHeaders[0].value, /allow-popups|allow-top-navigation/);
  const count = writes; await product.initialize(); assert.equal(writes, count, 'unchanged settings do not rewrite network rules');
  const beforeMissingRemoval = [...settings.websiteFixer.stayOnPage.whitelistDomains];
  await rule('UI_DELETE_RULE', 'https://not-saved.example.net/page');
  assert.deepEqual(settings.websiteFixer.stayOnPage.whitelistDomains, beforeMissingRemoval);
  await rule('UI_DELETE_RULE', 'example.co.uk');
  assert.equal(registered.length, 0);
  assert.deepEqual(network.map(rule => rule.id), [10]);
  assert.deepEqual(settings.websiteFixer.translateOverride.whitelistDomains, ['translate.test']);
  await rule('UI_ADD_RULE', 'one.test'); await rule('UI_ADD_RULE', 'two.test');
  await rule('UI_CLEAR_RULES'); assert.deepEqual(settings.websiteFixer.stayOnPage.whitelistDomains, []);
  await assert.rejects(rule('UI_ADD_RULE', 'bad.test', 'unrecognized'));
  await product.reset(); assert.deepEqual(network.map(rule => rule.id), [10]);
});

test('Stay on the page confines network blocking to source tabs and honors browser context-menu navigation', async () => {
  const source = { id: 1, url: 'https://stay.test/article', incognito: false };
  const tabs = new Map([[source.id, source]]);
  const removed = [];
  let rules = [];
  const settings = normalizeSettings({ websiteFixer: { enabled: true, stayOnPage: {
    enabled: true, whitelistDomains: ['stay.test']
  } } });
  globalThis.chrome = {
    tabs: {
      query: async () => [...tabs.values()],
      get: async id => tabs.get(id),
      remove: async id => { removed.push(id); tabs.delete(id); }
    },
    declarativeNetRequest: {
      getSessionRules: async () => rules,
      updateSessionRules: async ({ removeRuleIds, addRules = [] }) => {
        rules = rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    }
  };
  const stay = createStayOnPage({ readSettings: async () => settings });
  await stay.reconcile(settings);
  assert.deepEqual(rules.find(rule => rule.condition.resourceTypes.includes('main_frame')).condition.tabIds, [1]);

  const manual = { id: 2, url: 'https://outside.test/typed', incognito: false };
  tabs.set(manual.id, manual);
  await stay.handleTabCreated(manual);
  assert.deepEqual(removed, [], 'a user-created tab is not tied to the protected page');

  const popup = { id: 3, openerTabId: 1, url: 'https://outside.test/popup', incognito: false };
  tabs.set(popup.id, popup);
  stay.handleNavigationRequest({ tabId: popup.id, initiator: 'https://stay.test', url: popup.url });
  await stay.handleTabCreated(popup);
  assert.deepEqual(removed, [3], 'a page-created external tab remains blocked');

  assert.equal(await stay.handleContextMenu({ kind: 'browser', urls: ['https://outside.test/article'] }, { tab: source }), true);
  const chosen = { id: 4, openerTabId: 1, url: 'https://outside.test/article', incognito: false };
  tabs.set(chosen.id, chosen);
  await stay.handleTabCreated(chosen);
  assert.deepEqual(removed, [3], 'the exact link chosen from a browser context menu is allowed');

  const unrelated = { id: 5, openerTabId: 1, url: 'https://outside.test/other', incognito: false };
  tabs.set(unrelated.id, unrelated);
  stay.handleNavigationRequest({ tabId: unrelated.id, initiator: 'https://stay.test', url: unrelated.url });
  await stay.handleTabCreated(unrelated);
  assert.deepEqual(removed, [3, 5]);

  assert.equal(await stay.handleContextMenu({ kind: 'browser', urls: [], search: true }, { tab: source }), true);
  const search = { id: 6, openerTabId: 1, url: 'https://www.google.com/search?q=example', incognito: false };
  tabs.set(search.id, search);
  await stay.handleTabCreated(search);
  assert.deepEqual(removed, [3, 5], 'Search with Google is a browser action');
  assert.equal(await stay.handleContextMenu({ kind: 'browser', urls: [
    'https://outside.test/photo.jpg', 'https://outside.test/video.mp4'
  ] }, { tab: source }), true);
  const image = { id: 9, openerTabId: 1, url: 'https://outside.test/photo.jpg', incognito: false };
  tabs.set(image.id, image);
  stay.handleNavigationRequest({ tabId: image.id, initiator: 'https://stay.test', url: image.url });
  await stay.handleTabCreated(image);
  assert.deepEqual(removed, [3, 5], 'a chosen image target is allowed even with a webpage initiator');
  const otherAfterMenu = { id: 10, openerTabId: 1, url: 'https://outside.test/unrelated', incognito: false };
  tabs.set(otherAfterMenu.id, otherAfterMenu);
  stay.handleNavigationRequest({ tabId: otherAfterMenu.id, initiator: 'https://stay.test', url: otherAfterMenu.url });
  await stay.handleTabCreated(otherAfterMenu);
  assert.deepEqual(removed, [3, 5, 10], 'right-clicking does not permit an unrelated website popup');
  assert.equal(await stay.handleContextMenu({ kind: 'browser', urls: ['https://outside.test/photo.jpg'], image: true }, { tab: source }), true);
  const lens = { id: 11, openerTabId: 1, url: 'https://lens.google.com/uploadbyurl?url=photo', incognito: false };
  tabs.set(lens.id, lens);
  stay.handleNavigationRequest({ tabId: lens.id, initiator: 'https://stay.test', url: lens.url });
  await stay.handleTabCreated(lens);
  assert.deepEqual(removed, [3, 5, 10], 'browser image search is allowed');
  assert.equal(await stay.handleContextMenu({ kind: 'browser', urls: [] }, { tab: source }), true);
  const viewSource = { id: 12, openerTabId: 1, url: 'view-source:https://stay.test/article', incognito: false };
  tabs.set(viewSource.id, viewSource);
  await stay.handleTabCreated(viewSource);
  assert.deepEqual(removed, [3, 5, 10], 'the browser source viewer is not website navigation');
  const extensionTab = { id: 7, openerTabId: 1, url: 'https://outside.test/extension-open', incognito: false };
  tabs.set(extensionTab.id, extensionTab);
  stay.handleNavigationRequest({ tabId: extensionTab.id, url: extensionTab.url });
  await stay.handleTabCreated(extensionTab);
  assert.deepEqual(removed, [3, 5, 10], 'an extension-created tab is not a website popup');
  const extensionPage = { id: 8, openerTabId: 1,
    url: 'chrome-extension://other-extension/document-preview.html', incognito: false };
  tabs.set(extensionPage.id, extensionPage);
  await stay.handleTabCreated(extensionPage);
  assert.deepEqual(removed, [3, 5, 10], 'another extension page is not blocked');
  await stay.reconcile(settings);
  assert.deepEqual(rules.find(rule => rule.condition.resourceTypes.includes('main_frame')).condition.tabIds, [1],
    'newly opened external tabs never inherit the source tab network restriction');
});

test('Stay on the page does not close a tab after its navigation target changes', async () => {
  const source = { id: 1, url: 'https://stay.test/article', incognito: false };
  const popup = { id: 2, openerTabId: 1, url: 'about:blank', incognito: false };
  const tabs = new Map([[1, source], [2, popup]]);
  const removed = [];
  const settings = normalizeSettings({ websiteFixer: { enabled: true, stayOnPage: {
    enabled: true, whitelistDomains: ['stay.test']
  } } });
  globalThis.chrome = { tabs: {
    async get(id) { return tabs.get(id); },
    async remove(id) { removed.push(id); tabs.delete(id); }
  } };
  const stay = createStayOnPage({ readSettings: async () => settings });
  await stay.handleTabCreated(popup);
  const first = 'https://outside.test/advertisement';
  popup.url = first;
  stay.handleNavigationRequest({ tabId: 2, initiator: source.url, url: first });
  popup.url = 'https://manual.test/user-choice';
  await stay.handleTabUpdated(2, { url: popup.url }, popup);
  assert.deepEqual(removed, [], 'an earlier page navigation cannot close the user’s later destination');
  stay.handleNavigationRequest({ tabId: 2, initiator: '', url: popup.url });
  assert.deepEqual(removed, [], 'a browser-directed navigation is allowed');
});

test('scoped runtime uses the same curated site boundaries as background policy', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(readFileSync(new URL('../extension/content/website-fixer/website-fixer-site-key.js', import.meta.url), 'utf8'), context);
  const classify = vm.runInContext('globalThis[Symbol.for("cosmic-gemini.stay-site-key")]', context);
  for (const domain of ['a.example.co.uk', 'a.tenant.github.io', 'corporate-server.corp', 'example.com', 'deep.city.kawasaki.jp']) {
    assert.equal(classify('https://' + domain), normalizeWebsiteFixerSite(domain));
  }
});
