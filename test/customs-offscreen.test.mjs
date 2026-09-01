import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomsOffscreenCoordinator } from '../extension/background/provinces/customs-offscreen.js';

test('Customs does not close its offscreen document while a new request is starting', async () => {
  const previousChrome = globalThis.chrome;
  let releaseStorage;
  let closeCalls = 0;
  globalThis.chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async () => ({ ok: true, result: { ready: true } })
    },
    storage: {
      session: {
        get: () => new Promise(resolve => { releaseStorage = resolve; })
      }
    },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => { closeCalls += 1; }
    }
  };
  try {
    const coordinator = createCustomsOffscreenCoordinator();
    const closing = coordinator.maybeClose();
    while (!releaseStorage) await Promise.resolve();
    const request = coordinator.sendVideo({ type: 'CG_VIDEO_DISCOVER_YOUTUBE' });
    releaseStorage({});
    await Promise.all([closing, request]);
    assert.equal(closeCalls, 0);
  } finally { globalThis.chrome = previousChrome; }
});

test('Customs retains a local artifact when session storage cannot track its Chrome download', async () => {
  const previousChrome = globalThis.chrome;
  let closeCalls = 0;
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`, getContexts: async () => [] },
    storage: { session: { get: async () => ({}) } },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => { closeCalls += 1; }
    }
  };
  try {
    const coordinator = createCustomsOffscreenCoordinator();
    coordinator.retainArtifact('artifact-1');
    await coordinator.maybeClose();
    assert.equal(closeCalls, 0);
    coordinator.releaseArtifact('artifact-1');
    await coordinator.maybeClose();
    assert.equal(closeCalls, 1);
  } finally { globalThis.chrome = previousChrome; }
});
