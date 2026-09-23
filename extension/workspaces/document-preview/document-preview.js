import { loadLocale } from '../../core/locale.js';
import { localizeDocument, translator } from '../../shared/localization.js';
import { icon, send } from '../../shared/ui.js';
import { safeDocumentHtml, previewSrcdoc } from './sanitize.js';
import { normalizeDocumentAppearance } from '../../core/document-appearance.js';
import { createDocumentStatus } from './status.js';
import { documentKind } from '../../core/document-preview.js';

const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('id'), mode = params.get('mode');
const locale = await loadLocale(), t = translator(locale);
document.documentElement.lang = locale; localizeDocument(t);
document.querySelector('#document-icon').innerHTML = icon('documentPreview');
const status = document.querySelector('#status'), downloadButton = document.querySelector('#download');
const notices = createDocumentStatus(status, document.querySelector('#loading-progress'));
let metadata, blob, worker, workerTimer, pdfViewer, rendered, expired = false, downloadPending = false;
const frame = document.querySelector('#document');
const partControls = document.querySelector('#part-controls'), partSelect = document.querySelector('#document-part');
const previousPart = document.querySelector('#part-previous'), nextPart = document.querySelector('#part-next');
previousPart.setAttribute('aria-label', t('documentPreviousPart')); nextPart.setAttribute('aria-label', t('documentNextPart'));
function showPart(index) {
  const parts = rendered?.parts; if (!parts?.length || expired) return;
  index = Math.max(0, Math.min(parts.length - 1, index));
  partSelect.value = String(index); previousPart.disabled = index === 0; nextPart.disabled = index === parts.length - 1;
  const safe = safeDocumentHtml(parts[index].html, rendered.formatting);
  frame.srcdoc = previewSrcdoc(safe, locale, rendered.formatting);
}
partSelect.onchange = () => showPart(Number(partSelect.value));
previousPart.onclick = () => showPart(Number(partSelect.value) - 1);
nextPart.onclick = () => showPart(Number(partSelect.value) + 1);
const zoomControls = document.querySelector('#zoom-controls');
const zoomOut = document.querySelector('#zoom-out'), zoomIn = document.querySelector('#zoom-in'), zoomReset = document.querySelector('#zoom-reset');
let zoom = 100;
function updateZoom(next) {
  zoom = Math.max(50, Math.min(200, Math.round(next / 10) * 10));
  // Scale only the embedding frame. Its sandbox stays script-free, and the
  // document is neither converted again nor navigated when zoom changes.
  frame.style.setProperty('--document-zoom', String(zoom / 100));
  zoomReset.textContent = zoom + '%';
  zoomOut.disabled = zoom === 50; zoomIn.disabled = zoom === 200;
}
zoomOut.onclick = () => updateZoom(zoom - 10);
zoomIn.onclick = () => updateZoom(zoom + 10);
zoomReset.onclick = () => updateZoom(100);
for (const [button, key] of [[zoomOut, 'documentZoomOut'], [zoomIn, 'documentZoomIn'], [zoomReset, 'documentZoomReset']]) button.title = t(key);
const themeToggle = document.querySelector('#theme-toggle'), themeAuto = document.querySelector('#theme-auto');
const appearance = matchMedia('(prefers-color-scheme: dark)');
let defaultTheme = normalizeDocumentAppearance(params.get('appearance')), siteTheme = null, themeSaving = false;
function updateTheme() {
  const theme = siteTheme || defaultTheme;
  const dark = theme === 'dark' || (theme === 'auto' && appearance.matches);
  document.documentElement.dataset.appearance = theme;
  document.documentElement.style.colorScheme = theme === 'auto' ? 'light dark' : theme;
  document.documentElement.style.backgroundColor = dark ? '#24262a' : '#f7f8fa';
  // Keep the next reload's first paint consistent without storing site history.
  if (metadata && params.get('appearance') !== theme) {
    params.set('appearance', theme); history.replaceState(null, '', '#' + params);
  }
  // An opaque sandbox cannot be restyled through its DOM. The embedding
  // element's color scheme updates its media queries without reloading it.
  frame.style.colorScheme = dark ? 'dark' : 'light';
  pdfViewer?.setTheme(dark, siteTheme === null);
  themeToggle.innerHTML = icon(dark ? 'pageDisplay' : 'moon');
  themeToggle.title = t(dark ? 'documentThemeLight' : 'documentThemeDark');
  themeToggle.setAttribute('aria-label', themeToggle.title);
  themeAuto.hidden = siteTheme === null;
  themeAuto.title = t('documentThemeFollow');
  themeToggle.disabled = themeAuto.disabled = !metadata || expired || themeSaving;
}
async function setSiteTheme(value) {
  if (themeSaving || expired || !metadata) return;
  const previous = siteTheme;
  siteTheme = value; themeSaving = true; updateTheme();
  try { await command('UI_DOCUMENT_SET_THEME', { theme: value }); }
  catch { siteTheme = previous; if (!expired) notices.show(t('documentActionFailed'), true); }
  finally { themeSaving = false; updateTheme(); }
}
themeToggle.onclick = () => {
  const theme = siteTheme || defaultTheme;
  void setSiteTheme(theme === 'dark' || (theme === 'auto' && appearance.matches) ? 'light' : 'dark');
};
themeAuto.onclick = () => void setSiteTheme(null);
appearance.addEventListener('change', updateTheme);
updateTheme();
const blobDownloads = new Set();
const command = (type, rest = {}) => send({ type, featureId: 'documentPreview', id, ...rest });

