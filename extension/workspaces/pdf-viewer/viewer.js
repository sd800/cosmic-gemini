import * as pdfjs from '../../vendor/pdfjs/pdf.min.mjs';
import { PDFViewer, EventBus, PDFLinkService, PDFFindController, RenderingStates } from '../../vendor/pdfjs/pdf_viewer.mjs';
import { labels } from './labels.js';
import { setReaderIcon, setReaderIcons } from './icons.js';
import { normalizePdfSampling } from '../../core/pdf-sampling.js';
import { PDF_LIMITS, pdfDetailCanvasPixels, pdfOptions, pdfScale, stepPdfScale, printRange, rotateLeft, safePdfLink } from './model.js';

const $ = id => document.getElementById(id);
let port, task, pdf, viewer, workerUrl, parseTimer, destroyed = false, text = labels['en-US'];
const lifetime = new AbortController(), signal = lifetime.signal;
const eventBus = new EventBus(), viewport = $('viewport');
let thumbnailObserver, thumbnailTask, thumbnailBusy = false, thumbnailGeneration = 0, outlineLoaded = false;
const nearThumbnails = new Set(), thumbnailCache = new Map(), printUrls = new Set();
let sharpening = false;
let printing = false, printTask, zoomFrame = 0, wheelFactor = 1, wheelOrigin, passwordCancelled = false;
const emit = type => port?.postMessage({ type });
function status(key, loading = false) { $('status').textContent = text[key] || ''; $('progress').hidden = !loading; }
function theme(dark, automatic) { document.documentElement.dataset.dark = String(!!dark); document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; $('theme-auto').hidden = !!automatic; setReaderIcon($('theme'), dark ? 'sun' : 'moon'); }
function updateCanvasSharpening(view, transformed = false) {
  const canvas = view?.canvas;
  if (!canvas) return;
  // Only sharpen bounded base surfaces already at the requested density.
  // Stretched high-zoom previews must not allocate oversized filter surfaces.
  const density = view.getRenderPixelRatio();
  canvas.classList.toggle('pdf-sharpen', sharpening && !transformed && view.renderingState === RenderingStates.FINISHED &&
    canvas.width / view.viewport.width >= density * .98 && canvas.height / view.viewport.height >= density * .98);
}
function setSharpening(enabled) {
  const next = enabled === true;
  if (sharpening === next) return;
  sharpening = next;
  document.documentElement.dataset.sharpen = String(next);
  // CSS removal drops the extra compositor filter; reuse the existing PDF
  // canvases without parsing, rasterizing or allocating replacement surfaces.
  for (const view of viewer?.getCachedPageViews() || []) updateCanvasSharpening(view);
}
function click(id, callback) { $(id).addEventListener('click', callback, { signal }); }
function cleanupPrint() { for (const url of printUrls) URL.revokeObjectURL(url); printUrls.clear(); $('print-pages').replaceChildren(); }
function destroy() {
  if (destroyed) return; destroyed = true; lifetime.abort(); cancelAnimationFrame(zoomFrame); clearTimeout(parseTimer);
  thumbnailGeneration++; thumbnailObserver?.disconnect(); thumbnailTask?.cancel(); printTask?.cancel();
  viewer?.setDocument(null); void task?.destroy().catch(() => {}); cleanupPrint();
  if (workerUrl) URL.revokeObjectURL(workerUrl); port?.close();
}
window.addEventListener('pagehide', destroy, { once: true });
window.addEventListener('message', async event => {
  if (event.source !== parent || port || event.data?.type !== 'CG_PDF_INIT' || event.ports.length !== 1) return;
  const input = event.data;
  if (!(input.bytes instanceof ArrayBuffer) || input.bytes.byteLength > PDF_LIMITS.bytes) return;
  port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data?.type === 'theme') theme(data.dark, data.automatic);
    else if (data?.type === 'sharpening') setSharpening(data.enabled);
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
  $('filename').textContent = String(input.filename || 'PDF').slice(0, 1024); $('filename').title = $('filename').textContent;
  setSharpening(input.sharpening);
  theme(input.dark, input.automatic); status('loading', true);
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
  click('download', () => emit('download')); click('theme', () => emit('theme')); click('theme-auto', () => emit('auto'));
  click('fullscreen', () => emit('fullscreen'));
  try { await open(input.bytes, normalizePdfSampling(input.sampling)); } catch {
    clearTimeout(parseTimer);
    if (!destroyed && !passwordCancelled) { status('failed'); emit('error'); void task?.destroy().catch(() => {}); }
  }
}, { signal });

