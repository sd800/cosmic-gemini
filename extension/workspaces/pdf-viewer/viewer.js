import { showReaderDialog } from './dialog.js';
import { createPdfWorker } from './worker.js';
import * as pdfjs from '../../vendor/pdfjs/pdf.min.mjs';
import { PDFViewer, EventBus, PDFLinkService, RenderingStates } from '../../vendor/pdfjs/pdf_viewer.mjs';
import { labels } from './labels.js';
import { setReaderIcon, setReaderIcons } from './icons.js';
import { normalizePdfSampling } from '../../core/pdf-sampling.js';
import { PDF_LIMITS, pdfDetailCanvasPixels, pdfOptions, pdfScale, stepPdfScale, printRange, rotateLeft, safePdfLink } from './model.js';

const $ = id => document.getElementById(id);
let port, task, pdf, viewer, pdfWorker, parseTimer, destroyed = false, firstPageReady = false, text = labels['en-US'];
const lifetime = new AbortController(), signal = lifetime.signal;
const eventBus = new EventBus(), viewport = $('viewport');
// Prepare the local parser while the authorized host prepares document bytes.
const workerReady = createPdfWorker(pdfjs, signal).then(worker => {
  pdfWorker = worker;
  return worker;
});
void workerReady.catch(() => {});
let thumbnailObserver, thumbnailTask, thumbnailBusy = false, thumbnailGeneration = 0, outlineLoaded = false;
const nearThumbnails = new Set(), thumbnailCache = new Map(), printUrls = new Set();
let documentFilename, documentBytes = 0, properties;
let customZoomScale = null;
let printing = false, printTask, zoomFrame = 0, wheelFactor = 1, wheelOrigin, passwordCancelled = false;
const emit = type => port?.postMessage({ type });
let taskBusy = false, renderBusy = false, renderProgressTimer = 0, visiblePageViews = [];
function paintProgress() {
  const busy = taskBusy || renderBusy;
  $('progress').hidden = !busy; $('workspace').setAttribute('aria-busy', String(busy));
}
function status(key, loading = false) { $('status').textContent = key === 'loading' ? '' : text[key] || ''; taskBusy = loading; paintProgress(); }
function syncRenderProgress() {
  const pending = () => !destroyed && firstPageReady && !document.hidden && !printing &&
    visiblePageViews.some(view => view.renderingState !== RenderingStates.FINISHED);
  if (!pending()) {
    clearTimeout(renderProgressTimer); renderProgressTimer = 0;
    if (renderBusy) { renderBusy = false; paintProgress(); }
  } else if (!renderBusy && !renderProgressTimer) {
    // One delayed notification, no polling or extra page/geometry scans.
    renderProgressTimer = setTimeout(() => {
      renderProgressTimer = 0;
      if (pending()) { renderBusy = true; paintProgress(); }
    }, 200);
  }
}
function theme(dark) { document.documentElement.dataset.dark = String(!!dark); document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; setReaderIcon($('theme'), dark ? 'sun' : 'moon'); }
function click(id, callback) { $(id).addEventListener('click', callback, { signal }); }
function cleanupPrint() { for (const url of printUrls) URL.revokeObjectURL(url); printUrls.clear(); $('print-pages').replaceChildren(); }
function destroy() {
  if (destroyed) return; destroyed = true; lifetime.abort(); cancelAnimationFrame(zoomFrame); clearTimeout(parseTimer); clearTimeout(renderProgressTimer); visiblePageViews = [];
  thumbnailGeneration++; thumbnailObserver?.disconnect(); thumbnailTask?.cancel(); printTask?.cancel();
  viewer?.setDocument(null); void task?.destroy().catch(() => {}); cleanupPrint();
  pdfWorker?.destroy(); port?.close();
}
window.addEventListener('pagehide', destroy, { once: true });
window.addEventListener('message', event => {
  if (event.source !== parent || port || event.data?.type !== 'CG_PDF_INIT' || event.ports.length !== 1) return;
  const input = event.data;
  port = event.ports[0];
  let opened = false;
  for (const control of document.querySelectorAll('header nav button:not(#fullscreen), header nav input, header nav select, #print, #download')) control.disabled = true;
  port.onmessage = ({ data }) => {
    if (data?.type === 'document') {
      if (opened || !(data.bytes instanceof ArrayBuffer) || !data.bytes.byteLength || data.bytes.byteLength > PDF_LIMITS.bytes) return;
      opened = true; documentBytes = data.bytes.byteLength; $('download').disabled = false;
      void open(data.bytes, normalizePdfSampling(input.sampling)).catch(() => {
        clearTimeout(parseTimer);
        if (!destroyed && !passwordCancelled) { status('failed'); emit('error'); void task?.destroy().catch(() => {}); pdfWorker?.destroy(); }
      });
    }
    else if (data?.type === 'theme') theme(data.dark);
    else if (data?.type === 'fullscreen-error') status('fullScreenFailed');
    else if (data?.type === 'fullscreen') {
      setReaderIcon($('fullscreen'), data.active ? 'fullscreen-exit' : 'fullscreen');
      $('fullscreen').title = text[data.active ? 'exitFullscreen' : 'fullscreen'];
      $('fullscreen').setAttribute('aria-label', $('fullscreen').title);
    }
  };
  text = labels[input.locale] || labels['en-US']; document.documentElement.lang = input.locale === 'zh-CN' ? input.locale : 'en-US';
  for (const node of document.querySelectorAll('[data-text]')) node.textContent = text[node.dataset.text];
  for (const node of document.querySelectorAll('[data-label]')) { node.title = text[node.dataset.label]; node.setAttribute('aria-label', node.title); }
  documentFilename = String(input.filename || 'PDF').slice(0, 1024);
  $('filename').textContent = documentFilename;
  $('filename').title = `${documentFilename} — ${text.properties}`;
  $('filename').setAttribute('aria-label', $('filename').title);
  theme(input.dark); status('loading', true);
  setReaderIcons(document); emit('shell-ready');
  // Keep form navigation forbidden by the sandbox, including method=dialog.
  // These controls only validate local input and close the local dialog.
  for (const form of document.querySelectorAll('dialog form')) {
    form.addEventListener('submit', event => event.preventDefault(), { signal });
    for (const button of form.querySelectorAll('button')) {
      button.type = 'button';
      button.onclick = () => { if (button.value === 'cancel' || form.reportValidity()) form.closest('dialog').close(button.value); };
    }
    form.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); form.querySelector('button:not([value=cancel])').click(); }
    }, { signal });
  }
  click('download', () => emit('download')); click('theme', () => emit('theme'));
  click('fullscreen', () => emit('fullscreen'));
}, { signal });

