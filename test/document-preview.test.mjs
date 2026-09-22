import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { formattingEntries } from './fixtures/document-formatting.mjs';
import { acceptedStyles, formatStylesheet } from '../extension/workspaces/document-preview/format-styles.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { inspectDocx, validateDocxContent, docxFilename, readDocumentResponse, DOCUMENT_LIMIT, DOCUMENT_CLOSED_RETENTION, DOCUMENT_CLEANUP_ALARM_PREFIX } from '../extension/core/document-preview.js';
import { siteKey } from '../extension/core/site-key.js';
import { createDocumentRequestIngress } from '../extension/background/features/document-request-ingress.js';
import { createDocumentPreviewProduct } from '../extension/background/products/standing/document-preview.js';
import { createDocumentStatus } from '../extension/workspaces/document-preview/status.js';
import { previewSrcdoc } from '../extension/workspaces/document-preview/sanitize.js';

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
  assert.equal(inspectDocx(sampleDocx()).entries, 3);
  assert.throws(() => inspectDocx(new ArrayBuffer(DOCUMENT_LIMIT + 1)));
  assert.throws(() => inspectDocx(storedZip({ text: 'Not DOCX' })));
  assert.throws(() => inspectDocx(storedZip({ '[Content_Types].xml': '', 'word/document.xml': '', '../evil': '' })));
  assert.throws(() => inspectDocx(storedZip({ '[Content_Types].xml': '', 'word/document.xml': '', 'word/vbaProject.bin': 'macro' })));
  const inflated = sampleDocx(), view = new DataView(inflated);
  const directory = view.getUint32(inflated.byteLength - 6, true);
  view.setUint32(directory + 24, 90 * 1024 * 1024, true);
  assert.throws(() => inspectDocx(inflated));
  assert.equal(docxFilename({ filename: '/downloads/通知.DOCX' }), '通知.DOCX');
  assert.equal(docxFilename({ filename: 'notice.doc' }), '');
  assert.deepEqual(await readDocumentResponse(new Response(sampleDocx())), sampleDocx());
  await assert.rejects(readDocumentResponse(new Response('login page')));
  const compressed = storedZip({ '[Content_Types].xml': 'a'.repeat(4096), 'word/document.xml': '<document/>' }, true);
  await validateDocxContent(compressed);
  const zippedView = new DataView(compressed);
  zippedView.setUint32(zippedView.getUint32(compressed.byteLength - 6, true) + 24, 16, true);
  assert.doesNotThrow(() => inspectDocx(compressed), 'the directory falsely claims a small expanded entry');
  await assert.rejects(validateDocxContent(compressed), /invalidDocx/, 'actual inflation must be bounded as well');
});

function environment({ enabled = true, fetchResult, method = 'GET', incognito = false } = {}) {
  const saved = {}, files = new Map(), calls = [], alarms = new Map();
  const tabs = [{ id: 1, url: 'https://a.example.com/article', incognito }, { id: 2, url: 'https://b.example.com/other', incognito }];
  let settings = normalizeSettings({ documentPreview: { enabled } });
  const store = { get: async id => files.get(id), all: async () => [...files.values()], put: async doc => { files.set(doc.id, doc); calls.push('store'); }, remove: async id => files.delete(id) };
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

test('turning Document Preview off prevents an outstanding metadata prompt from creating a cache', async () => {
  const env = environment(); await env.capture(); await env.settle();
  const doc = env.documents()[0];
  await env.product.handleMessage({type:'UI_SET_ENABLED',enabled:false},{sender:{url:'chrome-extension://test/settings/satellites.html'}});
  await assert.rejects(env.choose(doc),/documentPreviewDisabled/);
  assert.equal(env.files.size,0); assert.ok(!env.calls.includes('fetch'));
});

test('website choice spans subdomains and ends only after the last matching tab leaves', async () => {
  const env = environment(); await env.capture(); await env.settle();
  const doc = env.documents()[0];
  await env.choose(doc, 'download', true);
  assert.equal(env.files.size,1); assert.ok(env.calls.includes('fetch'));
  assert.match(env.calls.find(value=>value[0]==='open')[1].url,/mode=download/);
  assert.equal((await env.product.state({ documentPreview: { enabled: true } }, env.tabs[1].url)).choice, 'download');
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
  env.files.set(doc.id, doc); delete env.saved['documentPreview:regular'];
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
  await env.product.handleMessage({ type: 'UI_DOCUMENT_DOWNLOAD', id: doc.id, blobUrl: 'blob:chrome-extension://test/1234' }, { sender: { url: workspace } });
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
  await env.product.handleMessage({ type: 'UI_DOCUMENT_DOWNLOAD', id: doc.id, blobUrl: 'blob:chrome-extension://test/1234' }, { sender: { url: workspace } });
  assert.equal(env.calls.find(value => value[0] === 'download')[1].saveAs, undefined);
  let suggested;
  assert.equal(env.product.handleDeterminingFilename({ byExtensionId: 'test', url: 'blob:chrome-extension://test/1234' }, value => suggested = value), true);
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
    const context = { ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int32Array, DataView, setTimeout, clearTimeout, console, TextDecoder };
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
  assert.equal(heading.color, '#2468ac'); assert.match(heading['font-family'], /Calibri.*宋体.*serif/);
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
  assert.equal(result.formatting.styles.length, 1);
  assert.equal((result.value.match(/Repeated/g) || []).length, 200);
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
  chrome.storage.session.set = async () => { throw Error('storage unavailable'); };
  await assert.rejects(env.product.handleMessage({...command,theme:'dark'},{sender}), /storage unavailable/);
  assert.equal((await env.product.handleMessage({type:'UI_DOCUMENT_GET',id:doc.id},{sender})).siteTheme,'light','a failed write cannot change the authoritative session preference');
});

test('closed previews expire after ten hours, with open copies and source sessions respected', async t => {
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
  assert.equal(env.files.size,0,'source-site closure expires bytes before the ten-hour deadline, even while capture is off');
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
  assert.match(previewSrcdoc('<p>Text</p>','en-US'), /@media\(prefers-color-scheme:dark\)\{html\{background:#202124;color:#f1f3f4\}/);
  const css = formatStylesheet({styles:[{color:'#000000'},{color:'#333333'},{color:'#ffffff'},{color:'#2468ac'},{'background-color':'#ffffff'}]});
  const dark = css.slice(css.indexOf('@media'));
  for(let i=0;i<3;i++)assert.ok(dark.includes('.cg-f'+i+'{color:#f1f3f4}'));
  assert.match(dark, /cg-f3\{color:#[a-f0-9]{6}\}/);
  assert.doesNotMatch(dark, /cg-f3\{color:#f1f3f4\}/, 'colored source text retains its hue');
  assert.match(dark, /background-color:#292929/);
});