function expire() {
  expired = true; blob = null; rendered = null; pdfViewer?.destroy(); pdfViewer = null; worker?.terminate(); clearTimeout(workerTimer);
  document.body.classList.remove('pdf-active');
  downloadButton.disabled = true; document.querySelector('#choice').hidden = true;
  zoomControls.hidden = true; partControls.hidden = true;
  frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); frame.hidden = true; notices.show(t('documentExpired')); updateTheme();
}
async function preview() {
  if (expired) return;
  document.querySelector('#choice').hidden = true; notices.loading(t('documentLoading'));
  worker?.terminate();
  if (metadata.format === 'pdf') {
    const { createPdfViewer } = await import('../pdf-viewer/host.js');
    const bytes = await blob.arrayBuffer();
    if (expired) return;
    pdfViewer?.destroy();
    const theme = siteTheme || defaultTheme;
    pdfViewer = createPdfViewer({ container: document.querySelector('main'), bytes,
      filename: metadata.filename, locale,
      dark: theme === 'dark' || (theme === 'auto' && appearance.matches), automatic: siteTheme === null,
      onDownload: () => void download(), onTheme: () => themeToggle.click(), onAuto: () => void setSiteTheme(null),
      onError: () => { if (!expired) { document.body.classList.remove('pdf-active'); notices.show(t('documentRenderFailed')); } }
    });
    document.body.classList.add('pdf-active');
    zoomControls.hidden = true; partControls.hidden = true;
    notices.show('');
    return;
  }
  worker = new Worker('render-worker.js');
  const finish = () => { clearTimeout(workerTimer); worker?.terminate(); worker = null; };
  workerTimer = setTimeout(() => { finish(); notices.show(t('documentRenderFailed')); }, 15000);
  worker.onerror = () => { finish(); notices.show(t('documentRenderFailed')); };
  worker.onmessage = event => {
    finish(); if (expired) return;
    try {
      if (event.data.error) throw Error();
      rendered = event.data;
      if (Array.isArray(rendered.parts) && rendered.parts.length) {
        if (rendered.parts.length > 300) throw Error();
        partSelect.replaceChildren(...rendered.parts.map((part, index) => new Option(part.name, String(index))));
        document.querySelector('#part-label').textContent = t(documentKind(metadata.format) === 'xlsx' ? 'documentSheet' : 'documentSlide');
        partControls.hidden = rendered.parts.length < 2; showPart(0);
      } else {
        const safe = safeDocumentHtml(rendered.html, rendered.formatting);
        if (!safe.trim()) throw Error();
        frame.srcdoc = previewSrcdoc(safe, locale, rendered.formatting);
      }
      frame.hidden = false;
      zoomControls.hidden = false;
      notices.show('');
    } catch { notices.show(t('documentRenderFailed')); }
  };
  const bytes = await blob.arrayBuffer();
  if (worker && !expired) worker.postMessage({ bytes, format: metadata.format, labels: {
    from: t('documentEmailFrom'), to: t('documentEmailTo'), cc: t('documentEmailCc'),
    date: t('documentEmailDate'), attachments: t('documentEmailAttachments'), noSubject: t('documentEmailNoSubject')
  } }, [bytes]);
}
async function download() {
  if (expired || downloadPending) return;
  downloadPending = true; downloadButton.disabled = true;
  try {
    const result = await command('UI_DOCUMENT_DOWNLOAD');
    blobDownloads.add(result.downloadId);
    if (!expired) notices.show(t('documentDownloadStarted'), true);
    const [item] = await chrome.downloads.search({ id: result.downloadId });
    if (item?.state !== 'in_progress') releaseDownload(result.downloadId);
  } catch { if (!expired) notices.show(t('documentActionFailed'), true); }
  finally { downloadPending = false; downloadButton.disabled = expired; }
}
function releaseDownload(downloadId) {
  if (!blobDownloads.delete(downloadId)) return;
  if (mode === 'download' && !blobDownloads.size) window.close();
}
chrome.downloads.onChanged.addListener(delta => { if (['complete', 'interrupted'].includes(delta.state?.current)) releaseDownload(delta.id); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (!metadata || expired) return;
  if (area === 'session') {
    const changed = changes['documentPreview:' + metadata.context];
    if (changed) {
      if (!changed.newValue?.documents?.some(doc => doc.id === id)) { expire(); return; }
      siteTheme = changed.newValue.themes?.[metadata.site] || null;
      updateTheme();
    }
  }
  const privateContext = metadata.context === 'incognito';
  const settingsChange = changes[privateContext ? 'cosmicGeminiIncognitoSettings' : 'cosmicGeminiSettings'];
  if (area === (privateContext ? 'session' : 'local') && settingsChange) {
    defaultTheme = normalizeDocumentAppearance(settingsChange.newValue?.documentPreview?.appearance);
    updateTheme();
  }
});
window.addEventListener('pagehide', () => { pdfViewer?.destroy(); worker?.terminate(); clearTimeout(workerTimer); notices.clear(); });
downloadButton.addEventListener('click', () => void download());
async function choose(action) {
  notices.loading(t('documentLoading'));
  const controls = [...document.querySelectorAll('#choice button')]; controls.forEach(button => button.disabled = true);
  try {
    await command('UI_DOCUMENT_CHOICE', { action, remember: document.querySelector('#remember').checked });
    await loadPreparedDocument();
    document.querySelector('#choice').hidden = true;
    if (action === 'preview') await preview(); else await download();
  } catch { if (!expired) notices.show(t('documentActionFailed'), true); controls.forEach(button => button.disabled = false); }
}
document.querySelector('#preview').onclick = () => void choose('preview');
document.querySelector('#choice-download').onclick = () => void choose('download');
function showMetadata() {
  document.body.dataset.format = metadata.format;
  defaultTheme = normalizeDocumentAppearance(metadata.appearance); siteTheme = metadata.siteTheme;
  updateTheme();
  document.querySelector('#filename').textContent = metadata.filename;
  document.querySelector('#filename').title = metadata.filename;
  document.title = metadata.filename + ' · Document Preview';
  const family = documentKind(metadata.format);
  const typeKey = {docx:'documentToolbarDocuments',xlsx:'documentToolbarSpreadsheets',pptx:'documentToolbarSlides',pdf:'documentToolbarPdf',eml:'documentToolbarEmail'}[family];
  document.querySelector('#metadata').textContent = [metadata.site, typeKey && t(typeKey)].filter(Boolean).join(' · ');
}
async function loadPreparedDocument() {
  notices.loading(t('documentLoading'));
  metadata = await command('UI_DOCUMENT_GET');
  if (!metadata.prepared) { await command('UI_DOCUMENT_PREPARE'); metadata = await command('UI_DOCUMENT_GET'); }
  if (expired || !metadata.blobUrl?.startsWith('blob:' + chrome.runtime.getURL(''))) throw Error();
  const cachedBlob = await (await fetch(metadata.blobUrl)).blob();
  metadata = await command('UI_DOCUMENT_GET'); // The source may have closed during the cache read.
  if (expired) throw Error();
  blob = cachedBlob;
  showMetadata();
  downloadButton.disabled = false;
}
try {
  metadata = await command('UI_DOCUMENT_GET'); showMetadata();
  if (mode === 'choose') { notices.show(''); document.querySelector('#choice').hidden = false; }
  else {
    await loadPreparedDocument();
    if (mode === 'download') await download(); else await preview();
  }
} catch { expire(); }
