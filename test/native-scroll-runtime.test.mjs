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
  removeAttribute(name) { if (name === 'data-native-scroll-normalized') delete this.dataset.nativeScrollNormalized; }
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
  get returnValue() { return !this.defaultPrevented; }
  set returnValue(value) { if (!value) this.preventDefault(); }
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
    isTrusted: true, eventPhase: 2, defaultPrevented: false, ctrlKey: false, metaKey: false,
    deltaX: 0, deltaY: 30, target,
    composedPath: () => path || [target, context.document.body, context.document.documentElement, context.document, context.window],
  });
}

test('gesture guards remain immediate while repeated layout inspection shares a frame', async () => {
  const context = makeContext();
  const frames = new Map(); let next = 0;
  context.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
  context.cancelAnimationFrame = id => frames.delete(id);
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.enable('standard');
  let inspections = 0;
  runtime.applyStyles = () => { inspections++; };
  runtime.beginGesture(); runtime.beginGesture(); runtime.scheduleInspection();
  assert.equal(runtime.shouldBlockScriptedScroll(context.window, 'scrollTo', [0, 100]), true);
  assert.equal(inspections, 0);
  assert.equal(frames.size, 1);
  const callback = [...frames.values()][0]; frames.clear(); callback();
  assert.equal(inspections, 1);
  runtime.beginGesture(); runtime.disable();
  assert.equal(frames.size, 0, 'disable cancels deferred inspection');
});

