import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { spreadsheetEntries, presentationEntries, darkPresentationEntries, samplePdf } from './fixtures/office-formats.mjs';
import { formattingEntries, readingEntries } from './fixtures/document-formatting.mjs';
import { acceptedStyles, formatStylesheet } from '../extension/workspaces/document-preview/format-styles.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { formatDocumentBytes, inspectOffice, validateOfficeContent, documentFilename, documentKind, DOCUMENT_TYPES, readDocumentResponse, DOCUMENT_LIMIT, DOCUMENT_CLOSED_RETENTION, DOCUMENT_CLEANUP_ALARM_PREFIX } from '../extension/core/document-preview/document-preview.js';
import { siteKey } from '../extension/core/site-key.js';
import { DOCUMENT_PREVIEW_PATH } from '../extension/core/document-preview/document-preview.js';
import { createDocumentRequestIngress } from '../extension/background/features/document-request-ingress.js';
import { createDocumentPreviewProduct } from '../extension/background/products/customs/document-preview.js';
import { createCustomsProvince } from '../extension/background/provinces/customs.js';
import { createDocumentStatus } from '../extension/workspaces/document-preview/status.js';
import { documentStyles } from '../extension/workspaces/document-preview/sanitize.js';
import { createDocumentContent } from '../extension/workspaces/document-preview/content-host.js';

test('presentation bridge preserves pending selection and zoom and ignores stale or invalid slide feedback', () => {
  const OriginalChannel = globalThis.MessageChannel, sent = [], selected = [], errors = [];
  let channel, initialize;
  globalThis.MessageChannel = class {
    constructor() { channel = this; this.port1 = {postMessage: value => sent.push(structuredClone(value)), close() {}}; this.port2 = {}; }
  };
  const frame = {style:{colorScheme:'dark'}, addEventListener(type, listener) { initialize = listener; },
    contentWindow:{postMessage() {}}, removeAttribute() {}};
  const reader = createDocumentContent(frame, 'en-US', () => errors.push(true), index => selected.push(index));
  try {
    reader.renderSlides([{html:'one'},{html:'two'}], {kind:'pptx'}, 'Slide');
    reader.selectSlide(1); reader.setZoom(1.3); initialize();
    channel.port1.onmessage({data:{type:'ready'}});
    const first = sent.at(-1);
    assert.equal(first.type, 'slides'); assert.equal(first.index, 1); assert.equal(first.zoom, 1.3);
    channel.port1.onmessage({data:{type:'slide',id:first.id,index:1}});
    channel.port1.onmessage({data:{type:'slide',id:first.id,index:2}});
    channel.port1.onmessage({data:{type:'slide',id:first.id,index:.5}});
    assert.deepEqual(selected, [1]);
    reader.render('<p>Word document</p>', {});
    channel.port1.onmessage({data:{type:'slide',id:first.id,index:0}});
    channel.port1.onmessage({data:{type:'error',id:first.id}});
    assert.deepEqual(selected, [1]); assert.deepEqual(errors, []);
    assert.equal(frame.style.visibility, 'hidden');
    channel.port1.onmessage({data:{type:'rendered',id:sent.at(-1).id}});
    assert.equal(frame.style.visibility, 'visible');
    reader.destroy();
    const count = sent.length;
    reader.selectSlide(0); reader.setZoom(2); reader.renderSlides([{html:'late'}], {kind:'pptx'}, 'Slide');
    assert.equal(sent.length, count);
  } finally { reader.destroy(); globalThis.MessageChannel = OriginalChannel; }
});

export function storedZip(entries, compress = false) {
  let offset = 0;
  const locals = [], directory = [];
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name), data = Buffer.from(text);
    const packed = compress ? deflateRawSync(data) : data;
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    locals.push(local, n, packed);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, n); offset += local.length + n.length + packed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22), count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const value = Buffer.concat([...locals, dir, end]);
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}
export const sampleDocx = () => storedZip({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>文档预览 Document Preview</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
});

test('Document Preview uses curated eTLD+1 rules, including IDNs, wildcards and exact IP fallbacks', () => {
  assert.equal(siteKey('https://www.rsj.sh.gov.cn/path'), 'sh.gov.cn');
  assert.equal(siteKey('https://a.b.example.co.uk/'), 'example.co.uk');
  assert.equal(siteKey('https://docs.alice.github.io/'), 'alice.github.io');
  assert.equal(siteKey('https://alice.github.io/'), 'alice.github.io');
  assert.equal(siteKey('https://bob.github.io/'), 'bob.github.io');
  assert.equal(siteKey('https://a.b.ck/'), 'a.b.ck');
  assert.equal(siteKey('https://a.www.ck/'), 'www.ck');
  assert.equal(siteKey('https://a.示例.公司.cn/'), new URL('https://示例.公司.cn/').hostname);
  assert.equal(siteKey('http://127.0.0.1:1234/'), '127.0.0.1');
  assert.equal(siteKey('http://[::1]:1234/'), '[::1]');
  assert.equal(siteKey('chrome-extension://id/'), '');
});

test('DOCX preflight bounds file size, ZIP entries and inflated data and rejects other formats', async () => {
  assert.equal(inspectOffice(sampleDocx()).entries, 3);
  assert.throws(() => inspectOffice(new ArrayBuffer(DOCUMENT_LIMIT + 1)));
  assert.throws(() => inspectOffice(storedZip({ text: 'Not DOCX' })));
  assert.throws(() => inspectOffice(storedZip({ '[Content_Types].xml': '', 'word/document.xml': '', '../evil': '' })));
  assert.throws(() => inspectOffice(storedZip({ '[Content_Types].xml': '', 'word/document.xml': '', 'word/vbaProject.bin': 'macro' })));
  const inflated = sampleDocx(), view = new DataView(inflated);
  const directory = view.getUint32(inflated.byteLength - 6, true);
  view.setUint32(directory + 24, 90 * 1024 * 1024, true);
  assert.throws(() => inspectOffice(inflated));
  assert.equal(documentFilename({ filename: '/downloads/通知.DOCX' }), '通知.DOCX');
  assert.equal(documentFilename({ filename: 'notice.wps' }), '');
  assert.deepEqual(await readDocumentResponse(new Response(sampleDocx())), sampleDocx());
  await assert.rejects(readDocumentResponse(new Response('login page')));
  const compressed = storedZip({ '[Content_Types].xml': 'a'.repeat(4096), 'word/document.xml': '<document/>' }, true);
  await validateOfficeContent(compressed);
  const zippedView = new DataView(compressed);
  zippedView.setUint32(zippedView.getUint32(compressed.byteLength - 6, true) + 24, 16, true);
  assert.doesNotThrow(() => inspectOffice(compressed), 'the directory falsely claims a small expanded entry');
  await assert.rejects(validateOfficeContent(compressed), /invalidDocument/, 'actual inflation must be bounded as well');
});

function environment({ enabled = true, fetchResult, method = 'GET', incognito = false } = {}) {
  const saved = {}, files = new Map(), calls = [], alarms = new Map();
  const tabs = [{ id: 1, url: 'https://a.example.com/article', incognito }, { id: 2, url: 'https://b.example.com/other', incognito }];
  let settings = normalizeSettings({ documentPreview: { enabled } });
  const store = { get: async id => files.get(id), all: async () => [...files.values()], put: async doc => { files.set(doc.id, { ...doc, blobUrl: 'blob:chrome-extension://test/' + doc.id }); calls.push('store'); }, remove: async id => files.delete(id) };
  const ingress = { setEnabled(value) { calls.push(['enabled', value]); }, take: () => ({ method, tabId: 1 }) };
  globalThis.fetch = async () => { calls.push('fetch'); return fetchResult ? fetchResult() : new Response(sampleDocx()); };
  globalThis.chrome = {
    runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path },
    alarms: { get: async name => alarms.get(name), create: async (name, options) => alarms.set(name, { name, scheduledTime: options.when }), clear: async name => alarms.delete(name) },
    storage: { session: { async get(key) { return { [key]: structuredClone(saved[key]) }; }, async set(value) { Object.assign(saved, structuredClone(value)); } } },
    tabs: { query: async () => tabs, get: async id => tabs.find(tab => tab.id === id), create: async value => { calls.push(['open', value]); return { id: 10 }; } },
    scripting: { executeScript: async value => { calls.push(['dialog', value.args[0]]); return [{ result: true }]; } },
    downloads: { cancel: async () => calls.push('cancel'), erase: async () => calls.push('erase'), download: async options => { calls.push(['download', options]); return 7; } }
  };
  const platform = { isIncognitoContext: () => incognito, getLocale: async () => 'en-US', readSettings: async () => settings, mutateSettings: async f => settings = f(settings) };
  const product = createDocumentPreviewProduct(platform, { store, ingress });
  const documents = () => saved['documentPreview:' + (incognito ? 'incognito' : 'regular')]?.documents || [];
  const choose = (doc = documents().at(-1), action = 'preview', remember = false) => product.handleMessage(
    { type: 'CG_DOCUMENT_CHOICE', id: doc.id, action, remember },
    { sender: { url: tabs[0].url, frameId: 0, tab: tabs[0] } }
  );
  const capture = (extra = {}) => new Promise(resolve => {
    const handled = product.handleDeterminingFilename({ id: 1, url: 'https://cdn.example.com/file', filename: 'sample.docx', state: 'in_progress', ...extra }, () => { calls.push('suggest'); resolve(); });
    if (!handled) resolve();
  });
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 10)); };
  return { product, capture, settle, calls, files, saved, tabs, platform, store, ingress, alarms, documents, choose };
}
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

test('Document Preview is default-off and preserves unsupported and unprepared downloads', async () => {
  assert.equal(DEFAULT_SETTINGS.documentPreview.enabled, false);
  assert.equal(DEFAULT_SETTINGS.documentPreview.appearance, 'auto');
  assert.equal(DEFAULT_SETTINGS.documentPreview.pdfSampling, 4);
  assert.equal(Object.hasOwn(normalizeSettings({ documentPreview: { pdfSharpening: true } }).documentPreview, 'pdfSharpening'), false,
    'saved versions of the removed option are ignored');
  for (const value of [undefined, 0, 7, 8, '6', NaN]) {
    assert.equal(normalizeSettings({documentPreview:{pdfSampling:value}}).documentPreview.pdfSampling, 4);
    assert.equal(settingsViewCache({documentPreview:{pdfSampling:value}}).documentPreview.pdfSampling, 4);
  }
  for (const value of [1, 2, 3, 4, 5, 6]) {
    assert.equal(normalizeSettings({documentPreview:{pdfSampling:value}}).documentPreview.pdfSampling, value);
    assert.equal(settingsViewCache({documentPreview:{pdfSampling:value}}).documentPreview.pdfSampling, value);
  }
  assert.equal(normalizeSettings({documentPreview:{appearance:'invalid'}}).documentPreview.appearance, 'auto');
  assert.equal(settingsViewCache({documentPreview:{appearance:'dark'}}).documentPreview.appearance, 'dark');
  assert.equal(settingsViewCache({ documentPreview: { enabled: true } }).documentPreview.enabled, true);
  for (const options of [{ enabled: false }, { method: 'POST' }]) {
    const env = environment(options); await env.capture(); await env.settle();
    assert.equal(env.calls.filter(value => value === 'suggest').length, 1);
    assert.ok(!env.calls.includes('cancel'));
    assert.equal(env.files.size, 0);
  }
  for (const fetchResult of [() => new Response('not docx'), () => { throw Error('offline'); }]) {
    const env = environment({ fetchResult }); await env.capture(); await env.settle();
    assert.equal(env.files.size, 0); assert.ok(!env.calls.includes('fetch'), 'the prompt itself never reads document bytes');
    await assert.rejects(env.choose());
    assert.equal(env.files.size, 0);
  }
  const env = environment(); await env.capture({ byExtensionId: 'another-extension' });
  await env.capture({ danger: 'content' });
  await env.capture({ danger: 'sensitiveContentBlock' });
  assert.ok(!env.calls.includes('fetch'));
});

