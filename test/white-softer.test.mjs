import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeSettings, DEFAULT_INCOGNITO_SETTINGS } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { createWhiteSofterProduct } from '../extension/background/products/standing/white-softer.js';

test('White Softer normalizes saved choices and starts inactive in ordinary and incognito contexts', () => {
  assert.deepEqual(normalizeSettings().whiteSofter, { enabled: false, tone: 'warm-minus-1' });
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.whiteSofter.enabled, false);
  assert.deepEqual(normalizeSettings({ whiteSofter: { enabled: true, tone: 'warm-minus-1' } }).whiteSofter, { enabled: true, tone: 'warm-minus-1' });
  for (const tone of [null, 'unknown', '#ffffff']) {
    assert.deepEqual(normalizeSettings({ whiteSofter: { enabled: true, tone } }).whiteSofter, { enabled: true, tone: 'warm-minus-1' });
  }
  assert.deepEqual(settingsViewCache({ whiteSofter: { enabled: true, tone: 'cool', active: false } }).whiteSofter, { enabled: true, tone: 'cool' });
});

test('Settings preload the White Softer palette before styles and reconcile enabled state', () => {
  const source = readFileSync(new URL('../extension/settings/palette-preload.js', import.meta.url), 'utf8');
  const create = (preference, incognito = false) => {
    const root = { dataset: {} };
    const context = vm.createContext({ document: { documentElement: root },
      chrome: { extension: { inIncognitoContext: incognito } },
      localStorage: { getItem() { return JSON.stringify({ whiteSofter: preference }); } } });
    vm.runInContext(source, context);
    return { root, palette: context[Symbol.for('cosmic-gemini.settings.white-softer-palette')] };
  };
  const ordinary = create({ enabled: true, tone: 'warm' });
  assert.equal(ordinary.root.dataset.whiteSofterTone, 'warm', 'a saved choice survives the new default');
  ordinary.palette.apply({ enabled: true, tone: 'cool' });
  assert.equal(ordinary.root.dataset.whiteSofterTone, 'cool');
  ordinary.palette.apply({ enabled: false, tone: 'cool' });
  assert.equal(ordinary.root.dataset.whiteSofterTone, undefined);
  assert.equal(create({ enabled: true }, true).root.dataset.whiteSofterTone, undefined,
    'ordinary preferences do not leak into incognito Settings');
  assert.equal(create({ enabled: true }).root.dataset.whiteSofterTone, 'warm-minus-1');
  for (const page of ['all-settings', 'native-scroll', 'no-autoplay', 'any-copy', 'image-download',
    'video-download', 'page-display', 'satellites']) {
    const html = readFileSync(new URL(`../extension/settings/${page}.html`, import.meta.url), 'utf8');
    assert.ok(html.indexOf('palette-preload.js') < html.indexOf('settings.css'), `${page} preloads its palette`);
    assert.ok(html.includes('dropdowns.js') && html.indexOf('dropdowns.js') < html.indexOf('preload.js"></script>', html.indexOf('<body')),
      `${page} prepares dropdowns before revealing the localized page`);
  }
  const css = readFileSync(new URL('../extension/settings/settings.css', import.meta.url), 'utf8');
  assert.match(css, /:root\[data-white-softer-tone\] \.switch span::after \{ background: rgb\(var\(--settings-soft-white\)\); \}/);
  assert.match(css, /--on-blue: rgb\(var\(--settings-soft-white\)\)/, 'primary button text uses the selected tone');
  assert.match(css, /--settings-on-danger: rgb\(var\(--settings-soft-white\)\)/, 'confirmation button text uses the selected tone');
  assert.match(css, /input\[type="checkbox"\]:not\(\.switch input\):checked::after/, 'native checkbox marks use the selected tone');
  assert.match(css, /@media \(forced-colors: active\)/, 'high-contrast mode retains native checkbox rendering');
  assert.match(css, /background-position: right 16px center/, 'select arrows retain right-edge breathing room');
  assert.doesNotMatch(css, /border-right-width:\s*8px/, 'selects retain their normal border geometry');
  assert.match(css, /left: anchor\(left\)/, 'option panels align to the control rather than its text');
  assert.match(css, /width: anchor-size\(width\)/, 'option panels use the same width as the control');
});

