// A disposable profile and local single-use download exercise the real capture pipeline.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { readNativeAddress } from './support/native-address.mjs';
import { viewerPdf } from '../../test/fixtures/pdf-viewer.mjs';
import { storedZip } from '../../test/fixtures/zip.mjs';
import { readingEntries } from '../../test/fixtures/document-formatting.mjs';
import { spreadsheetEntries, presentationEntries } from '../../test/fixtures/office-formats.mjs';
import { rtfSample, emailSample } from '../../test/fixtures/additional-document-formats.mjs';
const samples = new Map([
  ['docx', [storedZip(readingEntries()), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'First contextual']],
  ['xlsx', [storedZip(spreadsheetEntries()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Item']],
  ['pptx', [storedZip(presentationEntries()), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'First slide']],
  ['rtf', [rtfSample, 'application/rtf', 'RTF document']], ['eml', [emailSample, 'message/rfc822', 'HTML body']]
]);
const sampleRequests = new Map();
const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'cg-capture-qa-')), extension = resolve('extension');
let entries = 0, served = 0, changedRoutes = 0, unapprovedRequests = 0;
const used = new Set(), pdf = viewerPdf(1);
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture.test');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/files/123/download') {
    if (!req.headers.cookie?.includes('qa_session=1')) { res.writeHead(401); res.end(); return; }
    res.writeHead(302, {Location:`http://localhost:${server.address().port}/ephemeral/sample.pdf?key=${++entries}`}); res.end();
  } else if (url.pathname === '/ephemeral/sample.pdf') {
    const key = url.searchParams.get('key');
    if (req.headers.cookie?.includes('cdn_session=1')) { res.writeHead(403); res.end(); return; }
    if (!key || used.has(key)) { res.writeHead(401); res.end(); return; }
    used.add(key); served++;
    res.writeHead(200, {'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename=sample.pdf'}); res.end(pdf);
  } else if (url.pathname === '/changed/download') {
    if (++changedRoutes === 1) {
      res.writeHead(200, {'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename=changed.pdf'}); res.end(pdf);
    } else { res.writeHead(302, {Location:`http://localhost:${server.address().port}/unapproved`}); res.end(); }
  } else if (url.pathname === '/unapproved') {
    unapprovedRequests++; res.end();
  } else if (url.pathname.startsWith('/samples/')) {
    const format = url.pathname.split('.').pop(), sample = samples.get(format);
    if (!sample) { res.writeHead(404); res.end(); return; }
    sampleRequests.set(format, (sampleRequests.get(format) || 0) + 1);
    res.writeHead(200, {'Content-Type':sample[1], 'Content-Disposition':'attachment; filename=sample.'+format});
    res.end(typeof sample[0] === 'string' ? sample[0] : Buffer.from(sample[0]));
  } else {
    res.setHeader('Content-Type','text/html');
    res.setHeader('Set-Cookie','qa_session=1; Path=/; SameSite=Lax; HttpOnly');
    res.end('<!doctype html><h1>Generic authenticated download</h1><a href="/files/123/download">sample.pdf</a>'
      + '<p><a href="/changed/download">changed.pdf</a></p>'
      + [...samples.keys()].map(format=>'<p><a href="/samples/sample.'+format+'">sample.'+format+'</a></p>').join('')
      + '<a href="http://localhost:'+server.address().port+'/samples/sample.rtf">cross-origin.rtf</a>');
  }
});
await new Promise(resolve => server.listen(0, resolve));
await mkdir(resolve('test-dist/original-url'), {recursive:true});
await mkdir(join(profile,'Default'),{recursive:true});
await writeFile(join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:join(profile,'downloads'),prompt_for_download:false}}));
const nativeAddress = process.env.CONTEXT_NATIVE_ADDRESS === '1';
const context = await chromium.launchPersistentContext(profile, {headless:!nativeAddress,executablePath:process.env.CONTEXT_CHROME,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
async function workspaceFor(page) {
  await page.waitForFunction(()=>!!document.querySelector('iframe'));
  for(let i=0;i<100;i++) {
    const workspace=page.frames().find(f=>f.url().includes('/workspaces/document-preview/document-preview.html'));
    if(workspace) return workspace;
    await page.waitForTimeout(75);
  }
  throw Error('Document workspace did not mount.');
}
async function checkHistory(page) {
  const cdp=await context.newCDPSession(page);
  try {
    const history=await cdp.send('Page.getNavigationHistory');
    assert.equal(history.entries.length,1,'opening Preview must replace the initial blank history entry');
    assert.equal(history.entries[0].url,page.url());
  } finally { await cdp.detach(); }
  if(nativeAddress)assert.equal(readNativeAddress().replace(/^https?:\/\//,''),page.url().replace(/^https?:\/\//,''),'the visible address bar must show the file URL too');
}
async function checkToolbar(host, pdf=false) {
  const header=host.locator(pdf?'header':'.document-toolbar');
  assert.equal(await header.locator('.identity,.brand,#document-icon').count(),0,'no product branding remains in the reading toolbar');
  for(const width of [1280,720,480]) {
    await host.page().setViewportSize({width,height:900});
    const layout=await header.evaluate(node=>{
      const box=node.getBoundingClientRect();
      const controls=[...node.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length&&!e.closest('[hidden],.document-feedback'));
      return{height:box.height,centers:controls.map(e=>{const r=e.getBoundingClientRect();return r.top+r.height/2;})};
    });
    if(pdf&&width===1280){const center=await host.locator('nav').evaluate(e=>{const r=e.getBoundingClientRect();return r.left+r.width/2;});assert.ok(Math.abs(center-width/2)<2,'PDF reading tools remain centered');}
    assert.ok(layout.height<72,'reading controls remain on one row at '+width);
    assert.ok(Math.max(...layout.centers)-Math.min(...layout.centers)<8,'controls share the row at '+width);
  }
  await host.page().setViewportSize({width:1280,height:900});
  await host.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function choose(page, name) {
  await page.getByRole('link',{name,exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.tagName==='DIV');
  const opened=context.waitForEvent('page'); await page.keyboard.press('Enter'); return await opened;
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host, settings = await context.newPage();
  // Playwright's automatic allowAndName handler skips Chrome's filename event.
  // Restore ordinary download behavior only in this disposable test profile.
  const cdp=await context.newCDPSession(settings);await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
  await settings.goto(`chrome-extension://${id}/settings/all-settings.html`);
  assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({type:'UI_SET_ENABLED',featureId:'documentPreview',enabled:true}))).ok,true);
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/courses/12/files`);
  await page.getByRole('link',{name:'sample.pdf',exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.tagName==='DIV');
  assert.equal(entries,1); assert.equal(served,1,'the choice dialog must not refetch or cache document bytes');
  await context.addCookies([{ name:'cdn_session', value:'1', url:`http://localhost:${server.address().port}`, httpOnly:true }]);
  const opened = context.waitForEvent('page'); await page.keyboard.press('Enter'); const preview = await opened;
  await preview.waitForURL(`http://127.0.0.1:${server.address().port}/files/123/download`);
  const workspace=await workspaceFor(preview), frame=workspace.frameLocator('iframe.pdf-viewer-frame');
  await frame.locator('.page canvas').first().waitFor();

  assert.equal(entries,2,'preparation must revisit the stable authenticated entry point');
  assert.equal(served,2);
  assert.match(await frame.locator('.textLayer').first().textContent(),/PDF Viewer page 1/);
  await checkHistory(preview);
  const pdfFrame=workspace.childFrames().find(f=>f.url().includes('/pdf-viewer/viewer.html'));await checkToolbar(pdfFrame,true);
  await preview.screenshot({path:resolve('test-dist/original-url/preview.png')});
  // The web-accessible shell alone never grants access to a document.
  const hostile=await context.newPage(); await hostile.goto(page.url());
  await hostile.evaluate(url=>{const f=document.createElement('iframe');f.src=url;document.body.replaceChildren(f);},workspace.url());
  const unbound=await workspaceFor(hostile);
  const denied=await unbound.evaluate(async()=>chrome.runtime.sendMessage({type:'UI_DOCUMENT_GET',featureId:'documentPreview',id:new URLSearchParams(location.hash.slice(1)).get('id')}));
  assert.equal(denied.ok,false,'an unbound website iframe cannot read document metadata or bytes');
  const target = new URL(workspace.url());
  const copied = new URLSearchParams(target.hash.slice(1)); copied.set('mode', 'download'); target.hash = copied.toString();
  const downloaded = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  const unboundTab = context.waitForEvent('page');
  await hostile.evaluate(url => {
    const link = document.createElement('a'); link.target = '_blank'; link.href = url; link.click();
  }, target.href);
  const unboundTop = await unboundTab;
  await unboundTop.waitForURL(target.href);
  const rejected = await unboundTop.evaluate(async () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('id');
    return Promise.all(['UI_DOCUMENT_GET', 'UI_DOCUMENT_PREPARE', 'UI_DOCUMENT_DOWNLOAD', 'UI_GET', 'UI_RESET_ALL_SETTINGS']
      .map(type => chrome.runtime.sendMessage({ type, id, featureId: 'documentPreview' })));
  });
  assert.ok(rejected.every(result => result.ok === false), 'the copied ID does not authorize an unbound top-level tab');
  assert.equal(await worker.evaluate(async () => (await chrome.downloads.search({})).length), downloaded,
    'opening a copied reader address in download mode cannot launch a download');
  await unboundTop.close();
  await hostile.close();
  for (const [format, sample] of samples) {
    const opened=await choose(page,'sample.'+format);
    await opened.waitForURL(`http://127.0.0.1:${server.address().port}/samples/sample.${format}`);
    const host=await workspaceFor(opened), content=host.frameLocator('#document');
    await content.locator('body').getByText(sample[2],{exact:false}).first().waitFor();
    await checkHistory(opened);await checkToolbar(host);
    if(['docx','pptx'].includes(format))await opened.screenshot({path:resolve('test-dist/original-url/toolbar-'+format+'.png')});
    assert.equal(sampleRequests.get(format),2,'one intercepted download and one prepared RAM fetch for '+format);
    await opened.close();
  }
  const cross=await choose(page,'cross-origin.rtf');
  await cross.waitForURL(/chrome-extension:.*document-preview.html/);
  await cross.frameLocator('#document').locator('body').getByText('RTF document',{exact:false}).first().waitFor();
  await cross.close();
  // A changed redirect must be rejected before it contacts the new origin.
  const changed = await choose(page, 'changed.pdf');
  if (!changed.isClosed()) await changed.waitForEvent('close', { timeout:5000 });
  assert.equal(changedRoutes, 2);
  assert.equal(unapprovedRequests, 0);
  // Reload must use the prepared RAM copy even after the source website closes.
  await page.close(); await preview.reload();
  await preview.waitForURL(/chrome-extension:.*document-preview.html/);
  await preview.frameLocator('iframe.pdf-viewer-frame').locator('.page canvas').first().waitFor();
  assert.equal(entries,2,'refresh must not request the stable entry or its signed download again');
  assert.equal(served,2);
  const extensions = await context.newPage(); await extensions.goto('chrome://extensions');
  const errors = await extensions.evaluate(id=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo(
    {includeDisabled:true,includeTerminated:true},items=>resolve(items.find(item=>item.id===id)?.runtimeErrors||[]))),id);
  assert.deepEqual(errors,[],'capture and cancellation must not produce unchecked runtime errors');
  await writeFile(resolve('test-dist/original-url/README.md'), '# Original file URL checks\n\nRun scripts/browser/test-document-capture-browser.mjs with CONTEXT_PLAYWRIGHT and CONTEXT_CHROME pointing to the installed browser tools. CONTEXT_NATIVE_ADDRESS=1 enables a headed macOS check of the actual Chrome for Testing address field, in addition to internal URLs and initial navigation history. The native helper never targets the personal Chrome process. It creates authenticated, single-use PDF and synthetic DOCX, XLSX, PPTX, RTF, and EML downloads from existing test fixtures. It checks original-address rendering, one-row unbranded toolbars at desktop/narrow widths, RAM reuse, cross-origin fallback, unbound-frame rejection, refresh after source closure, and extension errors. preview.png shows the original-address PDF. probe.mjs is the same-origin shell experiment. Browser profiles are temporary; no request logs or private documents are retained.\n');
  console.log('PASS: original file URLs for PDF/DOCX/XLSX/PPTX/RTF/EML, RAM refresh, cross-origin fallback, unbound-frame rejection, no extension errors.');
} finally { await context.close(); await new Promise(resolve=>server.close(resolve)); await rm(profile,{recursive:true,force:true}); }
