import { safeDocumentHtml, documentStyles } from './sanitize.js';
// Only this fixed, packaged controller executes. Converter output is rebuilt
// as passive allowlisted markup in an opaque, API-free sandbox. The private
// channel accepts document content and fixed presentation controls, not script,
// resource URLs or host commands.
const controller = new AbortController(), { signal } = controller;
let port, capture, generation = 0, locale = 'en-US', stylesheet = '', dark = false;
let slides, slidesResources, renderId = 0, slideIndex = 0, slideZoom = 1;
function closeCapture() {
  generation++;
  void capture?.then(dialog => dialog.close(false, false));
}
function loadSlides() {
  return slidesResources ||= Promise.all([
    import('./slides.js'),
    new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'slides.css';
      link.onload = resolve; link.onerror = reject; document.head.append(link);
    })
  ]).then(([module]) => module);
}
function applyTheme() {
  document.documentElement.dataset.dark = String(dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  // Extension-scheme sandbox frames do not consistently inherit the embedding
  // element's preferred scheme. Switch only cached, validated presentation CSS.
  document.querySelector('#document-styles').textContent = stylesheet.replaceAll(
    '@media(prefers-color-scheme:dark)', dark ? '@media all' : '@media not all');
}
window.addEventListener('message', event => {
  if (port || event.source !== parent || event.data?.type !== 'CG_DOCUMENT_CONTENT_INIT' || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = ({data}) => {
    if (data?.type === 'theme' && typeof data.dark === 'boolean') { dark = data.dark; applyTheme(); return; }
    if (data?.type === 'select-slide' && data.id === renderId && Number.isInteger(data.index)) {
      slideIndex = data.index; slides?.select(slideIndex); return;
    }
    if (data?.type === 'slide-zoom' && data.id === renderId && Number.isFinite(data.zoom)) {
      slideZoom = Math.max(.5, Math.min(2, data.zoom)); slides?.setZoom(slideZoom); return;
    }
    if (!['render','slides'].includes(data?.type) || !Number.isInteger(data.id)) return;
    if (data.type === 'render' && (typeof data.html !== 'string' || data.html.length > 48 * 1024 * 1024)) return;
    void render(data);
  };
  port.postMessage({type:'ready'});
}, {signal});
async function render(data) {
  closeCapture(); const request = generation;
  renderId = data.id; slides?.destroy(); slides = null;
  document.body.replaceChildren();
  slideIndex = Number.isInteger(data.index) ? data.index : 0;
  slideZoom = Number.isFinite(data.zoom) ? Math.max(.5, Math.min(2, data.zoom)) : 1;
  try {
    const module = data.type === 'slides' ? await loadSlides() : null;
    if (request !== generation || signal.aborted) return;
    // Email sanitization can register passive inline styles; build CSS after it.
    const html = module ? null : safeDocumentHtml(data.html, data.formatting);
    document.documentElement.lang = locale = data.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
    stylesheet = documentStyles(data.formatting); applyTheme();
    document.body.className = 'cg-format-' + (['xlsx','pptx'].includes(data.formatting?.kind) ? data.formatting.kind : 'docx');
    if (module) {
      if (data.formatting?.kind !== 'pptx') throw Error('invalidDocument');
      slides = module.createSlidesView({parts:data.parts,formatting:data.formatting,
        label:typeof data.label === 'string' ? data.label.slice(0, 64) : (locale === 'zh-CN' ? '幻灯片' : 'Slide'),index:slideIndex,zoom:slideZoom}, index => {
        closeCapture(); port.postMessage({type:'slide',id:renderId,index});
      }, () => port.postMessage({type:'error',id:renderId}));
    } else document.body.innerHTML = html;
    window.scrollTo(0, 0);
    port.postMessage({type:'rendered',id:renderId});
  } catch { if (!signal.aborted && data.id === renderId) port.postMessage({type:'error',id:renderId}); }
}
async function activate(event) {
  if (event.type === 'auxclick' && event.button !== 1) return;
  const anchor = event.target.closest?.('a[data-external-link]');
  if (!anchor) return;
  event.preventDefault(); event.stopPropagation();
  if (!event.isTrusted) return;
  const request = ++generation;
  capture ||= import('../../shared/external-links-capture/capture.js')
    .then(({createExternalLinksCapture}) => createExternalLinksCapture({signal,locale}));
  try {
    const dialog = await capture;
    if (!signal.aborted && request === generation && anchor.isConnected) dialog.show(anchor.dataset.externalLink, anchor);
  } catch { /* Do not navigate if the confirmation UI cannot be loaded. */ }
}
document.addEventListener('click', activate, {signal});
document.addEventListener('auxclick', activate, {signal});
window.addEventListener('pagehide', () => {controller.abort();slides?.destroy();port?.close();}, {once:true});
