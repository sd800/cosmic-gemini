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
class FakeAudioContext {
  constructor() { this.resumed = 0; this.suspended = 0; this.state = 'running'; }
  resume() {
    if(this.state==='closed') {const error=new Error('Already closed');error.name='InvalidStateError';return Promise.reject(error);}
    this.resumed += 1; this.state = 'running'; return Promise.resolve();
  }
  suspend() { this.suspended += 1; this.state = 'suspended'; return Promise.resolve(); }
}

async function nativeControlsFixture(t, {webkitAlias = false} = {}) {
  let now = 100;
  const window = new SimpleEventTarget();
  const document = { documentElement: {}, activeElement: null, querySelectorAll: () => [] };
  const navigator = { userActivation: { isActive: false } };
  const context = {
    window, document, navigator,
    HTMLMediaElement: FakeMedia, HTMLAudioElement: FakeAudio, HTMLVideoElement: FakeVideo,
    AudioContext: FakeAudioContext, MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent,
    performance: { now: () => now }, crypto: { getRandomValues: values => values.fill(8) }
  };
  if (webkitAlias) {
    context.webkitAudioContext = FakeAudioContext;
    Object.defineProperty(context, 'AudioContext', {value:FakeAudioContext,writable:true,configurable:true,enumerable:false});
  }
  vm.createContext(context);
  vm.runInContext(await readFile(new URL('../extension/content/no-autoplay/no-autoplay-runtime.js', import.meta.url), 'utf8'), context);
  const runtime = window[Symbol.for('cosmic-gemini.no-autoplay.runtime')];
  const configure = (mode, overrides = {}) => runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, mode, audioAllowed: false, ...overrides } }) });
  configure('standard');
  t.after(() => runtime.onDispose({ detail: runtime.token }));
  return { runtime, document, navigator, context, configure, advance: ms => { now += ms; } };
}

test('native control play is media-local, expires, and cannot bypass the script play guard', async t => {
  const {runtime,document,navigator,context,advance} = await nativeControlsFixture(t);
  const video = new FakeVideo();
  video.controls = true;
  document.activeElement = video;
  navigator.userActivation.isActive = true;
  await assert.rejects(video.play(), {name:'NotAllowedError'}, 'focus and general activation alone do not permit script playback');
  assert.equal(runtime.pendingVideo.has(video), true);
  const pauses = video.paused;
  runtime.onPlay({target:video, isTrusted:true});
  assert.equal(video.paused, pauses, 'native controls start playback without an exposed pointer event');
  assert.equal(runtime.hasUserIntent(video), true);
  assert.equal(runtime.hasRecentPlaybackIntent(), false, 'native controls do not grant global playback intent');
  assert.equal(runtime.pendingVideo.has(video), false, 'manual playback clears the old autoplay resume queue');
  await assert.rejects(new FakeVideo().play(), {name:'NotAllowedError'});
  assert.equal(new context.AudioContext().suspended, 1);
  advance(15001);
  navigator.userActivation.isActive = false;
  await assert.rejects(video.play(), {name:'NotAllowedError'});
  navigator.userActivation.isActive = true;
  const beforeResume = video.paused;
  runtime.onPlay({target:video, isTrusted:true});
  assert.equal(video.paused, beforeResume, 'native resume works after the earlier gesture has expired');
});

test('native playback exception rejects missing controls, missing focus, synthetic events, and unrelated activation', async t => {
  const {runtime,document,navigator} = await nativeControlsFixture(t);
  for (const [controls,focused,trusted,active] of [
    [false,true,true,true], [true,false,true,true], [true,true,false,true], [true,true,true,false]
  ]) {
    const video = new FakeVideo();
    video.controls = controls;
    document.activeElement = focused ? video : {};
    navigator.userActivation.isActive = active;
    runtime.onPlay({target:video, isTrusted:trusted});
    assert.equal(video.paused, trusted ? 1 : 0, 'synthetic play notifications cannot pause media');
    assert.equal(runtime.hasUserIntent(video), false);
  }
});

