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
  setAttribute(name) { this.attributes.add(name); }
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
  createMediaElementSource(media) {
    if (!(this instanceof FakeAudioContext)) throw new TypeError('Invalid receiver');
    return new FakeMediaSource(this, { mediaElement: media });
  }
}
class FakeMediaSource {
  constructor(context, { mediaElement } = {}) {
    if (!(mediaElement instanceof FakeMedia)) throw new TypeError('Invalid media');
    this.context = context; this.mediaElement = mediaElement;
  }
}

async function nativeControlsFixture(t, {webkitAlias = false} = {}) {
  let now = 100;
  const window = new SimpleEventTarget();
  const document = { documentElement: {}, activeElement: null, querySelectorAll: () => [] };
  const navigator = { userActivation: { isActive: false } };
  const context = {
    window, document, navigator,
    HTMLMediaElement: FakeMedia, HTMLAudioElement: FakeAudio, HTMLVideoElement: FakeVideo,
    AudioContext: FakeAudioContext, MediaElementAudioSourceNode: FakeMediaSource,
    MutationObserver: FakeMutationObserver, CustomEvent: FakeCustomEvent,
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
  t.after(() => {
    const current = window[Symbol.for('cosmic-gemini.no-autoplay.runtime')];
    current?.onDispose({ detail: current.token });
  });
  return { runtime, document, navigator, context, configure, advance: ms => { now += ms; } };
}

test('unchanged configuration does not rescan media, but a mode change still applies', async t => {
  const { runtime, configure } = await nativeControlsFixture(t);
  let scans = 0, suspends = 0;
  runtime.removeMedia = () => { scans++; };
  runtime.suspendAutomaticContexts = () => { suspends++; };
  configure('enhanced');
  assert.equal(scans, 1);
  configure('enhanced');
  configure('enhanced', { audioAllowed: true });
  assert.equal(scans, 1, 'audio allowance has no effect in enhanced mode');
  assert.equal(suspends, 1);
  configure('standard', { audioAllowed: true });
  assert.equal(runtime.audioAllowed, true);
  assert.equal(runtime.observer, null);
  configure('enhanced');
  assert.equal(scans, 2);
});

test('an identical Enhanced decision still attaches observation when the parsed root arrives', async t => {
  const { runtime, document, configure } = await nativeControlsFixture(t);
  document.documentElement = null;
  configure('enhanced');
  assert.equal(runtime.observer, null);
  document.documentElement = {};
  configure('enhanced');
  assert.ok(runtime.observer);
});

test('native control authorization stays with the deliberate player and cannot bypass other players', async t => {
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
  await video.play();
  await assert.rejects(new FakeVideo().play(), {name:'NotAllowedError'});
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

test('native audio and shadow focus work, and Enhanced mode preserves manual media only', async t => {
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
  assert.equal(audio.removed, false);
  const automatic = new FakeAudio();
  runtime.onPlay({target:automatic,isTrusted:true});
  assert.equal(automatic.removed, true);
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

test('deliberate local players allow companion audio without authorizing page roots or other players', async t => {
  const {runtime,document,advance} = await nativeControlsFixture(t);
  const visible = new FakeVideo(), hidden = new FakeAudio(), unrelated = new FakeVideo();
  visible.rect = unrelated.rect = {width:640,height:360};
  const player = {querySelectorAll:()=>[visible,hidden]};
  visible.parentElement = hidden.parentElement = player;
  document.body = {querySelectorAll:()=>[visible,hidden,unrelated]};
  unrelated.parentElement = document.body;
  player.parentElement = document.body;
  const control = {localName:'button',className:'videoPlayButton',getAttribute:()=>''};
  runtime.onUserIntent({isTrusted:true,type:'pointerdown',composedPath:()=>[control,player,document.body,document]});
  advance(2100);
  await assert.rejects(hidden.play(), {name:'NotAllowedError'}, 'intent alone does not authorize hidden companions');
  await visible.play();
  await hidden.play();
  advance(16000);
  await hidden.play();
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

test('deliberate player authorization survives pause, replay, and audio-permission changes', async t => {
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
  assert.equal(runtime.shouldBlockMedia(manual), false);
  manual.paused = false;
  assert.equal(runtime.shouldBlockMedia(manual), false, 'the deliberate player may resume without a new deadline');
});

test('source changes preserve the deliberate player and retire stale blocked requests', async t => {
  const {runtime,document,navigator,advance} = await nativeControlsFixture(t);
  const video = new FakeVideo();
  video.controls = true; video.paused = false;
  document.activeElement = video; navigator.userActivation.isActive = true;
  runtime.onPlay({target:video,isTrusted:true});
  runtime.onPlaybackStopped({target:video,type:'emptied',isTrusted:true});
  navigator.userActivation.isActive = false; advance(16000);
  assert.equal(runtime.shouldBlockMedia(video), false, 'quality/source changes belong to the same deliberate player');
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
  assert.equal(manual.state,'running','Enhanced mode retains deliberate audio processing');
  assert.equal(runtime.pendingContexts.size,1);
});

test('a media click without an actual play request is only a short-lived intent', async t => {
  const { runtime, advance } = await nativeControlsFixture(t);
  const video = new FakeVideo();
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', composedPath: () => [video] });
  advance(16000);
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
});

for (const modern of [false, true]) {
test(`manual video releases only its associated Web Audio clock (${modern ? 'node constructor' : 'factory'})`, async t => {
  const { runtime, context, document, navigator, advance, configure } = await nativeControlsFixture(t);
  const video = new FakeVideo(); video.controls = true;
  const linked = new context.AudioContext(), unrelated = new context.AudioContext();
  const source = modern ? new context.MediaElementAudioSourceNode(linked, { mediaElement: video })
    : linked.createMediaElementSource(video);
  assert.equal(source.context, linked);
  assert.equal(linked.state, 'suspended');
  document.activeElement = video; navigator.userActivation.isActive = true;
  runtime.onPlay({ target: video, isTrusted: true });
  assert.equal(linked.state, 'running', 'native play releases the owned audio suspension');
  assert.equal(linked.resumed, 1);
  assert.equal(unrelated.state, 'suspended');
  navigator.userActivation.isActive = false; advance(16000);
  video.paused = true; runtime.onPlaybackStopped({ target: video, type: 'pause', isTrusted: true });
  await video.play();
  await linked.suspend(); await linked.resume();
  assert.equal(linked.state, 'running', 'buffering/audio-device recovery does not lose permission');
  linked.state = 'interrupted'; await linked.resume();
  assert.equal(linked.state, 'running');
  configure('enhanced');
  runtime.removeMedia(video);
  assert.equal(video.removed, false);
  assert.equal(linked.state, 'running');
  await assert.rejects(new FakeVideo().play(), { name: 'NotAllowedError' });
  await assert.rejects(unrelated.resume(), { name: 'NotAllowedError' });
});
}

test('a graph attached after manual video starts inherits only that player authorization', async t => {
  const { runtime, context, advance } = await nativeControlsFixture(t);
  const video = new FakeVideo();
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', composedPath: () => [video] });
  await video.play(); advance(16000);
  const linked = new context.AudioContext();
  assert.equal(linked.state, 'suspended');
  linked.createMediaElementSource(video);
  assert.equal(linked.state, 'running');
  assert.equal(runtime.hasUserAudioContext(linked), true);
  const unrelated = new context.AudioContext();
  unrelated.createMediaElementSource(new FakeVideo());
  assert.equal(unrelated.state, 'suspended');
});

test('weak context ownership preserves authorization and releases suspensions beyond the strong map limit', async t => {
  const { runtime, context, advance, configure } = await nativeControlsFixture(t);
  const video = new FakeVideo(), linked = new context.AudioContext();
  linked.createMediaElementSource(video);
  const automatic = Array.from({ length: 10 }, () => new context.AudioContext());
  assert.equal(runtime.pendingContexts.size, 8);
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', composedPath: () => [video] });
  await video.play(); advance(16000);
  assert.equal(linked.state, 'running', 'a weakly owned older context is still released');
  await linked.suspend(); await linked.resume();
  configure('standard', { active: false });
  assert.equal(automatic.every(audio => audio.state === 'running'), true, 'no forgotten clock remains frozen after disable');
  assert.equal(runtime.pendingContextRefs.size, 0);
  assert.equal(context.MediaElementAudioSourceNode, FakeMediaSource);
  assert.equal(FakeAudioContext.prototype.createMediaElementSource.name, 'createMediaElementSource');
});

test('manual playback survives off/on and runtime reinjection using inert weak document metadata', async t => {
  const { runtime, context, advance, configure } = await nativeControlsFixture(t);
  const video = new FakeVideo(), linked = new context.AudioContext();
  linked.createMediaElementSource(video);
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', composedPath: () => [video] });
  await video.play(); advance(16000);
  configure('standard', { active: false }); configure('standard');
  await video.play(); await linked.suspend(); await linked.resume();
  runtime.onDispose({ detail: runtime.token });
  assert.ok(context.window[Symbol.for('cosmic-gemini.no-autoplay.playback-session')]);
  vm.runInContext(await readFile(new URL('../extension/content/no-autoplay/no-autoplay-runtime.js', import.meta.url), 'utf8'), context);
  const next = context.window[Symbol.for('cosmic-gemini.no-autoplay.runtime')];
  assert.notEqual(next, runtime);
  next.onConfigure({ detail: JSON.stringify({ token: next.token, config: { active: true, mode: 'standard' } }) });
  await video.play(); linked.state = 'interrupted'; await linked.resume();
  assert.equal(linked.state, 'running');
  await assert.rejects(new FakeVideo().play(), { name: 'NotAllowedError' });
});

test('inactive cleanup discards denied HTML plays and retained hooks become direct native calls', async t => {
  const { runtime, context, document, configure } = await nativeControlsFixture(t);
  const video = new FakeVideo(), audio = new FakeAudio();
  const guardedPlay = FakeMedia.prototype.play, guardedResume = FakeAudioContext.prototype.resume;
  const guardedFactory = FakeAudioContext.prototype.createMediaElementSource;
  const retainedConstructor = context.AudioContext, retainedSource = context.MediaElementAudioSourceNode;
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
  await assert.rejects(audio.play(), { name: 'NotAllowedError' });
  const owned = new context.AudioContext(), unowned = new FakeAudioContext();
  await unowned.suspend();
  configure('standard', { active: false });
  assert.equal(video.played, 0); assert.equal(audio.played, 0, 'disabling does not replay previously denied requests');
  assert.equal(runtime.pendingVideo.size, 0); assert.equal(runtime.pendingAudio.size, 0);
  assert.equal(owned.resumed, 1, 'release only the suspension previously owned by this runtime');
  assert.equal(unowned.resumed, 0);
  const unexpected = () => { throw Error('inactive inspection'); };
  runtime.shouldBlockMedia = runtime.shouldBlockAudioContext = runtime.hasUserIntent = unexpected;
  runtime.bindMediaSource = unexpected; document.querySelectorAll = unexpected;
  runtime.blockMedia(video); runtime.removeMedia(document); runtime.stopInitialPlayback();
  runtime.onPlay({ get target() { unexpected(); } });
  runtime.onUserIntent({ isTrusted: true, composedPath: unexpected });
  await guardedPlay.call(video); await guardedResume.call(unowned);
  guardedFactory.call(unowned, video);
  new retainedConstructor(); new retainedSource(unowned, { mediaElement: video });
  assert.equal(video.played, 1); assert.equal(video.paused, 1, 'only the original blocked pause occurred');
  assert.equal(unowned.resumed, 1);
});

test('manual playback or deactivation restores only autoplay attributes removed by this runtime', async t => {
  const { runtime, configure } = await nativeControlsFixture(t);
  const manual = new FakeVideo(), blocked = new FakeVideo(), untouched = new FakeVideo();
  manual.attributes.add('autoplay'); blocked.attributes.add('autoplay');
  await assert.rejects(manual.play(), { name: 'NotAllowedError' });
  await assert.rejects(blocked.play(), { name: 'NotAllowedError' });
  assert.equal(manual.hasAttribute('autoplay'), false);
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', composedPath: () => [manual] });
  await manual.play();
  assert.equal(manual.hasAttribute('autoplay'), true);
  configure('standard', { active: false });
  assert.equal(blocked.hasAttribute('autoplay'), true);
  assert.equal(untouched.hasAttribute('autoplay'), false);
  assert.equal(runtime.autoplayAttributeRefs.size, 0);
  assert.equal(blocked.played, 0, 'native attribute restoration does not replay the rejected play call');
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

test('No Autoplay blocks automatic media, preserves direct play, and keeps video blocked when audio is allowed', async t => {
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
  t.after(() => runtime.onDispose({ detail: runtime.token }));
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
  const customControlVideo = new FakeVideo();
  customControlVideo.rect = { width: 640, height: 360 };
  document.querySelectorAll = () => [customControlVideo];
  runtime.onUserIntent({ isTrusted: true, type: 'pointerdown', target: playControl, composedPath: () => [playControl] });
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

function surfacePlayer(document, media) {
  const player = { localName: 'div', querySelectorAll: () => media,
    contains: node => media.includes(node), parentElement: document.body };
  for (const node of media) node.parentElement = player;
  const cover = { localName: 'div', className: 'large-glyph', getAttribute: () => '',
    hasAttribute: () => false, contains: () => false, querySelectorAll: () => [] };
  return { player, cover, path: () => [cover, player, document.body, document] };
}

test('an unlabelled player cover authorizes its visible media without page-wide playback permission', async t => {
  const { runtime, document, context, advance } = await nativeControlsFixture(t);
  document.body = {};
  const video = new FakeVideo(), hidden = new FakeAudio(), other = new FakeVideo();
  video.rect = other.rect = { left: 20, top: 20, right: 660, bottom: 380, width: 640, height: 360 };
  const { path } = surfacePlayer(document, [video, hidden]);
  runtime.onUserIntent({ type: 'pointerdown', isTrusted: true, button: 0, clientX: 200, clientY: 150, composedPath: path });
  assert.equal(runtime.hasRecentPlaybackIntent(), false);
  assert.equal(new context.AudioContext().suspended, 1, 'an unlinked audio context gains no permission');
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
  await assert.rejects(hidden.play(), { name: 'NotAllowedError' }, 'hidden companions wait for actual primary playback');
  runtime.onPlaybackStopped({ type: 'emptied', target: video, isTrusted: true });
  advance(2100);
  await video.play();
  await hidden.play();
  advance(16000);
  await video.play(); await hidden.play();
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
});

test('surface intent supports media created after the cover click, without a click-time subtree scan', async t => {
  const { runtime, document } = await nativeControlsFixture(t);
  document.body = {};
  const media = [], { path, player } = surfacePlayer(document, media);
  let scans = 0;
  player.querySelectorAll = () => { scans++; return media; };
  runtime.onUserIntent({ type: 'click', detail: 1, isTrusted: true, clientX: 30, clientY: 40, composedPath: path });
  assert.equal(scans, 0);
  const video = new FakeVideo(); video.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
  video.parentElement = player; media.push(video);
  await video.play(); assert.equal(video.played, 1);
});

for (const scenario of ['outside', 'ambiguous', 'link', 'synthetic', 'expired', 'root', 'off']) {
  test(`surface intent rejects ${scenario} activation`, async t => {
    const { runtime, document, advance } = await nativeControlsFixture(t);
    document.body = {};
    const video = new FakeVideo(); video.rect = { left: 20, top: 20, right: 660, bottom: 380, width: 640, height: 360 };
    const media = [video], { path, cover } = surfacePlayer(document, media);
    if (scenario === 'ambiguous') { const other = new FakeVideo(); other.rect = video.rect; media.push(other); }
    if (scenario === 'link') { cover.localName = 'a'; cover.getAttribute = name => name === 'href' ? '/elsewhere' : ''; }
    runtime.onUserIntent({ type: 'click', detail: 1, isTrusted: scenario !== 'synthetic',
      clientX: scenario === 'outside' ? 900 : 100, clientY: 100,
      composedPath: scenario === 'root' ? () => [cover, document.body, document] : path });
    if (scenario === 'expired') advance(15001);
    if (scenario === 'off') { runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) }); assert.equal(runtime.surfaceIntent, null); return; }
    await assert.rejects(video.play(), { name: 'NotAllowedError' });
  });
}

test('keyboard activation of an unlabelled overlay button is scoped to the media under its center', async t => {
  const { runtime, document } = await nativeControlsFixture(t);
  document.body = {};
  const video = new FakeVideo(); video.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
  const { path, cover } = surfacePlayer(document, [video]);
  cover.localName = 'button'; cover.getBoundingClientRect = () => ({ left: 280, top: 140, width: 80, height: 80 });
  runtime.onUserIntent({ type: 'keydown', key: 'Enter', isTrusted: true, composedPath: path });
  await video.play(); assert.equal(runtime.hasRecentPlaybackIntent(), false);
});


function explicitControl(label = 'Play') {
  return { localName: 'button', textContent: label, getAttribute: () => '',
    querySelectorAll: () => [], contains: () => false };
}

test('explicit local controls do not open a global HTML-media or Web Audio window', async t => {
  const { runtime, document, context } = await nativeControlsFixture(t);
  document.body = {};
  const video = new FakeVideo(), other = new FakeVideo();
  video.rect = { width: 640, height: 360 };
  const { player } = surfacePlayer(document, [video]), control = explicitControl();
  runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [control, player, document.body] });
  assert.equal(runtime.hasRecentPlaybackIntent(), false);
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
  assert.equal(new context.AudioContext().state, 'suspended');
  await video.play();
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
});

test('external controls honor ARIA media targets rather than nearby unrelated players', async t => {
  const { runtime, document } = await nativeControlsFixture(t);
  document.body = {};
  const target = new FakeVideo(), nearby = new FakeVideo();
  target.rect = nearby.rect = { width: 640, height: 360 };
  const { player } = surfacePlayer(document, [nearby]);
  const control = explicitControl('▶');
  control.getAttribute = name => name === 'aria-controls' ? 'target' : '';
  control.getRootNode = () => ({ getElementById: id => id === 'target' ? target : null });
  runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [control, player, document.body] });
  await assert.rejects(nearby.play(), { name: 'NotAllowedError' });
  await target.play();
});

test('labelled-by and play-glyph buttons support the document sole player without root authorization', async t => {
  const { runtime, document } = await nativeControlsFixture(t);
  document.body = {};
  for (const label of ['▶', 'labelled-by']) {
    const video = new FakeVideo(), other = new FakeVideo();
    video.rect = other.rect = { width: 640, height: 360 };
    video.parentElement = other.parentElement = document.body;
    const media = [video]; document.querySelectorAll = () => media;
    const control = explicitControl(label);
    if (label === 'labelled-by') {
      control.getAttribute = name => name === 'aria-labelledby' ? 'label' : '';
      control.getRootNode = () => ({ getElementById: () => ({ textContent: 'Play video' }) });
    }
    runtime.onUserIntent({ type: 'keydown', key: 'Enter', isTrusted: true, composedPath: () => [control, document.body] });
    media.push(other);
    await assert.rejects(other.play(), { name: 'NotAllowedError' });
    await video.play();
    assert.equal(runtime.authorizedPlayers.has(document.body), false);
  }
});

test('explicit local audio controls permit delayed hidden audio without releasing other media', async t => {
  const { runtime, document, advance } = await nativeControlsFixture(t);
  document.body = {};
  const audio = new FakeAudio(), other = new FakeAudio();
  const { player } = surfacePlayer(document, [audio]), control = explicitControl('Listen');
  runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [control, player, document.body] });
  advance(2100);
  await audio.play();
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
});

test('explicit controls cover late local creation and a late sole document player', async t => {
  const { runtime, document, advance } = await nativeControlsFixture(t);
  document.body = {};
  for (const local of [true, false]) {
    const media = [], { player } = surfacePlayer(document, media), control = explicitControl();
    document.querySelectorAll = () => media;
    runtime.onUserIntent({ type: 'click', isTrusted: true,
      composedPath: () => local ? [control, player, document.body] : [control, document.body] });
    advance(2100);
    const video = new FakeVideo(); video.rect = { width: 640, height: 360 };
    video.parentElement = local ? player : document.body; media.push(video);
    await video.play();
    await assert.rejects(new FakeVideo().play(), { name: 'NotAllowedError' });
  }
});

test('unplayed local intent does not authorize a newly inserted second visible media', async t => {
  const { runtime, document } = await nativeControlsFixture(t);
  document.body = {};
  const video = new FakeVideo(), other = new FakeVideo();
  video.rect = other.rect = { width: 640, height: 360 };
  const media = [video], { player } = surfacePlayer(document, media), control = explicitControl();
  runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [control, player, document.body] });
  other.parentElement = player; media.push(other);
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
  await video.play();
});

