import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomsOffscreenCoordinator } from '../extension/background/provinces/customs-offscreen.js';

test('Customs does not close its offscreen document while a new request is starting', async () => {
  const previousChrome = globalThis.chrome;
  let releaseStorage;
  let closeCalls = 0;
  let keepAliveCalls = 0;
  globalThis.chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      getContexts: async () => [{documentUrl:"chrome-extension://test/offscreen/video-download.html"}],
      getPlatformInfo: async () => { keepAliveCalls += 1; },
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
    assert.equal(keepAliveCalls, 1);
  } finally { globalThis.chrome = previousChrome; }
});

test('Customs retains a local artifact when session storage cannot track its Chrome download', async () => {
  const previousChrome = globalThis.chrome;
  let closeCalls = 0;
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ok:true,retained:false}), getURL: path => `chrome-extension://test/${path}`, getContexts: async () => [{documentUrl:"chrome-extension://test/offscreen/video-download.html"}] },
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

test('Customs retains a newly created artifact before an offscreen request releases its keepalive', async () => {
  const previousChrome = globalThis.chrome;
  let closeCalls = 0;
  globalThis.chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      getContexts: async () => [{documentUrl:"chrome-extension://test/offscreen/video-download.html"}],
      sendMessage: async () => ({ ok: true, result: { artifactId: 'artifact-handoff', url: 'blob:test' } })
    },
    storage: { session: { get: async () => ({}) } },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => { closeCalls += 1; }
    }
  };
  try {
    const coordinator = createCustomsOffscreenCoordinator();
    const artifact = await coordinator.sendImageArtifact({ type: 'CG_IMAGE_FETCH' });
    await coordinator.maybeClose();
    assert.equal(artifact.artifactId, 'artifact-handoff');
    assert.equal(closeCalls, 0);
    coordinator.releaseArtifact(artifact.artifactId);
    await coordinator.maybeClose();
    assert.equal(closeCalls, 1);
  } finally { globalThis.chrome = previousChrome; }
});

test('optional offscreen cleanup does not fail a completed product action', async () => {
  const previousChrome = globalThis.chrome;
  let closeCalls = 0;
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ok:true,retained:false}), getURL: path => `chrome-extension://test/${path}`, getContexts: async () => [{documentUrl:"chrome-extension://test/offscreen/video-download.html"}] },
    storage: { session: { get: async () => { throw new Error('temporary storage failure'); } } },
    offscreen: { closeDocument: async () => { closeCalls += 1; } }
  };
  try {
    const coordinator = createCustomsOffscreenCoordinator();
    await coordinator.maybeClose();
    assert.equal(closeCalls, 0);
  } finally { globalThis.chrome = previousChrome; }
});

test('Customs cleanup preserves Document Preview memory until its cache is cleared', async () => {
  const previousChrome = globalThis.chrome;
  let retained = true, closes = 0;
  globalThis.chrome = {
    runtime: {
      getURL: path => 'chrome-extension://test/' + path,
      getContexts: async () => [{documentUrl:'chrome-extension://test/offscreen/video-download.html'}],
      sendMessage: async message => {
        assert.equal(message.target,'offscreen-resource-status'); return {ok:true,retained};
      }
    },
    storage:{session:{get:async()=>({})}},
    offscreen:{closeDocument:async()=>{closes++;}}
  };
  try {
    const coordinator=createCustomsOffscreenCoordinator();
    await coordinator.maybeClose();assert.equal(closes,0);
    retained=false;await coordinator.maybeClose();assert.equal(closes,1);
  } finally {globalThis.chrome=previousChrome;}
});

test('offscreen processing accepts only Central, not content scripts or extension workspaces', async () => {
  const {isProcessorSender} = await import('../extension/offscreen/security.js');
  const runtime = {id:'test',getURL:path=>'chrome-extension://test/'+path};
  assert.equal(isProcessorSender({id:'test',url:runtime.getURL('background/central.js')},runtime),true);
  for(const sender of [null,{}, {id:'other',url:runtime.getURL('background/central.js')}, ...['settings/satellites.html','workspaces/document-preview/document-preview.html','background/central.js#fake'].map(path=>({id:'test',url:runtime.getURL(path)})),{id:'test',url:'https://example.com/'}]) {
    assert.equal(isProcessorSender(sender,runtime),false);
  }
});

test('media byte limits cancel oversized streams even without a trustworthy content length', async () => {
  const {readBoundedBytes}=await import('../extension/offscreen/security.js');
  assert.deepEqual([...await readBoundedBytes(new Response(new Uint8Array([1,2,3])),3)],[1,2,3]);
  let cancelled=false;
  const response=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}}),{headers:{'content-length':'1'}});
  await assert.rejects(readBoundedBytes(response,6),/size limit/);assert.equal(cancelled,true);
  await assert.rejects(readBoundedBytes(new Response('large',{headers:{'content-length':'999'}}),6),/size limit/);
});
