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
  return selector.split(',').some(rawSelector => {
    const item = rawSelector.trim();
    if (item === '.qnt-p') return element.className === 'qnt-p';
    if (item === '.videoPlayerMini') return element.className === 'videoPlayerMini';
    if (item === '.qqcom-jxvideo') return element.className === 'qqcom-jxvideo';
    if (item === '.video-wrap') return element.className === 'video-wrap';
    if (item === 'iframe[src*="video.qq.com"]') {
      return element.tagName === 'IFRAME' && (element.getAttribute('src') || '').includes('video.qq.com');
    }
    if (item === 'iframe[src*="v.qq.com"]') {
      return element.tagName === 'IFRAME' && (element.getAttribute('src') || '').includes('v.qq.com');
    }
    return element.tagName === item.toUpperCase();
  });
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
  getAttribute(name) { return this.attributes.get(name) || null; }
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

test('Ad Marshal releases Tencent News video modules and removes only the floating player state', async () => {
  const { context, playerRoot } = makeContext();
  const contentRight = context.document.body.appendChild(new FakeElement('div', 'content-right'));
  const videoWrap = contentRight.appendChild(new FakeElement('div', 'video-wrap'));
  const module = videoWrap.appendChild(new FakeElement('div', 'qqcom-jxvideo'));
  const moduleVideo = module.appendChild(new FakeVideo());
  const moduleFrame = module.appendChild(new FakeElement('iframe'));
  moduleFrame.setAttribute('src', 'https://video.qq.com/cookie/sync_qqnews.html');
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

  assert.equal(videoWrap.removed, true);
  assert.equal(moduleVideo.pauseCount, 1);
  assert.equal(moduleVideo.loadCount, 1);
  assert.equal(moduleVideo.attributes.has('src'), false);
  assert.equal(contentRight.removed, false);
  assert.equal(ordinaryPlayer.removed, false);
  assert.equal(video.pauseCount, 0);
  const observer = FakeMutationObserver.instances.find(item => item.target === playerRoot);
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
