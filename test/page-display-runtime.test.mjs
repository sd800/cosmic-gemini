import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    if (!listeners.includes(listener)) this.listeners.set(type, [...listeners, listener]);
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
    this.localName = tagName;
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) { return selector === ':popover-open' && this.popoverOpen === true; }
  showPopover() { this.popoverOpen = true; }
  hidePopover() { this.popoverOpen = false; }
  get parentElement() { return this.parentNode; }
  attachShadow({ mode }) {
    assert.equal(mode, 'closed');
    return { append: (...children) => this.children.push(...children) };
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

class FakeMutationObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, options) { this.disconnected = false; this.targets.push({ target, options }); }
  disconnect() { this.disconnected = true; }
}

async function runtimeFixture() {
  FakeMutationObserver.instances = [];
  const document = new SimpleEventTarget();
  document.documentElement = new FakeElement('html');
  document.fullscreenElement = null;
  document.contentType = 'text/html';
  document.readyState = 'complete';
  document.createElement = tagName => new FakeElement(tagName);
  document.createElementNS = (_ns, tagName) => new FakeElement(tagName);
  const context = {
    window: new SimpleEventTarget(),
    document,
    MutationObserver: FakeMutationObserver,
    getComputedStyle: node => ({ filter: node.style.filter || 'none' }),
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Uint8Array, Symbol, JSON, Number, String, Math, Object, WeakSet, queueMicrotask,
    crypto: { getRandomValues: values => { values.fill(7); return values; } }
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/page-display/page-display-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return { context, document, runtime: context[Symbol.for('cosmic-gemini.page-display.runtime')] };
}

test('Page Display combines passive visual layers and restores the page when both are disabled', async () => {
  const { context, document, runtime } = await runtimeFixture();
  runtime.onConfigure({
    detail: JSON.stringify({
      token: runtime.token,
      config: {
        active: true,
        reduceWhitePoint: { enabled: true, reduction: 0.35 },
        greyscale: { enabled: false }
      }
    })
  });
  const host = runtime.host;
  assert.equal(host.parentNode, document.documentElement);
  assert.equal(host.attributes.get('data-cosmic-gemini-page-display'), '');
  assert.equal(host.attributes.get('data-reduction'), '35');
  assert.equal(host.attributes.get('data-shade'), 'dark');
  assert.equal(host.attributes.get('data-greyscale'), 'false');
  assert.deepEqual(host.style, {});
  assert.equal(document.listeners.get('fullscreenchange').length, 1);
  assert.equal(FakeMutationObserver.instances.length, 2);

  document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
  FakeMutationObserver.instances[1].callback([{ type: 'attributes', target: document.documentElement }]);
  await Promise.resolve();
  assert.equal(host.attributes.get('data-shade'), 'light');

  document.documentElement.style.filter = 'invert(80%)';
  FakeMutationObserver.instances[1].callback([{ type: 'attributes', target: document.documentElement }]);
  await Promise.resolve();
  assert.equal(host.attributes.get('data-shade'), 'light');

  document.documentElement.style.filter = 'invert(1) invert(1)';
  FakeMutationObserver.instances[1].callback([{ type: 'attributes', target: document.documentElement }]);
  await Promise.resolve();
  assert.equal(host.attributes.get('data-shade'), 'dark');

  runtime.onConfigure({
    detail: JSON.stringify({
      token: runtime.token,
      config: {
        active: true,
        reduceWhitePoint: { enabled: false, reduction: 0.6 },
        greyscale: { enabled: true }
      }
    })
  });
  assert.equal(runtime.host, host);
  assert.equal(document.documentElement.children.length, 1);
  assert.equal(runtime.host.attributes.get('data-reduction'), '0');
  assert.equal(FakeMutationObserver.instances[1].disconnected, true);
  assert.equal(runtime.host.attributes.get('data-greyscale'), 'true');

  const fullscreen = new FakeElement('section');
  document.fullscreenElement = fullscreen;
  document.dispatchEvent({ type: 'fullscreenchange' });
  assert.equal(runtime.host.parentNode, fullscreen);

  runtime.onConfigure({
    detail: JSON.stringify({
      token: runtime.token,
      config: {
        active: false,
        reduceWhitePoint: { enabled: false, reduction: 0.25 },
        greyscale: { enabled: false }
      }
    })
  });
  assert.equal(runtime.host, null);
  assert.equal(fullscreen.children.length, 0);
  assert.equal(document.listeners.get('fullscreenchange').length, 0);

  runtime.onDispose({ detail: runtime.token });
  assert.equal(context[Symbol.for('cosmic-gemini.page-display.runtime')], undefined);
});

test('Page Display remounts the same layer before a rewritten page can paint without it', async () => {
  const { context, document, runtime } = await runtimeFixture();
  runtime.enable({ reduceWhitePoint: { enabled: true, reduction: .35 } });
  const host = runtime.host;
  host.remove();
  for (const observer of FakeMutationObserver.instances) if (!observer.disconnected) observer.callback([]);
  await Promise.resolve();
  assert.equal(host.parentNode, document.documentElement, 'removal must not leave an unshaded page');
  const replacement = new FakeElement('html'); document.documentElement = replacement;
  for (const observer of FakeMutationObserver.instances) if (!observer.disconnected) observer.callback([]);
  await Promise.resolve();
  assert.equal(runtime.host, host); assert.equal(host.parentNode, replacement);
  context.window.listeners.clear(); document.listeners.clear(); runtime.announce();
  context.window.dispatchEvent({ type: 'cosmic-gemini:page-display:configure', detail: JSON.stringify({
    token: runtime.token, config: { active: false }
  }) });
  assert.equal(runtime.host, null, 'document.open must not lose the configuration listener');
  assert.ok(FakeMutationObserver.instances.every(observer => observer.disconnected));
});

test('Page Display leaves authored XML alone and waits for the native HTML view without losing its settings', async () => {
  const { document, runtime } = await runtimeFixture();
  document.contentType = 'application/xml'; document.readyState = 'loading';
  document.documentElement.namespaceURI = ''; document.documentElement.localName = 'root';
  runtime.enable({ reduceWhitePoint: { enabled: true, reduction: .35 }, greyscale: { enabled: true } });
  assert.equal(runtime.host, null); assert.equal(document.documentElement.children.length, 0);
  document.documentElement = new FakeElement('html');
  for (const observer of FakeMutationObserver.instances) if (!observer.disconnected) observer.callback([]);
  assert.equal(runtime.host, null, 'Chrome must finish its document transformation first');
  document.readyState = 'complete'; document.dispatchEvent({ type: 'readystatechange' });
  assert.equal(runtime.host.attributes.get('data-reduction'), '35');
  assert.equal(runtime.host.attributes.get('data-greyscale'), 'true');
  runtime.disable();
  document.documentElement.namespaceURI = 'http://www.w3.org/2000/svg';
  document.documentElement.localName = 'svg';
  runtime.enable({ greyscale: { enabled: true } });
  assert.equal(runtime.host, null, 'authored SVG is never given an HTML overlay'); runtime.disable();
});

test('Page Display keeps one non-inverted top layer for replaced-element fullscreen and restores normal composition', async () => {
  const { document, runtime } = await runtimeFixture();
  document.documentElement.style.filter = 'invert(1)';
  runtime.enable({ reduceWhitePoint: { enabled: true, reduction: .35 } });
  const host = runtime.host; assert.equal(host.attributes.get('data-shade'), 'light');
  for (const name of ['canvas', 'img', 'iframe', 'video']) {
    document.fullscreenElement = new FakeElement(name); document.dispatchEvent({ type: 'fullscreenchange' });
    assert.equal(runtime.host, host); assert.equal(host.parentNode, document.documentElement);
    assert.equal(host.popoverOpen, true); assert.equal(host.attributes.get('data-shade'), 'dark');
  }
  document.fullscreenElement = null; document.dispatchEvent({ type: 'fullscreenchange' });
  assert.equal(host.popoverOpen, false); assert.equal(host.attributes.has('popover'), false);
  assert.equal(host.attributes.get('data-shade'), 'light'); runtime.disable();
});