async function open(bytes, sampling) {
  // An opaque extension sandbox cannot create a Worker from its extension URL.
  // Only the fixed bundled worker is copied into a blob; never PDF-supplied code.
  const workerCode = await (await fetch(new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url), { signal })).text();
  if (destroyed) return;
  workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  task = pdfjs.getDocument(pdfOptions(new Uint8Array(bytes), new URL('../../vendor/pdfjs/', import.meta.url).href));
  const armParseDeadline = () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => { status('failed'); emit('error'); void task.destroy().catch(() => {}); }, 30000);
  };
  armParseDeadline();
  task.onPassword = (accept, reason) => {
    clearTimeout(parseTimer);
    emit('password'); status('');
    $('password-message').textContent = text[reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'passwordWrong' : 'passwordNeeded'];
    $('password').value = ''; $('password-dialog').showModal(); $('password').focus();
    $('password-dialog').onclose = () => {
      if ($('password-dialog').returnValue === 'open') { status('loading', true); armParseDeadline(); accept($('password').value); $('password').value = ''; }
      else { passwordCancelled = true; status('cancelled'); void task.destroy().catch(() => {}); }
    };
  };
  pdf = await task.promise;
  clearTimeout(parseTimer);
  if (destroyed) return;
  if (pdf.numPages > PDF_LIMITS.pages) { await task.destroy(); throw Error('PDF page budget'); }
  const links = new PDFLinkService({ eventBus });
  // The annotation/form/editor/scripting layers are not instantiated. Only
  // passive text and our bounded allowlisted links are added above the canvas.
  const find = new PDFFindController({ eventBus, linkService: links });
  viewer = new PDFViewer({ container: viewport, viewer: $('pages'), eventBus, linkService: links, findController: find,
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
  viewer.renderingQueue.renderHighestPriority = (...args) => { if (!destroyed && !document.hidden && !printing) render(...args); };
  document.addEventListener('visibilitychange', () => {
    thumbnailTask?.cancel();
    if (document.hidden) viewer.cleanup(); else { viewer.update(); void drawThumbnails(); }
  }, { signal });
  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = '1';
    // Setting the initial scale aligns the first paper edge with the viewport.
    // Restore its top gutter once at initialization, never during later reading.
    viewport.scrollTop = 0;
    viewer.update();
    $('count').textContent = '/ ' + pdf.numPages; $('page').max = pdf.numPages; $('page').style.setProperty('--page-digits', Math.max(2, String(pdf.numPages).length));
    $('previous').disabled = true; $('next').disabled = pdf.numPages === 1; $('print').disabled = !viewer.printingAllowed;
    $('print-to').max = $('print-from').max = pdf.numPages; $('print-to').value = Math.min(pdf.numPages, PDF_LIMITS.printPages);
    status(''); emit('ready');
  }, { signal });
  eventBus.on('pagechanging', ({ pageNumber }) => {
    $('page').value = pageNumber; $('previous').disabled = pageNumber === 1; $('next').disabled = pageNumber === pdf.numPages;
    for (const node of $('thumbnails').children) node.setAttribute('aria-current', String(Number(node.dataset.page) === pageNumber));
  }, { signal });
  eventBus.on('pagerendered', ({ pageNumber, cssTransform, error }) => {
    if (error) status('pageError');
    if (sharpening) updateCanvasSharpening(viewer.getPageView(pageNumber - 1), cssTransform || error);
    if (!cssTransform && !destroyed) void renderLinks(pageNumber, links).catch(() => {});
  }, { signal });
  eventBus.on('scalechanging', ({ scale, presetValue }) => {
    if (sharpening) for (const view of viewer.getCachedPageViews()) view.canvas?.classList.remove('pdf-sharpen');
    const preset = presetValue || String(scale);
    if ([...$('scale').options].some(option => option.value === preset)) $('scale').value = preset;
    else { $('custom-scale').textContent = Math.round(scale * 100) + '%'; $('custom-scale').hidden = false; $('scale').value = 'custom'; }
    $('zoom-in').disabled = scale >= 5; $('zoom-out').disabled = scale <= .25;
  }, { signal });
  eventBus.on('updatefindmatchescount', ({ matchesCount }) => { $('matches').textContent = `${matchesCount.current} / ${matchesCount.total}`; }, { signal });
  eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
    $('matches').textContent = state === 3 ? text.searching : state === 1 ? text.noMatches : `${matchesCount?.current || 0} / ${matchesCount?.total || 0}`;
  }, { signal });
  viewer.setDocument(pdf);
  click('previous', () => viewer.previousPage()); click('next', () => viewer.nextPage());
  $('page').onchange = () => { viewer.currentPageNumber = Math.max(1, Math.min(pdf.numPages, Number($('page').value) || 1)); $('page').value = viewer.currentPageNumber; };
  function zoomTo(scale, origin) { viewer.updateScale({ scaleFactor: pdfScale(scale) / viewer.currentScale, drawingDelay: 180, origin }); }
  click('zoom-in', () => zoomTo(stepPdfScale(viewer.currentScale, 1))); click('zoom-out', () => zoomTo(stepPdfScale(viewer.currentScale, -1)));
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
  function openFind() { $('findbar').hidden = false; $('query').focus(); $('query').select(); }
  function closeFind() { $('findbar').hidden = true; eventBus.dispatch('findbarclose', { source: window }); viewport.focus(); }
  function search(again = false, previous = false) {
    eventBus.dispatch('find', { source: window, type: again ? 'again' : '', query: $('query').value, caseSensitive: $('match-case').checked,
      entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }
  click('search-toggle', openFind); click('find-close', closeFind); click('find-next', () => search(true)); click('find-previous', () => search(true, true));
  $('query').oninput = () => search(); $('match-case').onchange = () => search();
  $('query').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); search(true, event.shiftKey); } };
  window.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey, editable = /INPUT|SELECT|TEXTAREA/.test(event.target.tagName);
    if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); openFind(); }
    else if (modifier && event.key.toLowerCase() === 'p') { event.preventDefault(); openPrint(); }
    else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); emit('download'); }
    else if (modifier && ['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); zoomTo(event.key === '0' ? 1 : stepPdfScale(viewer.currentScale, event.key === '-' ? -1 : 1)); }
    else if (event.key === 'Escape' && !$('findbar').hidden) closeFind();
    else if (!editable && event.key === 'ArrowLeft') { event.preventDefault(); viewer.previousPage(); }
    else if (!editable && event.key === 'ArrowRight') { event.preventDefault(); viewer.nextPage(); }
    else if (!editable && event.key === 'Home') { event.preventDefault(); viewer.currentPageNumber = 1; }
    else if (!editable && event.key === 'End') { event.preventDefault(); viewer.currentPageNumber = pdf.numPages; }
  }, { signal });
  click('sidebar-toggle', () => {
    $('sidebar').hidden = !$('sidebar').hidden;
    if (!$('sidebar').hidden && !$('thumbnails').children.length) createThumbnails();
    if ($('sidebar').hidden) { thumbnailTask?.cancel(); } else void drawThumbnails();
  });
  click('show-pages', () => { $('outline').hidden = true; $('thumbnails').hidden = false; void drawThumbnails(); });
  click('show-outline', () => { $('thumbnails').hidden = true; $('outline').hidden = false; thumbnailTask?.cancel(); void showOutline(links); });
  click('print', openPrint);
  $('print-dialog').addEventListener('close', () => { if ($('print-dialog').returnValue === 'print') void printDocument(); }, { signal });
  window.addEventListener('afterprint', cleanupPrint, { signal });
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
    const url = safePdfLink(item.url); if (!url && !item.dest) continue;
    const rect = [...viewport.convertToViewportPoint(item.rect[0], item.rect[1]), ...viewport.convertToViewportPoint(item.rect[2], item.rect[3])];
    if (!rect.every(Number.isFinite)) continue;
    const link = document.createElement('a');
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = url; }
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
      button.disabled = !item.dest; button.onclick = () => void links.goToDestination(item.dest).catch(() => {}); container.append(button);
      if (Array.isArray(item.items)) add(item.items, container, depth + 1);
    }
  }
  add(items, $('outline'), 0);
}
function openPrint() {
  if (!pdf || !viewer?.printingAllowed || printing || destroyed) return;
  $('print-error').textContent = ''; $('print-dialog').showModal();
}
async function printDocument() {
  const range = printRange($('print-from').value, $('print-to').value, pdf.numPages);
  if (!range) { $('print-error').textContent = text.invalidRange; $('print-dialog').showModal(); return; }
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
