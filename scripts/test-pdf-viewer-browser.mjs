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
await writeFile(viewerPath, (await readFile(viewerPath, 'utf8')).replace('links.setViewer(viewer);', 'window.qaPdfViewer = viewer; links.setViewer(viewer);'));
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'PDF Viewer isolated QA', version: '1.0', permissions: ['storage','downloads'], background: {service_worker:'qa-background.js',type:'module'}, sandbox: manifest.sandbox, content_security_policy: manifest.content_security_policy }));
await writeFile(join(extension, 'qa-background.js'), `import {normalizeSettings} from './core/config.js';
chrome.runtime.onConnect.addListener(()=>{});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async()=>{
    if(message.type==='UI_GET_LOCALE')return {locale:(await chrome.storage.local.get('qaLocale')).qaLocale||'en-US'};
    if(message.type==='UI_GET')return {preferences:normalizeSettings((await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings)};
    if(message.type==='UI_SET_DOCUMENT_PDF_SAMPLING'||message.type==='UI_SET_DOCUMENT_PDF_SHARPENING'||message.type==='UI_SET_ENABLED'){
      const settings=normalizeSettings((await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings);
      const feature=settings.documentPreview;
      if(message.type==='UI_SET_DOCUMENT_PDF_SAMPLING')feature.pdfSampling=message.pdfSampling;
      else if(message.type==='UI_SET_DOCUMENT_PDF_SHARPENING')feature.pdfSharpening=message.pdfSharpening;
      else feature.enabled=message.enabled;
      await chrome.storage.local.set({cosmicGeminiSettings:settings});
      const {qaDocument:doc}=await chrome.storage.session.get('qaDocument');
      if(doc)await chrome.storage.session.set({qaDocument:{...doc,pdfSampling:feature.pdfSampling,pdfSharpening:feature.pdfSharpening}});
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
window.events=[];window.openPdf=(bytes, locale='en-US', sampling=6, sharpening=false)=>{window.viewer?.destroy();window.viewer=createPdfViewer({container:document.querySelector('main'),bytes:new Uint8Array(bytes).buffer,filename:'PDF Viewer — reading and zoom.pdf',site:'example.com',locale,sampling,sharpening,dark:true,automatic:true,onDownload:()=>events.push('download'),onTheme:()=>viewer.setTheme(false,false),onAuto:()=>viewer.setTheme(true,true),onError:()=>events.push('error')});};`);
const context = await chromium.launchPersistentContext(join(folder, 'profile'), { executablePath: process.env.PDF_VIEWER_CHROME, headless: true, deviceScaleFactor: 2, viewport: { width: 1280, height: 1000 }, args: ['--force-device-scale-factor=2', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  page.on('requestfailed', request => failures.push(request.url()));
  await page.goto('chrome://extensions');
  const id = await page.evaluate(() => document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id);
  const url = `chrome-extension://${id}/qa.html`;
  async function open(bytes, locale, sampling, sharpening) {
    await page.goto(url); await page.evaluate(({ bytes, locale, sampling, sharpening }) => openPdf(bytes, locale, sampling, sharpening), { bytes: Array.from(bytes), locale, sampling, sharpening });
    return (await page.locator('iframe').elementHandle()).contentFrame();
  }
  async function ready(frame) { await frame.waitForFunction(() => document.querySelector('.page canvas')?.width > 0 && document.querySelector('#count').textContent !== '/ —'); await frame.waitForFunction(() => document.querySelector('.textLayer span')); }
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
    assert.equal(await frame.locator('canvas.pdf-sharpen').count(),0,'disabled sharpening keeps no sharpened base surfaces');
  }
  const start = performance.now(); const frame = await open(viewerPdf()); await ready(frame);
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
  await frame.locator('#theme-auto').click(); await frame.waitForFunction(() => document.documentElement.dataset.dark === 'true');
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
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.page')).backgroundColor), 'rgb(10, 10, 10)');
  const originalDetail = await frame.locator('.page canvas.detailView').first().elementHandle();
  await frame.locator('#scale').selectOption('1.25');
  await detailReady(frame, 1, originalDetail);
  metrics.fractionalDetailRatio = await frame.locator('.page canvas.detailView').first().evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
  assert.ok(metrics.fractionalDetailRatio >= 5.5, 'fractional zoom preserves higher-density detail');
  assert.equal(await frame.locator('.page canvas.detailView').first().evaluate(canvas => getComputedStyle(canvas).imageRendering), 'auto');
  await page.screenshot({path:join(folder, 'fractional-zoom.png')});
  await frame.locator('#scale').selectOption('1');
  await frame.locator('#zoom-in').click(); await frame.locator('#zoom-in').click();
  assert.equal(await frame.locator('#custom-scale').textContent(), '120%');
  await frame.locator('#zoom-out').click(); await frame.locator('#zoom-out').click(); assert.equal(await frame.locator('#scale').inputValue(), '1');
  // Select/copy remains a text layer, not OCR or an editable document.
  assert.match(await frame.locator('.textLayer').first().textContent(), /PDF Viewer page 1/);
  await frame.locator('#search-toggle').click(); await frame.locator('#query').fill('needle');
  await frame.waitForFunction(() => document.querySelector('#matches').textContent === '1 / 80');
  await frame.locator('#find-close').click(); await jump(frame, 60);
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
  await frame.locator('#scale').selectOption('page-fit');
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
    await detailReady(real);
    metrics.realPages = await real.locator('#count').textContent();
    const firstDetail = await real.locator('.page canvas.detailView').first().elementHandle();
    const realZoomStart = performance.now();
    await real.locator('#scale').selectOption('5'); await detailReady(real, 1, firstDetail);
    metrics.real500PercentMs = Math.round(performance.now() - realZoomStart);
    metrics.real500PercentRatio = await real.locator('.page canvas.detailView').first().evaluate(canvas => canvas.width / canvas.getBoundingClientRect().width);
    assert.ok(metrics.real500PercentRatio >= 4.8, '500% zoom increases visible detail without rasterizing the whole page at 6x');
    const enlargedDetail = await real.locator('.page canvas.detailView').first().elementHandle();
    await real.locator('#scale').selectOption('page-fit');
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
  const scan = await open(scannedPdf(Buffer.from(scanImage, 'base64'),612,842), 'en-US', 6, true); await detailReady(scan);
  metrics.scanReadyMs = Math.round(performance.now()-scanStart);
  assert.match(await scan.locator('canvas.detailView').evaluate(canvas => getComputedStyle(canvas).filter), /pdf-detail-sharpen/);
  assert.equal(await scan.locator('.textLayer span').count(), 0, 'fixture is a scan without a text layer');
  const paper = await scan.locator('.page').boundingBox();
  const scanClip = {x:paper.x+45,y:paper.y+55,width:690,height:395};
  async function scanEdges(name) {
    const screenshot = await page.screenshot({path:join(folder, name+'.png'),clip:scanClip});
    return page.evaluate(async png => {
      const image = await createImageBitmap(new Blob([new Uint8Array(png)],{type:'image/png'}));
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
      const {data}=context.getImageData(0,0,canvas.width,canvas.height);let edges=0;
      for(let y=1;y<canvas.height;y++)for(let x=1;x<canvas.width;x++){
        const i=(y*canvas.width+x)*4;
        edges+=Math.abs(data[i]-data[i-4])+Math.abs(data[i]-data[i-canvas.width*4]);
      }
      return edges / (canvas.width*canvas.height);
    }, [...screenshot]);
  }
  const sharpEdges = await scanEdges('scan-sharpened');
  await page.evaluate(() => viewer.setSharpening(false));
  await filtersOff(scan);
  const plainEdges = await scanEdges('scan-unsharpened');
  metrics.scanEdgeGain = sharpEdges/plainEdges;
  assert.ok(metrics.scanEdgeGain > 1.01, 'mild sharpening measurably increases scan stroke-edge contrast');
  await page.evaluate(() => viewer.setSharpening(true));
  await scan.waitForFunction(()=>getComputedStyle(document.querySelector('canvas.detailView')).filter.includes('pdf-detail-sharpen'));
  const scanPrevious = await scan.locator('canvas.detailView').elementHandle();
  const scanZoomStart = performance.now(); await scan.locator('#scale').selectOption('2'); await detailReady(scan,1,scanPrevious);
  await page.screenshot({path:join(folder,'scan-200-percent.png')});
  metrics.scanZoomPaintMs = Math.round(performance.now()-scanZoomStart);
  const economical = await open(viewerPdf(2), 'en-US', 2, true); await ready(economical);
  await economical.waitForFunction(()=>window.qaPdfViewer.getPageView(0).renderingState===3);
  assert.equal(await economical.evaluate(()=>window.qaPdfViewer.getPageView(0).getRenderPixelRatio()),2);
  assert.equal(await economical.locator('.page[data-page-number="1"] canvas.pdf-sharpen').count(),1,'sharpening also covers full-resolution base canvases');
  await economical.locator('#scale').selectOption('2'); await detailReady(economical);
  assert.equal(await economical.evaluate(()=>window.qaPdfViewer.getPageView(0).getRenderPixelRatio()),2);
  await page.evaluate(() => viewer.setSharpening(false)); await filtersOff(economical);
  const lowMemory = await open(viewerPdf(2), 'en-US', 1); await ready(lowMemory);
  await lowMemory.waitForFunction(()=>window.qaPdfViewer.getPageView(0).renderingState===3);
  metrics.oneTimesCanvas = await lowMemory.evaluate(()=>{
    const view=window.qaPdfViewer.getPageView(0),canvas=view.canvas;
    return {density:canvas.width/view.viewport.width,pixels:canvas.width*canvas.height};
  });
  assert.ok(Math.abs(metrics.oneTimesCanvas.density-1)<.01);
  assert.ok(metrics.oneTimesCanvas.pixels<=1024*1024, '1x uses a smaller actual canvas at normal zoom');
  await filtersOff(lowMemory);
  await lowMemory.locator('#scale').selectOption('2'); await detailReady(lowMemory);
  assert.equal(await lowMemory.evaluate(()=>window.qaPdfViewer.getPageView(0).maxDetailCanvasPixels),1024*1024);
  assert.equal(await lowMemory.evaluate(()=>window.qaPdfViewer.getPageView(0).maxCanvasPixels),1024*1024);
  await filtersOff(lowMemory);
  for (const sampling of [3,5]) {
    const intermediate = await open(viewerPdf(1), 'en-US', sampling); await ready(intermediate); await detailReady(intermediate);
    assert.equal(await intermediate.evaluate(()=>window.qaPdfViewer.getPageView(0).getRenderPixelRatio()),sampling);
    assert.equal(await intermediate.evaluate(()=>window.qaPdfViewer.getPageView(0).maxDetailCanvasPixels),sampling**2*1024*1024);
    await filtersOff(intermediate);
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
  assert.deepEqual(await settings.locator('#documentPdfSampling option').allTextContents(),['1×','2×','3×','4×','5×','6×']);
  assert.equal(await settings.locator('#documentPdfSharpening').isChecked(),false,'sharpening starts unchecked');
  // These are live style changes, not another parse or canvas render.
  await embedded.evaluate(()=>{
    window.qaOriginalPage=window.qaPdfViewer.getPageView(0);
    window.qaOriginalCanvas=window.qaOriginalPage.detailView.canvas;
    window.qaSharpenRenders=0;window.qaPdfViewer.eventBus.on('pagerendered',()=>window.qaSharpenRenders++);
  });
  await settings.locator('#documentPdfSharpening').check({force:true});
  await embedded.waitForFunction(()=>getComputedStyle(window.qaOriginalCanvas).filter.includes('pdf-detail-sharpen'));
  await settings.reload();
  await settings.waitForFunction(()=>document.querySelector('#documentPdfSharpening').checked);
  await settings.locator('#documentPdfSharpening').uncheck({force:true});
  await filtersOff(embedded);
  assert.equal(await embedded.evaluate(()=>window.qaOriginalCanvas===window.qaPdfViewer.getPageView(0).detailView.canvas),true);
  assert.equal(await embedded.evaluate(()=>window.qaSharpenRenders),0,'changing sharpening does not render new canvases');
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
  await settings.locator('#documentPdfSampling').scrollIntoViewIfNeeded();
  await settings.screenshot({path:join(folder,'sampling-settings-zh.png')});
  await settings.locator('#documentPreviewEnabled').uncheck({force:true});
  await settings.waitForFunction(()=>document.querySelector('#documentPdfSampling').matches(':disabled'));
  assert.equal(await settings.locator('#documentPdfSharpening').isDisabled(),true);
  await settings.close();
  await page.evaluate(()=>chrome.storage.local.set({qaLocale:'en-US'}));
  await embedded.locator('#scale').selectOption('2'); await detailReady(embedded);
  assert.equal(await density(embedded),4,'saving preferences and zooming cannot change an open reader sampling value');
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
  assert.equal(await density(embedded),6,'a new reader instance takes the updated setting');
  assert.equal(await embedded.evaluate(()=>document.documentElement.dataset.dark),'true');
  await initialPosition(embedded);
  await page.evaluate(()=>chrome.storage.session.set({'documentPreview:regular':{documents:[],themes:{}}}));
  await integration.waitForFunction(()=>!document.querySelector('.pdf-viewer-frame'));
  assert.match(await integration.locator('#status').textContent(),/expired/);await integration.close();
  metrics.documentPreview='default 4x, all 1x–6x choices, default-off live sharpening, immutable open-reader sampling, theme, fullscreen, reload and expiry passed';
  assert.deepEqual(network, []); assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  await page.evaluate(() => viewer.destroy()); assert.equal(await page.locator('iframe').count(), 0);
  console.log(JSON.stringify({metrics, errors, network, screenshots: folder}, null, 2));
} catch (error) { console.error('Browser diagnostics', {errors, failures, network, folder}); throw error; } finally { await context.close(); await rm(join(folder, 'profile'), {recursive:true,force:true}); }
