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
    this.scrollWidth = 800;
    this.clientWidth = 800;
    this.scrollTop = 0;
    this.scrollLeft = 0;
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
  get scrollTop() { return this.savedScrollTop || 0; }
  set scrollTop(value) { this.savedScrollTop = value; }
  get scrollLeft() { return this.savedScrollLeft || 0; }
  set scrollLeft(value) { this.savedScrollLeft = value; }
}

class FakeMutationObserver { observe() {} disconnect() {} }
class FakeEvent {
  constructor(type) { this.type = type; this.defaultPrevented = false; this.stopped = false; }
  preventDefault() { this.defaultPrevented = true; }
  stopImmediatePropagation() { this.stopped = true; }
}
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
    MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent, Event: FakeEvent,
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
  return Object.assign(new FakeEvent('wheel'), {
    isTrusted: true, defaultPrevented: false, ctrlKey: false, metaKey: false,
    deltaX: 0, deltaY: 30, target,
    composedPath: () => path || [target, context.document.body, context.document.documentElement, context.document, context.window],
  });
}

test('late activation preserves native wheel scrolling and rejects queued root takeover movement', async () => {
  const context = makeContext();
  let scriptedMoves = 0;
  context.window.scrollBy = () => { scriptedMoves += 1; };
  const originalCancel = context.Event.prototype.preventDefault;
  const originalTop = Object.getOwnPropertyDescriptor(context.Element.prototype, 'scrollTop');
  const earlierListener = event => event.preventDefault();
  context.window.addEventListener('wheel', earlierListener);
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const event = wheelEvent(context);
  assert.equal(runtime.hasHijackListener(event, 'wheel'), false, 'the earlier listener is unknown');
  runtime.onWheel(event);
  assert.equal(event.stopped, false, 'ordinary wheel observers are not blocked');
  earlierListener(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, true);
  assert.equal(runtime.reported, true);
  context.window.scrollBy(0, 80);
  context.document.documentElement.scrollTop = 80;
  context.document.body.scrollTop = 80;
  assert.equal(scriptedMoves, 0);
  assert.equal(context.document.documentElement.scrollTop, 0);
  assert.equal(context.document.body.scrollTop, 0);
  const nested = new FakeElement('div');
  nested.scrollTop = 25;
  assert.equal(nested.scrollTop, 25, 'nested scrolling remains native');
  context.performance.now = () => 1000;
  context.document.documentElement.scrollTop = 60;
  assert.equal(context.document.documentElement.scrollTop, 60, 'ordinary later programmatic movement is allowed');
  runtime.onDispose({ detail: runtime.token });
  assert.equal(context.Event.prototype.preventDefault, originalCancel);
  assert.deepEqual(Object.getOwnPropertyDescriptor(context.Element.prototype, 'scrollTop'), originalTop);
  const inactiveEvent = wheelEvent(context);
  earlierListener(inactiveEvent);
  assert.equal(inactiveEvent.defaultPrevented, true);
});

test('wheel cancellation fallback preserves controls, zoom and nested gestures', async () => {
  const context = makeContext();
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const safe = new FakeElement('input');
  safe.matches = () => true;
  const nested = new FakeElement('div');
  nested.computed = { overflowY: 'auto' };
  for (const event of [
    Object.assign(wheelEvent(context), { isTrusted: false }),
    Object.assign(wheelEvent(context), { type: 'click' }),
    Object.assign(wheelEvent(context), { ctrlKey: true }),
    Object.assign(wheelEvent(context), { metaKey: true }),
    wheelEvent(context, safe),
    wheelEvent(context, nested)
  ]) {
    event.preventDefault();
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, false);
  }
  assert.equal(runtime.reported, false);
  nested.scrollTop = 200;
  const atEnd = wheelEvent(context, nested);
  atEnd.preventDefault();
  assert.equal(atEnd.defaultPrevented, false, 'a completed nested scroller can chain to the page');
  runtime.onDispose({ detail: runtime.token });
});

test('legacy mousewheel deltas protect both native page-scrolling axes', async () => {
  const context = makeContext();
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const event = Object.assign(wheelEvent(context), { type: 'mousewheel', deltaX: undefined, deltaY: undefined, wheelDelta: -120 });
  event.preventDefault();
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, true);
  const horizontal = Object.assign(wheelEvent(context), { type: 'mousewheel', deltaX: undefined, deltaY: undefined, wheelDeltaX: -240, wheelDeltaY: -120 });
  horizontal.preventDefault();
  assert.equal(horizontal.defaultPrevented, false);
  assert.equal(horizontal.stopped, true);
  runtime.onDispose({ detail: runtime.token });
});

