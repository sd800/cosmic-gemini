import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    if (!listeners.includes(listener)) listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of [...(this.listeners.get(event.type) || [])]) {
      if (typeof listener === 'function') listener.call(this, event);
      else listener?.handleEvent?.(event);
    }
    return true;
  }
}

class Style {
  constructor() { this.values = new Map(); }
  getPropertyValue(name) { return this.values.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
  setProperty(name, value, priority = '') { this.values.set(name, { value, priority }); }
  removeProperty(name) { this.values.delete(name); }
}

class FakeElement extends SimpleEventTarget {
  constructor(name) {
    super();
    this.name = name;
    this.style = new Style();
    this.dataset = {};
    this.children = [];
    this.isConnected = true;
    this.scrollHeight = 1000;
    this.clientHeight = 800;
    this.scrollTop = 0;
  }
  append(child) { child.isConnected = true; this.children.push(child); }
  remove() { this.isConnected = false; }
  removeAttribute() {}
  matches() { return false; }
  closest() { return null; }
  getBoundingClientRect() { return { width: 800, height: 1000 }; }
  scroll() {}
  scrollTo() {}
  scrollBy() {}
  scrollIntoView() {}
}

class FakeMutationObserver { observe() {} disconnect() {} }
class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; } }

function makeContext(hostname = 'example.com') {
  const window = new SimpleEventTarget();
  const document = new SimpleEventTarget();
  document.documentElement = new FakeElement('html');
  document.head = new FakeElement('head');
  document.body = new FakeElement('body');
  document.createElement = name => new FakeElement(name);
  window.scroll = () => {};
  window.scrollTo = () => {};
  window.scrollBy = () => {};
  const context = {
    window, document, EventTarget: SimpleEventTarget, Element: FakeElement,
    MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent,
    WeakMap, WeakRef, Map, Set, Symbol, JSON, Reflect, Number, String, Math,
    crypto: { getRandomValues: values => { values.fill(7); return values; } }, performance: { now: () => 100 },
    location: { hostname },
    innerWidth: 800, innerHeight: 800,
    requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame: () => {},
    getComputedStyle: element => ({ scrollBehavior: 'auto', scrollSnapType: 'none', overflowY: 'visible', position: 'static', transform: 'none', ...element.computed })
  };
  vm.createContext(context);
  return context;
}

function wheelEvent(context, target = context.document.body, path = null) {
  let stopped = false;
  return {
    isTrusted: true, defaultPrevented: false, ctrlKey: false, metaKey: false,
    deltaX: 0, deltaY: 30, target,
    composedPath: () => path || [target, context.document.body, context.document.documentElement, context.document, context.window],
    stopImmediatePropagation: () => { stopped = true; }, get stopped() { return stopped; }
  };
}

test('Native Scroll stays quiet on native pages and suppresses registered takeover code', async () => {
  const context = makeContext();
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const nativeEvent = wheelEvent(context);
  runtime.onWheel(nativeEvent);
  assert.equal(nativeEvent.stopped, false);
  let interventions = 0;
  context.window.addEventListener('cosmic-gemini:native-scroll:suppressed', () => { interventions += 1; });
  context.window.addEventListener('wheel', () => {});
  const hijackedEvent = wheelEvent(context);
  runtime.onWheel(hijackedEvent);
  assert.equal(hijackedEvent.stopped, true);
  assert.equal(interventions, 1);
  runtime.onDispose({ detail: runtime.token });
});

test('Native Scroll skips unload listeners when the document policy disallows them', async () => {
  const context = makeContext();
  context.document.permissionsPolicy = {
    allowsFeature: feature => feature !== 'unload'
  };
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const listener = () => {};
  context.EventTarget.prototype.addEventListener.call(context.window, 'unload', listener);
  assert.equal(context.window.listeners.has('unload'), false);
  context.window.addEventListener('load', listener);
  assert.equal(context.window.listeners.get('load').includes(listener), true);
  runtime.onDispose({ detail: runtime.token });
});

test('Native Scroll leaves page APIs untouched while inactive and restores them when disabled', async () => {
  const context = makeContext();
  const originalAdd = context.EventTarget.prototype.addEventListener;
  const originalScroll = context.window.scroll;
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window.scroll, originalScroll);
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  assert.notEqual(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.notEqual(context.window.scroll, originalScroll);
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window.scroll, originalScroll);
  runtime.onDispose({ detail: runtime.token });
  assert.equal(context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')], undefined);
});

