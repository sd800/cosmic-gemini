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
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }
}

function matchesSelector(element, selector) {
  if (selector === '.qnt-p') return element.className === 'qnt-p';
  if (selector === '.videoPlayerMini') return element.className === 'videoPlayerMini';
  return element.tagName === selector.toUpperCase();
}

class FakeElement extends SimpleEventTarget {
  constructor(tagName, className = '') {
    super();
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.isConnected = false;
    this.textContent = '';
    this.removed = false;
  }
  appendChild(child) {
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() {
    this.removed = true;
    this.isConnected = false;
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
  }
}

class FakeVideo extends FakeElement {
  constructor() {
    super('video');
    this.pauseCount = 0;
    this.loadCount = 0;
    this.setAttribute('src', 'https://example.com/video.mp4');
  }
  pause() { this.pauseCount += 1; }
  load() { this.loadCount += 1; }
}

class FakeImageElement extends FakeElement {
  constructor() { super('img'); this.source = ''; }
  get src() { return this.source; }
  set src(value) { this.source = String(value); }
}

class FakeMutationObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.target = null;
    this.options = null;
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, options) { this.target = target; this.options = options; }
  disconnect() { this.disconnected = true; }
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; }
}

class FakeXhr { open() {} }
class FakeNavigator { sendBeacon() { return false; } }

function makeContext() {
  FakeMutationObserver.instances = [];
  const window = new SimpleEventTarget();
  const document = new SimpleEventTarget();
  const root = new FakeElement('html');
  const head = root.appendChild(new FakeElement('head'));
  const body = root.appendChild(new FakeElement('body'));
  const playerRoot = body.appendChild(new FakeElement('div', 'qnt-p'));
  document.documentElement = root;
  document.head = head;
  document.body = body;
  document.createElement = tagName => new FakeElement(tagName);
  document.querySelector = selector => {
    if (selector.startsWith('style[')) return null;
    if (root.matches(selector)) return root;
    return root.querySelector(selector);
  };
  document.querySelectorAll = selector => root.querySelectorAll(selector);
  const context = {
    window,
    document,
    location: { hostname: 'news.qq.com', href: 'https://news.qq.com/' },
    navigator: new FakeNavigator(),
    Navigator: FakeNavigator,
    XMLHttpRequest: FakeXhr,
    HTMLImageElement: FakeImageElement,
    MutationObserver: FakeMutationObserver,
    CustomEvent: FakeCustomEvent,
    Request,
    Response,
    Blob,
    URL,
    WeakMap,
    Map,
    Set,
    Symbol,
    JSON,
    Reflect,
    Object,
    String,
    Uint8Array,
    Promise,
    crypto: { getRandomValues: values => { values.fill(9); return values; } },
    fetch: () => Promise.resolve(new Response('{}'))
  };
  vm.createContext(context);
  return { context, playerRoot };
}

test('Ad Marshal releases and removes only the Tencent News floating player', async () => {
  const { context, playerRoot } = makeContext();
  const ordinaryPlayer = playerRoot.appendChild(new FakeElement('div', 'videoPlayer'));
  const video = ordinaryPlayer.appendChild(new FakeVideo());
  const source = video.appendChild(new FakeElement('source'));
  source.setAttribute('src', 'https://example.com/video-source.mp4');

  const sourceCode = await readFile(new URL('../extension/content/ad-marshal-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(sourceCode, context);
  const runtime = context[Symbol.for('cosmic-gemini.ad-marshal.runtime')];
  runtime.onConfigure({
    detail: JSON.stringify({ token: runtime.token, config: { active: true, siteId: 'newsQqCom' } })
  });

  assert.equal(ordinaryPlayer.removed, false);
  assert.equal(video.pauseCount, 0);
  const observer = FakeMutationObserver.instances.at(-1);
  assert.equal(observer.target, playerRoot);
  assert.equal([...observer.options.attributeFilter].join(','), 'class');

  ordinaryPlayer.className = 'videoPlayerMini';
  observer.callback([{ type: 'attributes', target: ordinaryPlayer, addedNodes: [] }]);

  assert.equal(video.pauseCount, 1);
  assert.equal(video.loadCount, 1);
  assert.equal(video.attributes.has('src'), false);
  assert.equal(source.attributes.has('src'), false);
  assert.equal(ordinaryPlayer.removed, true);
  assert.equal(playerRoot.removed, false);

  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(observer.disconnected, true);
  assert.equal(runtime.newsFloatingPlayerObserver, null);
  runtime.onDispose({ detail: runtime.token });
});