test('horizontal page gestures survive earlier cancellation and queued root movement, including over links', async () => {
  const context = makeContext();
  const originalLeft = Object.getOwnPropertyDescriptor(context.Element.prototype, 'scrollLeft');
  let scriptedMoves = 0;
  context.window.scrollBy = () => { scriptedMoves += 1; };
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const link = new FakeElement('a');
  link.matches = selector => selector.includes('a[href]');
  const event = Object.assign(wheelEvent(context, link), { deltaX: -80, deltaY: 2 });
  runtime.onWheel(event);
  assert.equal(event.stopped, false, 'no known page listener means no proactive suppression');
  event.preventDefault();
  assert.equal(event.defaultPrevented, false, 'ordinary links must not let page handlers consume history gestures');
  assert.equal(event.stopped, true);
  assert.equal(runtime.shouldBlockScriptedScroll(link, 'scrollIntoView', []), false, 'explicit link navigation keeps its scrolling API behavior');
  context.window.scrollBy(-80, 0);
  context.document.documentElement.scrollLeft = -80;
  context.document.body.scrollLeft = -80;
  assert.equal(scriptedMoves, 0);
  assert.equal(context.document.documentElement.scrollLeft, 0);
  assert.equal(context.document.body.scrollLeft, 0);
  const nested = new FakeElement('div');
  nested.scrollLeft = 20;
  assert.equal(nested.scrollLeft, 20);
  context.performance.now = () => 1000;
  context.document.documentElement.scrollLeft = 60;
  assert.equal(context.document.documentElement.scrollLeft, 60, 'ordinary later scrolling remains allowed');
  runtime.onDispose({ detail: runtime.token });
  assert.deepEqual(Object.getOwnPropertyDescriptor(context.Element.prototype, 'scrollLeft'), originalLeft);
  const inactiveEvent = Object.assign(wheelEvent(context), { deltaX: 80, deltaY: 0 });
  inactiveEvent.preventDefault();
  assert.equal(inactiveEvent.defaultPrevented, true);
});

test('both modes preserve horizontal containers at either edge, RTL layouts and protected controls', async () => {
  const context = makeContext();
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  const scroller = new FakeElement('div');
  scroller.scrollWidth = 1200;
  const control = new FakeElement('input');
  control.matches = () => true;
  for (const mode of ['standard', 'enhanced']) {
    runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode } }) });
    context.window.addEventListener('wheel', () => {});
    for (const direction of ['ltr', 'rtl']) {
      scroller.computed = { overflowX: 'auto', direction };
      for (const position of [0, direction === 'rtl' ? -400 : 400]) {
        scroller.scrollLeft = position;
        for (const deltaX of [-80, 80]) {
          const event = Object.assign(wheelEvent(context, scroller), { deltaX, deltaY: 0 });
          runtime.onWheel(event);
          event.preventDefault();
          assert.equal(event.defaultPrevented, true);
          assert.equal(event.stopped, false);
        }
      }
    }
    const protectedEvent = Object.assign(wheelEvent(context, control), { deltaX: 80, deltaY: 0 });
    protectedEvent.preventDefault();
    assert.equal(protectedEvent.defaultPrevented, true);
    const pageEvent = Object.assign(wheelEvent(context), { deltaX: 80, deltaY: 0 });
    runtime.onWheel(pageEvent);
    assert.equal(pageEvent.stopped, true, 'only the page-wide takeover handler is suppressed');
    assert.equal(pageEvent.defaultPrevented, false);
  }
  runtime.onDispose({ detail: runtime.token });
});

test('Native Scroll stays quiet on native pages and suppresses registered takeover code', async () => {
  const context = makeContext();
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
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
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
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
  const originalScrollBy = context.window.scrollBy;
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window.scroll, originalScroll);
  assert.equal(context.window.scrollBy, originalScrollBy);
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  assert.notEqual(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.notEqual(context.window.scroll, originalScroll);
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window.scroll, originalScroll);
  runtime.onDispose({ detail: runtime.token });
  assert.equal(context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')], undefined);
});