test('native audio and focus inside a shadow root work, while Enhanced mode still removes media', async t => {
  const {runtime,document,navigator,configure} = await nativeControlsFixture(t);
  const audio = new FakeAudio();
  audio.controls = true;
  audio.getRootNode = () => ({activeElement:audio});
  document.activeElement = {};
  navigator.userActivation.isActive = true;
  await assert.rejects(audio.play(), {name:'NotAllowedError'});
  const pauses = audio.paused;
  runtime.onPlay({target:audio,isTrusted:true});
  assert.equal(audio.paused, pauses);
  assert.equal(runtime.pendingAudio.has(audio), false);
  configure('enhanced');
  runtime.onPlay({target:audio,isTrusted:true});
  assert.equal(audio.removed, true);
});

test('right clicks, modifier shortcuts, and secondary pointers do not authorize playback', async t => {
  const {runtime} = await nativeControlsFixture(t);
  for (const extra of [{button:2},{button:1},{isPrimary:false},{ctrlKey:true},{metaKey:true},{altKey:true}]) {
    const video = new FakeVideo();
    runtime.onUserIntent({isTrusted:true,type:'pointerdown',composedPath:()=>[video],...extra});
    await assert.rejects(video.play(), {name:'NotAllowedError'});
  }
});

test('play-control naming supports common controls without treating text entry or lookalike words as play', async t => {
  const {runtime} = await nativeControlsFixture(t);
  const control=label=>({localName:'button',className:label,getAttribute:()=>''});
  for(const label of ['videoPlayButton','videoReplayButton','startVideo','audio-listen','unmute-button'])assert.equal(runtime.isPlaybackControl(control(label)),true,label);
  for(const label of ['display-button','autoplay-option','playback-speed'])assert.equal(runtime.isPlaybackControl(control(label)),false,label);
  const input={localName:'input',textContent:'Play',getAttribute:name=>name==='value'?'Play':''};
  assert.equal(runtime.isPlaybackControl(input),false);
  runtime.onUserIntent({isTrusted:true,type:'keydown',key:'Enter',composedPath:()=>[input,control('play-control')]});
  await assert.rejects(new FakeVideo().play(),{name:'NotAllowedError'});
});

test('player associations exclude page roots and hidden sibling media', async t => {
  const {runtime,document,advance} = await nativeControlsFixture(t);
  const visible = new FakeVideo(), hidden = new FakeVideo(), unrelated = new FakeVideo();
  visible.rect = unrelated.rect = {width:640,height:360};
  const player = {querySelectorAll:()=>[visible,hidden]};
  visible.parentElement = hidden.parentElement = player;
  document.body = {querySelectorAll:()=>[visible,hidden,unrelated]};
  unrelated.parentElement = document.body;
  player.parentElement = document.body;
  const control = {localName:'button',className:'videoPlayButton',getAttribute:()=>''};
  runtime.onUserIntent({isTrusted:true,type:'pointerdown',composedPath:()=>[control,player,document.body,document]});
  advance(2100);
  await visible.play();
  await assert.rejects(hidden.play(), {name:'NotAllowedError'});
  await assert.rejects(unrelated.play(), {name:'NotAllowedError'});
  runtime.onUserIntent({isTrusted:true,type:'pointerdown',composedPath:()=>[control,document.body,document]});
  advance(2100);
  await assert.rejects(unrelated.play(), {name:'NotAllowedError'}, 'a page-level control must not seed a body-wide long permission');
  const broadContainer={querySelectorAll:()=>[visible,unrelated]};
  unrelated.parentElement=broadContainer;
  runtime.onUserIntent({isTrusted:true,type:'pointerdown',composedPath:()=>[control,broadContainer,document.body,document]});
  advance(2100);
  await assert.rejects(unrelated.play(), {name:'NotAllowedError'}, 'an ambiguous multi-player container cannot grant a long permission');
});