test('a valid GET DOCX is not fetched or cached until Preview or Download is chosen', async () => {
  const env = environment(); await env.capture(); await env.settle();
  assert.ok(env.calls.indexOf('cancel') < env.calls.indexOf('suggest'));
  assert.ok(!env.calls.includes('fetch')); assert.ok(!env.calls.includes('store'));
  assert.equal(env.calls.filter(value => value === 'suggest').length, 1);
  const dialog = env.calls.find(value => value[0] === 'dialog')[1];
  assert.equal(dialog.filename, 'sample.docx'); assert.equal(dialog.size, 0);
  assert.equal(env.files.size, 0); assert.equal(env.documents().length, 1);
  await env.choose();
  assert.ok(env.calls.includes('fetch')); assert.ok(env.calls.includes('store'));
  assert.equal(env.files.size, 1);
  assert.equal(env.documents()[0].prepared, true); assert.ok(env.documents()[0].size > 0);
});

test('dismissing an accidental document prompt removes metadata without fetching or caching bytes', async () => {
  const env = environment(); await env.capture(); await env.settle();
  const doc = env.documents()[0];
  await env.product.handleMessage(
    {type:'CG_DOCUMENT_CHOICE',id:doc.id,action:'dismiss'},
    {sender:{url:env.tabs[0].url,frameId:0,tab:env.tabs[0]}}
  );
  assert.deepEqual(env.documents(),[]); assert.equal(env.files.size,0);
  assert.ok(!env.calls.includes('fetch')); assert.ok(!env.calls.includes('store'));
  await assert.rejects(env.choose(doc),/documentExpired/);
});

test('pending prompts for a repeated document URL have independent lifetimes', async () => {
  const env = environment();
  await env.capture({ totalBytes: 1234 }); await env.settle();
  assert.equal(env.calls.find(value => value[0] === 'dialog')[1].sizeLabel, '1.2 KB');
  const first = env.documents()[0];
  await env.capture({ id: 2 }); await env.settle();
  const second = env.documents().at(-1);
  assert.notEqual(first.id, second.id);
  await env.choose(first, 'dismiss');
  await env.choose(second);
  assert.equal(env.files.size, 1);
  assert.equal(env.documents()[0].id, second.id);

  await env.capture({ id: 3, filename: 'different.pdf' }); await env.settle();
  assert.equal(env.documents().length, 2, 'a reused endpoint cannot return a cached file of another format');
  assert.equal(env.documents().at(-1).format, 'pdf');
});

test('a failed preparation metadata write rolls back bytes and remains retryable', async () => {
  const env = environment(); await env.capture(); await env.settle();
  const save = chrome.storage.session.set;
  let fail = true;
  chrome.storage.session.set = async value => {
    if (fail && value['documentPreview:regular']?.documents.some(doc => doc.prepared)) {
      fail = false; throw Error('storage unavailable');
    }
    return save(value);
  };
  const put = env.store.put;
  env.store.put = async value => {
    assert.equal(env.files.has(value.id), false, 'the real cache refuses to replace an existing upload');
    return put(value);
  };
  await assert.rejects(env.choose(), /storage unavailable/);
  assert.equal(env.files.size, 0);
  assert.equal(env.documents()[0].prepared, false);
  await env.choose();
  assert.equal(env.documents()[0].prepared, true);
});

test('a document read waiting on tabs cannot outlive a completed reset', async () => {
  const env = environment(); await env.capture(); await env.settle();
  const doc = env.documents()[0];
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const query = chrome.tabs.query;
  chrome.tabs.query = async () => {
    chrome.tabs.query = query;
    entered();
    return new Promise(resolve => { release = () => resolve(env.tabs); });
  };
  const result = env.product.handleMessage({ type: 'UI_DOCUMENT_GET', id: doc.id }, {
    sender: { url: chrome.runtime.getURL(DOCUMENT_PREVIEW_PATH) + '#id=' + doc.id }
  });
  const rejected = assert.rejects(result, /documentExpired/);
  await waiting;
  await env.product.reset();
  release();
  await rejected;
});

test('turning Document Preview off prevents an outstanding metadata prompt from creating a cache', async () => {
  const env = environment(); await env.capture(); await env.settle();
  const doc = env.documents()[0];
  await env.product.handleMessage({type:'UI_SET_ENABLED',enabled:false},{sender:{url:'chrome-extension://test/settings/satellites.html'}});
  await assert.rejects(env.choose(doc),/documentPreviewDisabled/);
  assert.equal(env.files.size,0); assert.ok(!env.calls.includes('fetch'));
});

test('preparation rechecks a disabled setting after the response finishes', async () => {
  const env = environment({ fetchResult: async () => {
    await env.platform.mutateSettings(settings => ({ ...settings,
      documentPreview: { ...settings.documentPreview, enabled: false } }));
    return new Response(sampleDocx());
  } });
  await env.capture(); await env.settle();
  await assert.rejects(env.choose(), /documentPreviewDisabled/);
  assert.equal(env.files.size, 0);
  assert.equal(env.documents()[0].prepared, false);
});

test('website choice spans subdomains and ends only after the last matching tab leaves', async () => {
  const env = environment(); await env.capture(); await env.settle();
  const doc = env.documents()[0];
  await env.choose(doc, 'download', true);
  assert.equal(env.files.size,1); assert.ok(env.calls.includes('fetch'));
  assert.match(env.calls.find(value=>value[0]==='open')[1].url,/mode=download/);
  assert.equal((await env.product.state({ documentPreview: { enabled: true } }, env.tabs[1].id, env.tabs[1].url)).choice, 'download');
  const fetchCount = env.calls.filter(value => value === 'fetch').length;
  await env.capture();
  assert.equal(env.calls.filter(value => value === 'fetch').length, fetchCount, 'remembered Download releases the original task');
  env.tabs.shift(); await env.product.handleTabRemoved(1); assert.equal(env.files.size, 1);
  env.tabs[0].url = 'https://elsewhere.test'; await env.product.handleTabUpdated(2, { url: env.tabs[0].url });
  assert.equal(env.files.size, 0); assert.deepEqual(env.saved['documentPreview:regular'].choices, {});
});

test('a closed target-blank download tab falls back only to its unique live referrer', async () => {
  const env = environment();
  env.ingress.take = () => ({ method: 'GET', tabId: 99 });
  globalThis.chrome.tabs.get = async () => { throw Error('No tab'); };
  await env.capture({ referrer: env.tabs[0].url }); await env.settle();
  assert.ok(env.calls.includes('cancel'));
  assert.equal(env.documents()[0].site, 'example.com'); assert.equal(env.files.size, 0);
  const ambiguous = environment();
  ambiguous.ingress.take = () => ({ method: 'GET', tabId: 99 });
  ambiguous.tabs[1].url = ambiguous.tabs[0].url;
  await ambiguous.capture({ referrer: ambiguous.tabs[0].url });
  assert.ok(!ambiguous.calls.includes('cancel'));
});

test('closing the last source tab during deferred preparation cannot resurrect its cache', async () => {
  let complete;
  const env = environment({ fetchResult: () => new Promise(resolve => complete = resolve) });
  await env.capture(); await env.settle();
  const task = env.choose(); await env.settle();
  env.tabs.splice(0); await env.product.handleTabRemoved(1);
  complete(new Response(sampleDocx())); await assert.rejects(task); await env.settle();
  assert.equal(env.files.size, 0); assert.ok(env.calls.includes('cancel'));
});

test('worker sleep preserves the website session; a new browser session removes orphaned document bytes', async () => {
  const env = environment(); await env.capture(); await env.settle();
  await env.choose();
  const doc = [...env.files.values()][0];
  const resumed = createDocumentPreviewProduct(env.platform, env);
  await resumed.initialize(); assert.equal(env.files.size, 1);
  assert.equal(env.saved['documentPreview:regular'].epoch, doc.epoch);
  delete env.saved['documentPreview:regular'];
  const restarted = createDocumentPreviewProduct(env.platform, env);
  await restarted.initialize(); assert.equal(env.files.size, 0);
  assert.notEqual(env.saved['documentPreview:regular'].epoch, doc.epoch);
  env.files.set(doc.id, { ...doc, blobUrl: 'blob:chrome-extension://test/' + doc.id }); delete env.saved['documentPreview:regular'];
  env.store.exists = async () => true;
  await env.platform.mutateSettings(settings => ({ ...settings, documentPreview: { enabled: false } }));
  await createDocumentPreviewProduct(env.platform, env).initialize();
  assert.equal(env.files.size, 0, 'disabled startup also clears an orphaned on-disk cache');
});

test('disabling capture preserves existing previews until the last source website tab leaves', async () => {
  const env = environment(); await env.capture(); await env.settle();
  await env.choose();
  const doc = [...env.files.values()][0];
  env.files.set('private-record', { id: 'private-record', context: 'incognito', epoch: 'private', blob: new Blob(['private']) });
  await env.product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.equal(env.files.size, 2);
  const workspace = 'chrome-extension://test/workspaces/document-preview/document-preview.html#id=' + doc.id;
  assert.equal((await env.product.handleMessage({ type: 'UI_DOCUMENT_GET', id: doc.id }, { sender: { url: workspace } })).id, doc.id);
  await env.product.handleMessage({ type: 'UI_DOCUMENT_DOWNLOAD', id: doc.id, blobUrl: doc.blobUrl }, { sender: { url: workspace } });
  const fetches = env.calls.filter(value => value === 'fetch').length;
  await env.capture(); assert.equal(env.calls.filter(value => value === 'fetch').length, fetches);
  env.tabs.splice(0); await env.product.handleTabRemoved(1);
  assert.deepEqual([...env.files.keys()], ['private-record']);
  assert.equal(env.saved['documentPreview:regular'].documents.length, 0);
  assert.deepEqual(env.calls.at(-1), ['enabled', false]);
});