async function open(bytes, sampling) {
  const worker = await workerReady;
  if (destroyed) return;
  task = pdfjs.getDocument({ ...pdfOptions(new Uint8Array(bytes), new URL('../../vendor/pdfjs/', import.meta.url).href), worker });
  const armParseDeadline = () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => { status('failed'); emit('error'); void task.destroy().catch(() => {}); pdfWorker?.destroy(); }, 30000);
  };
  armParseDeadline();
  task.onPassword = (accept, reason) => {
    clearTimeout(parseTimer);
    emit('password'); status('');
    $('password-message').textContent = text[reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'passwordWrong' : 'passwordNeeded'];
    $('password').value = ''; showReaderDialog($('password-dialog'), $('password'));
    $('password-dialog').onclose = () => {
      if ($('password-dialog').returnValue === 'open') { status('loading', true); armParseDeadline(); accept($('password').value); $('password').value = ''; }
      else { passwordCancelled = true; status('cancelled'); void task.destroy().catch(() => {}); pdfWorker?.destroy(); }
    };
  };
  pdf = await task.promise;
  clearTimeout(parseTimer);
  if (destroyed) return;
  if (pdf.numPages > PDF_LIMITS.pages) { await task.destroy(); throw Error('PDF page budget'); }
  emit('parsed');
  const links = new PDFLinkService({ eventBus });
  // The annotation/form/editor/scripting layers are not instantiated. Only
  // passive text and our bounded allowlisted links are added above the canvas.
  viewer = new PDFViewer({ container: viewport, viewer: $('pages'), eventBus, linkService: links,
    annotationMode: pdfjs.AnnotationMode.DISABLE, annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    enableAutoLinking: false, enablePermissions: true, scriptingManager: null, textLayerMode: 1,
    // The fixed pixel/dimension limits already bound memory. A second
    // screen-relative cap makes ordinary Retina pages render as tiny canvases.
    getRenderPixelRatio: () => sampling,
    maxCanvasPixels: Math.min(PDF_LIMITS.canvasPixels, pdfDetailCanvasPixels(sampling)), maxDetailCanvasPixels: pdfDetailCanvasPixels(sampling),
    maxCanvasDim: 8192, capCanvasAreaFactor: -1,
    enableDetailCanvas: true, enableOptimizedPartialRendering: true, minDurationToUpdateCanvas: 160,
    imagesRightClickMinSize: -1, abortSignal: signal });
  links.setViewer(viewer); links.setDocument(pdf);
  const render = viewer.renderingQueue.renderHighestPriority.bind(viewer.renderingQueue);
  viewer.renderingQueue.renderHighestPriority = (...args) => {
    // Reuse the renderer's existing visible set; do not inspect every page on scroll.
    if (args[0]?.views) visiblePageViews = args[0].views.filter(item=>item.percent>0).map(item=>item.view);
    if (!destroyed && !document.hidden && !printing) render(...args);
    syncRenderProgress();
  };
  document.addEventListener('visibilitychange', () => {
    thumbnailTask?.cancel();
    if (document.hidden) viewer.cleanup(); else { viewer.update(); void drawThumbnails(); }
    syncRenderProgress();
  }, { signal });
  eventBus.on('pagesinit', () => {
    for (const control of document.querySelectorAll('header nav button, header nav input, header nav select')) control.disabled = false;
    viewer.currentScaleValue = '1';
    // Setting the initial scale aligns the first paper edge with the viewport.
    // Restore its top gutter once at initialization, never during later reading.
    viewport.scrollTop = 0;
    viewer.update();
    $('count').textContent = String(pdf.numPages); $('page').max = pdf.numPages; $('page').parentElement.style.setProperty('--page-digits', Math.max(2, String(pdf.numPages).length));
    $('previous').disabled = true; $('next').disabled = pdf.numPages === 1; $('print').disabled = !viewer.printingAllowed;
    $('print-to').max = $('print-from').max = pdf.numPages; $('print-to').value = Math.min(pdf.numPages, PDF_LIMITS.printPages);
    $('filename').disabled = false;
  }, { signal });
  eventBus.on('pagechanging', ({ pageNumber }) => {
    $('page').value = pageNumber; $('previous').disabled = pageNumber === 1; $('next').disabled = pageNumber === pdf.numPages;
    for (const node of $('thumbnails').children) node.setAttribute('aria-current', String(Number(node.dataset.page) === pageNumber));
  }, { signal });
  eventBus.on('pagerendered', ({ pageNumber, cssTransform, error }) => {
    if (!firstPageReady && !cssTransform) {
      firstPageReady = true; status(''); emit('ready');
      // Let the first visible page paint before optional thumbnail work.
      if (!$('sidebar').hidden) requestAnimationFrame(() => {
        if (!destroyed && !$('sidebar').hidden && !$('thumbnails').children.length) createThumbnails();
      });
    }
    if (error) status('pageError');
    if (!cssTransform && !destroyed) void renderLinks(pageNumber, links).catch(() => {});
    syncRenderProgress();
  }, { signal });
  eventBus.on('scalechanging', ({ scale, presetValue }) => {
    const preset = presetValue || String(scale);
    const custom = $('custom-scale'), select = $('scale');
    if ([...select.options].some(option => option.value === preset)) {
      select.value = preset; custom.hidden = true; customZoomScale = null;
    } else {
      custom.textContent = Math.round(scale * 100) + '%'; custom.hidden = false;
      select.value = 'custom'; customZoomScale = scale;
    }
    $('zoom-in').disabled = scale >= 5; $('zoom-out').disabled = scale <= .25;
  }, { signal });
  viewer.setDocument(pdf);
  click('previous', () => viewer.previousPage()); click('next', () => viewer.nextPage());
  $('page').onchange = () => { viewer.currentPageNumber = Math.max(1, Math.min(pdf.numPages, Number($('page').value) || 1)); $('page').value = viewer.currentPageNumber; };
  function zoomTo(scale, origin) { viewer.updateScale({ scaleFactor: pdfScale(scale) / viewer.currentScale, drawingDelay: 180, origin }); }
  click('zoom-in', () => zoomTo(stepPdfScale(viewer.currentScale, 1))); click('zoom-out', () => zoomTo(stepPdfScale(viewer.currentScale, -1)));
  // Position the changing percentage only when the menu opens, not per zoom tick.
  function locateCustomZoom() {
    if (customZoomScale === null) return;
    const select = $('scale'), custom = $('custom-scale');
    const upper = [...select.options].find(option => Number(option.value) > customZoomScale);
    select.insertBefore(custom, upper || null); select.value = 'custom'; customZoomScale = null;
  }
  $('scale').addEventListener('pointerdown', locateCustomZoom, { signal });
  $('scale').addEventListener('keydown', event => {
    if (['ArrowDown','ArrowUp',' ','Enter','Home','End','F4'].includes(event.key)) locateCustomZoom();
  }, { signal });
  $('scale').onchange = () => { const value = $('scale').value; if (value === 'custom') return; if (value.startsWith('page-')) viewer.currentScaleValue = value; else zoomTo(Number(value)); };
  click('rotate', () => {
    const page = viewer.currentPageNumber;
    viewer.pagesRotation = rotateLeft(viewer.pagesRotation);
    // PDFViewer leaves scroll repositioning to its host after rotation.
    viewer.currentPageNumber = page;
    clearThumbnails(); void drawThumbnails();
  });
  const resize = new ResizeObserver(() => { if (!destroyed && ['page-fit', 'page-width'].includes(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue; });
  resize.observe(viewport); signal.addEventListener('abort', () => resize.disconnect(), { once: true });
  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return; event.preventDefault();
    wheelFactor *= Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .004); wheelOrigin = [event.clientX, event.clientY];
    if (!zoomFrame) zoomFrame = requestAnimationFrame(() => { zoomFrame = 0; zoomTo(viewer.currentScale * wheelFactor, wheelOrigin); wheelFactor = 1; });
  }, { passive: false, signal });
  window.addEventListener('keydown', event => {
    // A modal's keyboard interactions must not navigate/zoom the PDF behind it.
    if ($('properties-dialog').open) return;
    const modifier = event.ctrlKey || event.metaKey, editable = /INPUT|SELECT|TEXTAREA/.test(event.target.tagName);
    if (modifier && event.key.toLowerCase() === 'p') { event.preventDefault(); openPrint(); }
    else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); emit('download'); }
    else if (modifier && ['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); zoomTo(event.key === '0' ? 1 : stepPdfScale(viewer.currentScale, event.key === '-' ? -1 : 1)); }
    else if (!editable && event.key === 'ArrowLeft') { event.preventDefault(); viewer.previousPage(); }
    else if (!editable && event.key === 'ArrowRight') { event.preventDefault(); viewer.nextPage(); }
    else if (!editable && event.key === 'Home') { event.preventDefault(); viewer.currentPageNumber = 1; }
    else if (!editable && event.key === 'End') { event.preventDefault(); viewer.currentPageNumber = pdf.numPages; }
  }, { signal });
  click('sidebar-toggle', () => {
    $('sidebar').hidden = !$('sidebar').hidden;
    if (firstPageReady && !$('sidebar').hidden && !$('thumbnails').children.length) createThumbnails();
    if ($('sidebar').hidden) { thumbnailTask?.cancel(); } else void drawThumbnails();
  });
  click('show-pages', () => { $('outline').hidden = true; $('thumbnails').hidden = false; void drawThumbnails(); });
  click('show-outline', () => { $('thumbnails').hidden = true; $('outline').hidden = false; thumbnailTask?.cancel(); void showOutline(links); });
  click('print', openPrint);
  click('filename', () => {
    properties ||= import('./properties.js').then(({ createProperties }) => destroyed ? null :
      createProperties({ pdf, viewer, filename: documentFilename, byteLength: documentBytes, locale: document.documentElement.lang, text, signal }));
    void properties.then(dialog => dialog?.open()).catch(() => { if (!destroyed) status('propertiesUnavailable'); });
  });
  $('print-dialog').addEventListener('close', () => { if ($('print-dialog').returnValue === 'print') void printDocument(); }, { signal });
  window.addEventListener('afterprint', cleanupPrint, { signal });
}