test('active user playback survives redundant play and audio-permission changes, then expires on stop', async t => {
  const {runtime,document,navigator,configure,advance} = await nativeControlsFixture(t);
  const automatic = new FakeAudio(), manual = new FakeAudio(), video = new FakeVideo();
  automatic.paused = manual.paused = video.paused = false;
  manual.controls = true;
  document.activeElement = manual;
  navigator.userActivation.isActive = true;
  runtime.onPlay({target:manual,isTrusted:true});
  navigator.userActivation.isActive = false;
  advance(16000);
  assert.equal(runtime.shouldBlockMedia(manual), false, 'uninterrupted deliberate playback remains authorized');
  runtime.onPlaybackStopped({target:manual,type:'pause',isTrusted:true});
  assert.equal(runtime.shouldBlockMedia(manual), false, 'a queued old pause cannot revoke current playback');
  configure('standard',{audioAllowed:true});
  const queries = [];
  document.querySelectorAll = selector => {queries.push(selector);return selector==='audio'?[automatic,manual]:[automatic,manual,video];};
  configure('standard');
  assert.deepEqual(queries,['audio']);
  assert.equal(automatic.paused, 1, 'revoking permission stops automatic audio');
  assert.equal(manual.paused, false, 'manual audio continues');
  assert.equal(video.paused, false, 'an audio-only policy change never pauses video');
  manual.paused = true;
  runtime.onPlaybackStopped({target:manual,type:'pause',isTrusted:true});
  assert.equal(runtime.shouldBlockMedia(manual), true);
  manual.paused = false;
  assert.equal(runtime.shouldBlockMedia(manual), true, 'script playback after a real stop requires new intent');
});

test('source resets retire active playback authorization', async t => {
  const {runtime,document,navigator,advance} = await nativeControlsFixture(t);
  const video = new FakeVideo();
  video.controls = true; video.paused = false;
  document.activeElement = video; navigator.userActivation.isActive = true;
  runtime.onPlay({target:video,isTrusted:true});
  runtime.onPlaybackStopped({target:video,type:'emptied',isTrusted:true});
  navigator.userActivation.isActive = false; advance(16000);
  assert.equal(runtime.shouldBlockMedia(video), true);
  const replaced = new FakeVideo();
  await assert.rejects(replaced.play(),{name:'NotAllowedError'});
  assert.equal(runtime.pendingVideo.has(replaced),true);
  runtime.onPlaybackStopped({target:replaced,type:'emptied',isTrusted:true});
  assert.equal(runtime.pendingVideo.has(replaced),false,'a source reset must not replay an obsolete autoplay request on disposal');
});

test('repeated blocked media cannot evict another pending element from a full bounded queue', async t => {
  const {runtime} = await nativeControlsFixture(t);
  const media=Array.from({length:10},()=>new FakeVideo());
  for(const video of media)runtime.rememberPending(runtime.pendingVideo,video);
  assert.equal(runtime.pendingVideo.size,8);
  const first=runtime.pendingVideo.values().next().value;
  runtime.rememberPending(runtime.pendingVideo,media.at(-1));
  assert.equal(runtime.pendingVideo.size,8);
  assert.equal(runtime.pendingVideo.has(first),true);
});

test('Web Audio denials reject, pending resumes are deduplicated, and closed contexts stay closed', async t => {
  const {runtime,context,configure} = await nativeControlsFixture(t);
  const audio = new context.AudioContext();
  for(let i=0;i<3;i++) await assert.rejects(audio.resume(),{name:'NotAllowedError'});
  assert.equal(runtime.pendingContexts.size, 1);
  const closed = new context.AudioContext();
  closed.suspend = () => Promise.reject(new Error('Already closed'));
  await assert.rejects(closed.resume(),{name:'NotAllowedError'});
  closed.state = 'closed';
  await assert.rejects(closed.resume(),{name:'InvalidStateError'}, 'closed contexts retain their native rejection');
  configure('standard',{audioAllowed:true});
  await Promise.resolve();
  assert.equal(audio.resumed, 1);
  assert.equal(closed.resumed, 0);
  assert.equal(runtime.pendingContexts.size, 0);
});

