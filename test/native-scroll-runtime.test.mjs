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

function makeContext() {
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
    crypto: { randomUUID: () => 'runtime-token' }, performance: { now: () => 100 },
    innerWidth: 800, innerHeight: 800,
    requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame: () => {},
    getComputedStyle: element => ({ scrollBehavior: 'auto', scrollSnapType: 'none', overflowY: 'visible', position: 'static', transform: 'none', ...element.computed })
  };
  vm.createContext(context);
  return context;
}

function wheelEvent(context) {
  let stopped = false;
  return {
    isTrusted: true, defaultPrevented: false, ctrlKey: false, metaKey: false,
    deltaX: 0, deltaY: 30, target: context.document.body,
    composedPath: () => [context.document.body, context.document.documentElement, context.document, context.window],
    stopImmediatePropagation: () => { stopped = true; }, get stopped() { return stopped; }
  };
}

test('Native Scroll stays quiet on native pages and suppresses registered takeover code', async () => {
  const context = makeContext();
  const source = await readFile(new URL('../extension/content/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: 'runtime-token', config: { active: true, mode: 'standard' } }) });
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
});
