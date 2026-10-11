import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { instagramProfileUrl, instagramRoute } from '../extension/core/follow-list-instagram.js';
import { retryReadUntil } from '../extension/shared/ui.js';

// Exercise the shipped controllers with controlled replies/lifecycle events;
// rendering primitives are minimal, and no account/download operation is real.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Element {
  constructor() { this.dataset = {}; this.children = []; this.events = {}; this.value = ''; this.textContent = '';
    this.isConnected = true; this.classList = { add() {} }; }
  addEventListener(type, fn) { this.events[type] = fn; }
  setAttribute() {}
  removeAttribute() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
function surface(path) {
  const nodes = new Map(), listeners = new Map(), timers = new Map(), ports = [], calls = [];
  let nextTimer = 0, transport = async () => ({}), tabRead = async () => ({ url: 'https://www.instagram.com/example/' });
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const document = {
    documentElement: node('root'), body: node('body'), hidden: false,
    querySelector: node,
    querySelectorAll: selector => selector.startsWith('#') ? selector.split(',').map(key => node(key.trim())) : [],
    createElement: () => new Element(), createTextNode: text => ({ textContent: text }), addEventListener() {}
  };
  const on = (type, fn) => listeners.set(type, fn);
  const runtime = { connect() {
    const port = { onMessage: { addListener(fn) { port.receive = fn; } },
      onDisconnect: { addListener(fn) { port.onClose = fn; } }, postMessage() {},
      disconnect() { port.disconnected = true; port.onClose?.(); } };
    ports.push(port); return port;
  } };
  const timeout = (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; };
  const context = vm.createContext({ document, window: { addEventListener: on }, addEventListener: on,
    chrome: { runtime, tabs: { get: () => tabRead(), onUpdated: { addListener() {} }, onRemoved: { addListener() {} } } },
    location: { href: `chrome-extension://test/${path}?sourceTab=7` }, URL, console,
    setTimeout: timeout, clearTimeout: id => timers.delete(id), setInterval: timeout, clearInterval: id => timers.delete(id),
    cancelAnimationFrame() {}, loadLocale: async () => 'en-US', translator: () => key => key,
    localizeDocument() {}, icon: () => '', instagramProfileUrl, instagramRoute,
    formatImageBytes: () => '',
    send: message => { calls.push(message); return transport(message); }, retryRead: task => task(), retryReadUntil
  });
  return { context, document, node, ports, calls,
    source: readFileSync(new URL(`../extension/${path}`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''),
    fire: (type, value = {}) => listeners.get(type)?.(value),
    setTransport: fn => { transport = fn; }, setTabRead: fn => { tabRead = fn; },
    async tick(ms) {
      for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); }
      for (let i = 0; i < 12; i++) await Promise.resolve();
    }
  };
}
function imageSurface() {
  const f = surface('workspaces/image-download/image-download.js');
  const prefix = f.source.slice(0, f.source.indexOf("\nfor (const input of document.querySelectorAll('#search,"));
  const suspend = f.source.slice(f.source.indexOf('\nfunction suspendWorkspace()'));
  vm.runInContext(prefix + suspend + `
    renderState = () => {};
    updateSelectionBar = () => { document.querySelector('#download-selected').disabled = downloadPending; };
    globalThis.api = { rescan, stopSession, reload, loadInitialSession, scheduleReload, runWorkspaceAction, download, createCard,
      set(value) { state = value; }, get state() { return state; },
      get metadata() { return pendingMetadata; }, get failures() { return failedCandidates; },
      get scanPending() { return scanPending; }, get downloadPending() { return downloadPending; } };
  `, f.context);
  f.api = f.context.api; f.api.set({ active: true, status: 'complete', groups: [] });
  return f;
}
test('Image Download stop/restart owns its scan lock and ignores the previous failure', async () => {
  const f = imageSurface(), old = deferred(), fresh = deferred();
  let scans = 0;
  f.setTransport(message => message.type === 'UI_IMAGE_RESCAN' ? (++scans === 1 ? old.promise : fresh.promise) : Promise.resolve({}));
  const first = f.api.rescan(false);
  await f.api.stopSession();
  f.api.set({ active: true, status: 'complete', groups: [] });
  const second = f.api.rescan(true);
  old.reject(Error('old scan')); await first;
  assert.equal(f.api.scanPending, true);
  assert.equal(f.node('#status-text').textContent, 'imageDeepScanning');
  fresh.resolve({ active: true, status: 'complete', groups: [] }); await second;
  assert.equal(f.api.scanPending, false);
});
test('Image Download history restoration rejects old action unlocks and download notices', async () => {
  const f = imageSurface(), old = deferred(), newer = deferred(), oldDownload = deferred();
  const button = f.node('#capture-area');
  const first = f.api.runWorkspaceAction(button, () => old.promise);
  f.setTransport(() => oldDownload.promise);
  const downloading = f.api.download([{ groupId: 'test', candidateId: 'test' }]);
  f.fire('pagehide'); f.fire('pageshow', { persisted: true });
  const second = f.api.runWorkspaceAction(button, () => newer.promise);
  old.reject(Error('old capture')); oldDownload.resolve({});
  await Promise.all([first, downloading]);
  assert.equal(button.disabled, true, 'old action cannot release the restored action lock');
  assert.notEqual(f.node('#status-text').textContent, 'imageDownloadStarted');
  newer.resolve(); await second;
  assert.equal(button.disabled, false);
});
test('Image Download defers a scheduled state read while its workspace is hidden', async () => {
  const f = imageSurface();
  f.api.scheduleReload(); f.document.hidden = true; await f.tick(100);
  assert.equal(f.calls.length, 0);
  f.document.hidden = false; f.api.scheduleReload(); await f.tick(100);
  assert.equal(f.calls[0].type, 'UI_IMAGE_STATE');
});
test('an initial Image Download handoff cannot retry into a restored workspace', async () => {
  const f = imageSurface(), old = deferred(); f.setTransport(() => old.promise);
  const initial = f.api.loadInitialSession();
  f.fire('pagehide'); f.fire('pageshow', { persisted: true });
  old.resolve({ active: false }); await initial;
  assert.equal(f.calls.length, 1);
  assert.equal(f.api.state.active, true, 'the restored view retains its own state until fresh readback');
});
test('retired Image Download cards cannot publish metadata or poison restored candidates', () => {
  const f = imageSurface(), candidate = { id: 'one', url: 'https://example.com/a.png', width: 1, height: 1 };
  const group = { id: 'one', recommended: candidate, candidates: [candidate] };
  const card = f.api.createCard(group, 0), image = card.children[0].children[0];
  image.naturalWidth = image.naturalHeight = 2;
  image.events.load(); assert.equal(f.api.metadata.size, 1);
  f.fire('pagehide'); f.fire('pageshow', { persisted: true });
  image.events.load(); image.events.error();
  assert.equal(f.api.metadata.size, 0); assert.equal(f.api.failures.size, 0);
  const restored = f.api.createCard(group, 0).children[0].children[0];
  restored.naturalWidth = restored.naturalHeight = 2; restored.events.load();
  assert.equal(f.api.metadata.size, 1, 'restoration may send metadata cleared before its original flush');
});