test('Standing product applies once per supported page and preserves the selected tone while disabled', async () => {
  const previousChrome = globalThis.chrome;
  const registered = new Map();
  globalThis.chrome = { scripting: {
    async getRegisteredContentScripts({ ids }) { return ids.map(id => registered.get(id)).filter(Boolean); },
    async registerContentScripts(scripts) { for (const script of scripts) registered.set(script.id, script); },
    async updateContentScripts(scripts) { for (const script of scripts) registered.set(script.id, script); },
    async unregisterContentScripts({ ids }) { for (const id of ids) registered.delete(id); }
  } };
  try {
  let settings = normalizeSettings();
  const decisions = [];
  const product = createWhiteSofterProduct({ async sync(_product, context, active, styles) {
    decisions.push({ frame: context.frameId, active, styles });
  } }, { async mutateSettings(change) { settings = normalizeSettings(await change(settings)); return settings; },
    async readSettings() { return settings; } });
  const context = { topUrl: 'https://example.com/', frameId: 0 };
  assert.equal(await product.sync(context, settings), false);
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true });
  assert.equal(registered.size, 2);
  const early = registered.get('cosmic-gemini-white-softer-prepaint');
  assert.equal(early.runAt, 'document_start');
  assert.equal(early.world, 'MAIN');
  assert.deepEqual(early.css, ['content/white-softer/white-softer.css']);
  assert.ok(early.js.includes('content/white-softer/tones/warm-minus-1.js'));
  assert.equal(registered.get('cosmic-gemini-white-softer-prepaint-check').world, 'ISOLATED');
  assert.equal(await product.sync(context, settings), true);
  assert.equal(await product.sync({ ...context, frameId: 1 }, settings), false);
  assert.equal(await product.sync({ ...context, topUrl: 'chrome://settings/' }, settings), false);
  assert.equal(product.state(settings, 'http://example.com/').active, true);
  assert.deepEqual(decisions[1].styles, ['content/white-softer/white-softer.css']);
  await product.handleMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', tone: 'cool' });
  assert.ok(registered.get('cosmic-gemini-white-softer-prepaint').js.includes('content/white-softer/tones/cool.js'));
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false });
  assert.equal(registered.size, 0);
  assert.deepEqual(settings.whiteSofter, { enabled: false, tone: 'cool' });
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true });
  assert.equal(product.state(settings, context.topUrl).tone, 'cool');
  await assert.rejects(product.handleMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', tone: '<style>' }));
  assert.deepEqual(settings.whiteSofter, { enabled: true, tone: 'cool' });
  await product.reset();
  assert.equal(registered.size, 0);
  await product.initialize();
  assert.equal(registered.size, 2, 'saved settings restore document-start registration');
  settings = normalizeSettings({ ...settings, whiteSofter: { enabled: false, tone: 'cool' } });
  await product.handleStorageChanged({ cosmicGeminiSettings: { oldValue: { whiteSofter: { enabled: true, tone: 'cool' } },
    newValue: { whiteSofter: settings.whiteSofter } } }, 'local');
  assert.equal(registered.size, 0, 'external storage changes remove the early injection');
  } finally { globalThis.chrome = previousChrome; }
});

