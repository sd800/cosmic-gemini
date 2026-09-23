import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDF_LIMITS, pdfDetailCanvasPixels, pdfScale, stepPdfScale, pdfOptions, printRange, rotateLeft, safePdfLink, pdfFileSize } from '../extension/workspaces/pdf-viewer/model.js';
import { formatPdfDate } from '../extension/workspaces/pdf-viewer/document-dates.js';
import { labels } from '../extension/workspaces/pdf-viewer/labels.js';
import { createPdfViewer } from '../extension/workspaces/pdf-viewer/host.js';
import { toggleDocumentAppearance } from '../extension/core/document-appearance.js';
const root = new URL('../extension/', import.meta.url);
test('PDF properties preserve ISO date order, optional seconds and original offsets', () => {
  assert.equal(formatPdfDate("D:20260102123456+05'30'"), '2026-01-02 12:34:56 (UTC+5:30)');
  assert.equal(formatPdfDate("D:202602031012-08'00'"), '2026-02-03 10:12 (UTC-8)');
  assert.equal(formatPdfDate('D:20260923080000Z'), '2026-09-23 08:00:00 (UTC)');
  assert.equal(formatPdfDate('202402291030'), '2024-02-29 10:30');
  assert.equal(formatPdfDate('D:20260923103000'), '2026-09-23 10:30:00');
  assert.equal(formatPdfDate('D:20260923'), '2026-09-23 00:00');
  assert.equal(formatPdfDate('D:2026'), '2026-01-01 00:00');
  assert.equal(formatPdfDate('D:202609231030+0545'), '2026-09-23 10:30 (UTC+5:45)');
  for (const [offset, zone] of [['+0800', 'UTC+8'], ['-0500', 'UTC-5'], ['-0030', 'UTC-0:30'], ['+1245', 'UTC+12:45'], ['+0000', 'UTC+0']]) {
    assert.equal(formatPdfDate('D:202609231030' + offset), `2026-09-23 10:30 (${zone})`);
  }
  for (const value of [undefined, null, {}, '', '<b>2026</b>', 'D:20260229120000', 'D:20261301', 'D:202601012400', 'D:202601010060', "D:202601010000+24'00'", "D:202601010000+05'60'", '2'.repeat(81)]) assert.equal(formatPdfDate(value), '', String(value));
});
test('PDF properties show validated decimal file sizes with at most one decimal', () => {
  assert.equal(pdfFileSize(1), '1 byte'); assert.equal(pdfFileSize(999), '999 bytes');
  assert.equal(pdfFileSize(1234), '1.2 KB'); assert.equal(pdfFileSize(1200000), '1.2 MB');
  assert.equal(pdfFileSize(999, 'zh-CN'), '999 字节');
  for (const value of [undefined, -1, 1.5, NaN, Infinity, '1000']) assert.equal(pdfFileSize(value), '');
});
test('single PDF appearance control returns to the configured default', () => {
  for (const systemDark of [true, false]) for (const base of ['light','dark','auto']) {
    const opposite = toggleDocumentAppearance(base, null, systemDark);
    const dark = base === 'dark' || (base === 'auto' && systemDark);
    assert.equal(opposite, dark ? 'light' : 'dark');
    assert.equal(toggleDocumentAppearance(base, opposite, systemDark), null);
    assert.equal(toggleDocumentAppearance(base, dark ? 'dark' : 'light', systemDark), opposite, 'same-as-default site override still switches visibly');
  }
});
test('PDF Viewer applies read-only asset and resource boundaries', () => {
  const data = new Uint8Array([1,2]);
  const options = pdfOptions(data, 'chrome-extension://test/vendor/pdfjs/');
  assert.equal(options.data, data); assert.equal(options.isEvalSupported, false); assert.equal(options.enableXfa, false);
  assert.equal(options.disableAutoFetch, true); assert.equal(options.useWorkerFetch, false);
  assert.equal(options.cMapUrl, 'chrome-extension://test/vendor/pdfjs/cmaps/');
  assert.ok(options.maxImageSize <= 32 * 1024 * 1024);
  assert.equal(safePdfLink('javascript:alert(1)'), null); assert.equal(safePdfLink('data:text/html,hello'), null);
  assert.equal(safePdfLink('file:///etc/passwd'), null); assert.equal(safePdfLink('https://example.com/'), 'https://example.com/');
  assert.equal(safePdfLink('mailto:a@example.com'), 'mailto:a@example.com');
  assert.equal(rotateLeft(0), 270); assert.equal(rotateLeft(90), 0);
  assert.equal(pdfScale(100), 5); assert.equal(pdfScale(.01), .25);
  assert.equal(stepPdfScale(stepPdfScale(1, 1), 1), 1.2);
  assert.equal(stepPdfScale(stepPdfScale(1.2, -1), -1), 1);
  assert.equal(stepPdfScale(5, 1), 5); assert.equal(stepPdfScale(.25, -1), .25);
  for (const sampling of [1, 2, 3, 4, 5, 6]) assert.equal(pdfDetailCanvasPixels(sampling), sampling ** 2 * 1024 * 1024);
  for (const invalid of [undefined, 0, 8, NaN, '6']) assert.equal(pdfDetailCanvasPixels(invalid), 16 * 1024 * 1024);
  assert.equal(printRange(0, 5, 10), null); assert.equal(printRange(1, 51, 80), null);
  assert.equal(printRange(3, 2, 10), null); assert.equal(printRange(1, 11, 10), null);
  assert.deepEqual(printRange('2', '10', 20), {from:2,to:10});
  assert.throws(() => createPdfViewer({bytes: new ArrayBuffer(0)}));
  assert.throws(() => createPdfViewer({bytes: new ArrayBuffer(PDF_LIMITS.bytes + 1)}));
});
test('PDF rendering lives in a network-restricted opaque sandbox without editing/scripting', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
  assert.deepEqual(manifest.sandbox.pages, ['workspaces/pdf-viewer/viewer.html']);
  const policy = manifest.content_security_policy.sandbox;
  assert.doesNotMatch(policy, /allow-same-origin|'unsafe-eval'|https?:|\*/);
  assert.match(policy, /connect-src 'self' blob:/); assert.match(policy, /frame-src 'none'/); assert.match(policy, /object-src 'none'/);
  const source = await readFile(new URL('workspaces/pdf-viewer/viewer.js', root), 'utf8');
  assert.match(source, /annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE/);
  assert.match(source, /scriptingManager: null/); assert.match(source, /enableAutoLinking: false/);
  assert.doesNotMatch(source, /chrome\.|localStorage|sessionStorage|innerHTML|eval\(/);
  assert.match(source, /event.source !== parent/);
  assert.match(source, /drawingDelay: 180/); assert.match(source, /maxCanvasPixels: Math.min\(PDF_LIMITS.canvasPixels, pdfDetailCanvasPixels\(sampling\)\)/);
  assert.match(source, /thumbnailCache.size <= 24/); assert.match(source, /viewer.currentPageNumber = page/);
  const host = await readFile(new URL('workspaces/pdf-viewer/host.js', root), 'utf8');
  assert.match(host, /new MessageChannel/); assert.match(host, /iframe.remove\(\)/);
  const integration = await readFile(new URL('workspaces/document-preview/document-preview.js', root), 'utf8');
  assert.match(integration, /import\('\.\.\/pdf-viewer\/host.js'\)/); assert.doesNotMatch(integration, /pdfViewerEnabled|pdf-dark/);
  const css = await readFile(new URL('workspaces/pdf-viewer/viewer.css', root), 'utf8');
  assert.match(css, /data-dark=true\] \.pdfViewer \.page\{outline:1px solid/);
  assert.deepEqual(Object.keys(labels['en-US']).sort(), Object.keys(labels['zh-CN']).sort());
});
test('PDF dependency assets match pinned integrity and omit the script evaluator', async () => {
  const vendor = new URL('vendor/pdfjs/', root);
  const hashes = JSON.parse(await readFile(new URL('integrity.json', vendor)));
  for (const [name, hash] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(name, vendor))).digest('hex'), hash, name);
  }
  assert.ok(hashes['cmaps/UniGB-UCS2-H.bcmap']); assert.ok(hashes['standard_fonts/LiberationSans-Regular.ttf']);
  assert.ok(hashes['wasm/openjpeg.wasm']); assert.ok(hashes['wasm/jbig2.wasm']);
  assert.ok(!(await readdir(new URL('wasm/', vendor))).some(name => name.startsWith('quickjs')));
});
