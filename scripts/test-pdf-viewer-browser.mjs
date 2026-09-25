// Optional integration QA. Uses its own temporary profile, never a user's Chrome.
// PDF_VIEWER_CHROME=/path/to/chrome PDF_VIEWER_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/test-pdf-viewer-browser.mjs
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewerPdf, scannedPdf } from '../test/fixtures/pdf-viewer.mjs';
const { chromium } = await import(process.env.PDF_VIEWER_PLAYWRIGHT ? pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href : 'playwright');
const folder = await mkdtemp(join(tmpdir(), 'cg-pdf-qa-')), extension = join(folder, 'extension');
const metrics = {}, errors = [], network = [], failures = [];
await cp(resolve('extension'), extension, { recursive: true });
// Observe settled rendering only in this disposable QA copy, never production.
const viewerPath = join(extension, 'workspaces/pdf-viewer/viewer.js');
await writeFile(viewerPath, (await readFile(viewerPath, 'utf8'))
  .replace('void workerReady.catch(() => {});', 'void workerReady.catch(() => {}); window.qaWorkerReady = workerReady;')
  .replace('links.setViewer(viewer);', 'window.qaPdfViewer = viewer; window.qaPdfDocument = pdf; window.qaMetadataCalls = 0; const qaGetMetadata = pdf.getMetadata.bind(pdf); pdf.getMetadata = (...args) => { window.qaMetadataCalls++; return qaGetMetadata(...args); }; window.qaRenderedPages = []; eventBus.on("pagerendered", ({pageNumber, cssTransform, error}) => { if (!cssTransform && !error) window.qaRenderedPages.push(pageNumber); }); links.setViewer(viewer);'));
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'PDF Viewer isolated QA', version: '1.0', permissions: ['storage','downloads'], background: {service_worker:'qa-background.js',type:'module'}, sandbox: manifest.sandbox, content_security_policy: manifest.content_security_policy }));
await writeFile(join(extension, 'qa-background.js'), `import {normalizeSettings} from './core/config.js';
chrome.runtime.onConnect.addListener(()=>{});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async()=>{
    if(message.type==='UI_GET_LOCALE')return {locale:(await chrome.storage.local.get('qaLocale')).qaLocale||'en-US'};
    if(message.type==='UI_GET')return {preferences:normalizeSettings((await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings)};
    if(message.type==='UI_SET_DOCUMENT_PDF_SAMPLING'||message.type==='UI_SET_ENABLED'){
      const settings=normalizeSettings((await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings);
      const feature=settings.documentPreview;
      if(message.type==='UI_SET_DOCUMENT_PDF_SAMPLING')feature.pdfSampling=message.pdfSampling;
      else feature.enabled=message.enabled;
      await chrome.storage.local.set({cosmicGeminiSettings:settings});
      const {qaDocument:doc}=await chrome.storage.session.get('qaDocument');
      if(doc)await chrome.storage.session.set({qaDocument:{...doc,pdfSampling:feature.pdfSampling}});
      return feature;
    }
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
window.openDocument=async(html,formatting)=>{const {createDocumentContent}=await import('./workspaces/document-preview/content-host.js');const frame=document.createElement('iframe');document.querySelector('main').replaceChildren(frame);window.contentReader=createDocumentContent(frame,'en-US',()=>events.push('content-error'));contentReader.render(html,formatting);};window.events=[];window.openPdf=(bytes, locale='en-US', sampling=6)=>{window.qaDark=true;window.viewer?.destroy();window.viewer=createPdfViewer({container:document.querySelector('main'),bytes:bytes===undefined?undefined:new Uint8Array(bytes).buffer,filename:'PDF Viewer — reading and zoom.pdf',site:'example.com',locale,sampling,dark:true,onDownload:()=>events.push('download'),onTheme:()=>{window.qaDark=!window.qaDark;viewer.setTheme(window.qaDark);},onError:()=>events.push('error')});};`);
const context = await chromium.launchPersistentContext(join(folder, 'profile'), { executablePath: process.env.PDF_VIEWER_CHROME, headless: true, deviceScaleFactor: 2, viewport: { width: 1280, height: 1000 }, args: ['--force-device-scale-factor=2', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error' || /fake worker|autofocusing|permissions policy|Content Security Policy|cross-origin redirects/i.test(message.text())) errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  page.on('requestfailed', request => failures.push(request.url()));
  await page.goto('chrome://extensions');
  const id = await page.evaluate(() => document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id);
  const url = `chrome-extension://${id}/qa.html`;
  async function open(bytes, locale, sampling) {
    await page.goto(url); await page.evaluate(({ bytes, locale, sampling }) => openPdf(bytes, locale, sampling), { bytes: Array.from(bytes), locale, sampling });
    return (await page.locator('iframe').elementHandle()).contentFrame();
  }
  async function ready(frame) { await frame.waitForFunction(() => !!window.qaWorkerReady); assert.equal(await frame.evaluate(async () => (await window.qaWorkerReady).port instanceof Worker), true, 'PDF parsing uses a real background Worker'); await frame.waitForFunction(() => document.querySelector('.page canvas')?.width > 0 && document.querySelector('#count').textContent !== '—'); await frame.waitForFunction(() => document.querySelector('.textLayer span')); }

  async function checkCopyAll(frame) {
    const allowed = await frame.evaluate(() => ({write:document.featurePolicy.allowsFeature('clipboard-write'),read:document.featurePolicy.allowsFeature('clipboard-read')}));
    assert.equal(allowed.write, true); assert.equal(allowed.read, false);
    await frame.evaluate(() => {
      // Test the real PDF.js extraction path without replacing the OS clipboard.
      const original = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText');
      window.qaRestoreCopy = () => { if (original) Object.defineProperty(navigator.clipboard,'writeText',original); else delete navigator.clipboard.writeText; };
      Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.qaAllCopied=text;}});
      document.addEventListener('copy',event=>event.preventDefault(),{once:true});
    });
    await frame.locator('.textLayer span').first().click();
    await frame.page().keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');
    await frame.page().keyboard.press(process.platform==='darwin'?'Meta+c':'Control+c');
    await frame.waitForFunction(() => typeof window.qaAllCopied === 'string');
    assert.match(await frame.evaluate(()=>window.qaAllCopied), /PDF Viewer page 1/);
    await frame.evaluate(()=>{qaRestoreCopy();getSelection().removeAllRanges();});
  }
  async function detailReady(frame, number = 1, previous = null) {
    await frame.waitForFunction(({number, previous}) => {
      const detail = window.qaPdfViewer?.getPageView(number - 1)?.detailView;
      return detail?.renderingState === 3 && detail.canvas?.isConnected && detail.canvas !== previous;
    }, {number, previous}, {timeout:10000}).catch(async error => {
      console.error('Detail rendering state', await frame.evaluate(number => {
        const viewer = window.qaPdfViewer, view = viewer?.getPageView(number - 1);
        return {number, current:viewer?.currentPageNumber, scale:viewer?.currentScale, baseState:view?.renderingState,
          detailState:view?.detailView?.renderingState, connected:view?.detailView?.canvas?.isConnected,
          visible:[...(viewer?._getVisiblePages().ids || [])], budgets:[view?.maxCanvasPixels,view?.maxDetailCanvasPixels],
          density:view?.getRenderPixelRatio(), output:view?.outputScale, canvas:[view?.canvas?.width,view?.canvas?.height],
          viewport:[view?.viewport.width, view?.viewport.height]};
      }, number));
      throw error;
    });
  }
  async function zoom(frame, value) { await frame.locator('#scale').selectOption(value); }
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
  async function filtersOff(frame) {
    await frame.waitForFunction(() => [...document.querySelectorAll('.page canvas')].every(canvas => getComputedStyle(canvas).filter === 'none'));
  }

  // All non-PDF formats pass through this same sanitized content boundary.
  await page.goto(url);
  const web='https://example.com/captured', app='ms-word:ofe|u|https://example.com/report.docx';
  await page.evaluate(({web,app})=>openDocument(`<p id="start">Document text</p><a href="#end">Internal</a>
    <p><a href="${web}">Web</a></p><p><a href="${app}">App</a></p>
    <p><a href="mailto:a+tag@example.com">Mail</a></p><p><a href="tel:+13125550123">Phone</a></p><p><a href="sms:+13125550123?body=Hello">SMS</a></p>
    <a href="javascript:globalThis.ATTACK=true">Unsafe</a><img src="https://example.com/tracking"><iframe src="https://example.com/tracking"></iframe>
    <script>globalThis.ATTACK=true</script><p id="end">End</p>`,{}), {web,app});
  const content = await (await page.locator('iframe').elementHandle()).contentFrame();
  await content.waitForSelector('a[data-external-link]');
  assert.equal(await content.locator('a[data-external-link]').count(),5);
  assert.equal(await content.locator('img,iframe,script').count(),0);
  assert.equal(await content.evaluate(()=>typeof globalThis.chrome?.runtime), 'undefined');
  assert.equal(await content.evaluate(()=>window.ATTACK),undefined);
  assert.equal(await content.evaluate(()=>{try{parent.document;return false;}catch{return true;}}),true);
  assert.equal(await content.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.endsWith('/capture.js'))),false);
  const tabs = context.pages().length;
  for (const [title,opens] of [['Web',true],['App',true],['Mail',false],['Phone',false],['SMS',false]]) {
    const a=content.getByRole('link',{name:title,exact:true});assert.equal(await a.getAttribute('href'),'#');
    await a.click({button:title==='App'?'middle':'left'});await content.waitForSelector('.link-capture[open]');
    assert.equal(context.pages().length,tabs);assert.equal(await content.locator('.link-open').count(),Number(opens));
    if(title==='App')assert.equal(await content.locator('.link-open').getAttribute('href'),app);
    await content.evaluate(()=>{document.execCommand=command=>{window.qaCopy=document.querySelector('.link-copy-buffer')?.value;return command==='copy';};});
    await content.locator('.link-primary').click();assert.ok(await content.evaluate(()=>!!window.qaCopy));
    await content.locator('.link-capture').press('Escape');await content.waitForFunction(()=>!document.querySelector('.link-capture'));
  }
  await content.getByRole('link',{name:'Internal',exact:true}).click();assert.equal(await content.locator('.link-capture').count(),0);
  await page.evaluate(()=>contentReader.setTheme(true));
  await content.waitForFunction(()=>getComputedStyle(document.body).backgroundColor==='rgb(41, 42, 45)');
  await content.getByRole('link',{name:'App',exact:true}).click();await content.waitForSelector('.link-capture[open]');
  assert.equal(await content.locator('.link-capture').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(41, 42, 45)');
  await content.locator('.link-capture').evaluate(async node=>Promise.all(node.getAnimations().map(animation=>animation.finished)));
  await page.screenshot({path:join(folder,'external-links-document-dark.png')});
  await content.locator('.link-capture').press('Escape');await content.waitForFunction(()=>!document.querySelector('.link-capture'));
  await page.evaluate(()=>contentReader.setTheme(false));
  await content.waitForFunction(()=>getComputedStyle(document.body).backgroundColor==='rgb(255, 255, 255)');
  // Replacing a spreadsheet/slide closes stale captures and keeps only this part.
  await content.getByRole('link',{name:'App',exact:true}).click();await content.waitForSelector('.link-capture');
  await page.evaluate(()=>contentReader.render('<p>Second part</p>',{kind:'xlsx',styles:[]}));await content.waitForSelector('body.cg-format-xlsx');
  assert.equal(await content.locator('.link-capture').count(),0);
  assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.screenshot({path:join(folder,'external-links-document.png')});
  metrics.externalDocumentCapture='opaque sandbox; no untrusted scripts/resources; web/app second action; mail/tel/sms copy-only; internal links unchanged';

  let captureFrame=await open(viewerPdf(1,['mailto:a@example.com','tel:+13125550123','sms:+13125550123','custom-app:open?id=1']),'en-US',1);
  await ready(captureFrame);await captureFrame.waitForSelector('.pdf-links a[data-external-link^="custom-app:"]');
  for(const prefix of ['https:','mailto:','tel:','sms:','custom-app:']){
    await captureFrame.locator(`.pdf-links a[data-external-link^="${prefix}"]`).click();await captureFrame.waitForSelector('.link-capture[open]');
    assert.equal(await captureFrame.locator('.link-open').count(),['https:','custom-app:'].includes(prefix)?1:0);
    await captureFrame.locator('.link-capture').press('Escape');await captureFrame.waitForFunction(()=>!document.querySelector('.link-capture'));
  }
  metrics.externalPdfCapture='URI protocols captured without executing PDF actions or opening apps';

  await page.goto(url); await page.evaluate(() => openPdf(undefined, 'en-US', 1));
  const warming = await (await page.locator('iframe').elementHandle()).contentFrame();
  await warming.waitForFunction(() => document.querySelector('#filename').textContent.length > 0);
  await warming.evaluate(() => qaWorkerReady.then(() => true));
  assert.equal(await page.locator('iframe').evaluate(n => getComputedStyle(n).visibility), 'visible');
  assert.equal(await warming.locator('#filename').isDisabled(), true);
  assert.equal(await warming.locator('#download').isDisabled(), true);
  assert.equal(await warming.locator('#next').isDisabled(), true);
  assert.equal(await warming.locator('#progress').isVisible(), true);
  assert.equal(await warming.locator('.page').count(), 0, 'shell/worker can be ready before document bytes');
  await page.screenshot({path:join(folder,'loading-warm-shell.png')});
  await page.evaluate(bytes => viewer.open(new Uint8Array(bytes).buffer), Array.from(viewerPdf(80)));
  await ready(warming); await warming.waitForFunction(() => document.querySelector('#progress').hidden);
  assert.equal(await warming.evaluate(() => qaRenderedPages[0]), 1, 'page one is painted first');
  assert.ok(await warming.locator('.page canvas').count()<10, 'first page is usable without rendering the whole PDF');
  assert.equal(await warming.locator('#filename').isDisabled(), false);
  async function checkRenderFeedback(frame) {
    await frame.waitForFunction(()=>document.querySelector('#progress').hidden);
    const before=await frame.evaluate(async()=>{
      const viewer=window.qaViewer||window.qaPdfViewer,number=viewer.pagesCount;
      const page=await viewer.pdfDocument.getPage(number),original=page.render;
      window.qaProgressNumber=number;window.qaRestoreRender=()=>{page.render=original;};
      page.render=function(...args){
        const task=original.apply(this,args),gate=new Promise(resolve=>{window.qaReleaseRender=resolve;});
        const promise=task.promise.then(()=>gate);
        return new Proxy(task,{get(target,key){if(key==='promise')return promise;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
      };
      const y=document.querySelector('#workspace').getBoundingClientRect().top;
      viewer.currentPageNumber=number;
      return {y,hidden:document.querySelector('#progress').hidden};
    });
    assert.equal(before.hidden,true,'no immediate progress flash on navigation');
    await frame.waitForFunction(()=>typeof qaReleaseRender==='function'&&!document.querySelector('#progress').hidden);
    const waiting=await frame.evaluate(()=>{
      const viewer=window.qaViewer||window.qaPdfViewer,style=getComputedStyle(viewer.getPageView(qaProgressNumber-1).div,'::after');
      return{display:style.display,content:style.content,background:style.backgroundImage,y:document.querySelector('#workspace').getBoundingClientRect().top,
        line:document.querySelector('#progress').getBoundingClientRect().top,header:document.querySelector('header').getBoundingClientRect().bottom,status:document.querySelector('#status').textContent};
    });
    assert.equal(waiting.display,'none');assert.equal(waiting.content,'none');assert.equal(waiting.background,'none');
    assert.equal(waiting.y,before.y,'progress never moves the document');assert.ok(Math.abs(waiting.line-waiting.header)<=2,'progress sits on the toolbar divider');assert.equal(waiting.status,'');
    await frame.evaluate(()=>{qaRestoreRender();qaReleaseRender();});
    await frame.waitForFunction(()=>document.querySelector('#progress').hidden);
    await frame.evaluate(()=>{const viewer=window.qaViewer||window.qaPdfViewer;viewer.currentPageNumber=1;});
    await frame.waitForFunction(()=>document.querySelector('#progress').hidden&&(window.qaViewer||window.qaPdfViewer).getPageView(0).renderingState===3);
    // Offscreen pending state must not participate in visible-page feedback.
    assert.equal(await frame.evaluate(async()=>{
      const viewer=window.qaViewer||window.qaPdfViewer,offscreen=viewer.getPageView(qaProgressNumber-1),state=offscreen.renderingState;
      offscreen.renderingState=1;viewer.update();await new Promise(resolve=>setTimeout(resolve,260));const hidden=document.querySelector('#progress').hidden;offscreen.renderingState=state;return hidden;
    }),true);
  }
  await checkRenderFeedback(warming);metrics.renderFeedback='toolbar-divider only for slow visible pages; no page icons, background feedback or layout shift';
  const start = performance.now(); const frame = await open(viewerPdf()); await ready(frame); await checkCopyAll(frame);
  await detailReady(frame);
  metrics.open80PagesMs = Math.round(performance.now() - start);
  await filtersOff(frame);
  await initialPosition(frame);
  metrics.initialCanvasRatio = await frame.evaluate(() => {
    const canvas = document.querySelector('.page canvas.detailView'), width = canvas.getBoundingClientRect().width;
    return canvas.width / width;
  });
  assert.ok(metrics.initialCanvasRatio >= 5.9, 'normal reading reaches 6x density in the visible area');
  async function paperPalette() {
    const points = await frame.evaluate(() => {
      const rect = document.querySelector('.page').getBoundingClientRect();
      return [[rect.left + 20, rect.top + 20], [rect.left + rect.width * 465 / 612, rect.top + rect.height * 77 / 842]];
    });
    return page.evaluate(async ({png, points}) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], {type:'image/png'}));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      const density = canvas.width / innerWidth;
      return points.map(([x,y]) => [...context.getImageData(Math.floor(x*density), Math.floor(y*density), 1, 1).data].slice(0,3));
    }, {png: [...await page.screenshot()], points});
  }
  metrics.darkPalette = await paperPalette();
  assert.ok(metrics.darkPalette[0].every(channel => channel >= 9 && channel <= 11), 'white paper keeps the prior dark gray');
  assert.ok(metrics.darkPalette[1].every(channel => channel >= 244 && channel <= 246), 'black ink keeps the prior soft white');
  const firstPage = await frame.locator('.page').first().boundingBox();
  const detailClip = {x:firstPage.x+50, y:firstPage.y+40, width:740, height:185};
  await page.screenshot({path:join(folder, 'small-type-dark.png'), clip:detailClip});
  await frame.locator('#theme').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'false');
  assert.deepEqual(await paperPalette(), [[255,255,255],[0,0,0]], 'light appearance retains the original paper and ink');
  await page.screenshot({path:join(folder, 'small-type-light.png'), clip:detailClip});
  await frame.locator('#theme').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'true');
  assert.equal(await frame.locator('#scale').inputValue(), '1');
  const pageIndicator = await frame.evaluate(() => ({
    appearance: getComputedStyle(document.querySelector('#page')).appearance,
    countSize: getComputedStyle(document.querySelector('#count')).fontSize,
    pageSize: getComputedStyle(document.querySelector('#page')).fontSize,
    zoomSize: getComputedStyle(document.querySelector('#scale')).fontSize,
    count: document.querySelector('.page-indicator #count').textContent,
    countWidth: document.querySelector('#count').getBoundingClientRect().width,
    pageWidth: document.querySelector('#page').getBoundingClientRect().width,
    separatorSize: getComputedStyle(document.querySelector('.page-separator')).fontSize
  }));
  assert.equal(pageIndicator.appearance, 'textfield');
  assert.equal(pageIndicator.countSize, pageIndicator.pageSize);
  assert.equal(pageIndicator.countSize, pageIndicator.zoomSize);
  assert.equal(pageIndicator.count, '80');
  assert.equal(pageIndicator.countWidth, pageIndicator.pageWidth);
  assert.equal(pageIndicator.separatorSize, pageIndicator.pageSize);
  assert.equal(await frame.locator('#scale').evaluate(n => n.tagName), 'SELECT');
  assert.equal(await frame.locator('#theme-auto').count(), 0);
  assert.equal(await frame.locator('#theme').getAttribute('title'), 'Switch light/dark mode');
  assert.equal(await frame.locator('#previous').isVisible(), true);
  assert.equal(await frame.locator('#next').isVisible(), true);
  await frame.locator('#next').click();
  await frame.waitForFunction(() => qaPdfViewer.currentPageNumber === 2 && qaPdfViewer._getVisiblePages().ids.has(2));
  await frame.locator('#previous').click();
  await frame.waitForFunction(() => qaPdfViewer.currentPageNumber === 1 && qaPdfViewer._getVisiblePages().ids.has(1));
  await frame.locator('#zoom-in').click();
  assert.equal(await frame.locator('#custom-scale').textContent(), '110%');
  await frame.locator('#scale').dispatchEvent('pointerdown');
  assert.deepEqual(await frame.locator('#scale').evaluate(n => {
    const custom = n.querySelector('#custom-scale'); return [custom.previousElementSibling.value,custom.nextElementSibling.value,n.value];
  }), ['1','1.25','custom']);
  await zoom(frame, '1');
  assert.equal(await frame.locator('#custom-scale').evaluate(n => n.hidden), true);
  await jump(frame, 1);
  await frame.waitForFunction(() => qaPdfViewer.currentPageNumber === 1);
  await detailReady(frame);
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
  // Properties is lazy, keyboard accessible and reads the existing document.
  assert.equal(await frame.evaluate(() => performance.getEntriesByType('resource').some(r => r.name.endsWith('/properties.js'))), false);
  // PDF.js also reads metadata for the document language; the dialog must add
  // no eager request of its own, and only one cached request after activation.
  const engineMetadataCalls = await frame.evaluate(() => qaMetadataCalls);
  assert.equal(await frame.locator('#properties-list dd').count(), 0);
  assert.equal(await frame.locator('#filename').getAttribute('aria-haspopup'), 'dialog');
  await frame.locator('#filename').focus(); await frame.locator('#filename').press('Enter');
  await frame.waitForSelector('#properties-dialog[open]');
  await frame.waitForFunction(() => document.querySelector('[data-property=author]').textContent === 'Cosmic Gemini tests');
  assert.equal(await frame.locator('#properties-title').textContent(), 'Document properties');
  assert.equal(await frame.locator('[data-property=fileName]').textContent(), 'PDF Viewer — reading and zoom.pdf');
  assert.match(await frame.locator('[data-property=fileSize]').textContent(), /^\d+(\.\d)? KB$/);
  assert.equal(await frame.locator('[data-property=documentTitle]').textContent(), 'QA <b>metadata</b>');
  assert.equal(await frame.locator('#properties-list b').count(), 0);
  assert.equal(await frame.locator('[data-property=created]').textContent(), '2026-01-02 12:34:56 (UTC+5:30)');
  assert.equal(await frame.locator('[data-property=modified]').textContent(), '2026-02-03 10:12 (UTC-8)');
  assert.equal(await frame.locator('[data-property=pageCount]').textContent(), '80');
  assert.equal(await frame.locator('[data-property=pdfVersion]').textContent(), '1.7');
  assert.deepEqual(await frame.locator('#properties-dialog').evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,font:getComputedStyle(n).fontSize})),{width:560,height:560,font:'15px'});
  const originalPageSize = await frame.locator('[data-property=pageSize]').textContent();
  assert.match(originalPageSize, /^8.5 × 11.69 in \(Page 1\)$/);
  await frame.locator('#properties-close').press('ArrowRight');
  assert.equal(await frame.locator('#page').inputValue(), '1', 'modal keyboard must not move the PDF behind it');
  await page.screenshot({path:join(folder,'properties-dark-en.png')});
  await frame.locator('#properties-close').press('Escape');
  assert.equal(await frame.locator('#filename').evaluate(n => document.activeElement === n), true);
  await frame.locator('#rotate').click(); await frame.locator('#filename').click();
  await frame.waitForFunction(() => !document.querySelector('#properties-status').textContent);
  assert.equal(await frame.locator('[data-property=pageSize]').textContent(), originalPageSize, 'display rotation does not change original page dimensions');
  assert.equal(await frame.evaluate(() => qaMetadataCalls), engineMetadataCalls + 1, 'reopening reuses metadata');
  await frame.locator('#properties-list').click();
  assert.equal(await frame.locator('#properties-dialog').evaluate(n => n.open), true);
  await page.mouse.click(8,8); await frame.waitForFunction(() => !document.querySelector('#properties-dialog').open);
  for (let i=0;i<3;i++) await frame.locator('#rotate').click();
  await frame.locator('#theme').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'false');
  await frame.locator('#filename').click(); await frame.waitForFunction(() => !document.querySelector('#properties-status').textContent);
  await page.screenshot({path:join(folder,'properties-light-en.png')}); await frame.locator('#properties-close').click();
  await frame.locator('#theme').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'true');
  await page.setViewportSize({width:760,height:400});
  for(let i=0;i<2;i++){
    await frame.locator('#filename').click();await frame.waitForFunction(()=>!document.querySelector('#properties-status').textContent);
    assert.deepEqual(await frame.locator('#properties-dialog').evaluate(n=>({overflow:n.scrollHeight>n.clientHeight,top:n.scrollTop,left:n.scrollLeft,focus:document.activeElement.id})),{overflow:true,top:0,left:0,focus:'properties-title'});
    await frame.locator('#properties-dialog').evaluate(n=>{n.scrollTop=n.scrollHeight;});await frame.locator('#properties-close').click();
    assert.equal(await frame.evaluate(()=>document.activeElement.id),'filename');
  }
  await page.setViewportSize({width:1280,height:1000});
  metrics.properties = 'filename click/keyboard, lazy cached metadata, ISO dates/offsets, safe text, original dimensions, light/dark and dismissal';
  assert.equal(await frame.evaluate(() => typeof globalThis.chrome?.runtime), 'undefined');
  assert.equal(await frame.evaluate(() => !!globalThis.PDF_ATTACK), false);
  assert.equal(await frame.locator('.pdf-links a[href^="javascript:"]').count(), 0);
  await frame.waitForSelector('.pdf-links a[data-external-link="https://example.com/pdf-link"]');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.page')).outlineStyle), 'solid');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.page')).backgroundColor), 'rgb(10, 10, 10)');
  const originalDetail = await frame.locator('.page canvas.detailView').first().elementHandle();
  await zoom(frame, '1.25');
  await detailReady(frame, 1, originalDetail);
  metrics.fractionalDetailRatio = await frame.locator('.page canvas.detailView').first().evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
  assert.ok(metrics.fractionalDetailRatio >= 5.5, 'fractional zoom preserves higher-density detail');
  assert.equal(await frame.locator('.page canvas.detailView').first().evaluate(canvas => getComputedStyle(canvas).imageRendering), 'auto');
  await page.screenshot({path:join(folder, 'fractional-zoom.png')});
  await zoom(frame, '1');
  await frame.locator('#zoom-in').click(); await frame.locator('#zoom-in').click();
  assert.equal(await frame.locator('#custom-scale').textContent(), '120%');
  await frame.locator('#zoom-out').click(); await frame.locator('#zoom-out').click(); assert.equal(await frame.locator('#scale').inputValue(), '1');
  // Select/copy remains a text layer, not OCR or an editable document.
  assert.match(await frame.locator('.textLayer').first().textContent(), /PDF Viewer page 1/);
  assert.equal(await frame.locator('#search-toggle, #findbar').count(), 0);
  for (const modifier of ['metaKey','ctrlKey']) {
    assert.equal(await frame.evaluate(key => document.querySelector('#viewport').dispatchEvent(new KeyboardEvent('keydown', {key:'f', [key]:true, bubbles:true, cancelable:true})), modifier), true, 'Chrome owns Find shortcuts');
  }
  await jump(frame, 60);
  await detailReady(frame, 60);
  const detailBeforeZoom = await frame.locator('.page[data-page-number="60"] canvas.detailView').elementHandle();
  const zoomStart = performance.now(); for (let i = 0; i < 10; i++) await frame.locator('#zoom-in').click();
  assert.equal(await frame.locator('#scale').inputValue(), '2'); assert.equal(await frame.locator('#page').inputValue(), '60');
  metrics.tenZoomStepsMs = Math.round(performance.now() - zoomStart);
  await detailReady(frame, 60, detailBeforeZoom);
  metrics.zoomDetailRatio = await frame.evaluate(() => {
    const canvas = document.querySelector('.page[data-page-number="60"] canvas.detailView');
    return canvas.width / canvas.getBoundingClientRect().width;
  });
  metrics.zoomSettledMs = Math.round(performance.now() - zoomStart);
  assert.ok(metrics.zoomDetailRatio >= 4.8, 'high zoom increases detail density while retaining a scroll margin');
  const previousDetail = await frame.locator('.page[data-page-number="60"] canvas.detailView').elementHandle();
  await frame.evaluate(() => { document.querySelector('#viewport').scrollTop += 8; });
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await previousDetail.evaluate(canvas => canvas.isConnected), true, 'small scrolls reuse the detailed canvas');
  const pagePixels = await frame.locator('.page canvas').evaluateAll(nodes => nodes.map(canvas => ({pixels:canvas.width * canvas.height, detail:canvas.classList.contains('detailView')})));
  assert.ok(pagePixels.every(({pixels, detail}) => pixels <= (detail ? 36 : 4) * 1024 * 1024), 'base and detail canvases respect their separate budgets');
  await frame.locator('#rotate').click(); assert.equal(await frame.locator('#page').inputValue(), '60');
  await zoom(frame, 'page-fit');
  await frame.locator('#sidebar-toggle').click(); await frame.waitForSelector('.thumbnail canvas');
  metrics.thumbnailRatio = await frame.locator('.thumbnail canvas').first().evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
  assert.ok(metrics.thumbnailRatio >= 1.9, 'sidebar thumbnails match Retina pixel density');
  await frame.locator('#show-outline').click(); await frame.locator('#outline button').click();
  assert.equal(await frame.locator('#page').inputValue(), '80');
  await frame.locator('#show-pages').click();
  for (const n of [5,15,25,35,45,55,65,75]) await jump(frame, n);
  metrics.retainedPageCanvases = await frame.locator('.page canvas').count(); assert.ok(metrics.retainedPageCanvases <= 14);
  metrics.cachedBasePixels = await frame.locator('.page canvas:not(.detailView)').evaluateAll(nodes => nodes.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0));
  assert.ok(metrics.cachedBasePixels <= 6 * 4 * 1024 * 1024, 'visiting pages does not accumulate full-resolution page caches');
  metrics.retainedThumbnails = await frame.locator('.thumbnail canvas').count(); assert.ok(metrics.retainedThumbnails <= 24);
  await frame.locator('#theme').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'false');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.canvasWrapper')).filter), 'none');
  await frame.locator('#theme').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'true');
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
  await zoom(fresh, 'page-fit');
  await page.screenshot({path: join(folder, 'dark-zh.png')});
  if (process.env.PDF_VIEWER_PASSWORD_SAMPLE) {
    const locked = await open(await readFile(process.env.PDF_VIEWER_PASSWORD_SAMPLE)); await locked.waitForSelector('#password-dialog[open]');
    await locked.locator('#password').fill('wrong'); await locked.locator('button[value=open]').click(); await locked.waitForFunction(() => document.querySelector('#password-message').textContent.includes('Incorrect'));
    await locked.locator('#password').fill('reader-test'); await locked.locator('button[value=open]').click(); await ready(locked);
    metrics.password = 'wrong password rejected, correct password opened';
  }
  if (process.env.PDF_VIEWER_REAL_SAMPLE) {
    const real = await open(await readFile(process.env.PDF_VIEWER_REAL_SAMPLE)); await ready(real);
    await detailReady(real);
    metrics.realPages = await real.locator('#count').textContent();
    const firstDetail = await real.locator('.page canvas.detailView').first().elementHandle();
    const realZoomStart = performance.now();
    await zoom(real, '5'); await detailReady(real, 1, firstDetail);
    metrics.real500PercentMs = Math.round(performance.now() - realZoomStart);
    metrics.real500PercentRatio = await real.locator('.page canvas.detailView').first().evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
    assert.ok(metrics.real500PercentRatio >= 4.8, '500% zoom increases visible detail without rasterizing the whole page at 6x');
    const enlargedDetail = await real.locator('.page canvas.detailView').first().elementHandle();
    await zoom(real, 'page-fit');
    await detailReady(real, 1, enlargedDetail);
    await page.screenshot({path: join(folder, 'real.png')});
  }
  const scanImage = await page.evaluate(() => {
    const source = document.createElement('canvas'); source.width = 612; source.height = 842;
    const ink = source.getContext('2d'); ink.fillStyle = '#e8e8e8'; ink.fillRect(0,0,612,842);
    ink.fillStyle = '#686868';
    for (let row=0; row<9; row++) {
      ink.font = `${12 + row % 3 * 2}px Arial`;
      ink.fillText('Scanned text: minimum 0123456789 / fine strokes', 40, 65 + row*32);
    }
    const scan = document.createElement('canvas'); scan.width=612; scan.height=842;
    const context = scan.getContext('2d'); context.filter='blur(0.55px)'; context.drawImage(source,0,0);
    return scan.toDataURL('image/jpeg', .9).split(',')[1];
  });
  const scanStart = performance.now();
  const scan = await open(scannedPdf(Buffer.from(scanImage, 'base64'),612,842), 'en-US', 6); await detailReady(scan);
  metrics.scanReadyMs = Math.round(performance.now()-scanStart);
  await filtersOff(scan);
  assert.equal(await scan.locator('.textLayer span').count(), 0, 'fixture is a scan without a text layer');
  const scanPrevious = await scan.locator('canvas.detailView').elementHandle();
  const scanZoomStart = performance.now(); await zoom(scan, '2'); await detailReady(scan,1,scanPrevious);
  await page.screenshot({path:join(folder,'scan-200-percent.png')});
  metrics.scanZoomPaintMs = Math.round(performance.now()-scanZoomStart);
  const economical = await open(viewerPdf(2), 'en-US', 2); await ready(economical);
  await economical.waitForFunction(()=>window.qaPdfViewer.getPageView(0).renderingState===3);
  assert.equal(await economical.evaluate(()=>window.qaPdfViewer.getPageView(0).getRenderPixelRatio()),2);
  await zoom(economical, '2'); await detailReady(economical);
  assert.equal(await economical.evaluate(()=>window.qaPdfViewer.getPageView(0).getRenderPixelRatio()),2);
  await filtersOff(economical);
  const lowMemory = await open(viewerPdf(2), 'en-US', 1); await ready(lowMemory);
  await lowMemory.waitForFunction(()=>window.qaPdfViewer.getPageView(0).renderingState===3);
  metrics.oneTimesCanvas = await lowMemory.evaluate(()=>{
    const view=window.qaPdfViewer.getPageView(0),canvas=view.canvas;
    return {density:canvas.width/view.viewport.width,pixels:canvas.width*canvas.height};
  });
  assert.ok(Math.abs(metrics.oneTimesCanvas.density-1)<.01);
  assert.ok(metrics.oneTimesCanvas.pixels<=1024*1024, '1x uses a smaller actual canvas at normal zoom');
  await filtersOff(lowMemory);
  await zoom(lowMemory, '2'); await detailReady(lowMemory);
  assert.equal(await lowMemory.evaluate(()=>window.qaPdfViewer.getPageView(0).maxDetailCanvasPixels),1024*1024);
  assert.equal(await lowMemory.evaluate(()=>window.qaPdfViewer.getPageView(0).maxCanvasPixels),1024*1024);
  await filtersOff(lowMemory);
  for (const sampling of [3,5]) {
    const intermediate = await open(viewerPdf(1), 'en-US', sampling); await ready(intermediate); await detailReady(intermediate);
    assert.equal(await intermediate.evaluate(()=>window.qaPdfViewer.getPageView(0).getRenderPixelRatio()),sampling);
    assert.equal(await intermediate.evaluate(()=>window.qaPdfViewer.getPageView(0).maxDetailCanvasPixels),sampling**2*1024*1024);
    await filtersOff(intermediate);
  }
  const propertiesChinese = await open(viewerPdf(2), 'zh-CN', 1); await ready(propertiesChinese);
  await propertiesChinese.locator('#filename').click();
  await propertiesChinese.waitForFunction(() => !document.querySelector('#properties-status').textContent);
  assert.equal(await propertiesChinese.locator('#properties-title').textContent(), '文档信息');
  assert.equal(await propertiesChinese.locator('[data-property=created]').textContent(), '2026-01-02 12:34:56 (UTC+5:30)');
  assert.match(await propertiesChinese.locator('[data-property=pageSize]').textContent(), /^215.9 × 297.04 mm/);
  await page.setViewportSize({width:360,height:850});
  assert.equal(await propertiesChinese.locator('#properties-dialog').evaluate(n => n.getBoundingClientRect().width<=innerWidth&&n.scrollWidth<=n.clientWidth),true);
  await page.screenshot({path:join(folder,'properties-dark-zh-narrow.png')});
  await propertiesChinese.locator('#properties-close').click();
  await page.setViewportSize({width:1280,height:1000});
  const deferred = await open(viewerPdf(2), 'en-US', 1); await ready(deferred);
  await deferred.evaluate(() => {
    const original = qaPdfDocument.getMetadata.bind(qaPdfDocument);
    qaPdfDocument.getMetadata = () => new Promise(resolve => { window.qaResolveMetadata = async () => resolve(await original()); });
  });
  await deferred.locator('#filename').click(); await deferred.waitForSelector('#properties-dialog[open]');
  await deferred.waitForFunction(() => typeof qaResolveMetadata === 'function');
  await deferred.locator('#properties-close').press('Escape'); await deferred.evaluate(() => qaResolveMetadata());
  assert.equal(await deferred.locator('#properties-dialog').evaluate(n => n.open),false);
  assert.equal(await deferred.locator('[data-property=author]').textContent(),'—', 'closed dialog ignores stale metadata completion');
  await deferred.locator('#filename').click(); await deferred.waitForFunction(() => document.querySelector('[data-property=author]').textContent === 'Cosmic Gemini tests');
  await deferred.locator('#properties-close').click();
  const unavailable = await open(viewerPdf(1), 'en-US', 1); await ready(unavailable);
  await unavailable.evaluate(() => { qaPdfDocument.getMetadata = () => Promise.reject(new Error('QA metadata failure')); });
  await unavailable.locator('#filename').click();
  await unavailable.waitForFunction(() => document.querySelector('#properties-status').textContent === 'Some document properties could not be read.');
  assert.equal(await unavailable.locator('[data-property=author]').textContent(),'—');
  assert.equal(await unavailable.locator('[data-property=pageCount]').textContent(),'1');
  await unavailable.locator('#properties-close').click();
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
  await detailReady(embedded);
  const density = target => target.evaluate(()=>window.qaPdfViewer.getPageView(0).getRenderPixelRatio());
  assert.equal(await density(embedded),4,'default reader sampling is 4x');
  await filtersOff(embedded);
  assert.equal(await embedded.evaluate(()=>window.qaPdfViewer.getPageView(0).maxDetailCanvasPixels),16*1024*1024);
  await page.evaluate(()=>chrome.storage.local.set({cosmicGeminiSettings:{documentPreview:{enabled:true,appearance:'dark',pdfSampling:4}}}));
  const settings = await context.newPage();
  settings.on('pageerror',error=>errors.push(error.message));
  await settings.goto(`chrome-extension://${id}/settings/satellites.html`);
  await settings.waitForFunction(()=>!document.querySelector('#documentPdfSampling').matches(':disabled'));
  assert.equal(await settings.locator('#documentPdfSampling').inputValue(),'4');
  assert.deepEqual(await settings.locator('#documentPdfSampling option').allTextContents(),['1×','2×','3×','4× (default)','5×','6×']);
  await settings.locator('#documentPdfSampling').selectOption('1');
  await settings.waitForFunction(async()=>(await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings.documentPreview.pdfSampling===1);
  await settings.reload();
  await settings.waitForFunction(()=>document.querySelector('#documentPdfSampling').value==='1');
  await settings.locator('#documentPdfSampling').selectOption('6');
  await settings.waitForFunction(async()=>(await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings.documentPreview.pdfSampling===6);
  await settings.locator('#documentPdfSampling').scrollIntoViewIfNeeded();
  await settings.screenshot({path:join(folder,'sampling-settings-en.png')});
  await settings.reload();
  await settings.waitForFunction(()=>document.querySelector('#documentPdfSampling').value==='6');
  await page.evaluate(()=>chrome.storage.local.set({qaLocale:'zh-CN'}));
  await settings.reload();
  await settings.waitForFunction(()=>document.documentElement.lang==='zh-CN');
  assert.equal(await settings.locator('#documentPdfSamplingLabel').textContent(),'PDF 采样');
  assert.equal(await settings.locator('#documentPdfSampling option[value="4"]').textContent(),'4×（默认）');
  await settings.locator('#documentPdfSampling').scrollIntoViewIfNeeded();
  await settings.screenshot({path:join(folder,'sampling-settings-zh.png')});
  await settings.locator('#documentPreviewEnabled').uncheck({force:true});
  await settings.waitForFunction(()=>document.querySelector('#documentPdfSampling').matches(':disabled'));
  await settings.close();
  await page.evaluate(()=>chrome.storage.local.set({qaLocale:'en-US'}));
  await zoom(embedded, '2'); await detailReady(embedded);
  assert.equal(await density(embedded),4,'saving preferences and zooming cannot change an open reader sampling value');
  await jump(embedded, 3);
  await embedded.locator('#theme').click();await embedded.waitForFunction(()=>document.documentElement.dataset.dark==='false');
  assert.equal(await embedded.locator('#page').inputValue(), '3', 'theme changes keep the reading position');
  assert.match(integration.url(),/appearance=light/);
  await embedded.locator('#theme').click();await embedded.waitForFunction(()=>document.documentElement.dataset.dark==='true');
  await embedded.locator('#fullscreen').click();await integration.waitForFunction(()=>!!document.fullscreenElement);
  await embedded.locator('#fullscreen').click();await integration.waitForFunction(()=>!document.fullscreenElement);
  await integration.reload();await integration.waitForSelector('.pdf-viewer-frame');
  embedded=await (await integration.locator('.pdf-viewer-frame').elementHandle()).contentFrame();await ready(embedded);
  assert.equal(await embedded.locator('#scale').inputValue(),'1');
  assert.equal(await density(embedded),6,'a new reader instance takes the updated setting');
  assert.equal(await embedded.evaluate(()=>document.documentElement.dataset.dark),'true');
  await initialPosition(embedded);
  const themeTooltip = await embedded.locator('#theme').getAttribute('title');
  for (const defaultAppearance of ['light','dark','auto']) {
    await integration.emulateMedia({colorScheme:'light'});
    await page.evaluate(async appearance => {
      const stored = (await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings;
      stored.documentPreview.appearance = appearance;
      await chrome.storage.local.set({cosmicGeminiSettings:stored});
    }, defaultAppearance);
    const defaultDark = defaultAppearance === 'dark';
    await embedded.waitForFunction(dark => document.documentElement.dataset.dark === String(dark), defaultDark);
    await embedded.locator('#theme').click();
    await embedded.waitForFunction(dark => document.documentElement.dataset.dark === String(dark), !defaultDark);
    await page.waitForFunction(async () => (await chrome.storage.session.get('qaDocument')).qaDocument.siteTheme !== null);
    await embedded.locator('#theme').click();
    await embedded.waitForFunction(dark => document.documentElement.dataset.dark === String(dark), defaultDark);
    await page.waitForFunction(async () => (await chrome.storage.session.get('qaDocument')).qaDocument.siteTheme === null);
    assert.equal(await embedded.locator('#theme').getAttribute('title'), themeTooltip);
    assert.equal(await embedded.locator('#theme-auto').count(),0);
    if (defaultAppearance === 'auto') {
      await integration.emulateMedia({colorScheme:'dark'});
      await embedded.waitForFunction(() => document.documentElement.dataset.dark === 'true');
    }
  }
  metrics.toolbar = 'centered compact groups, symmetric page fields, previous/next, zoom presets/custom insertion, single theme control and restored Auto/Light/Dark';
  await page.evaluate(()=>chrome.storage.session.set({'documentPreview:regular':{documents:[],themes:{}}}));
  await integration.waitForFunction(()=>!document.querySelector('.pdf-viewer-frame'));
  assert.match(await integration.locator('#status').textContent(),/expired/);await integration.close();
  metrics.documentPreview='default 4x, all 1x–6x choices, immutable open-reader sampling, theme, fullscreen, reload and expiry passed';
  assert.deepEqual(network, []); assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  await page.evaluate(() => viewer.destroy()); assert.equal(await page.locator('iframe').count(), 0);
  console.log(JSON.stringify({metrics, errors, network, screenshots: folder}, null, 2));
} catch (error) { console.error('Browser diagnostics', {errors, failures, network, folder}); throw error; } finally { await context.close(); await rm(join(folder, 'profile'), {recursive:true,force:true}); }
