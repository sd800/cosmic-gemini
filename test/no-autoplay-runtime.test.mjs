import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
  dispatchEvent(event) { event.target ||= this; for (const listener of this.listeners.get(event.type) || []) listener.call(this, event); }
}
class FakeMedia extends SimpleEventTarget {
  constructor() {
    super();
    this.muted = false;
    this.volume = 1;
    this.isConnected = true;
    this.played = 0;
    this.paused = 0;
    this.removed = false;
    this.attributes = new Set();
    this.currentSrc = '';
    this.src = '';
    this.rect = { width: 0, height: 0 };
  }
  play() { this.played += 1; return Promise.resolve(); }
  pause() { this.paused += 1; }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return name === 'src' ? this.src : ''; }
  getBoundingClientRect() { return this.rect; }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() { this.removed = true; this.isConnected = false; }
}
class FakeAudio extends FakeMedia {}
class FakeVideo extends FakeMedia {}
class FakeMutationObserver { observe() {} disconnect() {} }
class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; } }
class FakeAudioContext { constructor() { this.resumed = 0; this.suspended = 0; } resume() { this.resumed += 1; return Promise.resolve(); } suspend() { this.suspended += 1; return Promise.resolve(); } }

test('No Autoplay blocks automatic media, preserves direct play, and keeps video blocked when audio is allowed', async () => {
  let now = 100;
  const window = new SimpleEventTarget();
  const alreadyPlayingAudio = new FakeAudio();
  alreadyPlayingAudio.paused = false;
  const document = {
    documentElement: {},
    querySelectorAll: selector => selector === 'video,audio' ? [alreadyPlayingAudio] : []
  };
  const navigator = { userActivation: { isActive: false } };
  const context = {
    window, document, navigator,
    HTMLMediaElement: FakeMedia, HTMLAudioElement: FakeAudio, HTMLVideoElement: FakeVideo,
    AudioContext: FakeAudioContext, webkitAudioContext: undefined,
    MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent,
    WeakMap, Map, Set, Symbol, JSON, Reflect, Number, String, Math, Object, Promise,
    performance: { now: () => now }, crypto: { getRandomValues: values => { values.fill(8); return values; } }
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/no-autoplay-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.no-autoplay.runtime')];
  const assertBlocked = media => assert.rejects(media.play(), error => error?.name === 'NotAllowedError');
  assert.equal(context.HTMLMediaElement.prototype.play, runtime.originalPlay);
  assert.equal(context.AudioContext, FakeAudioContext);
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard', audioAllowed: false } }) });
  assert.equal(alreadyPlayingAudio.paused, 1);

  const audio = new FakeAudio();
  await assertBlocked(audio);
  assert.equal(audio.played, 0);
  assert.equal(audio.paused, 1);

  const webAudio = new context.AudioContext();
  assert.equal(webAudio.suspended, 1);

  navigator.userActivation.isActive = true;
  const activationOnlyVideo = new FakeVideo();
  await assertBlocked(activationOnlyVideo);
  assert.equal(activationOnlyVideo.played, 0);
  const activationOnlyContext = new context.AudioContext();
  assert.equal(activationOnlyContext.suspended, 1);

  navigator.userActivation.isActive = false;
  const intentionalVideo = new FakeVideo();
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', target: intentionalVideo, composedPath: () => [intentionalVideo] });
  await intentionalVideo.play();
  assert.equal(intentionalVideo.played, 1);

  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', target: {}, composedPath: () => [{}] });
  const unrelatedClickVideo = new FakeVideo();
  await assertBlocked(unrelatedClickVideo);
  assert.equal(unrelatedClickVideo.played, 0);

  const playControl = {
    localName: 'button',
    className: 'video-play-control',
    textContent: 'Play',
    getAttribute: () => ''
  };
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', target: playControl, composedPath: () => [playControl] });
  const customControlVideo = new FakeVideo();
  await customControlVideo.play();
  assert.equal(customControlVideo.played, 1);

  now = 2501;
  const hiddenMedia = new FakeVideo();
  hiddenMedia.currentSrc = 'blob:hidden';
  const associatedVideo = new FakeVideo();
  associatedVideo.currentSrc = 'blob:visible';
  associatedVideo.rect = { width: 840, height: 473 };
  const controls = { querySelectorAll: () => [hiddenMedia] };
  const player = { querySelectorAll: () => [hiddenMedia, associatedVideo] };
  runtime.onUserIntent({
    isTrusted: true,
    type: 'pointerdown',
    target: playControl,
    composedPath: () => [playControl, controls, player]
  });
  now = 5002;
  await associatedVideo.play();
  assert.equal(associatedVideo.played, 1);
  await assertBlocked(hiddenMedia);
  const otherPlayerVideo = new FakeVideo();
  await assertBlocked(otherPlayerVideo);

  now = 20000;
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'standard', audioAllowed: true } }) });
  assert.equal(intentionalVideo.paused, 0);
  assert.equal(webAudio.resumed, 1);
  const allowedAudio = new FakeAudio();
  await allowedAudio.play();
  assert.equal(allowedAudio.played, 1);
  const blockedVideo = new FakeVideo();
  await assertBlocked(blockedVideo);
  assert.equal(blockedVideo.played, 0);

  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode: 'enhanced', audioAllowed: true } }) });
  navigator.userActivation.isActive = true;
  const enhancedVideo = new FakeVideo();
  await assertBlocked(enhancedVideo);
  assert.equal(enhancedVideo.removed, true);

  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false, mode: 'standard', audioAllowed: false } }) });
  navigator.userActivation.isActive = false;
  const whitelistedAudio = new FakeAudio();
  const whitelistedVideo = new FakeVideo();
  const whitelistedContext = new context.AudioContext();
  await whitelistedAudio.play();
  await whitelistedVideo.play();
  assert.equal(whitelistedAudio.played, 1);
  assert.equal(whitelistedVideo.played, 1);
  assert.equal(whitelistedContext.suspended, 0);
  assert.equal(context.HTMLMediaElement.prototype.play, runtime.originalPlay);
  assert.equal(context.AudioContext, FakeAudioContext);
  runtime.onDispose({ detail: runtime.token });
  assert.equal(context.window[Symbol.for('cosmic-gemini.no-autoplay.runtime')], undefined);
});
