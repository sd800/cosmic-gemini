import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener.call(this, event); }
}
class Style {
  constructor() { this.values = new Map(); }
  getPropertyValue(name) { return this.values.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
  setProperty(name, value, priority = '') { this.values.set(name, { value, priority }); }
  removeProperty(name) { this.values.delete(name); }
}
class Element extends EventTarget {
  constructor() { super(); this.style = new Style(); this.dataset = {}; this.isConnected = false; this.textContent = ''; }
  append(child) { child.isConnected = true; }
  remove() { this.isConnected = false; }
  matches() { return false; }
  closest() { return null; }
}
class Input extends Element {}
class Textarea extends Element {}
class MutationObserver { observe() {} disconnect() {} }
class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }

test('Any Copy writes the original selection and suppresses page copy handlers', async () => {
  const window = new EventTarget();
  const head = new Element();
  head.isConnected = true;
  const document = {
    documentElement: new Element(), head,
    createElement: () => new Element()
  };
  window.getSelection = () => ({ toString: () => 'Original text', rangeCount: 0 });
  const context = {
    window, document, Element, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    MutationObserver, CustomEvent, Map, Set, Symbol, JSON, Number, String, Object,
    crypto: { getRandomValues: values => { values.fill(9); return values; } }, getComputedStyle: () => ({ userSelect: 'text', webkitUserSelect: 'text' })
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/any-copy/any-copy-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = window[Symbol.for('cosmic-gemini.any-copy.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard' } }) });

  const clipboard = new Map();
  let stopped = false;
  let prevented = false;
  runtime.onCopy({
    isTrusted: true,
    target: document.documentElement,
    composedPath: () => [document.documentElement],
    clipboardData: { setData: (type, value) => clipboard.set(type, value) },
    stopImmediatePropagation: () => { stopped = true; },
    preventDefault: () => { prevented = true; }
  });
  assert.equal(clipboard.get('text/plain'), 'Original text');
  assert.equal(stopped, true);
  assert.equal(prevented, true);
  runtime.onDispose({ detail: runtime.token });
  assert.equal(window[Symbol.for('cosmic-gemini.any-copy.runtime')], undefined);
});

test('Any Copy and Any Copy Enhanced keep separate runtime and bridge boundaries', async () => {
  const [standardRuntime, standardBridge, enhancedRuntime, enhancedBridge] = await Promise.all([
    readFile(new URL('../extension/content/any-copy/any-copy-runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/content/any-copy/any-copy-bridge.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/content/any-copy-enhanced/any-copy-enhanced-runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/content/any-copy-enhanced/any-copy-enhanced-bridge.js', import.meta.url), 'utf8')
  ]);
  assert.match(standardRuntime, /cosmic-gemini\.any-copy\.runtime/);
  assert.doesNotMatch(standardRuntime, /any-copy-enhanced|readerHost|showReader/);
  assert.doesNotMatch(standardBridge, /readerHost|showReader|copyText/);
  assert.match(enhancedRuntime, /cosmic-gemini\.any-copy-enhanced\.runtime/);
  assert.match(enhancedRuntime, /showReader\(\)/);
  assert.match(standardRuntime, /cosmic-gemini:any-copy:dispose/);
  assert.match(enhancedRuntime, /cosmic-gemini:any-copy-enhanced:dispose/);
  assert.match(enhancedBridge, /featureId: 'anyCopyEnhanced'/);
});

test('Any Copy Enhanced keeps static breaks and safe URLs without rebuilding executable links', async () => {
  class ReaderElement extends Element {
    constructor(tag, attributes = {}, children = []) {
      super(); this.localName = tag; this.attributes = attributes; this.childNodes = children;
    }
    getAttribute(name) { return this.attributes[name] || ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(child) { this.childNodes.push(child); }
    querySelector() { return this.childNodes.find(child => ['br', 'hr', 'img'].includes(child.localName)) || null; }
  }
  const window = new EventTarget();
  const context = vm.createContext({ window, URL, Element: ReaderElement, Node: { TEXT_NODE: 3 },
    document: { baseURI: 'https://example.com/article/', createElement: tag => new ReaderElement(tag) },
    crypto: { randomUUID: () => 'reader-token' }, CustomEvent });
  vm.runInContext(await readFile(new URL('../extension/content/any-copy-enhanced/any-copy-enhanced-runtime.js', import.meta.url), 'utf8'), context);
  const runtime = window[Symbol.for('cosmic-gemini.any-copy-enhanced.runtime')];
  assert.equal(runtime.absoluteUrl('../next'), 'https://example.com/next');
  assert.equal(runtime.absoluteUrl('mailto:reader@example.com'), 'mailto:reader@example.com');
  for (const url of ['', 'javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/document']) {
    assert.equal(runtime.absoluteUrl(url), '', url);
    assert.equal(runtime.absoluteUrl(url, true), '', url);
  }
  assert.equal(runtime.absoluteUrl('data:image/png;base64,AAAA', true), 'data:image/png;base64,AAAA');
  assert.equal(runtime.absoluteUrl('blob:https://example.com/image', true), 'blob:https://example.com/image');
  const target = new ReaderElement('article');
  runtime.copyText(new ReaderElement('div', {}, [new ReaderElement('br'), new ReaderElement('hr'),
    new ReaderElement('img', { src: 'javascript:alert(1)' }), new ReaderElement('img', { src: '/photo.png' })]), target);
  assert.deepEqual(target.childNodes.map(child => child.localName), ['br', 'hr', 'img']);
  assert.equal(target.childNodes[2].attributes.src, 'https://example.com/photo.png');
  context.document.documentElement = new ReaderElement('html');
  runtime.originalOverflow = { value: 'scroll', priority: 'important' };
  runtime.hideReader();
  assert.equal(context.document.documentElement.style.getPropertyValue('overflow'), 'scroll');
  assert.equal(context.document.documentElement.style.getPropertyPriority('overflow'), 'important');
});
