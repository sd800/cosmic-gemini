import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
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
  const source = await readFile(new URL('../extension/content/any-copy-runtime.js', import.meta.url), 'utf8');
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
});
