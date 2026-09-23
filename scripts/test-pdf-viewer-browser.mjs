// Optional integration QA. Uses its own temporary profile, never a user's Chrome.
// PDF_VIEWER_CHROME=/path/to/chrome PDF_VIEWER_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/test-pdf-viewer-browser.mjs
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewerPdf } from '../test/fixtures/pdf-viewer.mjs';
const { chromium } = await import(process.env.PDF_VIEWER_PLAYWRIGHT ? pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href : 'playwright');
const folder = await mkdtemp(join(tmpdir(), 'cg-pdf-qa-')), extension = join(folder, 'extension');
const metrics = {}, errors = [], network = [], failures = [];
await cp(resolve('extension'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'PDF Viewer isolated QA', version: '1.0', permissions: ['storage','downloads'], background: {service_worker:'qa-background.js'}, sandbox: manifest.sandbox, content_security_policy: manifest.content_security_policy }));
await writeFile(join(extension, 'qa-background.js'), `chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async()=>{
    if(message.type==='UI_GET_LOCALE')return {locale:'en-US'};
    const {qaDocument:doc}=await chrome.storage.session.get('qaDocument');
    if(message.type==='UI_DOCUMENT_GET')return doc;
    if(message.type==='UI_DOCUMENT_SET_THEME'){
      doc.siteTheme=message.theme;
      await chrome.storage.session.set({qaDocument:doc,'documentPreview:regular':{documents:[doc],themes:message.theme?{[doc.site]:message.theme}:{}}});return {};
    }
    throw Error('Unexpected test message '+message.type);
  })().then(result=>reply({ok:true,result}),error=>reply({ok:false,error:error.message})); return true;
});`);
await writeFile(join(extension, 'qa.html'), '<!doctype html><style>body{margin:0;background:#121416}main{height:100vh;display:flex}iframe{border:0;width:100%;height:100%}</style><main></main><script type="module" src="qa.js"></script>');
await writeFile(join(extension, 'qa.js'), `import {createPdfViewer} from './workspaces/pdf-viewer/host.js';
window.events=[];window.openPdf=(bytes, locale='en-US')=>{window.viewer?.destroy();window.viewer=createPdfViewer({container:document.querySelector('main'),bytes:new Uint8Array(bytes).buffer,filename:'PDF Viewer — reading and zoom.pdf',site:'example.com',locale,dark:true,automatic:true,onDownload:()=>events.push('download'),onTheme:()=>viewer.setTheme(false,false),onAuto:()=>viewer.setTheme(true,true),onError:()=>events.push('error')});};`);
const context = await chromium.launchPersistentContext(join(folder, 'profile'), { executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 1280, height: 1000 }, args: ['--force-device-scale-factor=2', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  page.on('requestfailed', request => failures.push(request.url()));
  await page.goto('chrome://extensions');
  const id = await page.evaluate(() => document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id);
  const url = `chrome-extension://${id}/qa.html`;
  async function open(bytes, locale) {
    await page.goto(url); await page.evaluate(({ bytes, locale }) => openPdf(bytes, locale), { bytes: Array.from(bytes), locale });
    return (await page.locator('iframe').elementHandle()).contentFrame();
  }
  async function ready(frame) { await frame.waitForFunction(() => document.querySelector('.page canvas')?.width > 0 && document.querySelector('#count').textContent !== '/ —'); await frame.waitForFunction(() => document.querySelector('.textLayer span')); }
  async function jump(frame, number) { await frame.locator('#page').fill(String(number)); await frame.locator('#page').blur(); await frame.waitForFunction(n => !!document.querySelector(`.page[data-page-number="${n}"] canvas`), number); }
  async function initialPosition(frame) {
    const position = await frame.evaluate(() => {
      const viewport = document.querySelector('#viewport');
      return {top: viewport.scrollTop, gap: document.querySelector('.page').getBoundingClientRect().top - viewport.getBoundingClientRect().top,
        page: document.querySelector('#page').value};
    });
    assert.equal(position.page, '1');
    assert.equal(position.top, 0, 'newly opened PDFs start above the first page, not at its paper edge');
    assert.ok(position.gap >= 15, 'keep the space between the toolbar and first page visible');
  }
  const start = performance.now(); const frame = await open(viewerPdf()); await ready(frame);
  metrics.open80PagesMs = Math.round(performance.now() - start);
  await initialPosition(frame);
  metrics.initialCanvasRatio = await frame.evaluate(() => {
    const canvas = document.querySelector('.page canvas'), width = canvas.getBoundingClientRect().width;
    return canvas.width / width;
  });
  assert.ok(metrics.initialCanvasRatio >= 1.9, 'a normal page stays sharp at 100% on a Retina display');
  assert.equal(await frame.locator('#scale').inputValue(), '1');
  const pageIndicator = await frame.evaluate(() => ({
    appearance: getComputedStyle(document.querySelector('#page')).appearance,
    countSize: getComputedStyle(document.querySelector('#count')).fontSize,
    pageSize: getComputedStyle(document.querySelector('#page')).fontSize,
    zoomSize: getComputedStyle(document.querySelector('#scale')).fontSize,
    count: document.querySelector('.page-indicator #count').textContent
  }));
  assert.equal(pageIndicator.appearance, 'textfield');
  assert.equal(pageIndicator.countSize, pageIndicator.pageSize);
  assert.equal(pageIndicator.countSize, pageIndicator.zoomSize);
  assert.equal(pageIndicator.count, '/ 80');
  assert.equal(await frame.locator('#rotate').evaluate(node => getComputedStyle(node).borderTopColor), 'rgba(0, 0, 0, 0)');
  for (const width of [1280, 600, 360]) {
    await page.setViewportSize({width, height:1000});
    const layout = await frame.evaluate(() => {
      const file = document.querySelector('.file').getBoundingClientRect();
      const buttons = [...document.querySelector('nav').children].map(node => node.getBoundingClientRect());
      return {width: innerWidth, fileCenter:(file.left + file.right) / 2,
        left: Math.min(...buttons.map(rect => rect.left)), right: Math.max(...buttons.map(rect => rect.right)),
        overflow: document.querySelector('header').scrollWidth > innerWidth};
    });
    assert.ok(Math.abs(layout.fileCenter - width / 2) < 1, 'filename stays window-centered');
    assert.ok(Math.abs((layout.left + layout.right) / 2 - width / 2) < 1, 'tools stay window-centered');
    assert.ok(layout.left >= 0 && layout.right <= width && !layout.overflow, 'toolbar fits viewport');
    await page.screenshot({path:join(folder, `toolbar-${width}.png`)});
  }
  await page.setViewportSize({width:1280, height:1000});
  assert.equal(await frame.evaluate(() => typeof chrome?.runtime), 'undefined');
  assert.equal(await frame.evaluate(() => !!globalThis.PDF_ATTACK), false);
  assert.equal(await frame.locator('.pdf-links a[href^="javascript:"]').count(), 0);
  await frame.waitForSelector('.pdf-links a[href="https://example.com/pdf-link"]');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.page')).outlineStyle), 'solid');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.page')).backgroundColor), 'rgb(20, 20, 20)');
  await frame.locator('#zoom-in').click(); await frame.locator('#zoom-in').click();
  assert.equal(await frame.locator('#custom-scale').textContent(), '120%');
  await frame.locator('#zoom-out').click(); await frame.locator('#zoom-out').click(); assert.equal(await frame.locator('#scale').inputValue(), '1');
  // Select/copy remains a text layer, not OCR or an editable document.
  assert.match(await frame.locator('.textLayer').first().textContent(), /PDF Viewer page 1/);
  await frame.locator('#search-toggle').click(); await frame.locator('#query').fill('needle');
  await frame.waitForFunction(() => document.querySelector('#matches').textContent === '1 / 80');
  await frame.locator('#find-close').click(); await jump(frame, 60);
  const zoomStart = performance.now(); for (let i = 0; i < 10; i++) await frame.locator('#zoom-in').click();
  assert.equal(await frame.locator('#scale').inputValue(), '2'); assert.equal(await frame.locator('#page').inputValue(), '60');
  metrics.tenZoomStepsMs = Math.round(performance.now() - zoomStart);
  await frame.waitForFunction(() => document.querySelector('.page[data-page-number="60"] canvas.detailView')?.width > 0);
  metrics.zoomDetailRatio = await frame.evaluate(() => {
    const canvas = document.querySelector('.page[data-page-number="60"] canvas.detailView');
    return canvas.width / canvas.getBoundingClientRect().width;
  });
  assert.ok(metrics.zoomDetailRatio >= 1.9, 'high zoom retains a sharp visible-area detail canvas');
  await frame.locator('#rotate').click(); assert.equal(await frame.locator('#page').inputValue(), '60');
  await frame.locator('#scale').selectOption('page-fit');
  await frame.locator('#sidebar-toggle').click(); await frame.waitForSelector('.thumbnail canvas');
  metrics.thumbnailRatio = await frame.locator('.thumbnail canvas').first().evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
  assert.ok(metrics.thumbnailRatio >= 1.9, 'sidebar thumbnails match Retina pixel density');
  await frame.locator('#show-outline').click(); await frame.locator('#outline button').click();
  assert.equal(await frame.locator('#page').inputValue(), '80');
  await frame.locator('#show-pages').click();
  for (const n of [5,15,25,35,45,55,65,75]) await jump(frame, n);
  metrics.retainedPageCanvases = await frame.locator('.page canvas').count(); assert.ok(metrics.retainedPageCanvases <= 14);
  metrics.retainedThumbnails = await frame.locator('.thumbnail canvas').count(); assert.ok(metrics.retainedThumbnails <= 24);
  await frame.locator('#theme').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'false');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.canvasWrapper')).filter), 'none');
  await frame.locator('#theme-auto').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'true');
  await frame.locator('#fullscreen').click(); await page.waitForFunction(() => !!document.fullscreenElement);
  await frame.locator('#fullscreen').click(); await page.waitForFunction(() => !document.fullscreenElement);
  await frame.locator('#download').click(); assert.ok((await page.evaluate(() => events)).includes('download'));
  await frame.evaluate(() => { window.print = () => { globalThis.printed = [...document.querySelectorAll('#print-pages img')].map(n => [n.naturalWidth, n.naturalHeight]); }; });
  await frame.locator('#print').click(); await frame.locator('#print-from').fill('1'); await frame.locator('#print-to').fill('2'); await frame.locator('button[value=print]').click();
  await frame.waitForFunction(() => globalThis.printed?.length === 2); assert.equal(await frame.locator('#print-pages img').count(), 0);
  const fresh = await open(viewerPdf(2), 'zh-CN'); await ready(fresh);
  assert.equal(await fresh.locator('#scale').inputValue(), '1'); assert.equal(await fresh.locator('#rotate').getAttribute('title'), '向左旋转');
  // The theme hint is applied by a head script, before the engine import/first paint.
  assert.equal(await fresh.evaluate(() => document.documentElement.dataset.dark), 'true');
  await fresh.locator('#scale').selectOption('page-fit');
  await page.screenshot({path: join(folder, 'dark-zh.png')});
  if (process.env.PDF_VIEWER_PASSWORD_SAMPLE) {
    const locked = await open(await readFile(process.env.PDF_VIEWER_PASSWORD_SAMPLE)); await locked.waitForSelector('#password-dialog[open]');
    await locked.locator('#password').fill('wrong'); await locked.locator('button[value=open]').click(); await locked.waitForFunction(() => document.querySelector('#password-message').textContent.includes('Incorrect'));
    await locked.locator('#password').fill('reader-test'); await locked.locator('button[value=open]').click(); await ready(locked);
    metrics.password = 'wrong password rejected, correct password opened';
  }
  if (process.env.PDF_VIEWER_REAL_SAMPLE) {
    const real = await open(await readFile(process.env.PDF_VIEWER_REAL_SAMPLE)); await ready(real);
    metrics.realPages = await real.locator('#count').textContent();
    await real.locator('#scale').selectOption('5'); await real.waitForFunction(() => document.querySelector('.page canvas.detailView'));
    await real.locator('#scale').selectOption('page-fit');
    await page.screenshot({path: join(folder, 'real.png')});
  }
  // Exercise the real privileged Document Preview host and its existing session
  // lifecycle. The test background supplies owned metadata, not reader policy.
  const docId = await page.evaluate(async bytes => {
    const doc={id:'pdf-fixture',site:'example.com',filename:'Integration.pdf',format:'pdf',context:'regular',prepared:true,appearance:'dark',siteTheme:null,
      blobUrl:URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}))};
    await chrome.storage.session.set({qaDocument:doc,'documentPreview:regular':{documents:[doc],themes:{}}});return doc.id;
  }, Array.from(viewerPdf(3)));
  const integration = await context.newPage();
  integration.on('pageerror', error => errors.push(error.message));
  integration.on('console', message => { if(message.type()==='error')errors.push(message.text()); });
  await integration.goto(`chrome-extension://${id}/workspaces/document-preview/document-preview.html#id=${docId}&mode=preview&appearance=dark`);
  await integration.waitForSelector('.pdf-viewer-frame');
  let embedded=await (await integration.locator('.pdf-viewer-frame').elementHandle()).contentFrame();await ready(embedded);
  await initialPosition(embedded);
  assert.equal(await integration.locator('body').getAttribute('class'),'pdf-active');
  await jump(embedded, 3);
  await embedded.locator('#theme').click();await embedded.waitForFunction(()=>document.documentElement.dataset.dark==='false');
  assert.equal(await embedded.locator('#page').inputValue(), '3', 'theme changes keep the reading position');
  assert.match(integration.url(),/appearance=light/);
  await embedded.locator('#theme-auto').click();await embedded.waitForFunction(()=>document.documentElement.dataset.dark==='true');
  await embedded.locator('#fullscreen').click();await integration.waitForFunction(()=>!!document.fullscreenElement);
  await embedded.locator('#fullscreen').click();await integration.waitForFunction(()=>!document.fullscreenElement);
  await integration.reload();await integration.waitForSelector('.pdf-viewer-frame');
  embedded=await (await integration.locator('.pdf-viewer-frame').elementHandle()).contentFrame();await ready(embedded);
  assert.equal(await embedded.locator('#scale').inputValue(),'1');
  assert.equal(await embedded.evaluate(()=>document.documentElement.dataset.dark),'true');
  await initialPosition(embedded);
  await page.evaluate(()=>chrome.storage.session.set({'documentPreview:regular':{documents:[],themes:{}}}));
  await integration.waitForFunction(()=>!document.querySelector('.pdf-viewer-frame'));
  assert.match(await integration.locator('#status').textContent(),/expired/);await integration.close();
  metrics.documentPreview='theme, fullscreen, reload and expiry passed';
  assert.deepEqual(network, []); assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  await page.evaluate(() => viewer.destroy()); assert.equal(await page.locator('iframe').count(), 0);
  console.log(JSON.stringify({metrics, errors, network, screenshots: folder}, null, 2));
} catch (error) { console.error('Browser diagnostics', {errors, failures, network, folder}); throw error; } finally { await context.close(); await rm(join(folder, 'profile'), {recursive:true,force:true}); }
