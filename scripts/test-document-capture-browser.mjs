// A disposable profile and local single-use download exercise the real capture pipeline.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { viewerPdf } from '../test/fixtures/pdf-viewer.mjs';
const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'cg-capture-qa-')), extension = resolve('extension');
let entries = 0, served = 0;
const used = new Set(), pdf = viewerPdf(1);
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture.test');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/files/123/download') {
    if (!req.headers.cookie?.includes('qa_session=1')) { res.writeHead(401); res.end(); return; }
    res.writeHead(302, {Location:'/ephemeral/sample.pdf?key=' + (++entries)}); res.end();
  } else if (url.pathname === '/ephemeral/sample.pdf') {
    const key = url.searchParams.get('key');
    if (!key || used.has(key)) { res.writeHead(401); res.end(); return; }
    used.add(key); served++;
    res.writeHead(200, {'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename=sample.pdf'}); res.end(pdf);
  } else {
    res.setHeader('Content-Type','text/html');
    res.setHeader('Set-Cookie','qa_session=1; Path=/; SameSite=Lax; HttpOnly');
    res.end('<!doctype html><h1>Generic authenticated download</h1><a href="/files/123/download">sample.pdf</a>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir(join(profile,'Default'),{recursive:true});
await writeFile(join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:join(profile,'downloads'),prompt_for_download:false}}));
const context = await chromium.launchPersistentContext(profile, {headless:true,executablePath:process.env.CONTEXT_CHROME,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
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
  try { await page.waitForFunction(()=>document.activeElement?.tagName==='DIV'); } catch (error) {
    console.log('Capture diagnostic', await page.evaluate(()=>({url:location.href,active:document.activeElement?.outerHTML,body:document.body.innerText})), await settings.evaluate(async()=>({session:await chrome.storage.session.get('documentPreview:regular'),downloads:await chrome.downloads.search({})}))); throw error;
  }
  assert.equal(entries,1); assert.equal(served,1,'the choice dialog must not refetch or cache document bytes');
  const opened = context.waitForEvent('page'); await page.keyboard.press('Enter'); const preview = await opened;
  await preview.waitForURL(/document-preview.html/);
  const frame = preview.frameLocator('iframe.pdf-viewer-frame');
  await frame.locator('.page canvas').first().waitFor();
  assert.equal(entries,2,'preparation must revisit the stable authenticated entry point');
  assert.equal(served,2);
  assert.match(await frame.locator('.textLayer').first().textContent(),/PDF Viewer page 1/);
  const extensions = await context.newPage(); await extensions.goto('chrome://extensions');
  const errors = await extensions.evaluate(id=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo(
    {includeDisabled:true,includeTerminated:true},items=>resolve(items.find(item=>item.id===id)?.runtimeErrors||[]))),id);
  assert.deepEqual(errors,[],'capture and cancellation must not produce unchecked runtime errors');
  console.log('PASS: real download cancellation, no pre-choice refetch, signed-link refresh, PDF first-page rendering, no extension errors.');
} finally { await context.close(); await new Promise(resolve=>server.close(resolve)); await rm(profile,{recursive:true,force:true}); }
