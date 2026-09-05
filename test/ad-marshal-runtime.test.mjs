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
    if (item === 'video[autoplay]') return element.tagName === 'VIDEO' && element.hasAttribute('autoplay');
    if (item === 'audio[autoplay]') return element.tagName === 'AUDIO' && element.hasAttribute('autoplay');
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
  hasAttribute(name) { return this.attributes.has(name); }
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

class FakeMedia extends FakeElement {
  constructor(tagName) {
    super(tagName);
    this.pauseCount = 0;
    this.loadCount = 0;
    this.muted = false;
    this.volume = 1;
  }
  pause() { this.pauseCount += 1; }
  load() { this.loadCount += 1; }
}

class FakeVideo extends FakeMedia {
  constructor() {
    super('video');
    this.setAttribute('src', 'https://example.com/video.mp4');
  }
}

class FakeAudio extends FakeMedia {
  constructor() {
    super('audio');
    this.setAttribute('src', 'https://example.com/audio.mp3');
  }
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
class FakeNavigator {
  constructor() { this.userActivation = { isActive: false }; }
  sendBeacon() { return false; }
}

function makeContext() {
  FakeMutationObserver.instances = [];
  const window = new SimpleEventTarget();
  const document = new SimpleEventTarget();
  const root = new FakeElement('html');
  const head = root.appendChild(new FakeElement('head'));
  const body = root.appendChild(new FakeElement('body'));
  const playerRoot = body.appendChild(new FakeElement('div', 'qnt-p'));
  const clock = { now: 100 };
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
    HTMLMediaElement: FakeMedia,
    HTMLVideoElement: FakeVideo,
    HTMLAudioElement: FakeAudio,
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
    performance: { now: () => clock.now },
    crypto: { getRandomValues: values => { values.fill(9); return values; } },
    fetch: () => Promise.resolve(new Response('{}'))
  };
  vm.createContext(context);
  return { context, playerRoot, clock };
}

test('Ad Marshal removes side modules while suspending article media until explicit playback', async () => {
  const { context, playerRoot, clock } = makeContext();
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
  assert.ok(moduleVideo.pauseCount >= 1);
  assert.ok(moduleVideo.loadCount >= 1);
  assert.equal(moduleVideo.attributes.has('src'), false);
  assert.equal(contentRight.removed, false);
  assert.equal(ordinaryPlayer.removed, false);
  assert.equal(video.attributes.has('src'), true);
  assert.equal(source.attributes.has('src'), true);
  assert.equal(video.getAttribute('preload'), 'none');
  assert.equal(video.muted, true);
  assert.ok(video.pauseCount >= 1);
  assert.ok(video.loadCount >= 1);

  const mediaObserver = FakeMutationObserver.instances.find(item => item.options?.attributeFilter?.includes('src'));
  const floatingObserver = FakeMutationObserver.instances.find(item => item.target === playerRoot);
  assert.equal([...mediaObserver.options.attributeFilter].join(','), 'src,autoplay,preload');
  assert.equal([...floatingObserver.options.attributeFilter].join(','), 'class');

  video.setAttribute('preload', 'auto');
  const loadCountBeforePreloadReset = video.loadCount;
  mediaObserver.callback([{ type: 'attributes', attributeName: 'preload', target: video, addedNodes: [] }]);
  assert.equal(video.getAttribute('preload'), 'none');
  assert.ok(video.loadCount > loadCountBeforePreloadReset);

  const settingsControl = ordinaryPlayer.appendChild(new FakeElement('button', 'txp_btn_settings'));
  runtime.onNewsMediaIntent({
    type: 'pointerdown',
    isTrusted: true,
    target: settingsControl,
    composedPath: () => [settingsControl, ordinaryPlayer, playerRoot]
  });
  assert.equal(video.getAttribute('preload'), 'none');

  const playControl = ordinaryPlayer.appendChild(new FakeElement('button', 'play-button'));
  runtime.onNewsMediaIntent({
    type: 'pointerdown',
    isTrusted: true,
    target: playControl,
    composedPath: () => [playControl, ordinaryPlayer, playerRoot]
  });
  assert.equal(video.hasAttribute('preload'), false);
  assert.equal(playerRoot.hasAttribute('data-cosmic-gemini-news-media-active'), true);
  const pauseCountBeforeManualPlay = video.pauseCount;
  runtime.onNewsMediaPlay({ target: video });
  assert.equal(video.pauseCount, pauseCountBeforeManualPlay);

  video.muted = false;
  runtime.onNewsVolumeChange({ target: video });
  assert.equal(video.muted, true);

  const volumeControl = ordinaryPlayer.appendChild(new FakeElement('button', 'txp_btn_volume'));
  runtime.onNewsMediaIntent({
    type: 'pointerdown',
    isTrusted: true,
    target: volumeControl,
    composedPath: () => [volumeControl, ordinaryPlayer, playerRoot]
  });
  video.muted = false;
  runtime.onNewsVolumeChange({ target: video });
  clock.now = 2201;
  runtime.onNewsVolumeChange({ target: video });
  assert.equal(video.muted, false);

  ordinaryPlayer.className = 'videoPlayerMini';
  floatingObserver.callback([{ type: 'attributes', target: ordinaryPlayer, addedNodes: [] }]);

  assert.ok(video.pauseCount > pauseCountBeforeManualPlay);
  assert.equal(video.getAttribute('preload'), 'none');
  assert.equal(video.attributes.has('src'), true);
  assert.equal(source.attributes.has('src'), true);
  assert.equal(ordinaryPlayer.removed, false);
  assert.equal(playerRoot.removed, false);

  const pauseCountBeforeFloatingPlay = video.pauseCount;
  runtime.onNewsMediaPlay({ target: video });
  assert.ok(video.pauseCount > pauseCountBeforeFloatingPlay);

  ordinaryPlayer.className = 'videoPlayer';
  floatingObserver.callback([{ type: 'attributes', target: ordinaryPlayer, addedNodes: [] }]);
  assert.equal(video.hasAttribute('preload'), false);

  const audio = context.document.body.appendChild(new FakeAudio());
  audio.setAttribute('autoplay', '');
  mediaObserver.callback([{ type: 'childList', target: context.document.body, addedNodes: [audio] }]);
  assert.equal(audio.hasAttribute('autoplay'), false);
  assert.equal(audio.getAttribute('preload'), 'none');
  const audioPauseCount = audio.pauseCount;
  runtime.onNewsMediaPlay({ target: audio });
  assert.ok(audio.pauseCount > audioPauseCount);

  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(mediaObserver.disconnected, true);
  assert.equal(floatingObserver.disconnected, true);
  assert.equal(context.window.listeners.get('play')?.length || 0, 0);
  assert.equal(context.window.listeners.get('volumechange')?.length || 0, 0);
  assert.equal(runtime.newsFloatingPlayerObserver, null);
  runtime.onDispose({ detail: runtime.token });
});