// External Links Capture never forwards arbitrary URLs to the privileged host.
let externalLinksCapture, externalLinkRequest = 0;
function bindExternalLink(node, url) {
  node.dataset.externalLink = url; node.title = url;
  if (node.tagName === 'A') node.href = '#';
  const activate = async event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.isTrusted || destroyed) return;
    const request = ++externalLinkRequest;
    externalLinksCapture ||= import('../../shared/external-links-capture/capture.js')
      .then(({ createExternalLinksCapture }) => createExternalLinksCapture({ signal, locale: document.documentElement.lang }));
    try {
      const capture = await externalLinksCapture;
      if (!destroyed && node.isConnected && request === externalLinkRequest) capture.show(url, node);
    } catch { /* A failed prompt must never fall through to opening a link. */ }
  };
  node.addEventListener('click', activate, { signal });
  node.addEventListener('auxclick', activate, { signal });
}

async function renderLinks(number, linkService) {
  const pageView = viewer.getPageView(number - 1), viewport = pageView?.viewport;
  if (!pageView?.pdfPage || !viewport || destroyed) return;
  const annotations = await pageView.pdfPage.getAnnotations({ intent: 'display' }).catch(() => []);
  if (destroyed || pageView.viewport !== viewport || !pageView.canvas) return;
  pageView.div.querySelector('.pdf-links')?.remove();
  const layer = document.createElement('div'); layer.className = 'pdf-links';
  for (const item of annotations.slice(0, 1000)) {
    if (item.subtype !== 'Link' || item.actions || !Array.isArray(item.rect) || item.rect.length !== 4 || !item.rect.every(Number.isFinite)) continue;
    const url = safePdfLink(item.url || item.unsafeUrl); if (!url && !item.dest) continue;
    const rect = [...viewport.convertToViewportPoint(item.rect[0], item.rect[1]), ...viewport.convertToViewportPoint(item.rect[2], item.rect[3])];
    if (!rect.every(Number.isFinite)) continue;
    const link = document.createElement('a');
    if (url) bindExternalLink(link, url);
    else { link.href = '#'; link.onclick = e => { e.preventDefault(); void linkService.goToDestination(item.dest).catch(() => {}); }; link.title = text.page; }
    link.style.cssText = `left:${Math.min(rect[0],rect[2])/viewport.width*100}%;top:${Math.min(rect[1],rect[3])/viewport.height*100}%;width:${Math.abs(rect[2]-rect[0])/viewport.width*100}%;height:${Math.abs(rect[3]-rect[1])/viewport.height*100}%`;
    link.setAttribute('aria-label', link.title); layer.append(link);
  }
  pageView.div.append(layer);
}
function createThumbnails() {
  const fragment = document.createDocumentFragment();
  for (let i = 1; i <= pdf.numPages; i++) { const button = document.createElement('button'); button.className = 'thumbnail'; button.dataset.page = i; button.textContent = String(i); button.title = text.page + ' ' + i; button.onclick = () => { viewer.currentPageNumber = i; }; fragment.append(button); }
  $('thumbnails').append(fragment);
  thumbnailObserver = new IntersectionObserver(entries => { for (const entry of entries) { if (entry.isIntersecting) nearThumbnails.add(entry.target); else nearThumbnails.delete(entry.target); } void drawThumbnails(); }, { root: $('sidebar'), rootMargin: '160px' });
  for (const node of $('thumbnails').children) thumbnailObserver.observe(node);
}
function clearThumbnails() {
  thumbnailGeneration++; thumbnailTask?.cancel();
  for (const [node, canvas] of thumbnailCache) { canvas.width = canvas.height = 0; node.replaceChildren(String(node.dataset.page)); }
  thumbnailCache.clear();
}
async function drawThumbnails() {
  if (thumbnailBusy || destroyed || document.hidden || printing || $('sidebar').hidden || $('thumbnails').hidden) return;
  const generation = thumbnailGeneration; thumbnailBusy = true;
  try {
    for (const node of nearThumbnails) {
      if (destroyed || document.hidden || printing || $('sidebar').hidden || $('thumbnails').hidden || generation !== thumbnailGeneration) break;
      if (thumbnailCache.has(node)) continue;
      const page = await pdf.getPage(Number(node.dataset.page)); if (destroyed || generation !== thumbnailGeneration) break;
      const base = page.getViewport({ scale: 1, rotation: (page.rotate + viewer.pagesRotation) % 360 });
      const viewport = page.getViewport({ scale: Math.min(144 / base.width, 145 / base.height), rotation: base.rotation });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width * pixelRatio); canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
      thumbnailTask = page.render({ canvasContext: canvas.getContext('2d'), viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0], annotationMode: pdfjs.AnnotationMode.DISABLE });
      await thumbnailTask.promise; thumbnailTask = null;
      eventBus.dispatch('thumbnailrendered', { pageNumber: Number(node.dataset.page), pdfPage: page });
      if (destroyed || generation !== thumbnailGeneration) { canvas.width = canvas.height = 0; break; }
      node.replaceChildren(canvas, String(node.dataset.page)); thumbnailCache.set(node, canvas);
      // Thumbnails are tiny and only requested when their sidebar region is near.
      for (const [old, image] of thumbnailCache) { if (thumbnailCache.size <= 24) break; if (nearThumbnails.has(old)) continue; image.width = image.height = 0; old.replaceChildren(String(old.dataset.page)); thumbnailCache.delete(old); }
    }
  } catch { /* A close, rotation or tab hide cancels only the optional thumbnails. */ }
  finally { thumbnailBusy = false; if (!destroyed && generation !== thumbnailGeneration) void drawThumbnails(); }
}
async function showOutline(links) {
  if (outlineLoaded) return; outlineLoaded = true;
  const items = await pdf.getOutline().catch(() => null); if (destroyed) return;
  if (!items?.length) { $('outline').textContent = text.noOutline; return; }
  let count = 0;
  function add(items, container, depth) {
    if (depth > 20) return;
    for (const item of items) { if (++count > 2000) break;
      const button = document.createElement('button'); button.textContent = String(item.title || text.page).slice(0, 512); button.style.paddingInlineStart = (8 + depth * 10) + 'px';
      const url = !item.actions && safePdfLink(item.url || item.unsafeUrl);
      button.disabled = !item.dest && !url;
      if (url) bindExternalLink(button, url);
      else button.onclick = () => void links.goToDestination(item.dest).catch(() => {});
      container.append(button);
      if (Array.isArray(item.items)) add(item.items, container, depth + 1);
    }
  }
  add(items, $('outline'), 0);
}
function openPrint() {
  if (!pdf || !viewer?.printingAllowed || printing || destroyed) return;
  $('print-error').textContent = ''; showReaderDialog($('print-dialog'), $('print-from'));
}
async function printDocument() {
  const range = printRange($('print-from').value, $('print-to').value, pdf.numPages);
  if (!range) { $('print-error').textContent = text.invalidRange; showReaderDialog($('print-dialog'), $('print-from')); return; }
  printing = true; $('print').disabled = true; thumbnailTask?.cancel(); status('printing', true); cleanupPrint();
  let pixels = 0;
  try {
    for (let i = range.from; i <= range.to; i++) {
      if (destroyed) return;
      const page = await pdf.getPage(i), base = page.getViewport({ scale: 1.5, rotation: (page.rotate + viewer.pagesRotation) % 360 });
      pixels += Math.ceil(base.width) * Math.ceil(base.height);
      if (pixels > PDF_LIMITS.printPixels || base.width > 8192 || base.height > 8192) throw Error('Print budget');
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(base.width); canvas.height = Math.ceil(base.height);
      printTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: base, intent: 'print', annotationMode: pdfjs.AnnotationMode.DISABLE });
      await printTask.promise; printTask = null;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 0;
      if (!blob || destroyed) throw Error();
      const url = URL.createObjectURL(blob); printUrls.add(url); const image = new Image(); image.src = url; await image.decode(); $('print-pages').append(image);
    }
    if (!destroyed) { status(''); window.print(); }
  } catch { if (!destroyed) status('printFailed'); }
  finally { printing = false; $('print').disabled = false; cleanupPrint(); if (!destroyed) { viewer.update(); void drawThumbnails(); } }
}