test('media-free controls authorize only one Web Audio context, including Enhanced mode', async t => {
  const { runtime, context, configure, advance } = await nativeControlsFixture(t);
  for (const mode of ['standard', 'enhanced']) {
    configure(mode);
    const control = explicitControl('Listen');
    runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [control] });
    const manual = new context.AudioContext(), other = new context.AudioContext();
    await manual.resume();
    await assert.rejects(other.resume(), { name: 'NotAllowedError' });
    await assert.rejects(new FakeVideo().play(), { name: 'NotAllowedError' });
    advance(2100);
    await manual.resume();
    assert.equal(manual.state, 'running');
  }
});

test('autoplay options and playback-rate controls never masquerade as play controls', async t => {
  const { runtime } = await nativeControlsFixture(t);
  for (const label of ['autoPlayButton', 'auto-play-toggle', 'playbackRate', '自动播放', '播放速度']) {
    const control = explicitControl(label); control.className = label;
    assert.equal(runtime.isPlaybackControl(control), false, label);
    runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [control] });
    await assert.rejects(new FakeVideo().play(), { name: 'NotAllowedError' });
  }
});


test('missing declared targets do not fall back to an unrelated sole video', async t => {
  const { runtime, document, advance } = await nativeControlsFixture(t);
  document.body = {};
  const other = new FakeVideo(); other.rect = { width: 640, height: 360 };
  document.querySelectorAll = () => [other];
  let target = null;
  const control = explicitControl();
  control.getAttribute = name => name === 'aria-controls' ? 'later' : '';
  control.getRootNode = () => ({ getElementById: () => target });
  runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [control, document.body] });
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
  advance(2100); target = new FakeAudio();
  await target.play();
  await assert.rejects(other.play(), { name: 'NotAllowedError' });
});

