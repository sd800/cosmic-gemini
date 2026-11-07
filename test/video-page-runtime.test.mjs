import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function fixture(t, { smallBudget = false, ...globals } = {}) {
  const messages = [];
  const context = vm.createContext({
    URL, Uint8Array, TextDecoder, btoa, location: { href: 'https://example.test/', origin: 'https://example.test' },
    document: { scripts: [], baseURI: 'https://example.test/', title: 'Video' },
    XMLHttpRequest: class { open() {} send() {} }, fetch() {},
    EventTarget: class { addEventListener(...args) { this.addEventListener(...args); } },
    addEventListener() {}, removeEventListener() {}, postMessage: value => messages.push(value), ...globals
  });
  let source = await readFile(new URL('../extension/content/video-download/video-download-page.js', import.meta.url), 'utf8');
  if (smallBudget) source = source.replace('const MAX_TEXT_LENGTH = 12 * 1024 * 1024;', 'const MAX_TEXT_LENGTH = 64;');
  vm.runInContext(source, context);
  const runtime = vm.runInContext("globalThis[Symbol.for('cosmic-gemini.video-download.page-runtime')]", context);
  t.after(() => runtime.stop());
  return { runtime, context, messages };
}

test('page-state discovery finds nested videos and inline playlists without serializing the whole object', async t => {
  const state = { clip: { url: 'https://media.test/video.mp4' },
    playlist: '#EXTM3U\n#EXTINF:1,\nhttps://media.test/segment.ts\n#EXT-X-ENDLIST',
    toJSON() { throw new Error('whole-state serialization must not be needed'); } };
  state.cycle = state;
  const { messages } = await fixture(t, { __NEXT_DATA__: state });
  assert.ok(messages.some(message => message.candidates?.some(candidate => candidate.url === state.clip.url)));
  assert.ok(messages.some(message => message.manifests?.some(manifest => manifest.manifestText.includes('#EXTM3U'))));
});

test('response inspection reads one clone, keeps original bytes readable, and forwards HLS data', async t => {
  const { runtime, messages } = await fixture(t);
  const text = '#EXTM3U\n#EXTINF:1,\nhttps://media.test/clip.mp4\n#EXT-X-ENDLIST';
  const response = new Response(text, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  Object.defineProperty(response, 'url', { value: 'https://media.test/list.m3u8' });
  let clones = 0;
  const clone = response.clone.bind(response);
  response.clone = () => { clones++; return clone(); };
  await runtime.inspectResponse(response);
  assert.equal(clones, 1);
  assert.equal(await response.text(), text);
  const wrapped = messages.find(message => message.type === 'wrapped-manifest');
  assert.equal(Buffer.from(wrapped.data, 'base64').toString(), text);
  assert.ok(messages.some(message => message.type === 'manifests'));
  assert.equal(runtime.responseReaders.size, 0);
});

test('native JSON XHR discovery reuses the parsed object and preserves playlist base URLs', async t => {
  class Request {
    open() {} send() {}
    addEventListener(_type, callback) { this.onLoad = callback; }
    getResponseHeader() { return 'application/json'; }
  }
  const { messages } = await fixture(t, { XMLHttpRequest: Request });
  const request = new Request();
  request.responseType = 'json'; request.responseURL = 'https://media.test/api/playlist';
  request.response = { video: { url: 'https://media.test/clip.mp4' },
    playlist: '#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST',
    toJSON() { throw new Error('no serialization'); } };
  request.open('GET', request.responseURL); request.send(); request.onLoad();
  assert.ok(messages.some(message => message.candidates?.some(candidate => candidate.url === request.response.video.url)));
  assert.ok(messages.some(message => message.manifests?.some(manifest => manifest.baseUrl === request.responseURL)));
});

test('unknown-length response reads stop at their byte budget without waiting on tee cancellation', async t => {
  const { runtime } = await fixture(t, { smallBudget: true });
  let reads = 0, cancels = 0;
  const reader = { async read() { reads++; return { value: new Uint8Array(32), done: false }; },
    cancel() { cancels++; return new Promise(() => {}); }, releaseLock() {} };
  assert.equal(await runtime.readResponse({ clone: () => ({ body: { getReader: () => reader } }) }), null);
  assert.equal(reads, 3);
  assert.equal(cancels, 1);
  assert.equal(runtime.responseReaders.size, 0);
});

test('stopping discovery cancels pending clone reads and avoids late text processing', async t => {
  const { runtime, messages } = await fixture(t);
  const before = messages.length;
  let finish, cancelled = false;
  const reader = { read: () => new Promise(resolve => { finish = resolve; }),
    cancel() { cancelled = true; finish({ done: true }); return Promise.resolve(); }, releaseLock() {} };
  const pending = runtime.inspectResponse({ url: 'https://media.test/data.json', headers: { get: () => 'application/json' },
    clone: () => ({ body: { getReader: () => reader } }) });
  runtime.stop();
  await pending;
  assert.equal(cancelled, true);
  assert.equal(runtime.responseReaders.size, 0);
  assert.equal(messages.length, before);
});

test('a queued scan message cannot revive a stopped page runtime', async t => {
  const { runtime, context, messages } = await fixture(t);
  runtime.stop();
  const count = messages.length;
  context.runtime = runtime;
  vm.runInContext("runtime.onMessage({source:globalThis,data:{marker:'cosmic-gemini-video-download',type:'scan'}})", context);
  assert.equal(runtime.active, false);
  assert.equal(messages.length, count);
});
