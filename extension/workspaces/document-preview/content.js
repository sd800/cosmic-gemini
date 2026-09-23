import { safeDocumentHtml, documentStyles } from './sanitize.js';
// Only this fixed, packaged controller executes. Converter output is rebuilt
// as passive allowlisted markup in an opaque, API-free sandbox. The one-way
// channel accepts document content, not script, resource URLs or host commands.
const controller = new AbortController(), { signal } = controller;
let port, capture, generation = 0, locale = 'en-US', stylesheet = '', dark = false;
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
    if (data?.type !== 'render' || typeof data.html !== 'string' || data.html.length > 48 * 1024 * 1024) return;
    generation++;
    void capture?.then(dialog => dialog.close(false, false));
    try {
      const html = safeDocumentHtml(data.html, data.formatting);
      document.documentElement.lang = locale = data.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
      stylesheet = documentStyles(data.formatting); applyTheme();
      document.body.className = 'cg-format-' + (['xlsx','pptx'].includes(data.formatting?.kind) ? data.formatting.kind : 'docx');
      document.body.innerHTML = html;
      window.scrollTo(0, 0);
      port.postMessage({type:'rendered'});
    } catch { port.postMessage({type:'error'}); }
  };
  port.postMessage({type:'ready'});
}, {signal});
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
window.addEventListener('pagehide', () => {controller.abort();port?.close();}, {once:true});