test('disabled Native Scroll leaves retained methods and delayed callbacks inert', async () => {
  const context = makeContext(); let nativeCalls = 0;
  context.window.scrollTo = function () { if (this !== context.window) throw new TypeError('native receiver'); nativeCalls++; };
  const originalScroll = context.window.scrollTo;
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.enable('standard');
  const retainedScroll = context.window.scrollTo, retainedCancel = context.Event.prototype.preventDefault;
  runtime.disable();
  assert.equal(context.window.scrollTo, originalScroll);
  context.getComputedStyle = () => { throw Error('inactive style read'); };
  context.requestAnimationFrame = () => { throw Error('inactive frame'); };
  runtime.onMutation(); runtime.applyStyles(); runtime.scheduleInspection(); runtime.beginGesture();
  retainedScroll.call(context.window, 0, 20);
  assert.equal(nativeCalls, 1);
  assert.throws(() => retainedScroll.call({}, 0, 20), /native receiver/, 'retain the original receiver behavior while inactive');
  const event = wheelEvent(context);
  retainedCancel.call(event);
  assert.equal(event.defaultPrevented, true, 'page cancellation is native again');
  assert.equal(runtime.observer, null); assert.equal(runtime.rootObservers.length, 0);
});

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
  assert.equal(atEnd.defaultPrevented, true, 'a nested scroller can intentionally contain the gesture at its edge');
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
    assert.equal(pageEvent.stopped, false, 'listeners are allowed to observe the native gesture');
    pageEvent.preventDefault();
    assert.equal(pageEvent.stopped, true, 'only an actual takeover attempt suppresses propagation');
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
  assert.equal(hijackedEvent.stopped, false, 'an observer is not a takeover');
  assert.equal(interventions, 0);
  hijackedEvent.preventDefault();
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
  context.document.addEventListener('wheel', () => {}, { passive: false });
  firstRuntime.onDispose({ detail: firstRuntime.token });
  assert.equal(context.EventTarget.prototype.addEventListener, originalAdd);
  assert.equal(context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')], undefined);

  vm.runInContext(source, context);
  const secondRuntime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  secondRuntime.onConfigure({ detail: JSON.stringify({ token: secondRuntime.token, config: { active: true, mode: 'standard' } }) });
  const standardEvent = wheelEvent(context);
  secondRuntime.onWheel(standardEvent);
  assert.equal(standardEvent.stopped, false);
  assert.equal(secondRuntime.shouldBlockScriptedScroll(context.window, 'scrollBy'), true);
  assert.equal(secondRuntime.gestureUntil, 0);
  standardEvent.preventDefault();
  assert.equal(standardEvent.stopped, true);

  secondRuntime.onConfigure({ detail: JSON.stringify({ token: secondRuntime.token, config: { active: true, mode: 'enhanced' } }) });
  const enhancedEvent = wheelEvent(context);
  secondRuntime.onWheel(enhancedEvent);
  assert.equal(enhancedEvent.stopped, false);
  enhancedEvent.preventDefault();
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
  assert.equal(event.stopped, false);
  event.preventDefault();
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


test('Native Scroll preserves authored smooth anchors and retires a preceding wheel guard on trusted clicks', async () => {
  const source=await readFile(new URL('../extension/content/native-scroll/runtime.js',import.meta.url),'utf8');
  for(const mode of ['standard','enhanced']){
    const css=await readFile(new URL(`../extension/content/native-scroll/native-scroll-${mode}.css`,import.meta.url),'utf8');
    assert.doesNotMatch(css,/(?:^|\s)scroll-behavior\s*:/,'authored browser smooth scrolling must not be overridden');
    const context=makeContext(),calls=[];
    context.window.scrollTo=(...args)=>calls.push(args);
    context.document.documentElement.computed={scrollBehavior:'smooth'};
    vm.runInContext(source,context);
    const runtime=context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
    runtime.onConfigure({detail:JSON.stringify({token:runtime.token,config:{active:true,mode}})});
    try{
      assert.equal(runtime.reported,false,'smooth CSS alone is not a scroll takeover');
      const options={top:800,behavior:'smooth'};
      context.window.scrollTo(options);
      assert.equal(calls[0][0],options,'explicit smooth options reach the captured native API unchanged');
      wheelEvent(context).preventDefault();
      context.window.scrollTo(options);
      assert.equal(calls.length,1,'queued wheel takeover remains blocked');
      context.window.dispatchEvent(Object.assign(new FakeEvent('click'),{isTrusted:false}));
      context.window.scrollTo(options);
      assert.equal(calls.length,1,'synthetic clicks cannot retire the gesture guard');
      context.window.dispatchEvent(Object.assign(new FakeEvent('click'),{isTrusted:true}));
      context.window.scrollTo(options);
      assert.equal(calls.length,2,'a real link activation is independent of the preceding wheel');
      assert.equal(runtime.shouldBlockScriptedScroll(new FakeElement('section'),'scrollIntoView',[options]),false);
    }finally{runtime.onDispose({detail:runtime.token});}
    assert.equal(context.window.listeners.get('click').length,0,'the trusted-click listener is released');
  }
});


async function scrollFixture(t, mode = 'standard', before = () => {}) {
  const context = makeContext();
  const originalAdd = context.EventTarget.prototype.addEventListener, originalRemove = context.EventTarget.prototype.removeEventListener;
  before(context);
  vm.runInContext(await readFile(new URL('../extension/content/native-scroll/runtime.js', import.meta.url), 'utf8'), context);
  const runtime = context.window[Symbol.for('cosmic-gemini.native-scroll.runtime')];
  runtime.enable(mode); t.after(() => {
    runtime.onDispose({ detail: runtime.token });
    context.EventTarget.prototype.addEventListener = originalAdd;context.EventTarget.prototype.removeEventListener = originalRemove;
  });
  return { context, runtime };
}

test('scroll observers keep their events and only actual takeover reports an intervention', async t => {
  const { context, runtime } = await scrollFixture(t);
  let observed = 0;
  const passive = () => { observed++; }, observer = () => { observed++; };
  context.window.addEventListener('wheel', passive, { passive: true });
  const native = wheelEvent(context); runtime.onWheel(native); passive(native);
  assert.equal(runtime.gestureUntil, 0); assert.equal(native.stopped, false);
  context.window.addEventListener('wheel', observer, { passive: false });
  const watched = wheelEvent(context); runtime.onWheel(watched); observer(watched);
  assert.equal(observed, 2); assert.equal(watched.stopped, false); assert.equal(runtime.reported, false);
  assert.equal(runtime.shouldBlockScriptedScroll(context.window, 'scrollBy'), true, 'synchronous root takeover is blocked');
  watched.eventPhase = 0;
  assert.equal(runtime.shouldBlockScriptedScroll(context.window, 'scrollBy'), false, 'later anchor updates run after an ordinary observer');
  watched.eventPhase = 2;
  watched.preventDefault();
  assert.equal(watched.defaultPrevented, false); assert.equal(watched.stopped, true); assert.equal(runtime.reported, true);
});

test('listener metadata respects passive defaults, case, once, aborted signals, and removals', async t => {
  const { context, runtime } = await scrollFixture(t);
  const event = wheelEvent(context), callback = () => {}, signal = { aborted: false };
  for (const options of [undefined, { passive: true }, { passive: false, once: true }, { passive: false, signal: { aborted: true } }]) {
    runtime.recordListener(context.window, 'wheel', callback, options);
    assert.equal(runtime.hasHijackListener(event, 'wheel'), false);
    runtime.forgetListener(context.window, 'wheel', callback, options);
  }
  runtime.recordListener(context.window, 'Wheel', callback, { passive: false });
  assert.equal(runtime.hasHijackListener(event, 'wheel'), false);
  runtime.recordListener(context.document.documentElement, 'wheel', callback, undefined);
  assert.equal(runtime.hasHijackListener(event, 'wheel'), true, 'HTML element does not receive the root passive default');
  runtime.forgetListener(context.document.documentElement, 'wheel', callback);
  runtime.recordListener(context.window, 'wheel', callback, { passive: false, signal });
  assert.equal(runtime.hasHijackListener(event, 'wheel'), true);
  signal.aborted = true;
  assert.equal(runtime.hasHijackListener(event, 'wheel'), false);
  runtime.recordListener(context.window, 'wheel', callback, { passive: false });
  runtime.forgetListener(context.window, 'wheel', callback, { get capture() { throw Error('do not evaluate options getters'); } });
  assert.equal(runtime.hasHijackListener(event, 'wheel'), false);
});

test('native listener option getters run once without an extra bookkeeping conversion', async t => {
  let reads = 0;
  const { context, runtime } = await scrollFixture(t, 'standard', context => {
    const native = context.EventTarget.prototype.addEventListener;
    context.EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type === 'wheel' && options && typeof options === 'object') void options.capture;
      return Reflect.apply(native, this, [type, listener, options]);
    };
  });
  const options = { get capture() { reads++; return true; }, passive: false };
  context.window.addEventListener('wheel', () => {}, options);
  assert.equal(reads, 1);
  const event = wheelEvent(context); runtime.onWheel(event);
  assert.equal(event.stopped, false);
  event.preventDefault(); assert.equal(event.defaultPrevented, false, 'actual cancellation remains guarded without preflight metadata');
});