const igSnapshot = (revision = 1, extra = {}) => ({ runId: 'run', revision, status: 'complete',
  ownProfile: true, profile: { username: 'example', following: 1, followers: 0 },
  groups: { notFollowingBack: [{ id: 'one', username: 'one', name: '' }], mutual: [], followersOnly: [] }, ...extra });
async function instagramSurface() {
  const f = surface('workspaces/follow-list-instagram/follow-list-instagram.js');
  const prefix = f.source.slice(0, f.source.indexOf("\n$('#refresh').addEventListener"));
  await vm.runInContext(`(async () => { ${prefix}
    sourceUsername = 'example';
    globalThis.api = { begin, stop, receive, pollUnfollowConfirmation, clearResults,
      get snapshot() { return snapshot; }, get attaching() { return attaching; }, get writing() { return writing; } };
  })()`, f.context);
  f.api = f.context.api; return f;
}
test('Instagram invalidates a delayed source lookup without blocking the next scan', async () => {
  const f = await instagramSurface(), old = deferred(), fresh = deferred();
  f.setTabRead(() => old.promise);
  const first = f.api.begin(); f.api.stop('igStopped', false);
  f.setTabRead(() => fresh.promise);
  const second = f.api.begin();
  old.resolve({ url: 'https://www.instagram.com/example/' }); await first;
  assert.equal(f.api.attaching, true);
  assert.equal(f.calls.length, 0, 'the old lookup cannot start a scan');
  fresh.resolve({ url: 'https://www.instagram.com/example/' }); await second;
  assert.equal(f.calls.filter(call => call.type === 'UI_IG_BEGIN').length, 1);
});
test('Instagram retains initial error snapshots that have no readable profile', async () => {
  const f = await instagramSurface();
  f.setTransport(async () => ({ runId: 'run', revision: 1, status: 'error', error: 'igUnavailable', profile: null }));
  await f.api.begin();
  assert.equal(f.api.snapshot.status, 'error');
  assert.equal(f.node('#status').dataset.error, 'true');
});
test('closing the Instagram sidebar ends foreground confirmation polling without stopping the scan', async () => {
  const f = await instagramSurface();
  f.api.receive(igSnapshot(1, { pendingUnfollowId: 'one' }));
  f.fire('pagehide'); await f.tick(1000);
  await f.api.begin(); f.api.receive(igSnapshot(9));
  assert.equal(f.calls.length, 0, 'closing must not check confirmation or send UI_IG_STOP');
  assert.equal(f.api.snapshot.revision, 1, 'closed surfaces ignore push snapshots');
});
test('an older Instagram confirmation response cannot replace a newer pushed result', async () => {
  const f = await instagramSurface(), old = deferred();
  f.api.receive(igSnapshot());
  f.setTransport(() => old.promise);
  const action = f.node('#accounts').children[0].children[1].events.click();
  f.api.receive(igSnapshot(5, { unfollowedIds: ['one'] }));
  old.resolve({ state: igSnapshot(2, { pendingUnfollowId: 'one' }), result: 'waiting' }); await action;
  assert.equal(f.api.snapshot.revision, 5);
  assert.equal(f.node('#accounts').children[0].children[1].disabled, true);
});
test('Instagram run replacement retains ownership when an old clear finishes', async () => {
  const f = await instagramSurface(), old = deferred(), fresh = deferred();
  f.api.receive(igSnapshot()); f.setTransport(() => old.promise);
  const first = f.api.clearResults('UI_IG_CLEAR_CURRENT', 'igClearedCurrent');
  f.api.receive(igSnapshot(1, { runId: 'new' })); f.setTransport(() => fresh.promise);
  const second = f.api.clearResults('UI_IG_CLEAR_CURRENT', 'igClearedCurrent');
  old.resolve(); await first;
  assert.equal(f.api.writing, true);
  assert.equal(f.api.snapshot.runId, 'new');
  fresh.resolve(); await second;
  assert.equal(f.api.writing, false);
});
test('cleared Instagram results cannot be revived by a queued snapshot from that run', async () => {
  const f = await instagramSurface(); f.api.receive(igSnapshot());
  await f.api.clearResults('UI_IG_CLEAR_CURRENT', 'igClearedCurrent');
  f.api.receive(igSnapshot(9));
  assert.equal(f.api.snapshot, null);
  assert.equal(f.node('#status').textContent, 'igClearedCurrent');
});

test('popup closes subscriptions before initialization and suppresses delayed actions', async () => {
  const f = surface('popup/popup.js');
  const prefix = f.source.slice(0, f.source.indexOf("\nfor (const featureId of ['nativeScroll', 'noAutoplay'])"));
  vm.runInContext(prefix + `
    t = key => key; render = () => {};
    currentTab = { id: 7 }; viewMode = 'video';
    globalThis.api = { reload, perform, connectCentralUi, setVideoViewVisible };
  `, f.context);
  const api = f.context.api, old = deferred();
  api.connectCentralUi(); api.setVideoViewVisible(true);
  const acting = api.perform(() => old.promise, true);
  f.fire('pagehide'); old.reject(Error('closed')); await acting;
  assert.equal(f.ports.every(port => port.disconnected), true);
  assert.equal(f.node('#live').textContent, '');
  await api.reload(); await api.perform(() => assert.fail('no action after popup close'));
  assert.equal(f.calls.length, 0);
});