test('document commands reject unrelated sites and invalid workspace sources', async () => {
  const env = environment(); await env.capture(); await env.settle();
  await env.choose();
  const doc = [...env.files.values()][0];
  await assert.rejects(env.product.handleMessage({ type: 'CG_DOCUMENT_CHOICE', id: doc.id, action: 'download' }, { sender: { url: 'https://evil.test', frameId: 0, tab: { id: 8, url: 'https://evil.test' } } }));
  await assert.rejects(env.product.handleMessage({ type: 'UI_DOCUMENT_GET', id: doc.id }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } }));
  const workspace = 'chrome-extension://test/workspaces/document-preview/document-preview.html#id=' + doc.id;
  await assert.rejects(env.product.handleMessage({ type: 'UI_DOCUMENT_DOWNLOAD', id: doc.id, blobUrl: 'https://evil.test' }, { sender: { url: workspace } }));
  await assert.rejects(env.product.handleMessage({ type: 'UI_DOCUMENT_DOWNLOAD', id: doc.id, blobUrl: 'blob:chrome-extension://test/unrelated-document' }, { sender: { url: workspace } }));
  await env.product.handleMessage({ type: 'UI_DOCUMENT_DOWNLOAD', id: doc.id, blobUrl: doc.blobUrl }, { sender: { url: workspace } });
  assert.equal(env.calls.find(value => value[0] === 'download')[1].saveAs, undefined);
  let suggested;
  assert.equal(env.product.handleDeterminingFilename({ byExtensionId: 'test', url: doc.blobUrl }, value => suggested = value), true);
  assert.deepEqual(suggested, { filename: 'sample.docx', conflictAction: 'uniquify' });
});

test('request correlation is bounded, refuses POST and ambiguous source tabs, and detaches while disabled', () => {
  let listener;
  globalThis.chrome = { webRequest: { onBeforeRequest: { hasListener: () => !!listener, addListener: fn => listener = fn, removeListener: () => listener = null } } };
  const ingress = createDocumentRequestIngress(); ingress.setEnabled(true);
  listener({ requestId: '1', tabId: 1, url: 'https://example.com/a', method: 'GET' });
  assert.equal(ingress.take({ url: 'https://example.com/a' }).tabId, 1);
  listener({ requestId: '2', tabId: 1, url: 'https://example.com/a', method: 'POST' });
  assert.equal(ingress.take({ url: 'https://example.com/a' }), null);
  for (const tabId of [1, 2]) listener({ requestId: String(tabId), tabId, url: 'https://example.com/a', method: 'GET' });
  assert.equal(ingress.take({ url: 'https://example.com/a' }), null);
  ingress.setEnabled(false); assert.equal(listener, null);
});

let renderer;
async function convert(entries) {
  if (!renderer) {
    const context = { ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int32Array, DataView, setTimeout, clearTimeout, console, TextDecoder, TextEncoder, Blob, ReadableStream, atob, btoa };
    runInNewContext(await readFile(new URL('../extension/vendor/mammoth/mammoth.browser.min.js', import.meta.url), 'utf8'), context);
    renderer = context.mammoth;
  }
  return renderer.convertToHtml({ arrayBuffer: storedZip(entries) }, { externalFileAccess: false });
}

test('bundled DOCX renderer preserves inherited and direct formatting, table layout, numbering and page breaks', async () => {
  const result = await convert(formattingEntries());
  const styles = JSON.parse(JSON.stringify(result.formatting.styles));
  const styleForText = text => {
    const match = result.value.match(new RegExp('<span class="cg-f(\\d+)">' + text));
    assert.ok(match, text); return styles[Number(match[1])];
  };
  const heading = styleForText('Document Preview');
  assert.equal(heading['font-size'], '20pt'); assert.equal(heading['font-weight'], '700');
  assert.equal(heading.color, '#2468ac'); assert.match(heading['font-family'], /^"Calibri"/);
  assert.ok(styles.some(s=>s['font-family']?.includes('宋体')), 'Chinese source font remains available on Chinese text');
  const body = styleForText('保留原文');
  assert.equal(body['font-weight'], '400', 'direct bold-off overrides the inherited style');
  assert.equal(body['font-style'], 'italic'); assert.equal(body['font-size'], '13pt');
  const paragraph = styles.find(style => style['text-align'] === 'justify');
  assert.equal(paragraph['text-indent'], '2em'); assert.equal(paragraph['line-height'], '1.5');
  assert.equal(paragraph['margin-top'], '4pt'); assert.equal(paragraph['margin-bottom'], '10pt');
  assert.equal(styleForText('Highlight')['text-decoration-style'], 'double');
  assert.equal(styleForText('Highlight')['background-color'], '#ffff00');
  const markers = [...result.value.matchAll(/class="cg-list-marker[^"]*">([^<]+)<\/span>/g)].map(match => match[1].trim());
  assert.deepEqual(markers, ['III.','III.a)','III.b)','IV.','IV.a)']);
  assert.match(result.value, /<colgroup><col class="cg-f\d+">/);
  assert.ok(styles.some(style => style.width === '33.333%')); assert.ok(styles.some(style => style.width === '66.667%'));
  assert.match(result.value, /<td colspan="2"/);
  assert.ok(styles.some(style => style['background-color'] === '#ddeeff' && style['border-top-width'] === '1pt'));
  assert.ok(styles.some(style => style['border-bottom-style'] === 'double'));
  assert.equal((result.value.match(/class="cg-page-break"/g) || []).length, 2);
  assert.match(result.value, /<p class="cg-f\d+"><\/p>/, 'blank paragraphs remain visible');
  assert.deepEqual(JSON.parse(JSON.stringify(result.formatting.page)), {width:'595.3pt',top:'72pt',bottom:'72pt',left:'60pt',right:'60pt'});
  assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))), styles, 'every generated declaration passes the independent display whitelist');
});

test('page-break-before also works without any other formatting; repeated runs share classes', async () => {
  const entries = formattingEntries();
  delete entries['word/styles.xml'];
  entries['word/document.xml'] = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Break</w:t></w:r></w:p>' + '<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>Repeated</w:t></w:r></w:p>'.repeat(200) + '</w:body></w:document>';
  const result = await convert(entries);
  assert.match(result.value, /^<hr class="cg-page-break"/);
  const repeated=[...result.value.matchAll(/<span class="(cg-f\d+)">Repeated<\/span>/g)];
  assert.equal(repeated.length,200);assert.equal(new Set(repeated.map(m=>m[1])).size,1);
  assert.equal(result.formatting.styles.filter(s=>s['font-size']==='12pt').length,1);
});