test('keyboard and pointer actions release a previous gesture, while synthetic actions do not', async t => {
  const { context, runtime } = await scrollFixture(t);
  for (const type of ['keydown', 'pointerdown']) {
    runtime.beginGesture();
    context.window.dispatchEvent(Object.assign(new FakeEvent(type), { isTrusted: false }));
    assert.equal(runtime.shouldBlockScriptedScroll(context.window, 'scrollTo', [0, 100]), true);
    context.window.dispatchEvent(Object.assign(new FakeEvent(type), { isTrusted: true }));
    assert.equal(runtime.shouldBlockScriptedScroll(context.window, 'scrollTo', [0, 100]), false);
  }
  runtime.disable();
  for (const type of ['keydown', 'pointerdown', 'touchend', 'touchcancel']) assert.equal(context.window.listeners.get(type)?.length, 0);
});

test('both modes allow genuine horizontal container APIs during a root guard', async t => {
  const { context, runtime } = await scrollFixture(t);
  const panel = new FakeElement('div'); panel.scrollWidth = 1200; panel.computed = { overflowX: 'auto', overflowY: 'visible' };
  for (const mode of ['standard', 'enhanced']) {
    runtime.mode = mode; runtime.beginGesture();
    for (const name of ['scrollLeft', 'scrollBy', 'scrollTo', 'scrollIntoView']) assert.equal(runtime.shouldBlockScriptedScroll(panel, name, [-80, 0]), false);
    assert.equal(runtime.shouldBlockScriptedScroll(context.document.documentElement, 'scrollLeft', [-80]), true);
  }
});

function touchEvent(context, x, y, extra = {}) {
  const event = Object.assign(new FakeEvent('touchmove'), { isTrusted: true, cancelable: true,
    touches: [{ clientX: x, clientY: y }], target: context.document.body, ...extra });
  event.composedPath = () => [event.target, context.document.body, context.document.documentElement, context.document, context.window];
  return event;
}

test('touch observers remain intact while earlier real cancellation is intercepted', async t => {
  const { context, runtime } = await scrollFixture(t);
  runtime.onTouchStart({ isTrusted: true, touches: [{ clientX: 100, clientY: 200 }] });
  context.window.addEventListener('touchmove', () => {}, { passive: false });
  const event = touchEvent(context, 100, 170); runtime.onTouchMove(event);
  assert.equal(event.stopped, false); assert.equal(runtime.reported, false);
  event.preventDefault(); assert.equal(event.stopped, true); assert.equal(event.defaultPrevented, false);
  runtime.gestureUntil = 0;
  const early = touchEvent(context, 100, 140);
  early.preventDefault(); assert.equal(early.defaultPrevented, false);
  assert.equal(runtime.touchY, 140, 'a cancellation before capture updates the touch position');
  runtime.onTouchEnd(); assert.equal(runtime.touchY, null);
  const later = touchEvent(context, 100, 100); later.preventDefault(); assert.equal(later.defaultPrevented, true);
});

