import assert from 'node:assert/strict';
import test from 'node:test';
import { equalJson } from '../extension/core/json-equal.js';
import { saveSettingsViewCache } from '../extension/core/settings-view-cache.js';
import { saveLocaleCache } from '../extension/core/locale.js';
import { normalizeSettings } from '../extension/core/config.js';
import { createContextSessionStorage } from '../extension/background/commissions/central-cc.js';
import { normalizeImageCandidate, mergeImageCandidate } from '../extension/core/image-download.js';
import { createImageDownloadProduct } from '../extension/background/products/customs/image-download.js';
import { classifyVideoResource, mergeVideoCandidate } from '../extension/core/video-download/video-download.js';

test('JSON comparison ignores object key order but preserves values and array order', () => {
  assert.equal(equalJson({ a: [1, 2], b: false }, { b: false, a: [1, 2] }), true);
  for (const value of [{ a: [2, 1], b: false }, { a: [1, 2], b: true }, { a: [] }, [1, 2]])
    assert.equal(equalJson({ a: [1, 2], b: false }, value), false);
  assert.equal(equalJson([], Array(2)), false);
});

test('unchanged Settings snapshots and locale avoid repeat disk-cache writes, including after cache deletion', () => {
  const values = new Map(); let writes = 0;
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { writes++; values.set(key, value); } };
  const states = normalizeSettings();
  saveSettingsViewCache(states, storage); saveSettingsViewCache(structuredClone(states), storage);
  saveSettingsViewCache({ ...states, runtimeActivity: true }, storage);
  assert.equal(writes, 1);
  states.whiteSofter.enabled = true; saveSettingsViewCache(states, storage); assert.equal(writes, 2);
  values.clear(); saveSettingsViewCache(states, storage); assert.equal(writes, 3);
  saveLocaleCache('en-US', storage); saveLocaleCache('en-US', storage); assert.equal(writes, 4);
  saveLocaleCache('zh-CN', storage); assert.equal(writes, 5);
});

test('session key enumeration does not read unrelated media payloads or cross privacy contexts', async t => {
  const previous = globalThis.chrome; t.after(() => { globalThis.chrome = previous; });
  const data = { 'tabActivity:7': { nativeScroll: true }, 'imageDownloadSession:7': { id: 7 },
    'videoDownloadSession:7': { marker: 'unrelated' }, 'cosmicGeminiPrivate:imageDownloadSession:8': { id: 8 } };
  const requests = [];
  globalThis.chrome = { storage: { session: {
    getKeys: async () => Object.keys(data),
    async get(keys) { requests.push(keys); assert.notEqual(keys, null); return Object.fromEntries(keys.map(key => [key, data[key]])); }
  } } };
  const ordinary = createContextSessionStorage(false), privateStore = createContextSessionStorage(true);
  assert.deepEqual(await ordinary.keys('tabActivity:'), ['tabActivity:7']); assert.equal(requests.length, 0);
  assert.deepEqual(await ordinary.getByPrefix('imageDownloadSession:'), { 'imageDownloadSession:7': { id: 7 } });
  assert.deepEqual(requests, [['imageDownloadSession:7']]);
  assert.deepEqual(await privateStore.getByPrefix('imageDownloadSession:'), { 'imageDownloadSession:8': { id: 8 } });
  assert.deepEqual(requests[1], ['cosmicGeminiPrivate:imageDownloadSession:8']);
  delete chrome.storage.session.getKeys; let fallbackReads = 0;
  chrome.storage.session.get = async key => { assert.equal(key, null); fallbackReads++; return data; };
  assert.deepEqual(await ordinary.getByPrefix('imageDownloadSession:'), { 'imageDownloadSession:7': { id: 7 } });
  assert.equal(fallbackReads, 1, 'older Chrome uses one original broad read rather than two');
});

test('duplicate media facts reuse existing records while richer metadata still replaces them', () => {
  const image = normalizeImageCandidate({ url: 'https://media.test/a.jpg', width: 120, height: 100, discoveredAt: 1 });
  assert.equal(mergeImageCandidate(image, { ...image, discoveredAt: 5 }), image);
  assert.notEqual(mergeImageCandidate(image, { ...image, width: 240 }), image);
  let video = classifyVideoResource({ url: 'https://media.test/a.mp4', width: 120, height: 100 });
  video = mergeVideoCandidate(video, video); // canonical optional fields
  assert.equal(mergeVideoCandidate(video, { ...video }), video);
  assert.notEqual(mergeVideoCandidate(video, { ...video, width: 240 }), video);
});

test('duplicate image network batches do not rewrite sessions; better file metadata still persists', async t => {
  const previous = globalThis.chrome;
  const candidate = normalizeImageCandidate({ url: 'https://media.test/a.jpg', mime: 'image/jpeg', source: 'network', originalHint: 1, contentLength: 1024, discoveredAt: 1 });
  const data = { 'imageDownloadSession:7': { active: true, tabId: 7, origin: 'https://page.test', pageUrl: 'https://page.test/',
    status: 'found', candidates: [candidate] } };
  let writes = 0;
  globalThis.chrome = { storage: { session: {
    getKeys: async () => Object.keys(data),
    async get(keys) { const names = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return structuredClone(Object.fromEntries(names.filter(key => key in data).map(key => [key, data[key]]))); },
    async set(values) { writes++; Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; }
  } }, tabs: { query: async () => [{ id: 7, url: 'https://page.test/' }] }, alarms: { clear: async () => {} } };
  const product = createImageDownloadProduct({ isIncognitoContext: () => false, setFeatureActivity: async () => {}, notifyCentralUi() {} },
    { maybeClose: async () => {} }, { setCollecting() {} });
  t.after(async () => { await product.handleTabRemoved(7); globalThis.chrome = previous; });
  const report = size => product.handleHeadersReceived({ tabId: 7, type: 'image', url: candidate.url,
    responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }, { name: 'Content-Length', value: String(size) }] });
  await Promise.all([report(1024), report(1024), report(1024)]);
  await new Promise(done => setTimeout(done, 180)); assert.equal(writes, 0);
  await report(2048);
  await new Promise(done => setTimeout(done, 180)); assert.equal(writes, 1);
  assert.equal(data['imageDownloadSession:7'].candidates[0].contentLength, 2048);
});

test('an unavailable localStorage getter does not block optional UI caching', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('storage unavailable'); } });
  assert.doesNotThrow(() => saveLocaleCache('en-US'));
  assert.doesNotThrow(() => saveSettingsViewCache(normalizeSettings()));
});