test('document-start prepaint hands its single filter to the normal runtime', () => {
  const listeners = new Map();
  const window = {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); }
  };
  class Element {
    constructor() { this.attributes = new Map(); this.style = { setProperty() {} }; this.children = []; this.open = false; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    append(child) { this.children.push(child); child.parentNode = this; }
    matches(selector) { return selector === ':popover-open' && this.open; }
    showPopover() { this.open = true; }
    remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  }
  const root = new Element();
  const rootObservers = [];
  const document = {
    contentType: 'text/html', documentElement: null, createElement: () => new Element(), createElementNS: () => new Element(),
    addEventListener() {}, removeEventListener() {}
  };
  const context = vm.createContext({ window, document, Symbol, Math, Number, Array, Uint8Array,
    MutationObserver: class { constructor(callback) { this.callback = callback; rootObservers.push(this); }
      observe() {} disconnect() {} },
    crypto: { getRandomValues(bytes) { bytes.fill(1); return bytes; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  });
  for (const file of ['shared/white-tones.js', 'content/shared/white-cap-layer.js',
    'content/white-softer/tones/cool.js', 'content/white-softer/white-softer-prepaint.js']) {
    vm.runInContext(readFileSync(new URL('../extension/' + file, import.meta.url), 'utf8'), context);
  }
  const prepaint = context[Symbol.for('cosmic-gemini.white-softer.prepaint')];
  assert.ok(prepaint);
  assert.equal(root.children.length, 0);
  document.documentElement = root;
  rootObservers[0].callback();
  const host = root.children[0];
  assert.equal(host.parentNode, root);
  assert.equal(host.getAttribute('data-tone'), 'cool');
  assert.equal(host.open, true);
  window.dispatchEvent({ type: 'cosmic-gemini:white-softer:prepaint-check', detail: JSON.stringify({
    active: true, tone: 'warm-minus-1'
  }) });
  assert.equal(host.getAttribute('data-tone'), 'warm-minus-1');
  vm.runInContext(readFileSync(new URL('../extension/content/white-softer/white-softer-runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context[Symbol.for('cosmic-gemini.white-softer.runtime')];
  assert.equal(runtime.layer.host, host);
  assert.equal(context[Symbol.for('cosmic-gemini.white-softer.prepaint')], undefined);
  window.dispatchEvent({ type: 'cosmic-gemini:white-softer:configure', detail: JSON.stringify({
    token: runtime.token, config: { active: true, tone: 'warm' }
  }) });
  assert.equal(host.getAttribute('data-tone'), 'warm');
  assert.equal(root.children.filter(child => child.getAttribute('data-cosmic-gemini-white-softer') === '').length, 1);
  const replacement = new Element();
  document.documentElement = replacement;
  rootObservers[0].callback();
  assert.equal(host.parentNode, replacement, 'root replacement retains the same filter');
  window.dispatchEvent({ type: 'cosmic-gemini:white-softer:dispose', detail: runtime.token });
  assert.equal(host.parentNode, null);
  vm.runInContext(readFileSync(new URL('../extension/content/white-softer/white-softer-prepaint.js', import.meta.url), 'utf8'), context);
  const staleHost = replacement.children[0];
  window.dispatchEvent({ type: 'cosmic-gemini:white-softer:prepaint-check', detail: JSON.stringify({ active: false }) });
  assert.equal(staleHost.parentNode, null);
  assert.equal(context[Symbol.for('cosmic-gemini.white-softer.prepaint')], undefined);
});

test('XML waits for the native viewer, retains the latest tone and cancels deferred work when disabled', () => {
  const htmlNS = 'http://www.w3.org/1999/xhtml';
  const listeners = new Map(), created = [];
  class Element {
    constructor(ns, name) {
      this.namespaceURI = ns; this.localName = name; this.attributes = new Map(); this.children = [];
      if (ns === htmlNS || ns === 'http://www.w3.org/2000/svg') this.style = { setProperty() {} };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    append(child) { this.children.push(child); child.parentNode = this; }
    matches() { return this.open === true; }
    showPopover() { this.open = true; }
    remove() { this.parentNode = null; }
  }
  const document = {
    contentType: 'text/xml', readyState: 'loading', documentElement: new Element('urn:sitemap', 'urlset'),
    createElementNS(ns, name) { created.push([ns, name]); return new Element(ns, name); },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const context = vm.createContext({ document, Symbol, Math, Number, Array,
    MutationObserver: class { observe() {} disconnect() {} } });
  for (const file of ['shared/white-tones.js', 'content/shared/white-cap-layer.js']) {
    vm.runInContext(readFileSync(new URL('../extension/' + file, import.meta.url), 'utf8'), context);
  }
  const Layer = context[Symbol.for('cosmic-gemini.white-cap-layer')];
  const layer = new Layer('data-test-white-cap');
  layer.enable('warm'); layer.enable('cool');
  assert.equal(created.length, 0, 'raw XML must receive no SVG or HTML nodes');
  assert.equal(listeners.get('readystatechange').size, 1, 'repeated configuration has one readiness listener');
  document.readyState = 'interactive';
  for (const listener of listeners.get('readystatechange')) listener();
  assert.equal(created.length, 0, 'interactive is still too early for the XML viewer');
  document.documentElement = new Element(htmlNS, 'html');
  document.readyState = 'complete';
  for (const listener of listeners.get('readystatechange')) listener();
  assert.equal(layer.host.namespaceURI, htmlNS, 'XML creates a real HTMLElement, not a generic Element');
  assert.equal(layer.host.getAttribute('data-tone'), 'cool');
  assert.equal(layer.host.open, true);
  layer.disable();
  document.readyState = 'loading'; document.documentElement = new Element('urn:sitemap', 'urlset');
  layer.enable('warm'); layer.disable();
  assert.equal(listeners.get('readystatechange').size, 0, 'turning off cancels the pending XML mount');
  document.readyState = 'complete';
  layer.enable();
  assert.equal(layer.host, null, 'authored non-HTML XML and standalone SVG stay untouched');
  assert.equal(layer.rootObserver, null);
});

function whiteBridgeFixture() {
  const window = new EventTarget(), requests = [], configs = [], timers = new Map();
  let messageListener, timerId = 0;
  class CustomEvent extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } }
  window.addEventListener('cosmic-gemini:white-softer:configure', event => configs.push(JSON.parse(event.detail)));
  const context = vm.createContext({ window, CustomEvent, Symbol, JSON, Promise,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: {
      sendMessage: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
      onMessage: { addListener(listener) { messageListener = listener; }, removeListener() {} }
    } }
  });
  vm.runInContext(readFileSync(new URL('../extension/content/white-softer/white-softer-bridge.js', import.meta.url), 'utf8'), context);
  return { requests, configs, timers,
    announce: () => window.dispatchEvent(new CustomEvent('cosmic-gemini:white-softer:main-ready', { detail: 'token' })),
    refresh: () => new Promise(resolve => messageListener({ type: 'CG_REFRESH_FEATURE_CONFIG', featureId: 'whiteSofter' }, {}, resolve)),
    stop: () => messageListener({ type: 'CG_STOP_CENTRAL_FEATURE', featureId: 'whiteSofter' }, {}, () => {}),
    retry: () => timers.values().next().value?.()
  };
}
const whiteResponse = tone => ({ ok: true, result: { whiteSofter: { active: true, tone } } });
const settleBridge = () => new Promise(resolve => setImmediate(resolve));

test('overlapping White Softer refreshes share a final acknowledgement and discard stale colors', async () => {
  const fixture = whiteBridgeFixture(); fixture.announce();
  const first = fixture.refresh(), second = fixture.refresh(); fixture.announce();
  assert.equal(fixture.requests.length, 1);
  fixture.requests[0].resolve(whiteResponse('warm')); await settleBridge();
  assert.equal(fixture.requests.length, 2, 'a refresh during the lookup rereads the current preference');
  assert.equal(fixture.configs.length, 0, 'the old tone is never applied');
  fixture.requests[1].resolve(whiteResponse('cool'));
  assert.equal((await first).configured, true);
  assert.equal((await second).configured, true);
  assert.equal(fixture.configs.length, 1);
  assert.equal(fixture.configs[0].config.tone, 'cool'); fixture.stop();
});

test('transient White Softer configuration failure retries before the runtime host can remove styles', async () => {
  const fixture = whiteBridgeFixture(); const result = fixture.refresh();
  fixture.requests[0].reject(new Error('worker restarting')); await settleBridge();
  assert.equal(fixture.timers.size, 1); assert.equal(fixture.configs.length, 0);
  fixture.retry(); await settleBridge(); fixture.requests[1].resolve(whiteResponse('warm'));
  assert.equal((await result).configured, true); assert.equal(fixture.timers.size, 0); fixture.stop();
});

test('White Softer disposal settles pending retries and ignores late configuration replies', async () => {
  const fixture = whiteBridgeFixture(); const result = fixture.refresh();
  fixture.requests[0].reject(new Error('temporarily unavailable')); await settleBridge();
  fixture.stop();
  assert.equal((await result).configured, false); assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.requests.length, 1);
  const late = whiteBridgeFixture(); const pending = late.refresh(); late.stop();
  late.requests[0].resolve(whiteResponse('cool'));
  assert.equal((await pending).configured, false);
  assert.equal(late.configs.some(message => message.config.active), false);
});

test('White Softer configuration failures are bounded and finish without a lingering timer', async () => {
  const fixture = whiteBridgeFixture(); const result = fixture.refresh();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    fixture.requests[attempt].reject(new Error('unavailable')); await settleBridge();
    if (attempt < 3) { fixture.retry(); await settleBridge(); }
  }
  assert.equal((await result).configured, false); assert.equal(fixture.requests.length, 4);
  assert.equal(fixture.timers.size, 0);
});

test('early settings check removes stale prepaint when White Softer was turned off', async () => {
  const events = [];
  const listeners = new Map();
  const window = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) { events.push(event); }
  };
  const chrome = {
    extension: { inIncognitoContext: false },
    storage: {
      local: { async get() { return { cosmicGeminiSettings: { whiteSofter: { enabled: false, tone: 'warm' } } }; } },
      onChanged: { addListener(listener) { listeners.set('storage', listener); } }
    }
  };
  const context = vm.createContext({ window, chrome, Symbol, CustomEvent: class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  } });
  vm.runInContext(readFileSync(new URL('../extension/content/white-softer/white-softer-prepaint-check.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(events[0].detail).active, false);
  listeners.get('storage')({ cosmicGeminiSettings: { newValue: { whiteSofter: { enabled: true, tone: 'cool' } } } }, 'local');
  assert.deepEqual(JSON.parse(events.at(-1).detail), { active: true, tone: 'cool' });
});

test('White Softer does not save an enabled preference if early registration fails', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { scripting: {
    async getRegisteredContentScripts() { return []; },
    async registerContentScripts() { throw new Error('registration failed'); }
  } };
  let settings = normalizeSettings();
  const product = createWhiteSofterProduct({ async sync() {} }, {
    async readSettings() { return settings; },
    async mutateSettings(change) { settings = normalizeSettings(await change(settings)); return settings; }
  });
  try {
    await assert.rejects(product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true }), /registration failed/);
    assert.equal(settings.whiteSofter.enabled, false);
  } finally { globalThis.chrome = previousChrome; }
});