test('autoplay switches over a video do not inherit cover or ARIA playback intent', async t => {
  const { runtime, document } = await nativeControlsFixture(t);
  document.body = {};
  for (const kind of ['autoPlayButton', 'switch', 'playbackRate']) {
    const video = new FakeVideo(); video.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
    const { player } = surfacePlayer(document, [video]), control = explicitControl('Play');
    control.className = kind;
    control.getAttribute = name => name === 'aria-controls' ? 'video' : name === 'role' && kind === 'switch' ? 'switch' : '';
    control.getRootNode = () => ({ getElementById: () => video });
    runtime.onUserIntent({ type: 'click', detail: 1, clientX: 20, clientY: 20, isTrusted: true,
      composedPath: () => [control, player, document.body] });
    await assert.rejects(video.play(), { name: 'NotAllowedError' });
  }
});

test('inactive cleanup clears deferred control targets and audio-context choice', async t => {
  const { runtime, configure, context } = await nativeControlsFixture(t);
  runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [explicitControl('Listen')] });
  assert.ok(runtime.controlIntent);
  new context.AudioContext(); assert.ok(runtime.intentContext);
  configure('standard', { active: false });
  assert.equal(runtime.controlIntent, null); assert.equal(runtime.intentContext, null);
});


test('a closed audio context cannot consume a pending manual context selection', async t => {
  const { runtime, context } = await nativeControlsFixture(t);
  const closed = new context.AudioContext(); closed.state = 'closed';
  runtime.onUserIntent({ type: 'click', isTrusted: true, composedPath: () => [explicitControl('Listen')] });
  await assert.rejects(closed.resume(), { name: 'InvalidStateError' });
  const manual = new context.AudioContext(); await manual.resume();
  assert.equal(manual.state, 'running');
  await assert.rejects(new context.AudioContext().resume(), { name: 'NotAllowedError' });
});