test('audio-permission revocation and Enhanced mode suspend running Web Audio with distinct user intent', async t => {
  const {runtime,context,configure,advance} = await nativeControlsFixture(t);
  configure('standard',{audioAllowed:true});
  const automatic=new context.AudioContext(),manual=new context.AudioContext();
  const control={localName:'button',textContent:'Listen',getAttribute:()=>''};
  runtime.onUserIntent({isTrusted:true,type:'pointerdown',composedPath:()=>[control]});
  await manual.resume();
  advance(16000);
  configure('standard');
  assert.equal(automatic.state,'suspended');
  assert.equal(manual.state,'running');
  await manual.resume();
  assert.equal(manual.state,'running','redundant resume does not interrupt deliberate running audio');
  configure('enhanced');
  assert.equal(manual.state,'suspended','Enhanced mode also suspends already-running contexts');
  assert.equal(runtime.pendingContexts.size,2);
});

test('Web Audio tracking stays bounded and releases closed or disposed contexts', async t => {
  const {runtime,context,configure} = await nativeControlsFixture(t);
  configure('standard',{audioAllowed:true});
  for(let i=0;i<10;i++)new context.AudioContext();
  assert.equal(runtime.audioContexts.size,8);
  const closed=runtime.audioContexts.keys().next().value;closed.state='closed';
  new context.AudioContext();
  assert.equal(runtime.audioContexts.size,8);
  assert.equal(runtime.audioContexts.has(closed),false);
  configure('standard',{active:false});
  assert.equal(runtime.audioContexts.size,0);
});

test('deactivate/reactivate preserves later page wrappers without recursive play calls', async t => {
  const {runtime,configure} = await nativeControlsFixture(t);
  const guarded = FakeMedia.prototype.play;
  let calls = 0;
  const pagePlay = function(...args){calls++;return Reflect.apply(guarded,this,args);};
  FakeMedia.prototype.play = pagePlay;
  t.after(()=>{FakeMedia.prototype.play=runtime.originalPlay;});
  configure('standard',{active:false});
  assert.equal(FakeMedia.prototype.play,pagePlay);
  configure('standard');
  const video = new FakeVideo();
  runtime.onUserIntent({isTrusted:true,type:'pointerdown',composedPath:()=>[video]});
  await video.play();
  assert.equal(calls,1);
  configure('standard',{active:false});
  assert.equal(FakeMedia.prototype.play,pagePlay);
  await video.play();
  assert.equal(calls,2);
});

test('Web Audio constructor aliases share a guard and restore their property descriptors', async t => {
  const {runtime,context,configure} = await nativeControlsFixture(t, {webkitAlias:true});
  const standard = new context.AudioContext(), legacy = new context.webkitAudioContext();
  assert.equal(standard.suspended,1);
  assert.equal(legacy.suspended,1);
  assert.equal(runtime.pendingContexts.size,2);
  await assert.rejects(legacy.resume(),{name:'NotAllowedError'});
  configure('standard',{active:false});
  assert.equal(context.AudioContext,FakeAudioContext);
  assert.equal(context.webkitAudioContext,FakeAudioContext);
  assert.equal(Object.getOwnPropertyDescriptor(context,'AudioContext').enumerable,false);
  assert.equal(standard.resumed,1);
  assert.equal(legacy.resumed,1);
});

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
  const source = await readFile(new URL('../extension/content/no-autoplay/no-autoplay-runtime.js', import.meta.url), 'utf8');
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