test('private White Softer prepaint is session-scoped and separately registered', async () => {
  const previousChrome = globalThis.chrome;
  const scripts = [];
  globalThis.chrome = { scripting: {
    async getRegisteredContentScripts() { return []; },
    async registerContentScripts(batch) { scripts.push(...batch); }
  } };
  const settings = normalizeSettings({ whiteSofter: { enabled: true, tone: 'cool' } });
  const product = createWhiteSofterProduct({ async sync() {} }, {
    isIncognitoContext: () => true, async readSettings() { return settings; }
  });
  try {
    await product.initialize();
    assert.equal(scripts.length, 2);
    assert.ok(scripts.every(script => script.id.endsWith('-incognito') && script.persistAcrossSessions === false));
    assert.ok(scripts[0].js.includes('content/white-softer/tones/cool.js'));
  } finally { globalThis.chrome = previousChrome; }
});

test('White Softer preserves near-white surface and border contrast at every tone', () => {
  class Element {
    constructor() { this.attributes = new Map(); this.children = []; this.style = { setProperty() {} }; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    append(child) { this.children.push(child); child.parentNode = this; }
  }
  const context = vm.createContext({
    document: { contentType: 'text/html', createElement: () => new Element(), createElementNS: () => new Element(),
      addEventListener() {}, removeEventListener() {} },
    Symbol, Math, Number, Array
  });
  for (const file of ['white-tones.js', '../content/shared/white-cap-layer.js']) {
    vm.runInContext(readFileSync(new URL('../extension/shared/' + file, import.meta.url), 'utf8'), context);
  }
  const Layer = context[Symbol.for('cosmic-gemini.white-cap-layer')];
  const layer = new Layer('data-test-white-cap');
  layer.mount = () => {};
  for (const tone of context[Symbol.for('cosmic-gemini.white-tones')].tones) {
    vm.runInContext(readFileSync(new URL(`../extension/content/white-softer/tones/${tone.id}.js`, import.meta.url), 'utf8'), context);
    assert.equal(vm.runInContext("globalThis[Symbol.for('cosmic-gemini.white-softer.prepaint-tone')]", context), tone.id);
    layer.enable(tone.id);
    const caps = tone.rgb.split(' ').map(Number);
    layer.channels.forEach((channel, index) => {
      const values = channel.getAttribute('tableValues').split(' ').map(value => Math.round(Number(value) * 255));
      const cap = caps[index], shoulder = cap - 32;
      assert.equal(values.length, 256);
      assert.equal(values[255], cap, `${tone.id}: white must equal the selected color`);
      for (let n = 0; n <= shoulder; n++) assert.equal(values[n], n, `${tone.id}: midtones stay unchanged`);
      for (let n = 1; n < 256; n++) assert.ok(values[n] >= values[n-1], `${tone.id}: grayscale order ${n}`);
      assert.ok(values[240] < values[255], `${tone.id}: a light border remains distinct from its white panel`);
      assert.ok(values[245] < values[255], `${tone.id}: near-white and white surfaces remain distinct`);
    });
  }
});
