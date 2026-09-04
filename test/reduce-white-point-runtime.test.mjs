import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  attachShadow({ mode }) {
    assert.equal(mode, 'closed');
    return { append: child => this.children.push(child) };
  }
  append(child) {
    child.parentNode?.children?.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this;
    this.children.push(child);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
}

async function runtimeFixture() {
  const document = new SimpleEventTarget();
  document.documentElement = new FakeElement('html');
  document.fullscreenElement = null;
  document.createElement = tagName => new FakeElement(tagName);
  const context = {
    window: new SimpleEventTarget(),
    document,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Uint8Array, Symbol, JSON, Number, String, Math, Object,
    crypto: { getRandomValues: values => { values.fill(7); return values; } }
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/reduce-white-point-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return { context, document, runtime: context[Symbol.for('cosmic-gemini.reduce-white-point.runtime')] };
}

test('Reduce White Point maintains one passive layer and removes it when disabled', async () => {
  const { context, document, runtime } = await runtimeFixture();
  runtime.onConfigure({
    detail: JSON.stringify({ token: runtime.token, config: { active: true, reduction: 0.35 } })
  });
  const host = runtime.host;
  assert.equal(host.parentNode, document.documentElement);
  assert.match(host.style.cssText, /position:fixed/);
  assert.match(host.style.cssText, /pointer-events:none/);
  assert.equal(runtime.shade.style.opacity, '0.35');
  assert.equal(document.listeners.get('fullscreenchange').length, 1);

  runtime.onConfigure({
    detail: JSON.stringify({ token: runtime.token, config: { active: true, reduction: 0.6 } })
  });
  assert.equal(runtime.host, host);
  assert.equal(document.documentElement.children.length, 1);
  assert.equal(runtime.shade.style.opacity, '0.6');

  const fullscreen = new FakeElement('section');
  document.fullscreenElement = fullscreen;
  document.dispatchEvent({ type: 'fullscreenchange' });
  assert.equal(runtime.host.parentNode, fullscreen);

  runtime.onConfigure({
    detail: JSON.stringify({ token: runtime.token, config: { active: false } })
  });
  assert.equal(runtime.host, null);
  assert.equal(fullscreen.children.length, 0);
  assert.equal(document.listeners.get('fullscreenchange').length, 0);

  runtime.onDispose({ detail: runtime.token });
  assert.equal(context[Symbol.for('cosmic-gemini.reduce-white-point.runtime')], undefined);
});