test('synthetic, multi-touch, protected and horizontal-container gestures keep native behavior', async t => {
  const { context, runtime } = await scrollFixture(t);
  const panel = new FakeElement('div'); panel.scrollWidth = 1200; panel.computed = { overflowX: 'auto', direction: 'rtl' };
  const input = new FakeElement('input'); input.matches = () => true;
  for (const mode of ['standard', 'enhanced']) {
    runtime.mode = mode;
    for (const extra of [{ isTrusted: false }, { cancelable: false }, { target: input }, { target: panel }]) {
      runtime.onTouchStart({ isTrusted: true, touches: [{ clientX: 200, clientY: 200 }] });
      const event = touchEvent(context, 100, 200, extra); runtime.onTouchMove(event); event.preventDefault();
      assert.equal(event.stopped, false); assert.equal(event.defaultPrevented, true);
    }
  }
  runtime.onTouchStart({ isTrusted: true, touches: [{ clientX: 100, clientY: 200 }] });
  runtime.onTouchMove(touchEvent(context, 100, 170, { touches: [{ clientX: 100, clientY: 170 }, { clientX: 200, clientY: 170 }] }));
  assert.equal(runtime.touchY, null);
  assert.equal(runtime.isPageTouch(touchEvent(context, 100, 150)), false);
});

test('enhanced wrapper normalization avoids repeated writes and releases detached nodes', async t => {
  const { context, runtime } = await scrollFixture(t, 'enhanced');
  const wrapper = new FakeElement('main'); wrapper.computed = { position: 'fixed', transform: 'matrix(1,0,0,1,0,-50)' };
  let writes = 0, value;
  Object.defineProperty(wrapper.dataset, 'nativeScrollNormalized', { configurable: true, get: () => value, set: next => { value = next; writes++; } });
  context.document.body.children = [wrapper];
  runtime.normalizeTransformScroller(); runtime.normalizeTransformScroller();
  assert.equal(writes, 1); assert.equal(runtime.normalizedWrappers.size, 1);
  wrapper.isConnected = false; context.document.body.children = Array.from({ length: 31 }, () => new FakeElement('div'));
  runtime.normalizeTransformScroller(); assert.equal(runtime.normalizedWrappers.size, 0);
});


test('event type conversion stays native and unload policy remains case-sensitive', async t => {
  let reads = 0;
  const { context, runtime } = await scrollFixture(t, 'standard', context => {
    const native = context.EventTarget.prototype.addEventListener;
    context.EventTarget.prototype.addEventListener = function(type, listener, options) {
      return Reflect.apply(native, this, [String(type), listener, options]);
    };
  });
  const listener = () => {};
  context.window.addEventListener({ toString() { reads++; return 'wheel'; } }, listener, { passive: false });
  assert.equal(reads, 1); assert.equal(context.window.listeners.get('wheel').includes(listener), true);
  context.document.permissionsPolicy = { allowsFeature: () => false };
  assert.equal(runtime.isDisallowedUnload('unload'), true);assert.equal(runtime.isDisallowedUnload('UNLOAD'), false);
});


test('legacy returnValue cancellation keeps the same native input boundary and restores its descriptor', async t => {
  const before = Object.getOwnPropertyDescriptor(FakeEvent.prototype, 'returnValue');
  const { context, runtime } = await scrollFixture(t);
  const retained = Object.getOwnPropertyDescriptor(FakeEvent.prototype, 'returnValue').set;
  const wheel = wheelEvent(context); wheel.returnValue = false;
  assert.equal(wheel.defaultPrevented, false); assert.equal(wheel.stopped, true);
  for (const event of [Object.assign(new FakeEvent('click'), { isTrusted: true }), Object.assign(wheelEvent(context), { isTrusted: false })]) {
    event.returnValue = false; assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, false);
  }
  runtime.disable();
  assert.equal(Object.getOwnPropertyDescriptor(FakeEvent.prototype, 'returnValue').set, before.set);
  const native = wheelEvent(context); Reflect.apply(retained, native, [false]); assert.equal(native.defaultPrevented, true);
});

test('nested conversation panes keep wheel ownership and local anchor APIs in either mode', async t => {
  const { context, runtime } = await scrollFixture(t);
  const panel = new FakeElement('main'), message = new FakeElement('article');
  panel.computed = { overflowY: 'auto' };
  panel.scrollTop = panel.scrollHeight - panel.clientHeight;
  message.parentElement = panel;
  for (const mode of ['standard', 'enhanced']) {
    runtime.mode = mode;
    const event = wheelEvent(context, message, [message, panel, context.document.body, context.document.documentElement, context.document, context.window]);
    event.preventDefault();
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, false);
    runtime.beginGesture();
    assert.equal(runtime.shouldBlockScriptedScroll(panel, 'scrollTo'), false);
    assert.equal(runtime.shouldBlockScriptedScroll(message, 'scrollIntoView'), false);
    assert.equal(runtime.shouldBlockScriptedScroll(context.window, 'scrollTo'), true);
    runtime.clearGesture();
  }
});
