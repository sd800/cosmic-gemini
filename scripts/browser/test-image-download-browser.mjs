import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const artifacts = resolve('test-dist/image-download');
await mkdir(artifacts, { recursive: true });
const html = '<!doctype html><meta charset="utf-8"><title>Image workspace fixture</title><meta property="og:image" content="/unrequested.png"><img src="/image.svg" width="320" height="200" alt="Fixture image">';
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
let pdf = '%PDF-1.4\n'; const offsets = [0];
for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
try { await writeFile(join(artifacts, 'native.pdf'), pdf, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
pdf = await readFile(join(artifacts, 'native.pdf'), 'utf8');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#7752b8"/></svg>';
let unrequested = 0;
const server = createServer((request, response) => {
  if (request.url === '/unrequested.png') unrequested++;
  const document = ['/native.pdf', '/document'].includes(request.url);
  response.setHeader('Content-Type', document ? 'application/pdf' : request.url === '/plain' ? 'text/plain' : request.url === '/xml' ? 'application/xml' : request.url === '/image.svg' ? 'image/svg+xml' : 'text/html');
  response.end(document ? pdf : request.url === '/xml' ? '<fixture>Document</fixture>' : request.url === '/plain' ? 'Plain document' : request.url === '/image.svg' ? svg : request.url === '/embedded'
    ? '<!doctype html><style>html,body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="/native.pdf"></iframe>' : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://images.test:${server.address().port}`;
const folder = await mkdtemp(join(tmpdir(), 'cg-image-open-'));
let context;
try {
  const extension = resolve('extension');
  context = await chromium.launchPersistentContext(join(folder, 'profile'), {
    executablePath: process.env.TEST_CHROME, headless: true,
    args: [`--disable-extensions-except=${[extension, process.env.PDF_TEST_EXTENSION].filter(Boolean).join(',')}`, `--load-extension=${[extension, process.env.PDF_TEST_EXTENSION].filter(Boolean).join(',')}`, '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1']
  });
  let worker;
  while (!worker) {
    for (const candidate of context.serviceWorkers()) if (await candidate.evaluate(() => chrome.runtime.getManifest().name) === 'Cosmic Gemini') worker = candidate;
    if (!worker) await context.waitForEvent('serviceworker');
  }
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  await worker.evaluate(() => {
    const open = chrome.sidePanel.open.bind(chrome.sidePanel);
    globalThis.imageOpenProbe = [];
    chrome.sidePanel.open = async options => {
      try { await open(options); globalThis.imageOpenProbe.push({ opened: true }); }
      catch (error) { globalThis.imageOpenProbe.push({ opened: false, error: error.message }); throw error; }
    };
  });
  const source = await context.newPage(); await source.goto(origin);
  const sourceTabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === origin + '/').id, origin);
  const otherPath = `workspaces/follow-list-instagram/follow-list-instagram.html?sourceTab=${sourceTabId}`;
  await worker.evaluate(({ tabId, path }) => chrome.sidePanel.setOptions({ tabId, path, enabled: true }), { tabId: sourceTabId, path: otherPath });
  const popup = await context.newPage();
  await source.bringToFront(); await popup.goto(base + 'popup/index.html');
  await popup.waitForFunction(() => document.documentElement.dataset.localePending === 'false'
    && !document.querySelector('#imageDownload-status').disabled);
  assert.equal((await worker.evaluate(tabId => chrome.sidePanel.getOptions({ tabId }), sourceTabId)).path, otherPath,
    'reading popup state must leave another product’s configuration unchanged');
  await popup.locator('#imageDownload-status').click();
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 40 && !globalThis.imageOpenProbe.length; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  });
  const probe = await worker.evaluate(() => globalThis.imageOpenProbe);
  console.log(JSON.stringify({ sidePanel: probe }));
  assert.equal(probe[0]?.opened, true, 'a real popup click must open the native Side Panel');
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const values = await chrome.storage.session.get(null);
      if (Object.entries(values).some(([key, value]) => key.startsWith('imageDownloadSession:') && value.candidates?.length)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Image discovery did not start.');
  });
  const panels = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
  assert.ok(panels.some(panel => panel.documentUrl.startsWith(base + 'workspaces/image-download/')));
  const reopen = async () => {
    const page = await context.newPage(); await source.bringToFront();
    await page.goto(base + 'popup/index.html');
    await page.waitForFunction(() => document.documentElement.dataset.localePending === 'false'
      && !document.querySelector('#imageDownload-status').disabled);
    await page.locator('#imageDownload-status').click();
    if (!page.isClosed()) await page.waitForEvent('close');
  };
  await reopen();
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 40 && globalThis.imageOpenProbe.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  });
  const repeated = await worker.evaluate(() => globalThis.imageOpenProbe);
  assert.equal(repeated.length, 2); assert.ok(repeated.every(value => value.opened));
  await worker.evaluate(async () => {
    const values = await chrome.storage.local.get('cosmicGeminiSettings');
    values.cosmicGeminiSettings.imageDownload.workspaceMode = 'page';
    await chrome.storage.local.set(values);
  });
  await reopen();
  const findPage = () => worker.evaluate(async tabId => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const page = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find(page => {
        if (!page.documentUrl?.includes('/workspaces/image-download/image-download.html')) return false;
        const url = new URL(page.documentUrl);
        return url.searchParams.get('sourceTab') === String(tabId) && url.searchParams.get('view') === 'page';
      });
      if (page) return page.tabId;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return 0;
  }, sourceTabId);
  const pageWorkspace = await findPage();
  assert.ok(pageWorkspace > 0, 'explicit page mode opens its own workspace');
  const gallery = context.pages().find(page => page.url().includes('/workspaces/image-download/image-download.html?'));
  assert.ok(gallery);
  await gallery.locator('.image-preview img[src^="data:image/"]').first().waitFor();
  assert.equal(unrequested, 0, 'opening an image gallery does not fetch an address supplied only by webpage metadata');
  await reopen();
  assert.equal(await findPage(), pageWorkspace, 'page mode reuses an existing extension document');
  assert.equal((await worker.evaluate(() => globalThis.imageOpenProbe)).length, 2, 'page mode does not open a Side Panel');
  const videoPopup = await context.newPage(); await source.bringToFront(); await videoPopup.goto(base + 'popup/index.html');
  await videoPopup.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  assert.equal(await videoPopup.locator('#videoDownload-status').isVisible(), true);
  await videoPopup.locator('#videoDownload-status').click();
  await videoPopup.waitForFunction(() => document.body.dataset.view === 'video');
  assert.equal(unrequested, 0, 'opening Video Download does not fetch a page-supplied poster');
  await videoPopup.locator('#video-stop').click();
  await videoPopup.waitForFunction(() => document.body.dataset.view === 'main');
  await videoPopup.close();
  const holdToStop = async (page, featureId) => {
    const selector = '#' + featureId + '-status';
    const opens = (await worker.evaluate(() => globalThis.imageOpenProbe)).length;
    await page.locator(selector).hover(); await page.mouse.down();
    try {
      await page.waitForFunction(selector => document.querySelector(selector).getAttribute('aria-pressed') === 'false'
        && !document.body.hasAttribute('aria-busy'), selector);
    } finally { await page.mouse.up(); }
    assert.equal(page.isClosed(), false, 'holding must not reopen the image workspace on release');
    assert.equal(await page.getAttribute('body', 'data-view'), 'main');
    assert.equal((await worker.evaluate(() => globalThis.imageOpenProbe)).length, opens);
    assert.equal(await worker.evaluate(async ({ featureId, tabId }) => {
      const key = `${featureId}Session:${tabId}`;
      return (await chrome.storage.session.get(key))[key] === undefined;
    }, { featureId, tabId: sourceTabId }), true, 'holding must remove the active source session');
  };
  const stopPopup = await context.newPage(); await source.bringToFront(); await stopPopup.goto(base + 'popup/index.html');
  await stopPopup.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  assert.equal(await stopPopup.getAttribute('#imageDownload-status', 'data-persistent'), 'true');
  await holdToStop(stopPopup, 'imageDownload');
  await stopPopup.locator('#videoDownload-status').click();
  await stopPopup.waitForFunction(() => document.body.dataset.view === 'video');
  await stopPopup.locator('#video-back').click();
  await stopPopup.waitForFunction(() => document.querySelector('#videoDownload-status').dataset.state === 'active'
    && document.querySelector('#videoDownload-status').dataset.persistent === 'false');
  await holdToStop(stopPopup, 'videoDownload');
  await stopPopup.close();
  let pdfWorker;
  if (process.env.PDF_TEST_EXTENSION) {
    for (const candidate of context.serviceWorkers()) if (await candidate.evaluate(() => chrome.runtime.getManifest().name) === 'Cosmic PDF') pdfWorker = candidate;
    assert.ok(pdfWorker);
    await pdfWorker.evaluate(async () => {
      await chrome.storage.local.set({ settings: { enabled: false } });
      for (let attempt = 0; attempt < 40 && (await chrome.declarativeNetRequest.getDynamicRules()).length; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    });
  }
  const protectedUrls = ['chrome://settings/', base + 'settings/all-settings.html', origin + '/native.pdf', origin + '/document', origin + '/embedded', origin + '/plain', origin + '/xml'];
  if (pdfWorker) protectedUrls.push(pdfWorker.url().replace('/background/central.js', '/workspaces/pdf-reader/index.html') + '?source=' + origin + '/document');
  const openCount = (await worker.evaluate(() => globalThis.imageOpenProbe)).length;
  for (const url of protectedUrls) {
    const target = await context.newPage(); await target.goto(url, { waitUntil: 'domcontentloaded' });
    const control = await context.newPage(); await target.bringToFront(); await control.goto(base + 'popup/index.html');
    await control.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
    assert.equal(await control.locator('#imageDownload-status').isVisible(), false);
    assert.equal(await control.locator('#videoDownload-status').isVisible(), false);
    assert.equal(await control.locator('#media-download-row').isVisible(), false);
    const targetTabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    for (const type of ['UI_IMAGE_OPEN', 'UI_VIDEO_OPEN']) {
      const reply = await control.evaluate(message => chrome.runtime.sendMessage(message), { type, tabId: targetTabId, url });
      assert.equal(reply.ok, false, 'unsupported contexts must reject direct launch commands too');
    }
    await control.close(); await target.close();
  }
  assert.equal((await worker.evaluate(() => globalThis.imageOpenProbe)).length, openCount,
    'protected readers do not claim or open the media Side Panel');
  await writeFile(join(artifacts, 'README.md'), '# Image Download opening\n\nRun scripts/browser/test-image-download-browser.mjs with PLAYWRIGHT_MODULE and TEST_CHROME set. Uses an isolated Chrome for Testing profile and local image fixture. Checks a trusted popup click, native Side Panel opening, discovered images, repeated opening, passive popup ownership, explicit page mode, reuse without the tabs permission, normal Video Download activation, hold-to-stop of the active image session and icon-only video grace state without release-click reactivation, hidden controls and rejected direct launches in native/extension PDF readers and restricted pages, extensionless PDF handling, and exclusion of plain-text/XML documents. `native.pdf` is a reusable blank one-page fixture. Set PDF_TEST_EXTENSION to a local Cosmic PDF extension directory to include the real reader. Baseline reproduced Chrome rejecting the worker’s open call after asynchronous configuration. The popup now finishes configuration in its clicked document before the worker opens without an intervening await. The worker retains source validation and failure cleanup. Profiles are deleted and no browsing logs are retained.\n');
  console.log('Media tools: native Side Panel, image discovery, workspace reuse, normal video entry, hold-to-stop, and protected-reader exclusion passed.');
} finally {
  await context?.close(); await rm(folder, { recursive: true, force: true });
  await new Promise(resolve => server.close(resolve));
}
