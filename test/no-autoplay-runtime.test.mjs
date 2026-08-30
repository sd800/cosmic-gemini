import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  dispatchEvent(event) { event.target ||= this; for (const listener of this.listeners.get(event.type) || []) listener.call(this, event); }
}
class FakeMedia extends SimpleEventTarget {
  constructor() { super(); this.muted = false; this.volume = 1; this.isConnected = true; this.played = 0; this.paused = 0; this.removed = false; }
  play() { this.played += 1; return Promise.resolve(); }
  pause() { this.paused += 1; }
  removeAttribute() {}
  remove() { this.removed = true; this.isConnected = false; }
}
class FakeAudio extends FakeMedia {}
class FakeVideo extends FakeMedia {}
class FakeMutationObserver { observe() {} disconnect() {} }
class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; } }
class FakeAudioContext { constructor() { this.resumed = 0; this.suspended = 0; } resume() { this.resumed += 1; return Promise.resolve(); } suspend() { this.suspended += 1; return Promise.resolve(); } }

test('No Autoplay blocks automatic media, preserves direct play, and keeps video blocked when sound is allowed', async () => {
  const window = new SimpleEventTarget();
  const document = { documentElement: {}, querySelectorAll: () => [] };
  const navigator = { userActivation: { isActive: false } };
  const context = {
    window, document, navigator,
    HTMLMediaElement: FakeMedia, HTMLAudioElement: FakeAudio, HTMLVideoElement: FakeVideo,
    AudioContext: FakeAudioContext, webkitAudioContext: undefined,
    MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent,
    WeakMap, Map, Set, Symbol, JSON, Reflect, Number, String, Math, Object, Promise,
    performance: { now: () => 100 }, crypto: { randomUUID: () => 'autoplay-token' }
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/no-autoplay-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context.window[Symbol.for('cosmic-gemini.no-autoplay.runtime')];
  runtime.onConfigure({ detail: JSON.stringify({ token: 'autoplay-token', config: { active: true, mode: 'standard', audioAllowed: false } }) });

  let audioPrompts = 0;
  context.window.addEventListener('cosmic-gemini:no-autoplay:audio-blocked', () => { audioPrompts += 1; });
  const audio = new FakeAudio();
  await audio.play();
  assert.equal(audio.played, 0);
  assert.equal(audio.paused, 1);
  assert.equal(audioPrompts, 1);

  const webAudio = new context.AudioContext();
  assert.equal(webAudio.suspended, 1);

  navigator.userActivation.isActive = true;
  const intentionalVideo = new FakeVideo();
  await intentionalVideo.play();
  assert.equal(intentionalVideo.played, 1);

  navigator.userActivation.isActive = false;
  runtime.onConfigure({ detail: JSON.stringify({ token: 'autoplay-token', config: { active: true, mode: 'standard', audioAllowed: true } }) });
  assert.equal(webAudio.resumed, 1);
  const allowedAudio = new FakeAudio();
  await allowedAudio.play();
  assert.equal(allowedAudio.played, 1);
  const blockedVideo = new FakeVideo();
  await blockedVideo.play();
  assert.equal(blockedVideo.played, 0);

  runtime.onConfigure({ detail: JSON.stringify({ token: 'autoplay-token', config: { active: true, mode: 'strong', audioAllowed: true } }) });
  navigator.userActivation.isActive = true;
  const strongVideo = new FakeVideo();
  await strongVideo.play();
  assert.equal(strongVideo.removed, true);
});
