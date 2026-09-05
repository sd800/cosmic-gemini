import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { retryRead, retryReadUntil } from '../extension/shared/ui.js';

test('read retries can recover from transient failures', async () => {
  let attempts = 0;
  const result = await retryRead(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary read failure');
    return 'ready';
  }, [0, 0, 0]);

  assert.equal(result, 'ready');
  assert.equal(attempts, 3);
});

test('read retries preserve the final failure after the limit', async () => {
  let attempts = 0;
  await assert.rejects(retryRead(async () => {
    attempts += 1;
    throw new Error(`read failure ${attempts}`);
  }, [0, 0]), /read failure 2/);
  assert.equal(attempts, 2);
});

test('conditional read retries wait for a usable state without repeating mutations', async () => {
  const states = [{ active: false }, { active: false }, { active: true, count: 3 }];
  let attempts = 0;
  const result = await retryReadUntil(async () => {
    attempts += 1;
    return states.shift();
  }, value => value?.active === true, [0, 0, 0]);

  assert.deepEqual(result, { active: true, count: 3 });
  assert.equal(attempts, 3);
});

test('conditional read retries return the latest readable state when the condition stays pending', async () => {
  let attempts = 0;
  const result = await retryReadUntil(async () => {
    attempts += 1;
    return { active: false, attempt: attempts };
  }, value => value?.active === true, [0, 0]);

  assert.deepEqual(result, { active: false, attempt: 2 });
});

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

const popupSource = readFileSync(new URL('../extension/popup/popup.js', import.meta.url), 'utf8');
const imageSource = readFileSync(new URL('../extension/workspaces/image-download/image-download.js', import.meta.url), 'utf8');

function between(source, from, to) {
  return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
}

test('a late popup snapshot cannot switch controls back to the previously read tab', async () => {
  const old = deferred(); let reads = 0;
  const context = vm.createContext({
    send: async () => ++reads === 1 ? old.promise : { tab: { id: 2 }, state: { incognito: true } },
    render() {}, showView() {}, saveSettingsViewCache() {}
  });
  vm.runInContext(`let stateReadGeneration = 0, popupClosing = false, currentTab, state,
    videoSelectionTabId, videoPanelSignature, videoPickerActive, videoPanelRenderPending, viewMode = null;
    const selectedVideoCandidateIds = new Map();
    ${between(popupSource, 'async function reload(', 'async function reloadAfterAction(')}
    globalThis.ui = { reload, tab: () => currentTab };`, context);
  const pending = context.ui.reload(false);
  await context.ui.reload(false);
  old.resolve({ tab: { id: 1 }, state: {} }); await pending;
  assert.equal(context.ui.tab().id, 2);
});

test('a stopped image session cannot be revived by a late rescan response', async () => {
  const scan = deferred();
  const context = vm.createContext({
    send: async message => {
      if (message.type === 'UI_IMAGE_RESCAN') return scan.promise;
      if (message.type === 'UI_IMAGE_STOP') return { active: false };
      throw Error('readback unavailable');
    },
    renderState() {}, setStatus() {}, updateWorkspaceControls() {}, scheduleReload() {},
    retryRead: task => task(), retryReadUntil, t: key => key
  });
  vm.runInContext(`let state = { active: true, groups: [] }, stateReadGeneration = 0,
    scanActionGeneration = 0, scanPending = false, workspaceClosing = false;
    const sourceTabId = 7, workspaceView = 'page';
    ${between(imageSource, 'async function reload(', 'function updateWorkspaceControls(')}
    ${between(imageSource, 'async function stopSession(', '\nfor (const input of ')}
    globalThis.ui = { rescan, stopSession, state: () => state };`, context);
  const pending = context.ui.rescan(false);
  await context.ui.stopSession();
  assert.equal(context.ui.state().active, false);
  scan.resolve({ active: true, groups: [{ id: 'old' }] }); await pending;
  assert.equal(context.ui.state().active, false);
  assert.equal(context.ui.state().groups.length, 0);
});

