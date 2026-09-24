import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  normalizeSettings,
  normalizeWebsiteFixerDomain,
  websiteFixerState
} from '../extension/core/config.js';
import { createWebsiteFixerProduct } from '../extension/background/products/standing/website-fixer.js';

test('Website Fixer defaults off and matches only selected domains and their subdomains', () => {
  assert.deepEqual(DEFAULT_INCOGNITO_SETTINGS.websiteFixer, {
    enabled: false, translateOverride: { enabled: false, whitelistDomains: [] }
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

test('Website Fixer registers only allowlisted document-start scripts and unregisters when disabled', async () => {
  let settings = normalizeSettings();
  let registered = [];
  const calls = [];
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    scripting: {
      async getRegisteredContentScripts() { return registered; },
      async registerContentScripts(scripts) { calls.push('register'); registered = scripts; },
      async updateContentScripts(scripts) { calls.push('update'); registered = scripts; },
      async unregisterContentScripts() { calls.push('unregister'); registered = []; }
    }
  };
  const product = createWebsiteFixerProduct({
    readSettings: async () => settings,
    mutateSettings: async mutate => (settings = normalizeSettings(mutate(settings))),
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

test('Translate Override removes early and dynamically inserted page opt-outs only', () => {
  const observers = [];
  const timers = new Map();
  const listeners = new Map();
  let nextTimer = 1;
  const document = {
    head: null,
    readyState: 'loading',
  };
  const window = { addEventListener(type, listener) { listeners.set(type, listener); } };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; this.active = true; }
    disconnect() { this.active = false; }
  }
  function meta(name, content) {
    const attributes = { name, content };
    return {
      localName: 'meta', connected: true,
      getAttribute(attribute) { return attributes[attribute] ?? null; },
      hasAttribute(attribute) { return Object.hasOwn(attributes, attribute); },
      setAttribute(attribute, value) { attributes[attribute] = value; },
      removeAttribute(attribute) { delete attributes[attribute]; },
      remove() { this.connected = false; }
    };
  }
  const context = vm.createContext({ document, window, MutationObserver: Observer,
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(readFileSync(new URL('../extension/content/website-fixer-translate.js', import.meta.url), 'utf8'), context);
  const denied = meta('google', 'notranslate');
  const ordinary = meta('viewport', 'width=device-width');
  const head = { metas: [denied, ordinary], querySelectorAll() { return this.metas.filter(item => item.connected); } };
  document.head = head;
  observers[0].callback();
  assert.equal(denied.connected, false);
  assert.equal(ordinary.connected, true);
  const late = meta('GOOGLE', 'other, NOTRANSLATE');
  head.metas.push(late);
  observers[1].callback();
  assert.equal(late.connected, true);
  assert.equal(late.getAttribute('content'), 'other');
  listeners.get('load')();
  assert.equal(observers.every(observer => !observer.active), true);
  assert.equal(timers.size, 0);
});
