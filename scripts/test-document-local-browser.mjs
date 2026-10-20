// Local file selection uses a disposable profile, never a user's Chrome session.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewerPdf } from '../test/fixtures/pdf-viewer.mjs';

const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'cg-local-document-qa-'));
const samples = resolve('test-dist/document-preview/local');
await mkdir(samples, { recursive: true });
const rtf = Buffer.from('{\\rtf1\\ansi Local document preview.\\par Original file stays on this device.}');
await writeFile(join(samples, 'sample.rtf'), rtf);
await writeFile(join(samples, 'sample.pdf'), viewerPdf(1));
await writeFile(join(samples, 'README.md'), '# Local document fixtures\n\nSynthetic RTF and PDF files used by `scripts/test-document-local-browser.mjs`. The script recreates them in this ignored directory. No personal files or browser profiles are saved here.\n');
await mkdir(join(profile,'Default'),{recursive:true});
await writeFile(join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:join(profile,'downloads'),prompt_for_download:false}}));
const extension = resolve('extension');
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CONTEXT_CHROME,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host, settings = await context.newPage();
  const cdp = await context.newCDPSession(settings);
  await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
  const external = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await settings.goto(`chrome-extension://${id}/settings/satellites.html`);
  const button = settings.locator('#documentOpenFile');
  await button.waitFor(); await settings.waitForFunction(() => document.documentElement.dataset.localePending !== 'true');
  assert.equal(await settings.locator('#documentPreviewEnabled').isChecked(), false);
  assert.equal(await button.isEnabled(), true);
  assert.equal(await settings.locator('#documentPreviewOptions').evaluate(node => node.disabled), true);
  const choose = async payload => {
    const chooser = settings.waitForEvent('filechooser'); await button.click();
    await (await chooser).setFiles(payload);
  };
  // Cancelling the picker must not open a preview or change any preference.
  const before = context.pages().length;
  await choose([]); assert.equal(context.pages().length, before);
  await choose({name:'unsupported.txt',mimeType:'text/plain',buffer:Buffer.from('unsupported file')});
  await settings.locator('.document-open-message').filter({hasText:/supported file formats/}).waitFor();
  assert.equal(context.pages().length, before);
  await choose({name:'empty.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(0)});
  await settings.locator('.document-open-message').filter({hasText:/empty or too large/}).waitFor();
  const opened = context.waitForEvent('page');
  await choose(join(samples, 'sample.rtf')); const preview = await opened;
  await preview.waitForURL(/document-preview.html/);
  await preview.frameLocator('#document').locator('body').filter({hasText:'Local document preview.'}).waitFor();
  assert.equal(await preview.locator('#metadata').textContent(), 'Local file · documents');
  assert.equal(await settings.locator('#documentPreviewEnabled').isChecked(), false);
  const sourceIndex = await settings.evaluate(async () => (await chrome.tabs.getCurrent()).index);
  const previewIndex = await preview.evaluate(async () => (await chrome.tabs.getCurrent()).index);
  assert.equal(previewIndex, sourceIndex + 1);
  await preview.locator('#download').click();
  await preview.waitForFunction(async()=> (await chrome.downloads.search({state:'complete'})).some(file=>file.filename.endsWith('/sample.rtf')));
  const file = await preview.evaluate(async()=> (await chrome.downloads.search({state:'complete'})).find(file=>file.filename.endsWith('/sample.rtf')));
  const { readFile } = await import('node:fs/promises');
  assert.equal(file.filename,join(profile,'downloads','sample.rtf'));
  assert.deepEqual(await readFile(file.filename), rtf);
  const session = await settings.evaluate(()=>chrome.storage.session.get('documentPreview:regular'));
  const record = session['documentPreview:regular'].documents[0];
  assert.equal(record.local,true);
  assert.equal(record.url,'');
  assert.equal(Object.hasOwn(record,'blob'),false,'session storage contains metadata, never file contents or a disk copy');
  await preview.reload();
  await preview.frameLocator('#document').locator('body').filter({hasText:'Local document preview.'}).waitFor();
  await settings.locator('#language').selectOption('zh-CN');
  await button.filter({hasText:'打开文件'}).waitFor();
  const pdfOpened = context.waitForEvent('page'); await choose(join(samples, 'sample.pdf'));
  const pdf = await pdfOpened;
  await pdf.waitForURL(/document-preview.html/);
  await pdf.frameLocator('iframe.pdf-viewer-frame').locator('.page canvas').first().waitFor();
  assert.equal(await pdf.locator('#metadata').textContent(), '本地文件 · PDF');
  await settings.close();
  await pdf.frameLocator('iframe.pdf-viewer-frame').locator('.textLayer').first().filter({hasText:'PDF Viewer page 1'}).waitFor();
  await pdf.reload();
  await pdf.frameLocator('iframe.pdf-viewer-frame').locator('.page canvas').first().waitFor();
  assert.deepEqual(external, [], 'local previews do not make website requests');
  const extensions = await context.newPage(); await extensions.goto('chrome://extensions');
  const errors = await extensions.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionsInfo(
    {includeDisabled:true,includeTerminated:true}, items => resolve(items.find(item=>item.id===id)?.runtimeErrors || []))), id);
  assert.deepEqual(errors, []);
  await pdf.close(); await preview.close();
  await worker.evaluate(async()=>{
    for(let attempt=0;attempt<50;attempt++) {
      const saved=(await chrome.storage.session.get('documentPreview:regular'))['documentPreview:regular'];
      if (!saved?.documents.some(doc=>doc.local)) return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('Local file references were not released after closing previews.');
  });
  console.log('PASS: picker cancellation, unsupported/empty files, capture-off RTF/PDF previews, adjacent tabs, original download, bilingual labels, Settings close, RAM-backed reload, close cleanup, no network or extension errors.');
} finally { await context?.close(); await rm(profile, { recursive:true, force:true }); }