test('stopping Image Download clears its busy status before background cleanup finishes', async () => {
  const stop = deferred(); const statuses = [];
  const context = vm.createContext({
    send: message => message.type === 'UI_IMAGE_STOP' ? stop.promise : Promise.resolve({ active: false }),
    renderState() {}, updateWorkspaceControls() {}, reloadAfterAction() {},
    setStatus(value, busy = false) { statuses.push({ value, busy }); },
    t: key => key
  });
  vm.runInContext(`let state = { active: true, status: 'scanning', groups: [] }, stateReadGeneration = 0,
    scanActionGeneration = 0, scanPending = true, workspaceClosing = false;
    const sourceTabId = 7, workspaceView = 'page';
    ${between(imageSource, 'async function stopSession(', '\nfor (const input of ')}
    globalThis.ui = { stopSession, state: () => state };`, context);
  const pending = context.ui.stopSession();
  assert.equal(context.ui.state().active, false);
  assert.deepEqual(statuses.at(-1), { value: 'imageSessionStopped', busy: false });
  stop.resolve({ active: false });
  await pending;
});

test('stopping Image Download from the Side Panel preserves it until the close transition begins', async () => {
  const messages = []; const root = { dataset: {} }; const statuses = [];
  const context = vm.createContext({
    root,
    send: async message => { messages.push(message); return { active: false }; },
    setTimeout(callback) { callback(); },
    matchMedia() { return { matches: false }; },
    updateWorkspaceControls() {},
    setStatus(value, busy = false) { statuses.push({ value, busy }); },
    t: key => key
  });
  vm.runInContext(`let state = { active: true, status: 'scanning', groups: [] }, stateReadGeneration = 0,
    scanActionGeneration = 0, scanPending = true, workspaceClosing = false;
    const sourceTabId = 7, workspaceView = 'side-panel';
    ${between(imageSource, 'async function stopSession(', '\nfor (const input of ')}
    globalThis.ui = { stopSession, closing: () => workspaceClosing };`, context);
  await context.ui.stopSession();
  await Promise.resolve();
  assert.deepEqual(messages.map(message => message.type), ['UI_IMAGE_STOP', 'UI_IMAGE_CLOSE_SIDE_PANEL']);
  assert.equal(messages[0].preserveWorkspace, true);
  assert.equal(context.ui.closing(), true);
  assert.equal(root.dataset.workspaceClosing, 'true');
  assert.deepEqual(statuses.at(-1), { value: 'imageSessionStopped', busy: false });
});

test('scheduled media-view reconnects do not reactivate a closed or hidden list', () => {
  for (const image of [false, true]) {
    const callbacks = []; const ports = []; const document = { hidden: false };
    const context = vm.createContext({
      document, setTimeout: callback => callbacks.push(callback), scheduleReload() {},
      chrome: { runtime: { connect() {
        const port = { postMessage() {}, disconnect() {},
          onMessage: { addListener() {} },
          onDisconnect: { addListener(callback) { port.disconnected = callback; } } };
        ports.push(port); return port;
      } } }
    });
    const setup = image
      ? `let workspaceClosing = false, viewPort, viewReconnectAttempts = 0; const sourceTabId = 7;
         ${between(imageSource, 'function setWorkspaceVisible(', 'function scheduleReload(')}
         globalThis.openView = () => setWorkspaceVisible(true);
         globalThis.leave = () => { document.hidden = true; };`
      : `let popupClosing = false, currentTab = { id: 7 }, videoViewPort, videoViewPortTabId,
           videoViewReconnectAttempts = 0, viewMode = 'video';
         ${between(popupSource, 'function setVideoViewVisible(', 'function scheduleReload(')}
         globalThis.openView = () => setVideoViewVisible(true);
         globalThis.leave = () => { viewMode = 'main'; };`;
    vm.runInContext(setup, context);
    context.openView(); ports[0].disconnected(); context.leave();
    for (const callback of callbacks) callback();
    assert.equal(ports.length, 1, image ? 'hidden image list' : 'closed video list');
  }
});