test('Native Scroll keeps Window scroll methods bound when pages call them through another object', async () => {
  const context = makeContext();
  const calls = [];
  const originalScrollTo = function (...args) {
    if (this !== context.window) throw new TypeError('Illegal invocation');
    calls.push(args);
  };
  context.window.scrollTo = originalScrollTo;
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });

  Reflect.apply(context.window.scrollTo, { scrollTo: context.window.scrollTo }, [12, 34]);
  assert.deepEqual(calls, [[12, 34]]);

  runtime.beginGesture();
  Reflect.apply(context.window.scrollTo, { scrollTo: context.window.scrollTo }, [56, 78]);
  assert.deepEqual(calls, [[12, 34]]);

  runtime.onDispose({ detail: runtime.token });
  assert.equal(context.window.scrollTo, originalScrollTo);
});

test('Native Scroll does not create inline page styles on strict-CSP pages', async () => {
  const context = makeContext();
  let styleElements = 0;
  context.document.createElement = name => {
    if (name === 'style') styleElements += 1;
    return new FakeElement(name);
  };
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'enhanced' } }) });
  assert.equal(styleElements, 0);
  for (const root of [context.document.documentElement, context.document.body]) {
    assert.equal(root.style.getPropertyValue('scroll-behavior'), '');
    assert.equal(root.style.getPropertyValue('scroll-snap-type'), '');
    assert.equal(root.style.getPropertyValue('overflow-y'), '');
  }
  runtime.onDispose({ detail: runtime.token });
});

test('Native Scroll becomes inert when a later page wrapper keeps its listener wrapper reachable', async () => {
  const context = makeContext();
  const originalCancel = context.Event.prototype.preventDefault;
  const originalTop = Object.getOwnPropertyDescriptor(context.Element.prototype, 'scrollTop');
  context.document.permissionsPolicy = { allowsFeature: feature => feature !== 'unload' };
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  const nativeScrollWrapper = context.EventTarget.prototype.addEventListener;
  context.EventTarget.prototype.addEventListener = function laterPageWrapper(...args) {
    return Reflect.apply(nativeScrollWrapper, this, args);
  };
  const nativeCancel = context.Event.prototype.preventDefault;
  const laterCancel = function (...args) { return Reflect.apply(nativeCancel, this, args); };
  context.Event.prototype.preventDefault = laterCancel;
  const nativeTop = Object.getOwnPropertyDescriptor(context.Element.prototype, 'scrollTop').set;
  const laterTop = function (value) { return Reflect.apply(nativeTop, this, [value]); };
  Object.defineProperty(context.Element.prototype, 'scrollTop', { ...originalTop, set: laterTop });
  runtime.beginGesture();
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(runtime.active, false);
  const listener = () => {};
  Reflect.apply(nativeScrollWrapper, context.window, ['custom', listener]);
  assert.equal(context.window.listeners.get('custom')?.includes(listener), true);
  Reflect.apply(nativeScrollWrapper, context.window, ['unload', listener]);
  assert.equal(context.window.listeners.get('unload').includes(listener), true);
  assert.equal(context.Event.prototype.preventDefault, laterCancel);
  assert.equal(Object.getOwnPropertyDescriptor(context.Element.prototype, 'scrollTop').set, laterTop);
  const event = wheelEvent(context);
  event.preventDefault();
  assert.equal(event.defaultPrevented, true, 'retained cancellation wrapper must become inert');
  context.document.documentElement.scrollTop = 35;
  assert.equal(context.document.documentElement.scrollTop, 35, 'retained setter must become inert');
  runtime.onDispose({ detail: runtime.token });
  context.Event.prototype.preventDefault = originalCancel;
  Object.defineProperty(context.Element.prototype, 'scrollTop', originalTop);
});

test('Native Scroll recognizes existing hijack listeners after it is disabled and re-enabled', async () => {
  const context = makeContext();
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
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
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
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
  const originalScrollBy = context.window.scrollBy;
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });
  assert.equal(runtime.active, true);
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window.scroll, originalScroll);
  assert.equal(context.window.scrollBy, originalScrollBy);
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
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
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
  const source = await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'enhanced' } }) });
  assert.equal(context.document.documentElement.style.getPropertyValue('height'), '');
  assert.equal(context.document.body.style.getPropertyValue('overflow-y'), '');
  runtime.onDispose({ detail: runtime.token });
});