test('Native Scroll becomes inert when a later page wrapper keeps its listener wrapper reachable', async () => {
  const context = makeContext();
  context.document.permissionsPolicy = { allowsFeature: feature => feature !== 'unload' };
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const nativeScrollWrapper = context.EventTarget.prototype.addEventListener;
  context.EventTarget.prototype.addEventListener = function laterPageWrapper(...args) {
    return Reflect.apply(nativeScrollWrapper, this, args);
  };
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(runtime.active, false);
  const listener = () => {};
  Reflect.apply(nativeScrollWrapper, context.window, ['custom', listener]);
  assert.equal(context.window.listeners.get('custom')?.includes(listener), true);
  Reflect.apply(nativeScrollWrapper, context.window, ['unload', listener]);
  assert.equal(context.window.listeners.get('unload').includes(listener), true);
  runtime.onDispose({ detail: runtime.token });
});

test('Native Scroll recognizes existing hijack listeners after it is disabled and re-enabled', async () => {
  const context = makeContext();
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  const originalAdd = context.EventTarget.prototype.addEventListener;
  vm.runInContext(source, context);
  const firstRuntime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  firstRuntime.onConfigure({ detail: JSON.stringify({ token: firstRuntime.token, config: { active: true, mode: 'standard' } }) });
  context.document.addEventListener('wheel', () => {});
  firstRuntime.onDispose({ detail: firstRuntime.token });
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')], undefined);

  vm.runInContext(source, context);
  const secondRuntime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  secondRuntime.onConfigure({ detail: JSON.stringify({ token: secondRuntime.token, config: { active: true, mode: 'standard' } }) });
  const standardEvent = wheelEvent(context);
  secondRuntime.onWheel(standardEvent);
  assert.equal(standardEvent.stopped, true);

  secondRuntime.onConfigure({ detail: JSON.stringify({ token: secondRuntime.token, config: { active: true, mode: 'enhanced' } }) });
  const enhancedEvent = wheelEvent(context);
  secondRuntime.onWheel(enhancedEvent);
  assert.equal(enhancedEvent.stopped, true);
  secondRuntime.onDispose({ detail: secondRuntime.token });
});

test('Native Scroll preserves Xiaohongshu wheel interactions', async () => {
  const context = makeContext('www.xiaohongshu.com');
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  context.window.addEventListener('wheel', () => {});
  const event = wheelEvent(context);
  runtime.onWheel(event);
  assert.equal(event.stopped, false);
  runtime.onDispose({ detail: runtime.token });
});

test('Native Scroll leaves Xiaohongshu page APIs and root styles untouched before a post opens', async () => {
  const context = makeContext('www.xiaohongshu.com');
  const originalAdd = context.EventTarget.prototype.addEventListener;
  const originalScroll = context.window.scroll;
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  assert.equal(runtime.active, true);
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window.scroll, originalScroll);
  assert.equal(context.document.documentElement.style.getPropertyValue('scroll-behavior'), '');
  assert.equal(context.document.body.style.getPropertyValue('overscroll-behavior'), '');
  assert.equal(runtime.observer, null);
  assert.equal(runtime.rootObservers.length, 0);
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'enhanced' } }) });
  assert.equal(context.document.documentElement.style.getPropertyValue('overflow-y'), '');
  runtime.onDispose({ detail: runtime.token });
});

test('Xiaohongshu native-interaction compatibility does not apply to other websites', async () => {
  const context = makeContext('example.com');
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  context.window.addEventListener('wheel', () => {});
  const event = wheelEvent(context);
  runtime.onWheel(event);
  assert.equal(event.stopped, true);
  runtime.onDispose({ detail: runtime.token });
});

test('Native Scroll Enhanced leaves the Xiaohongshu page intact', async () => {
  const context = makeContext('www.xiaohongshu.com');
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'enhanced' } }) });
  assert.equal(context.document.documentElement.style.getPropertyValue('height'), '');
  assert.equal(context.document.body.style.getPropertyValue('overflow-y'), '');
  runtime.onDispose({ detail: runtime.token });
});