test('document styles cannot add arbitrary CSS, and source XML declarations are rejected', async () => {
  const css = formatStylesheet({styles:[{'font-family':'"x";background:url(https://evil.test)',color:'#123456','background-color':'#ffffff',position:'fixed',constructor:'x',width:'url(x)','font-size':'12pt'}],page:{width:'612pt',left:'0;}body{display:none'}});
  assert.doesNotMatch(css, /evil|url|position|constructor|display:none/);
  assert.match(css, /font-size:12pt/); assert.match(css, /max-width:612pt/);
  assert.match(css, /@media\(prefers-color-scheme:dark\).*background-color:#292929/);
  const entries = formattingEntries();
  entries['word/document.xml'] = '<!DOCTYPE document [<!ENTITY test "no">]>' + entries['word/document.xml'];
  await assert.rejects(convert(entries), /Unsupported XML declaration/);
});

test('document appearance defaults, site overrides and resets follow the source website session', async () => {
  const env = environment(); await env.capture(); await env.settle();
  await env.choose();
  const first = [...env.files.values()][0];
  const workspace = doc => ({sender:{url:'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+doc.id}});
  const get = (doc, product=env.product) => product.handleMessage({type:'UI_DOCUMENT_GET',id:doc.id},workspace(doc));
  const setTheme = (doc,theme) => env.product.handleMessage({type:'UI_DOCUMENT_SET_THEME',id:doc.id,theme},workspace(doc));
  const setDefault = appearance => env.product.handleMessage({type:'UI_SET_DOCUMENT_APPEARANCE',appearance},{sender:{url:'chrome-extension://test/settings/satellites.html'}});
  assert.equal((await get(first)).appearance, 'auto');
  const opened = await get(first);
  assert.equal(opened.pdfSampling, 4);
  const setSampling = pdfSampling => env.product.handleMessage({type:'UI_SET_DOCUMENT_PDF_SAMPLING',pdfSampling},{sender:{url:'chrome-extension://test/settings/satellites.html'}});
  for (const value of [1, 2, 3, 5, 6, 4]) {
    assert.equal((await setSampling(value)).pdfSampling, value);
    assert.equal((await get(first)).pdfSampling, value, 'new readers receive the current setting, including cached documents');
  }
  assert.equal(opened.pdfSampling, 4, 'previously returned reader metadata is a snapshot');
  assert.equal(first.pdfSampling, undefined, 'document cache does not freeze a global rendering preference');
  await setDefault('dark'); await setTheme(first,'light');
  assert.equal((await get(first)).appearance, 'dark'); assert.equal((await get(first)).siteTheme, 'light');
  env.tabs[0].url = 'https://docs.example.com/downloads';
  await env.capture({url:'https://cdn.example.com/second'}); await env.settle();
  await env.choose();
  const second = [...env.files.values()][1];
  assert.equal((await get(second)).siteTheme,'light','another document on a subdomain shares the override');
  env.tabs[0].url = 'https://different.example.org/downloads';
  await env.capture({url:'https://cdn.example.org/other'}); await env.settle();
  await env.choose();
  const other = [...env.files.values()][2];
  assert.equal((await get(other)).siteTheme,null,'a different eTLD+1 has no override');
  await setTheme(other,'dark');
  const resumed = createDocumentPreviewProduct(env.platform,env);
  assert.equal((await get(first,resumed)).siteTheme,'light','worker sleep retains the website choice');
  await setTheme(second,null);
  assert.equal((await get(first)).siteTheme,null); assert.equal((await get(first)).appearance,'dark');
  await setTheme(first,'light');
  await env.product.handleMessage({type:'UI_SET_ENABLED',enabled:false},{sender:{url:'chrome-extension://test/settings/satellites.html'}});
  assert.equal((await get(first)).siteTheme,'light','disabling new captures preserves open previews');
  await setTheme(second,'dark');
  env.tabs.splice(1); await env.product.handleTabRemoved(2);
  await assert.rejects(get(first), /documentExpired/);
  assert.deepEqual(env.saved['documentPreview:regular'].themes, {'example.org':'dark'});
  env.tabs.splice(0); await env.product.handleTabRemoved(1);
  assert.deepEqual(env.saved['documentPreview:regular'].themes,{});
});

test('appearance commands reject invalid callers and values, and incognito overrides stay separate', async () => {
  const env = environment({incognito:true});
  env.saved['documentPreview:regular'] = {themes:{'example.com':'dark'}};
  await env.capture(); await env.settle();
  await env.choose();
  const doc = [...env.files.values()][0];
  const sender = {url:'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+doc.id};
  const command = {type:'UI_DOCUMENT_SET_THEME',id:doc.id,theme:'light'};
  await env.product.handleMessage(command,{sender});
  assert.deepEqual(env.saved['documentPreview:incognito'].themes,{'example.com':'light'});
  assert.deepEqual(env.saved['documentPreview:regular'].themes,{'example.com':'dark'});
  await assert.rejects(env.product.handleMessage({...command,theme:'invalid'},{sender}));
  await assert.rejects(env.product.handleMessage(command,{sender:{url:'https://example.com',frameId:0,tab:env.tabs[0]}}));
  await assert.rejects(env.product.handleMessage(command,{sender:{url:sender.url.replace(doc.id,'other')}}));
  await assert.rejects(env.product.handleMessage({type:'UI_SET_DOCUMENT_APPEARANCE',appearance:'light'},{sender}));
  await assert.rejects(env.product.handleMessage({type:'UI_SET_DOCUMENT_APPEARANCE',appearance:'invalid'},{sender:{url:'chrome-extension://test/settings/satellites.html'}}));
  await assert.rejects(env.product.handleMessage({type:'UI_SET_DOCUMENT_PDF_SAMPLING',pdfSampling:6},{sender}), /Settings only/);
  for (const pdfSampling of ['6', 7, 0, 10, null]) await assert.rejects(env.product.handleMessage({type:'UI_SET_DOCUMENT_PDF_SAMPLING',pdfSampling},{sender:{url:'chrome-extension://test/settings/satellites.html'}}), /Unknown PDF sampling/);
  chrome.storage.session.set = async () => { throw Error('storage unavailable'); };
  await assert.rejects(env.product.handleMessage({...command,theme:'dark'},{sender}), /storage unavailable/);
  assert.equal((await env.product.handleMessage({type:'UI_DOCUMENT_GET',id:doc.id},{sender})).siteTheme,'light','a failed write cannot change the authoritative session preference');
});

test('closed previews expire after ten minutes, with open copies and source sessions respected', async t => {
  assert.equal(DOCUMENT_CLOSED_RETENTION, 10 * 60 * 1000);
  t.mock.timers.enable({apis:['Date'],now:1800000000000});
  const env = environment(); await env.capture(); await env.settle();
  await env.choose();
  const doc = [...env.files.values()][0], alarmName = DOCUMENT_CLEANUP_ALARM_PREFIX + 'regular';
  const preview = {id:10,incognito:false,url:'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+doc.id};
  const metadata = () => env.saved['documentPreview:regular'].documents.find(value => value.id === doc.id);
  env.tabs.push(preview); await env.product.handleTabCreated(preview);
  assert.equal(metadata().closedAt,null); assert.equal(env.alarms.size,0);
  const copy = {...preview,id:11}; env.tabs.push(copy); await env.product.handleTabCreated(copy);
  env.tabs.splice(env.tabs.indexOf(preview),1); await env.product.handleTabRemoved(preview.id);
  t.mock.timers.tick(DOCUMENT_CLOSED_RETENTION * 2);
  await env.product.handleAlarm({name:alarmName});
  assert.equal(env.files.size,1,'an open duplicate protects the cached file from the closed-preview deadline');
  env.tabs.splice(env.tabs.indexOf(copy),1); await env.product.handleTabRemoved(copy.id);
  const closedAt = Date.now(); assert.equal(metadata().closedAt,closedAt);
  assert.equal(env.alarms.get(alarmName).scheduledTime,closedAt+DOCUMENT_CLOSED_RETENTION);
  t.mock.timers.tick(DOCUMENT_CLOSED_RETENTION-1);
  await env.product.handleTabUpdated(1,{url:env.tabs[0].url});
  assert.equal(metadata().closedAt,closedAt,'unrelated page changes cannot extend the deadline');
  const resumed = createDocumentPreviewProduct(env.platform,env); await resumed.initialize();
  assert.equal(env.alarms.get(alarmName).scheduledTime,closedAt+DOCUMENT_CLOSED_RETENTION,'worker restart preserves the original deadline');
  assert.equal(env.files.size,1);
  t.mock.timers.tick(1);
  await resumed.handleAlarm({name:alarmName});
  assert.equal(env.files.size,0); assert.equal(env.alarms.size,0);
  assert.equal(env.saved['documentPreview:regular'].documents.length,0);
  await assert.rejects(resumed.handleMessage({type:'UI_DOCUMENT_GET',id:doc.id},{sender:{url:preview.url}}),/documentExpired/);
});

test('reopening cancels a document deadline, navigation restarts it, and an earlier source exit wins', async t => {
  t.mock.timers.enable({apis:['Date'],now:1800000000000});
  const env = environment(); await env.capture(); await env.settle();
  await env.choose();
  const doc = [...env.files.values()][0], alarmName = DOCUMENT_CLEANUP_ALARM_PREFIX + 'regular';
  const preview = {id:10,incognito:false,url:'about:blank',pendingUrl:'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+doc.id};
  t.mock.timers.tick(DOCUMENT_CLOSED_RETENTION-1);
  env.tabs.push(preview); await env.product.handleTabCreated(preview);
  assert.equal(env.alarms.size,0,'pending preview URLs already cancel the countdown');
  preview.url = preview.pendingUrl; delete preview.pendingUrl;
  t.mock.timers.tick(DOCUMENT_CLOSED_RETENTION*2); await env.product.handleAlarm({name:alarmName});
  assert.equal(env.files.size,1);
  preview.url = 'about:blank'; await env.product.handleTabUpdated(10,{url:preview.url});
  assert.equal(env.alarms.get(alarmName).scheduledTime,Date.now()+DOCUMENT_CLOSED_RETENTION);
  await env.product.handleMessage({type:'UI_SET_ENABLED',enabled:false},{sender:{url:'chrome-extension://test/settings/satellites.html'}});
  const before = env.alarms.get(alarmName).scheduledTime;
  assert.equal(await env.product.handleAlarm({name:DOCUMENT_CLEANUP_ALARM_PREFIX+'incognito'}),false);
  assert.equal(env.alarms.get(alarmName).scheduledTime,before);
  env.tabs.splice(0,2); await env.product.handleTabRemoved(1);
  assert.equal(env.files.size,0,'source-site closure expires bytes before the ten-minute deadline, even while capture is off');
  assert.equal(env.alarms.size,0);
});

test('each document has its own deadline and expired files cannot be revived by a late preview', async t => {
  t.mock.timers.enable({apis:['Date'],now:1800000000000});
  const env = environment(); await env.capture(); await env.settle();
  await env.choose();
  const first = [...env.files.values()][0], alarmName = DOCUMENT_CLEANUP_ALARM_PREFIX+'regular';
  const firstDeadline = env.alarms.get(alarmName).scheduledTime;
  t.mock.timers.tick(60000); await env.capture({url:'https://cdn.example.com/second'}); await env.settle();
  await env.choose();
  const second = [...env.files.values()][1];
  assert.equal(env.alarms.size,1); assert.equal(env.alarms.get(alarmName).scheduledTime,firstDeadline);
  t.mock.timers.tick(DOCUMENT_CLOSED_RETENTION-60000);
  const preview = {id:10,incognito:false,url:'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+first.id};
  await assert.rejects(env.product.handleMessage({type:'UI_DOCUMENT_GET',id:first.id},{sender:{url:preview.url}}),/documentExpired/,'commands also reject expired files before a delayed alarm fires');
  env.tabs.push(preview); await env.product.handleTabCreated(preview);
  assert.deepEqual([...env.files.keys()],[second.id]);
  assert.equal(env.alarms.get(alarmName).scheduledTime,firstDeadline+60000);
  t.mock.timers.tick(60000); await env.product.handleAlarm({name:alarmName});
  assert.equal(env.files.size,0); assert.equal(env.alarms.size,0);
});

test('temporary document notices last fifteen seconds and cannot erase newer states', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const element = {textContent:''}, status = createDocumentStatus(element);
  status.show('download started',true); t.mock.timers.tick(14999);
  assert.equal(element.textContent,'download started'); t.mock.timers.tick(1); assert.equal(element.textContent,'');
  status.show('download started',true); t.mock.timers.tick(10000); status.show('retry failed',true);
  t.mock.timers.tick(5000); assert.equal(element.textContent,'retry failed');
  t.mock.timers.tick(10000); assert.equal(element.textContent,'');
  status.show('download started',true); status.show('expired'); t.mock.timers.tick(30000);
  assert.equal(element.textContent,'expired');
  status.show('notice',true); status.clear(); t.mock.timers.tick(30000); assert.equal(element.textContent,'notice');
});

test('dark document text uses the filename white for defaults and neutral source colors', () => {
  assert.match(documentStyles(), /@media\(prefers-color-scheme:dark\)\{html\{background:#202124;color:#f1f3f4\}/);
  const css = formatStylesheet({styles:[{color:'#000000'},{color:'#333333'},{color:'#ffffff'},{color:'#2468ac'},{'background-color':'#ffffff'}]});
  const dark = css.slice(css.indexOf('@media'));
  for(let i=0;i<3;i++)assert.ok(dark.includes('.cg-f'+i+'{color:#f1f3f4}'));
  assert.match(dark, /cg-f3\{color:#[a-f0-9]{6}\}/);
  assert.doesNotMatch(dark, /cg-f3\{color:#f1f3f4\}/, 'colored source text retains its hue');
  assert.match(dark, /background-color:#292929/);
});

test('each supported suffix is validated against its own format, including MIME-only PDF filenames', async () => {
  for (const [format,entries] of [['xlsx',spreadsheetEntries()],['pptx',presentationEntries()]]) {
    const bytes=storedZip(entries,true);
    assert.equal(documentFilename({filename:'/downloads/file.'+format.toUpperCase()}),'file.'+format.toUpperCase());
    await validateOfficeContent(bytes,format);
    assert.deepEqual(await readDocumentResponse(new Response(bytes),format),bytes);
    assert.throws(()=>inspectOffice(bytes,'docx'));
    assert.throws(()=>inspectOffice(storedZip({...entries,[(format==='xlsx'?'xl':'ppt')+'/vbaProject.bin']:'macro'}),format));
  }
  assert.equal(documentFilename({filename:'download',mime:'application/pdf'}),'download.pdf');
  assert.equal(documentFilename({filename:'app.exe',mime:'application/pdf'}),'');
  assert.equal(documentFilename({filename:'file.wps'}),'');
  assert.deepEqual(await readDocumentResponse(new Response(samplePdf()),'pdf'),samplePdf());
  await assert.rejects(readDocumentResponse(new Response('<html>login</html>'),'pdf'));
});

test('workbooks keep multiple sheets, shared/inline strings, cached values, formats and merges without executing formulas', async () => {
  await convert(formattingEntries());
  const result=await renderer.convertSpreadsheet(storedZip(spreadsheetEntries()));
  assert.deepEqual(Array.from(result.parts,part=>part.name),['预算 Budget','Notes']);
  const html=result.parts[0].html;
  assert.match(html,/\$1,234\.50/);assert.match(html,/2023-03-15/);assert.match(html,/50\.00%/);
  assert.match(html,/colspan="3"/);assert.match(html,/Shared string/);assert.match(html,/=1\+2/);
  assert.doesNotMatch(html,/<script|https:\/\/tracker/);
  assert.match(html,/&lt;script&gt;unsafe/);assert.match(result.parts[1].html,/第二张表/);
  assert.ok(result.formatting.styles.some(style=>style['background-color']==='#ABCDEF'),'explicit RGB fills must not be replaced by a theme fallback');
  const bad=spreadsheetEntries();bad['xl/sharedStrings.xml']='<!DOCTYPE s [<!ENTITY external SYSTEM "file:///private">]><sst/>';
  await assert.rejects(renderer.convertSpreadsheet(storedZip(bad)));
});

test('presentation slides preserve order, static text, coordinates and formatting while ignoring remote images', async () => {
  await convert(formattingEntries());
  const result=await renderer.convertPresentation(storedZip(presentationEntries()));
  assert.equal(result.parts.length,2);assert.match(result.parts[0].name,/First slide/);
  assert.match(result.parts[1].html,/Second slide &amp; safe text/);
  assert.ok(result.formatting.styles.some(style=>style.left==='72pt'&&style.top==='36pt'));
  assert.ok(result.formatting.styles.some(style=>style['font-size']==='32pt'&&style['font-weight']==='700'));
  assert.doesNotMatch(result.parts.map(part=>part.html).join(''),/<img|tracker|script|iframe/);
  const checked=acceptedStyles(result.formatting);
  assert.ok(checked.some(style=>style.position==='absolute'&&style.left==='72pt'));
});

test('presentation paper resolves theme and inherited dark backgrounds without brightening dark fills', async () => {
  await convert(formattingEntries());
  const paper=result=>result.formatting.styles[Number(result.parts[0].html.match(/cg-slide cg-f(\d+)/)[1])]['background-color'];
  for(const [reference,expected] of [[1001,'#101218'],[1002,'#08090c'],[1,'#080a0c'],[0,'#ffffff'],[1000,'#ffffff'],[9999,'#ffffff']]) {
    const entries=darkPresentationEntries();
    entries['ppt/slideMasters/slideMaster1.xml']=entries['ppt/slideMasters/slideMaster1.xml'].replace('idx="1001"',`idx="${reference}"`);
    const result=await renderer.convertPresentation(storedZip(entries));
    assert.equal(paper(result),expected);
    const dark=formatStylesheet(result.formatting).split('@media(prefers-color-scheme:dark)')[1];
    if(reference===1001)assert.ok(dark.includes('background-color:#101218'), 'dark source paper remains dark');
    const second=result.formatting.styles[Number(result.parts[1].html.match(/cg-slide cg-f(\d+)/)[1])];
    assert.equal(second['background-color'],'#ffffff','white slides retain independent source paper');
  }
  const direct=darkPresentationEntries();
  direct['ppt/slides/slide1.xml']=direct['ppt/slides/slide1.xml'].replace('<p:cSld>','<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:bgPr></p:bg>');
  assert.equal(paper(await renderer.convertPresentation(storedZip(direct))),'#000000');
  const override=darkPresentationEntries();
  override['ppt/slides/slide1.xml']=override['ppt/slides/slide1.xml'].replace('</p:sld>','<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1"/></p:clrMapOvr></p:sld>');
  assert.equal(paper(await renderer.convertPresentation(storedZip(override))),'#f4f6fa');
});

test('remembered website actions apply across document formats and require no bytes before choosing', async () => {
  for(const action of ['preview','download']) {
    const env=environment();await env.capture();await env.settle();await env.choose(undefined,action,true);
    const count=env.calls.filter(value=>value[0]==='dialog').length,fetches=env.calls.filter(value=>value==='fetch').length;
    for(const format of ['xlsx','pptx','pdf'])await env.capture({url:'https://cdn.example.com/next.'+format,filename:'next.'+format});
    await env.settle();
    assert.equal(env.calls.filter(value=>value[0]==='dialog').length,count);
    assert.equal(env.calls.filter(value=>value==='fetch').length,fetches);
    if(action==='preview')assert.equal(env.documents().length,4);
    else assert.equal(env.documents().length,1);
  }
});

test('Office template, slideshow and macro suffixes reuse inert family renderers', async () => {
  await convert(formattingEntries());
  for (const format of Object.keys(DOCUMENT_TYPES).filter(value => /^(?:docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|potx|potm|ppsx|ppsm)$/.test(value))) {
    const kind = documentKind(format);
    const entries = kind === 'docx' ? formattingEntries() : kind === 'xlsx' ? spreadsheetEntries() : presentationEntries();
    if (format.endsWith('m')) {
      const dir = kind === 'docx' ? 'word' : kind === 'xlsx' ? 'xl' : 'ppt';
      entries[dir + '/vbaProject.bin'] = 'THIS MACRO MUST NEVER EXECUTE';
      entries[dir + '/activeX/activeX1.xml'] = '<not-executable/>';
      entries[dir + '/embeddings/oleObject1.bin'] = 'EMBEDDED PROGRAM';
    }
    const buffer = storedZip(entries, true);
    assert.equal(documentFilename({filename:'file.' + format.toUpperCase()}),'file.' + format.toUpperCase());
    await validateOfficeContent(buffer, format);
    const result = kind === 'docx' ? await renderer.convertToHtml({arrayBuffer:buffer}, {externalFileAccess:false})
      : kind === 'xlsx' ? await renderer.convertSpreadsheet(buffer) : await renderer.convertPresentation(buffer);
    const html = result.value || result.parts.map(part => part.html).join('');
    assert.ok(html.length > 100, format);
    assert.doesNotMatch(html, /THIS MACRO|not-executable|EMBEDDED PROGRAM/, format);
  }
});

test('extension-created PDF downloads bypass interception', () => {
  const env = environment();
  assert.equal(env.product.handleDeterminingFilename({filename:'document.pdf',url:'https://example.com/file.pdf',byExtensionId:'mhjfbmdgcfjbbpaeojofohoefgiehjai',state:'in_progress'},()=>{throw Error('must not intercept');}),false);
});

test('Customs routes document settings, state and cleanup without starting media discovery', async () => {
  const env = environment({enabled:false});
  globalThis.chrome.runtime.getContexts = async () => [];
  const observed=[];
  const customs = createCustomsProvince(env.platform,{setTabs:ids=>observed.push(ids)});
  const result = await customs.handleMessage('documentPreview',{type:'UI_SET_DOCUMENT_APPEARANCE',appearance:'dark'},
    {sender:{url:'chrome-extension://test/settings/satellites.html'}});
  assert.equal(result.appearance,'dark');
  const sampling = await customs.handleMessage('documentPreview',{type:'UI_SET_DOCUMENT_PDF_SAMPLING',pdfSampling:6},
    {sender:{url:'chrome-extension://test/settings/satellites.html'}});
  assert.equal(sampling.pdfSampling,6);
  const state = await customs.getProductState('documentPreview',{settings:await env.platform.readSettings(),tabId:1,url:env.tabs[0].url});
  assert.equal(state.enabled,false);assert.equal(state.supported,true);
  assert.equal(await customs.handleAlarm({name:DOCUMENT_CLEANUP_ALARM_PREFIX+'regular'}),true);
  await customs.handleTabCreated({url:'chrome-extension://test/workspaces/document-preview/document-preview.html#id=missing'});
  assert.deepEqual(observed,[]);assert.equal(env.files.size,0);
});

test('memory cache transfers exact bytes, rejects overflows and releases abandoned uploads', async t => {
  const {blobCommand,hasBlobs}=await import('../extension/offscreen/blob-cache.js');
  t.mock.timers.enable({apis:['setTimeout']});
  blobCommand({operation:'begin',id:'partial',size:5,mime:'application/pdf',metadata:{context:'regular'}});
  assert.equal(hasBlobs(),true);
  assert.throws(()=>blobCommand({operation:'chunk',id:'partial',offset:0,data:btoa('123456')}));
  assert.throws(()=>blobCommand({operation:'finish',id:'partial'}));
  t.mock.timers.tick(60001);assert.equal(hasBlobs(),false);
  blobCommand({operation:'begin',id:'complete',size:5,mime:'application/pdf',metadata:{context:'regular'}});
  blobCommand({operation:'chunk',id:'complete',offset:0,data:btoa('123')});
  blobCommand({operation:'chunk',id:'complete',offset:3,data:btoa('45')});
  const record=blobCommand({operation:'finish',id:'complete'});
  assert.equal(await(await originalFetch(record.blobUrl)).text(),'12345');
  t.mock.timers.tick(60001);assert.equal(hasBlobs(),true,'completed records follow product lifecycle, not upload timeout');
  blobCommand({operation:'remove',id:'complete'});
  assert.equal(hasBlobs(),false);await assert.rejects(originalFetch(record.blobUrl));
});

let legacyXlsx;
async function extraRenderers(){
  await convert(formattingEntries());
  if(!legacyXlsx){const context={TextDecoder,TextEncoder,Uint8Array,Uint16Array,Int32Array,ArrayBuffer,DataView,console};runInNewContext(await readFile(new URL('../extension/vendor/sheetjs/xlsx.full.min.js',import.meta.url),'utf8'),context);legacyXlsx=context.XLSX;}
  return legacyXlsx;
}
test('new formats validate real containers, reject masquerading pages and dispatch to the correct family',async()=>{
  const XLSX=await extraRenderers();
  const {odfEntries,rtfSample,emailSample,wordStreams,presentationStreams,cfbFile}=await import('./fixtures/additional-document-formats.mjs');
  for(const format of ['doc','xls','ppt','rtf','odt','ods','odp','eml']){
    assert.equal(documentFilename({filename:'Example.'+format.toUpperCase()}),'Example.'+format.toUpperCase());
    await assert.rejects(readDocumentResponse(new Response('<html>login page</html>'),format),/invalidDocument/);
  }
  for(const format of ['odt','ods','odp'])await validateOfficeContent(storedZip(odfEntries(format)),format);
  for(const format of ['doc','ppt'])await readDocumentResponse(new Response(cfbFile(XLSX,format==='doc'?wordStreams():presentationStreams())),format);
  await readDocumentResponse(new Response(rtfSample),'rtf');await readDocumentResponse(new Response(emailSample),'eml');
  assert.equal(documentKind('odt'),'docx');assert.equal(documentKind('ods'),'xlsx');assert.equal(documentKind('odp'),'pptx');assert.equal(documentKind('eml'),'eml');
  const wrong=odfEntries('odt');wrong.mimetype=DOCUMENT_TYPES.ods;assert.throws(()=>inspectOffice(storedZip(wrong),'odt'));
});
test('legacy Word uses ordered pieces and field results; compound loops and encryption fail closed',async()=>{
  const XLSX=await extraRenderers(),{cfbFile,wordStreams}=await import('./fixtures/additional-document-formats.mjs');
  const stream=wordStreams(),file=cfbFile(XLSX,stream),result=renderer.convertLegacyWord(file);
  assert.match(result.value,/Word 97 中文正文/);assert.match(result.value,/Display result/);assert.doesNotMatch(result.value,/HYPERLINK|secret/);
  const encrypted=wordStreams();encrypted.WordDocument.writeUInt16LE(0x300,10);assert.throws(()=>renderer.convertLegacyWord(cfbFile(XLSX,encrypted)));
  const corrupted=file.slice(0),v=new DataView(corrupted),fat=v.getUint32(76,true),directory=v.getUint32(48,true);v.setUint32((fat+1)*512+directory*4,directory,true);assert.throws(()=>renderer.convertLegacyWord(corrupted));
  const short=wordStreams();short.WordDocument.writeUInt32LE(5000,76);assert.throws(()=>renderer.convertLegacyWord(cfbFile(XLSX,short)));
});
test('legacy PowerPoint retains live presentation order and excludes deleted slides',async()=>{
  const XLSX=await extraRenderers(),{cfbFile,presentationStreams}=await import('./fixtures/additional-document-formats.mjs');
  const result=renderer.convertLegacyPresentation(cfbFile(XLSX,presentationStreams()));
  assert.equal(result.parts.length,2);assert.match(result.parts[0].html,/Second title.*Second shape/);assert.match(result.parts[1].html,/First title.*First shape 中文/);
  assert.doesNotMatch(JSON.stringify(result),/DELETED SLIDE/);
  const bad=presentationStreams();bad['Current User'].writeUInt32LE(0xffffff,16);assert.throws(()=>renderer.convertLegacyPresentation(cfbFile(XLSX,bad)));
});
test('XLS keeps Unicode, saved values, formatted numbers, merges and worksheet order',async()=>{
  const XLSX=await extraRenderers(),book=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([['中文',1234.5],['Merged']]);sheet.B1.z='#,##0.00';sheet['!merges']=[{s:{r:1,c:0},e:{r:1,c:1}}];
  XLSX.utils.book_append_sheet(book,sheet,'预算');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Second sheet']]),'第二张');
  const bytes=XLSX.write(book,{bookType:'biff8',type:'array'}),array=new Uint8Array(bytes).slice().buffer;
  const result=renderer.convertLegacySpreadsheet(array,XLSX);assert.deepEqual(Array.from(result.parts,p=>p.name),['预算','第二张']);assert.match(result.parts[0].html,/中文/);assert.match(result.parts[0].html,/1,234\.50/);assert.match(result.parts[0].html,/colspan="2"/);
});
test('RTF handles Unicode fallbacks, Chinese byte sequences, scoped formatting and safe field results',async()=>{
  await extraRenderers();const {rtfSample}=await import('./fixtures/additional-document-formats.mjs');
  const result=renderer.convertRtf(new TextEncoder().encode(rtfSample).buffer);
  assert.equal((result.value.match(/中文/g)||[]).length,2);assert.match(result.value,/Safe field result/);assert.match(result.value,/cg-page-break/);assert.match(result.value,/<td[^>]*>.*Cell one/);
  assert.ok(result.formatting.styles.some(s=>s['font-weight']==='700'));assert.doesNotMatch(result.value,/PROGRAM|INCLUDEPICTURE|tracker/);
  assert.throws(()=>renderer.convertRtf(new TextEncoder().encode('{\\rtf1{bad').buffer));
});
test('OpenDocument preserves headings, table spans and slide navigation, bounds repetition and excludes remote/active content',async()=>{
  await extraRenderers();const {odfEntries}=await import('./fixtures/additional-document-formats.mjs');
  const doc=await renderer.convertOpenDocument(storedZip(odfEntries('odt')),'odt');assert.match(doc.value,/开放文档/);assert.match(doc.value,/cg-page-break/);assert.ok(doc.formatting.styles.some(s=>s['font-size']==='22pt'));
  const sheet=await renderer.convertOpenDocument(storedZip(odfEntries('ods')),'ods');assert.equal(sheet.parts.length,2);assert.match(sheet.parts[0].html,/1,200\.50/);assert.match(sheet.parts[0].html,/colspan="2"/);assert.ok(sheet.parts[0].html.length<2000,'empty repeated tail is not expanded');
  const slides=await renderer.convertOpenDocument(storedZip(odfEntries('odp')),'odp');assert.equal(slides.parts.length,2);assert.match(slides.parts[1].html,/Second slide content/);assert.ok(slides.formatting.styles.some(s=>s.left==='56.693pt'));
  assert.doesNotMatch(JSON.stringify([doc,sheet,slides]),/tracker|EXECUTABLE|<script/);
  const huge=odfEntries('ods');huge['content.xml']=huge['content.xml'].replace('<table:table-row>','<table:table-row table:number-rows-repeated="999999">');await assert.rejects(renderer.convertOpenDocument(storedZip(huge),'ods'));
  const encrypted=odfEntries('odt');encrypted['META-INF/manifest.xml']=encrypted['META-INF/manifest.xml'].replace('</manifest:manifest>','<manifest:encryption-data/></manifest:manifest>');await assert.rejects(renderer.convertOpenDocument(storedZip(encrypted),'odt'));
  const entity=odfEntries('odt');entity['content.xml']='<!DOCTYPE a [<!ENTITY e SYSTEM "https://tracker.invalid">]>'+entity['content.xml'];await assert.rejects(renderer.convertOpenDocument(storedZip(entity),'odt'));
});
test('EML decodes MIME headers and multipart bodies while keeping attachments inert',async()=>{
  await extraRenderers();const {emailSample}=await import('./fixtures/additional-document-formats.mjs');
  const result=await renderer.convertEmail(new TextEncoder().encode(emailSample).buffer,{from:'发件人',attachments:'附件'});
  assert.match(result.value,/邮件预览/);assert.match(result.value,/测试 &lt;author@example.test&gt;/);assert.match(result.value,/发件人/);assert.match(result.value,/HTML body/);assert.doesNotMatch(result.value,/Plain fallback/);
  assert.match(result.value,/<li>test.exe<\/li>/);assert.doesNotMatch(result.value,/TVpOb3R|NotActualExecutable/);
});

test('document cache rejects empty chunks, replay and out-of-order uploads', async () => {
  const {blobCommand,hasBlobs}=await import('../extension/offscreen/blob-cache.js');
  for(const [id,offset,data] of [['empty',0,''],['order',2,btoa('a')],['encoding',0,' YQ==']]) {
    blobCommand({operation:'begin',id,size:5});
    assert.throws(()=>blobCommand({operation:'chunk',id,offset,data}));
    assert.equal(hasBlobs(),false);
  }
  blobCommand({operation:'begin',id:'replay',size:5});
  blobCommand({operation:'chunk',id:'replay',offset:0,data:btoa('ab')});
  assert.throws(()=>blobCommand({operation:'chunk',id:'replay',offset:0,data:btoa('ab')}));
  assert.equal(hasBlobs(),false);
});

test('document loading feedback has no fabricated percentage and clears on success or failure', () => {
  const label={textContent:''},progress={hidden:true};
  const status=createDocumentStatus(label,progress);
  status.loading('Preparing the document…');assert.equal(progress.hidden,false);
  status.show('Ready');assert.equal(progress.hidden,true);
  status.loading('Preparing the document…');status.show('Could not prepare');assert.equal(progress.hidden,true);
});

test('Document Preview whitelist includes subdomains and ports, preserves order and keeps prepared previews', async () => {
  const {documentPreviewWhitelisted}=await import('../extension/core/document-preview/document-preview.js');
  const settings=normalizeSettings({documentPreview:{whitelistDomains:['B.example.com','*.example.org','b.example.com','192.0.2.1','[2001:db8::1]','https://invalid/path']}});
  const domains=settings.documentPreview.whitelistDomains;
  assert.deepEqual(domains,['b.example.com','example.org','192.0.2.1','[2001:db8::1]']);
  assert.deepEqual(settingsViewCache(settings).documentPreview.whitelistDomains,domains);
  for(const url of ['https://b.example.com:8443','https://a.b.example.com','https://example.org','http://192.0.2.1:80','https://[2001:db8::1]:444'])assert.equal(documentPreviewWhitelisted(url,domains),true,url);
  for(const url of ['https://notb.example.com','https://example.org.evil.test','https://example.com','invalid'])assert.equal(documentPreviewWhitelisted(url,domains),false,url);
  const env=environment();await env.capture();await env.settle();await env.choose();
  const doc=[...env.files.values()][0];const context={sender:{url:'chrome-extension://test/settings/satellites.html'}};
  const command=(type,rule)=>env.product.handleMessage({type,listName:'whitelistDomains',rule},context);
  await command('UI_ADD_RULE','z.example.net');await command('UI_ADD_RULE','*.example.com');
  assert.deepEqual((await env.platform.readSettings()).documentPreview.whitelistDomains,['z.example.net','example.com']);
  const before=env.calls.filter(v=>v==='cancel').length;await env.capture();await env.settle();assert.equal(env.calls.filter(v=>v==='cancel').length,before);assert.equal(env.files.size,1);
  const workspace={sender:{url:'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+doc.id}};
  assert.equal((await env.product.handleMessage({type:'UI_DOCUMENT_GET',id:doc.id},workspace)).prepared,true);
  await assert.rejects(env.product.handleMessage({type:'UI_ADD_RULE',listName:'whitelistDomains',rule:'evil.test'},workspace));
  await command('UI_ALPHABETIZE_RULES');assert.deepEqual((await env.platform.readSettings()).documentPreview.whitelistDomains,['example.com','z.example.net']);
  await command('UI_DELETE_RULE','example.com');await env.capture();await env.settle();assert.equal(env.calls.filter(v=>v==='cancel').length,before+1);
  await command('UI_CLEAR_RULES');assert.deepEqual((await env.platform.readSettings()).documentPreview.whitelistDomains,[]);
});

test('binary DOC preserves inherited/direct styles, list markers, paragraph layout, real tables and hides hidden runs',async()=>{
  const XLSX=await extraRenderers(),{cfbFile,formattedWordStreams}=await import('./fixtures/additional-document-formats.mjs');
  const source=formattedWordStreams(),result=renderer.convertLegacyWord(cfbFile(XLSX,source)),styles=result.formatting.styles;
  assert.match(result.value,/<h1[^>]*>.*Heading/);assert.match(result.value,/cg-list-marker[^>]*>1\. /);assert.match(result.value,/<table.*Left.*Right/);assert.doesNotMatch(result.value,/Hidden/);assert.match(result.value,/visible/);
  assert.ok(styles.some(s=>s['font-size']==='20pt'&&s['font-weight']==='700'));
  assert.ok(styles.some(s=>s['margin-left']==='36pt'&&s['text-indent']==='18pt'&&s['margin-bottom']==='12pt'));
  const emphasis=result.value.match(/<span class="cg-f(\d+)">body<\/span>/);assert.ok(emphasis);assert.equal(styles[Number(emphasis[1])]['font-size'],'13pt','character style does not replace the paragraph font size');assert.equal(styles[Number(emphasis[1])]['font-style'],'italic');
  assert.ok(styles.some(s=>s.width==='120pt'&&s['border-top-style']==='solid'));
  assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),JSON.parse(JSON.stringify(styles)));
  source.WordDocument[4*512+511]=255;assert.throws(()=>renderer.convertLegacyWord(cfbFile(XLSX,source)),/invalidDocument/);
});
test('binary XLS retains BIFF fonts, palette colors, fills, wrapping and borders alongside saved number formats',async()=>{
  const XLSX=await extraRenderers(),{styledXls}=await import('./fixtures/additional-document-formats.mjs');
  const result=renderer.convertLegacySpreadsheet(styledXls(XLSX),XLSX),styles=result.formatting.styles;
  assert.match(result.parts[0].html,/Styled workbook/);assert.match(result.parts[0].html,/1,234\.50/);
  const style=styles.find(s=>s['font-size']==='16pt');assert.ok(style);assert.equal(style['font-weight'],'700');assert.equal(style['font-style'],'italic');assert.equal(style.color,'#ff0000');assert.equal(style['background-color'],'#ffff00');assert.equal(style['white-space'],'pre-wrap');assert.equal(style['border-left-style'],'solid');
  assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),JSON.parse(JSON.stringify(styles)));
});
test('binary PPT retains text box coordinates, colors, paragraph spacing and character sizes without duplicating text',async()=>{
  const XLSX=await extraRenderers(),{cfbFile,formattedPresentationStreams}=await import('./fixtures/additional-document-formats.mjs');
  const result=renderer.convertLegacyPresentation(cfbFile(XLSX,formattedPresentationStreams())),styles=result.formatting.styles;
  assert.equal((result.parts[0].html.match(/Positioned title/g)||[]).length,1);
  assert.ok(styles.some(s=>s.left==='72pt'&&s.top==='36pt'&&s.width==='576pt'&&s['background-color']==='#ccddee'));
  assert.ok(styles.some(s=>s['font-size']==='28pt'&&s['font-weight']==='700'&&s.color==='#003366'));
  assert.ok(styles.some(s=>s['text-align']==='center'&&s['line-height']==='1.5'));
  assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),JSON.parse(JSON.stringify(styles)));
});
test('XLSX preserves rich text without phonetic duplication and carries hidden merge roots to the visible grid',async()=>{
  await extraRenderers();const entries=spreadsheetEntries();
  entries['xl/sharedStrings.xml']=entries['xl/sharedStrings.xml'].replace('<r><t>Shared </t></r>','<r><rPr><rFont val="Arial"/><b/><u val="double"/><color indexed="10"/></rPr><t>Shared </t></r><rPh sb="0" eb="1"><t>PHONETIC</t></rPh>');
  entries['xl/worksheets/sheet1.xml']=entries['xl/worksheets/sheet1.xml'].replace('width="26"','width="26" hidden="1"');
  const result=await renderer.convertSpreadsheet(storedZip(entries)),html=result.parts[0].html;
  assert.doesNotMatch(html,/>A<|PHONETIC/);assert.match(html,/colspan="2".*Shared /);assert.ok(result.formatting.styles.some(s=>s['text-decoration-style']==='double'&&s.color==='#ff0000'));
  entries['xl/worksheets/sheet1.xml']=entries['xl/worksheets/sheet1.xml'].replace('</mergeCells>','<mergeCell ref="B4:C4"/></mergeCells>');
  await assert.rejects(renderer.convertSpreadsheet(storedZip(entries)),/invalidDocument/,'overlapping merges cannot cause repeated unbounded area scans');
});
test('RTF preserves local fonts, colors, indents, spacing, table geometry and resets hidden text',async()=>{
  await extraRenderers();const sample=String.raw`{\rtf1\ansi{\fonttbl{\f0\fcharset0 Georgia;}}{\colortbl;\red0\green51\blue102;\red221\green238\blue255;}\paperw11906\margl1200\f0\cf1\fs28\li720\fi360\sa240\sl360\slmult1 Visible \v HIDDEN\v0 restored\par\pard\trowd\trrh600\clcbpat2\clbrdrt\brdrs\brdrw20\brdrcf1\cellx2400\cellx6000\intbl Left\cell Right\cell\row\pard End}`;
  const result=renderer.convertRtf(new TextEncoder().encode(sample).buffer),styles=result.formatting.styles;
  assert.doesNotMatch(result.value,/HIDDEN/);assert.match(result.value,/restored/);assert.ok(styles.some(s=>s.color==='#003366'&&s['font-family']==='"Georgia",serif'));
  assert.ok(styles.some(s=>s['margin-left']==='36pt'&&s['text-indent']==='18pt'&&s['line-height']==='1.5'));
  assert.ok(styles.some(s=>s.width==='120pt'&&s['background-color']==='#ddeeff'&&s['border-top-width']==='1pt'));
  assert.equal(result.formatting.page.width,'595.3pt');assert.equal(result.formatting.page.left,'60pt');
});
test('OpenDocument style families remain independent and retain numbered lists, borders, page metrics and scalar cells',async()=>{
  await extraRenderers();const {odfEntries}=await import('./fixtures/additional-document-formats.mjs');
  const doc=odfEntries('odt');doc['content.xml']=doc['content.xml'].replace('</office:automatic-styles>',`<style:style style:name="Heading" style:family="text"><style:text-properties fo:font-size="9pt"/></style:style><text:list-style style:name="Numbered"><text:list-level-style-number text:level="1" style:num-format="I" text:start-value="3"/></text:list-style><style:page-layout style:name="Page"><style:page-layout-properties fo:page-width="21cm" fo:margin-left="2cm"/></style:page-layout><style:master-page style:name="Standard" style:page-layout-name="Page"/></office:automatic-styles>`).replace('</office:text>','<text:list text:style-name="Numbered"><text:list-item><text:p>Third item</text:p></text:list-item></text:list></office:text>');
  const result=await renderer.convertOpenDocument(storedZip(doc),'odt');assert.ok(result.formatting.styles.some(s=>s['font-size']==='22pt'));assert.match(result.value,/<ol start="3"/);assert.ok(result.formatting.styles.some(s=>s['list-style-type']==='upper-roman'));assert.equal(result.formatting.page.width,'595.276pt');
  const sheet=odfEntries('ods');sheet['content.xml']=sheet['content.xml'].replace('office:value-type="float" office:value="1200.5"><text:p>1,200.50</text:p>','office:value-type="date" office:date-value="2026-09-22">');
  assert.match((await renderer.convertOpenDocument(storedZip(sheet),'ods')).parts[0].html,/2026-09-22/);
});
test('XLSX separate negative number sections preserve minus signs and parentheses',async()=>{
 await extraRenderers();const entries=spreadsheetEntries();
 entries['xl/styles.xml']=entries['xl/styles.xml'].replace('</numFmts>','<numFmt numFmtId="180" formatCode="0.00;[Red]-0.00"/><numFmt numFmtId="181" formatCode="0.00;(0.00)"/></numFmts>').replace('</cellXfs>','<xf numFmtId="180"/><xf numFmtId="181"/></cellXfs>');
 const count=(entries['xl/styles.xml'].match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b/g)||[]).length;
 entries['xl/worksheets/sheet1.xml']=entries['xl/worksheets/sheet1.xml'].replace(/<sheetData>[\s\S]*?<\/sheetData>/,'<sheetData><row r="1"><c r="A1" s="'+(count-2)+'"><v>-123.5</v></c><c r="B1" s="'+(count-1)+'"><v>-123.5</v></c></row></sheetData>').replace(/<mergeCells>[\s\S]*?<\/mergeCells>/,'');
 const result=await renderer.convertSpreadsheet(storedZip(entries));assert.match(result.parts[0].html,/>-123\.50<\/td>/);assert.match(result.parts[0].html,/>\(123\.50\)<\/td>/);
});

test('PPTX retains paragraph spacing, numbering starts and superscript runs',async()=>{
  await extraRenderers();const entries=presentationEntries();entries['ppt/slides/slide1.xml']=entries['ppt/slides/slide1.xml'].replace('<a:p><a:r>','<a:p><a:pPr><a:spcBef><a:spcPts val="1200"/></a:spcBef><a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:buAutoNum type="romanUcPeriod" startAt="3"/></a:pPr><a:r>').replace('sz="3200" b="1"','sz="3200" b="1" baseline="30000"');
  const result=await renderer.convertPresentation(storedZip(entries));assert.match(result.parts[0].html,/III\. <sup/);assert.ok(result.formatting.styles.some(s=>s['margin-top']==='12pt'&&s['line-height']==='1.5'));
});

test('binary Word applies separate Chinese and Latin font slots with local-only GB2312 fallbacks',async()=>{
 const XLSX=await extraRenderers(),{cfbFile,formattedWordStreams}=await import('./fixtures/additional-document-formats.mjs');
 const result=renderer.convertLegacyWord(cfbFile(XLSX,formattedWordStreams({mixedFonts:true}))),styles=result.formatting.styles;
 const chinese=result.value.match(/<span class="cg-f(\d+)">中文<\/span>/),latin=result.value.match(/<span class="cg-f(\d+)">Indented <\/span>/);assert.ok(chinese);assert.ok(latin);
 const c=styles[Number(chinese[1])]['font-family'],l=styles[Number(latin[1])]['font-family'];
 assert.match(c,/^"仿宋_GB2312"/);assert.match(c,/STFangsong/);assert.match(l,/^"Courier New"/);assert.notEqual(c,l);
 assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),JSON.parse(JSON.stringify(styles)));
});

test('DOCX retains Chinese GB2312 fonts separately from Latin fonts and explicit fonts override inherited themes',async()=>{
 const entries=formattingEntries();
 entries['word/document.xml']='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="仿宋_GB2312"/></w:rPr><w:t>Latin 中文正文 123</w:t></w:r></w:p></w:body></w:document>';
 entries['word/styles.xml']='<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorAscii" w:eastAsiaTheme="minorEastAsia"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>';
 const result=await convert(entries),chinese=result.value.match(/<span class="cg-f(\d+)">中文正文<\/span>/);assert.ok(chinese);
 assert.match(result.formatting.styles[Number(chinese[1])]['font-family'],/^"仿宋_GB2312","FangSong_GB2312"/);
 assert.ok(result.formatting.styles.some(s=>s['font-family']?.startsWith('"Courier New"')));
 assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),JSON.parse(JSON.stringify(result.formatting.styles)));
});
test('DOCX keeps distinct Chinese typefaces through paragraph, character and table inheritance',async()=>{
 const entries=formattingEntries(),fonts=['宋体','黑体','楷体_GB2312','仿宋_GB2312','华文中宋'];
 entries['word/styles.xml']='<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/></w:rPr></w:style><w:style w:type="character" w:styleId="Kaiti"><w:rPr><w:rFonts w:eastAsia="楷体_GB2312"/></w:rPr></w:style></w:styles>';
 entries['word/document.xml']='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc>'+fonts.map((font,i)=>'<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="'+font+'"/></w:rPr><w:t>字型'+String.fromCharCode(0x4e00+i)+'</w:t></w:r></w:p>').join('')+'</w:tc></w:tr></w:tbl><w:p><w:r><w:rPr><w:rStyle w:val="Kaiti"/></w:rPr><w:t>继承楷体</w:t></w:r></w:p></w:body></w:document>';
 const result=await convert(entries);
 for(const [i,font]of fonts.entries()){
  const span=result.value.match(new RegExp('<span class="cg-f(\\d+)">字型'+String.fromCharCode(0x4e00+i)+'</span>'));assert.ok(span,font);
  assert.ok(result.formatting.styles[Number(span[1])]['font-family'].startsWith('"'+font+'",'),font);
 }
 const inherited=result.value.match(/<span class="cg-f(\d+)">继承楷体<\/span>/);assert.ok(inherited);assert.match(result.formatting.styles[Number(inherited[1])]['font-family'],/^"楷体_GB2312","KaiTi_GB2312"/);
});

test('PPTX keeps explicit East Asian fonts separate from Latin fonts',async()=>{
 await extraRenderers();const entries=presentationEntries();
 entries['ppt/slides/slide1.xml']=entries['ppt/slides/slide1.xml'].replace(/<a:rPr([^>]*)\/>/,'<a:rPr$1><a:latin typeface="Courier New"/><a:ea typeface="黑体"/></a:rPr>');
 const result=await renderer.convertPresentation(storedZip(entries)),html=result.parts[0].html;
 assert.match(html,/<span class="cg-f\d+">第一张幻灯片/);
 assert.ok(result.formatting.styles.some(s=>s['font-family']?.startsWith('"黑体","SimHei"')));
 assert.ok(result.formatting.styles.some(s=>s['font-family']?.startsWith('"Courier New"')));
});

test('DOCX preserves blank fields and uses paragraph-mark metrics without changing text-run sizes',async()=>{
 const entries=formattingEntries();
 entries['word/styles.xml']='<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>';
 entries['word/settings.xml']='<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="420"/></w:settings>';
 entries['word/document.xml']='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:spacing w:afterLines="50"/><w:rPr><w:sz w:val="48"/><w:b/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">　　Name:    </w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">            </w:t></w:r><w:r><w:tab/><w:t>Next</w:t></w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>';
 const result=await convert(entries),styles=result.formatting.styles;
 assert.match(result.value,/　　Name:    <\/span>/);assert.match(result.value,/> {12}<\/span>/);assert.match(result.value,/\tNext/);
 const blank=result.value.match(/<span class="cg-f(\d+)"> {12}<\/span>/);assert.equal(styles[Number(blank[1])]['text-decoration-line'],'underline');assert.equal(styles[Number(blank[1])]['font-size'],'12pt');assert.notEqual(styles[Number(blank[1])]['font-weight'],'700');
 assert.ok(styles.some(s=>s['font-size']==='24pt'&&s['margin-bottom']==='0.5em'&&s['tab-size']==='21pt'));
 assert.ok(styles.some(s=>s['margin-top']==='0pt'&&s['margin-bottom']==='0pt'));
 assert.match(documentStyles(result.formatting),/p,h1,h2,h3,h4,h5,h6,li\{white-space:break-spaces/);
 assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),JSON.parse(JSON.stringify(styles)));
});

test('document information uses decimal size units rather than fixed binary KiB',()=>{
 for(const [bytes,label]of [[0,'0 bytes'],[1,'1 byte'],[2,'2 bytes'],[999,'999 bytes'],[1000,'1 KB'],[44544,'44.5 KB'],[1048576,'1 MB'],[999999,'1 MB'],[1e9,'1 GB']])assert.equal(formatDocumentBytes(bytes,'en-US'),label);
 assert.equal(formatDocumentBytes(NaN),'');assert.equal(formatDocumentBytes(-1),'');assert.equal(formatDocumentBytes(1500000,'zh-CN'),'1.5 MB');
});

test('Word-family content keeps passive equations, ruby, checkbox text, picture sizes and authored run overrides', async () => {
  const result=await convert(readingEntries()),styles=JSON.parse(JSON.stringify(result.formatting.styles));
  assert.match(result.value,/<math display="inline"><mrow><mfrac>/);
  assert.match(result.value,/<math display="block">/);assert.match(result.value,/<msqrt>/);
  assert.match(result.value,/<ruby>.*汉.*<rt>.*hàn/);
  assert.match(result.value,/☑/);assert.doesNotMatch(result.value,/HIDDEN|LOST CHECKBOX|<input/);
  assert.match(result.value,/<img[^>]+class="cg-f\d+"/);
  assert.ok(styles.some(s=>s.width==='100pt'&&s['aspect-ratio']==='2'));
  const italic=styles[Number(result.value.match(/class="cg-f(\d+)" lang="en-US">Italic/)[1])];
  assert.equal(italic['font-style'],'italic');assert.equal(italic['vertical-align'],'2pt');assert.equal(italic['font-kerning'],'normal');
  const first=styles[Number(result.value.match(/<p class="cg-f(\d+)"><span[^>]*>First contextual/)[1])];
  assert.equal(first['margin-bottom'],'0pt');
  assert.ok(styles.some(s=>s['padding-bottom']==='6pt'&&s['text-align-last']==='justify'));
  assert.ok(styles.some(s=>s['border-top-style']==='none'&&s['padding-left']==='5.4pt'));
  assert.ok(styles.some(s=>s['tab-size']==='48pt'));
  assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),styles);
  for(const format of ['docm','dotx','dotm']){
    const entries=readingEntries();entries['[Content_Types].xml']=entries['[Content_Types].xml'].replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', ({docm:'application/vnd.ms-word.document.macroEnabled.main+xml',dotx:'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',dotm:'application/vnd.ms-word.template.macroEnabledTemplate.main+xml'})[format]);
    // Family dispatch uses the requested suffix; macros never become content.
    if(format.endsWith('m'))entries['word/vbaProject.bin']='INERT MACRO';
    const buffer=storedZip(entries);await validateOfficeContent(buffer,format);
    const variant=await renderer.convertToHtml({arrayBuffer:buffer},{externalFileAccess:false});
    assert.equal(variant.value,result.value,format);
  }
});

test('binary DOC follows live picture references, preserves character spacing and safe hyperlink field results', async () => {
  const XLSX=await extraRenderers(),{cfbFile,readingWordStreams,wordStreams}=await import('./fixtures/additional-document-formats.mjs');
  const streams=readingWordStreams(),result=renderer.convertLegacyWord(cfbFile(XLSX,streams));
  assert.match(result.value,/Name: {10}/);assert.match(result.value,/<img[^>]+src="data:image\/png;base64,/);
  assert.match(result.value,/<a href="https:\/\/example.test\/guide"><span[^>]*>Guide/);
  assert.doesNotMatch(result.value,/HYPERLINK|UNSUPPORTED METAFILE/);
  assert.ok(result.formatting.styles.some(s=>s['letter-spacing']==='1pt'&&s['vertical-align']==='2pt'&&s['font-kerning']==='normal'&&s['text-decoration-style']==='double'));
  assert.ok(result.formatting.styles.some(s=>s.width==='100pt'&&s['aspect-ratio']==='2'));
  assert.ok(result.formatting.styles.some(s=>s['tab-size']==='48pt'));
  assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),JSON.parse(JSON.stringify(result.formatting.styles)));
  const unsafe=renderer.convertLegacyWord(cfbFile(XLSX,wordStreams('\x13HYPERLINK "javascript:alert(1)"\x14Only text\x15\r')));
  assert.match(unsafe.value,/Only text/);assert.doesNotMatch(unsafe.value,/<a |javascript/);
  const corrupt=readingWordStreams();corrupt.Data.writeUInt32LE(0xffffff,72);assert.throws(()=>renderer.convertLegacyWord(cfbFile(XLSX,corrupt)),/invalidDocument/);
});

test('legacy Office decodes raster record IDs and rejects metafile records even when they contain PNG-like bytes',async()=>{
  const XLSX=await extraRenderers(),{cfbFile,formattedPresentationStreams,readingWordStreams}=await import('./fixtures/additional-document-formats.mjs');
  const result=renderer.convertLegacyPresentation(cfbFile(XLSX,formattedPresentationStreams({embeddedImage:true})));
  assert.match(result.parts[0].html,/<img class="cg-slide-picture" src="data:image\/png;base64,/);
  const unsupported=readingWordStreams(),at=68+8+Buffer.byteLength('UNSUPPORTED METAFILE');
  unsupported.Data.writeUInt16LE(0xf01a,at+2);
  assert.doesNotMatch(renderer.convertLegacyWord(cfbFile(XLSX,unsupported)).value,/<img/);
});

test('preview opens beside its current source tab in that window, including remembered choices and cached files',async()=>{
  const env=environment();Object.assign(env.tabs[0],{index:2,windowId:9});
  await env.capture();await env.settle();env.tabs[0].index=5;
  await env.choose(undefined,'preview',true);
  let opened=env.calls.filter(c=>c[0]==='open').at(-1)[1];
  assert.deepEqual({index:opened.index,windowId:opened.windowId,openerTabId:opened.openerTabId},{index:6,windowId:9,openerTabId:1});
  env.tabs[0].index=1;await env.capture();await env.settle();
  opened=env.calls.filter(c=>c[0]==='open').at(-1)[1];assert.equal(opened.index,2);
  // The same cached file may be requested from a different source tab.
  Object.assign(env.tabs[0],{id:8,index:3,windowId:12});env.ingress.take=()=>({method:'GET',tabId:8});
  await env.capture();await env.settle();opened=env.calls.filter(c=>c[0]==='open').at(-1)[1];
  assert.equal(opened.openerTabId,8);assert.equal(opened.windowId,12);assert.equal(opened.index,4);
  const fallback=environment();Object.assign(fallback.tabs[0],{index:0,windowId:7});
  chrome.scripting.executeScript=async()=>{throw Error('restricted page');};
  await fallback.capture();await fallback.settle();opened=fallback.calls.filter(c=>c[0]==='open').at(-1)[1];
  assert.equal(opened.index,1);assert.equal(opened.windowId,7);assert.match(opened.url,/mode=choose/);
});

test('Word lists preserve nested formats, continued counts, explicit restarts, style-linked levels and long hanging labels',async()=>{
 const {listEntries}=await import('./fixtures/document-formatting.mjs');const result=await convert(listEntries());
 const labels=[...result.value.matchAll(/class="cg-list-marker[^"]*">([^<]+)<\/span>/g)].map(m=>m[1].trimEnd());
 assert.deepEqual(labels,['一、','一.a)','1.1.1)','二、','二.b)','2.2.1)','十二、','•','998.','999.','1000.']);
 assert.equal((result.value.match(/class="cg-list-content"/g)||[]).length,11);
 assert.match(result.value,/<p class="cg-f\d+"><span[^>]*>Cancelled numbering/);
 const styles=JSON.parse(JSON.stringify(result.formatting.styles));
 assert.ok(styles.some(s=>s['margin-left']==='18pt'&&s['text-indent']==='0pt'));
 assert.ok(styles.some(s=>s['min-width']==='18pt'&&s['text-align']==='right'&&s['padding-right']==='0.35em'));
 assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(result.formatting))),styles);
 const entries=listEntries();entries['word/document.xml']=entries['word/document.xml'].replace('</w:numPr>', '</w:numPr><w:ind w:hangingChars="200"/>');
 const mixed=await convert(entries);assert.ok(mixed.formatting.styles.some(s=>s['margin-left']==='calc(36pt - 2em)'));
 assert.deepEqual(JSON.parse(JSON.stringify(acceptedStyles(mixed.formatting))),JSON.parse(JSON.stringify(mixed.formatting.styles)));
});

test('binary Word lists keep Chinese/letter formats, uninterrupted counts, independent restarts and bullet gutters',async()=>{
 const XLSX=await extraRenderers(),{cfbFile,listWordStreams}=await import('./fixtures/additional-document-formats.mjs');
 const result=renderer.convertLegacyWord(cfbFile(XLSX,listWordStreams()));
 assert.deepEqual([...result.value.matchAll(/class="cg-list-marker[^\"]*">([^<]+)<\/span>/g)].map(m=>m[1].trimEnd()),['九、','九.a)','九.b)','十、','十.c)','九、','•']);
 assert.equal((result.value.match(/class="cg-list-content"/g)||[]).length,7);
 assert.ok(result.formatting.styles.some(s=>s['margin-left']==='36pt'&&s['text-indent']==='0pt'));
 assert.ok(result.formatting.styles.some(s=>s['min-width']==='18pt'&&s['padding-right']==='0.35em'));
});
