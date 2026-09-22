import { loadLocale } from '../../core/locale.js';
import { documentStore } from '../../core/document-preview-store.js';
import { localizeDocument, translator } from '../../shared/localization.js';
import { icon, send } from '../../shared/ui.js';
import { safeDocumentHtml, previewSrcdoc } from './sanitize.js';
import { normalizeDocumentAppearance } from '../../core/document-appearance.js';
import { createDocumentStatus } from './status.js';

const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('id'), mode = params.get('mode');
const locale = await loadLocale(), t = translator(locale);
document.documentElement.lang = locale; localizeDocument(t);
document.querySelector('#document-icon').innerHTML = icon('documentPreview');
const status = document.querySelector('#status'), downloadButton = document.querySelector('#download');
const notices = createDocumentStatus(status);
let metadata, blob, worker, workerTimer, expired = false, downloadPending = false;
const frame = document.querySelector('#document');
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
let defaultTheme = 'auto', siteTheme = null, themeSaving = false;
function updateTheme() {
  const theme = siteTheme || defaultTheme;
  const dark = theme === 'dark' || (theme === 'auto' && appearance.matches);
  document.documentElement.dataset.appearance = theme;
  document.documentElement.style.colorScheme = theme === 'auto' ? 'light dark' : theme;
  // An opaque sandbox cannot be restyled through its DOM. The embedding
  // element's color scheme updates its media queries without reloading it.
  frame.style.colorScheme = dark ? 'dark' : 'light';
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
const blobDownloads = new Map();
const command = (type, rest = {}) => send({ type, featureId: 'documentPreview', id, ...rest });

function expire() {
  expired = true; blob = null; worker?.terminate(); clearTimeout(workerTimer);
  downloadButton.disabled = true; document.querySelector('#choice').hidden = true;
  zoomControls.hidden = true;
  frame.removeAttribute('srcdoc'); frame.hidden = true; notices.show(t('documentExpired')); updateTheme();
}
async function preview() {
  if (expired) return;
  document.querySelector('#choice').hidden = true; notices.show(t('documentLoading'));
  worker?.terminate();
  worker = new Worker('render-worker.js');
  const finish = () => { clearTimeout(workerTimer); worker?.terminate(); worker = null; };
  workerTimer = setTimeout(() => { finish(); notices.show(t('documentRenderFailed')); }, 15000);
  worker.onerror = () => { finish(); notices.show(t('documentRenderFailed')); };
  worker.onmessage = event => {
    finish(); if (expired) return;
    try {
      if (event.data.error) throw Error();
      const safe = safeDocumentHtml(event.data.html, event.data.formatting);
      if (!safe.trim()) throw Error();
      frame.srcdoc = previewSrcdoc(safe, locale, event.data.formatting); frame.hidden = false;
      zoomControls.hidden = false;
      notices.show(''); document.querySelector('#layout-note').hidden = false;
    } catch { notices.show(t('documentRenderFailed')); }
  };
  const bytes = await blob.arrayBuffer();
  if (worker && !expired) worker.postMessage(bytes, [bytes]);
}
async function download() {
  if (expired || downloadPending) return;
  downloadPending = true; downloadButton.disabled = true;
  const url = URL.createObjectURL(blob);
  try {
    const result = await command('UI_DOCUMENT_DOWNLOAD', { blobUrl: url });
    blobDownloads.set(result.downloadId, url);
    if (!expired) notices.show(t('documentDownloadStarted'), true);
    const [item] = await chrome.downloads.search({ id: result.downloadId });
    if (item?.state !== 'in_progress') releaseDownload(result.downloadId);
  } catch { URL.revokeObjectURL(url); if (!expired) notices.show(t('documentActionFailed'), true); }
  finally { downloadPending = false; downloadButton.disabled = expired; }
}
function releaseDownload(downloadId) {
  const url = blobDownloads.get(downloadId); if (!url) return;
  URL.revokeObjectURL(url); blobDownloads.delete(downloadId);
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
window.addEventListener('pagehide', () => { worker?.terminate(); clearTimeout(workerTimer); notices.clear(); for (const url of blobDownloads.values()) URL.revokeObjectURL(url); });
downloadButton.addEventListener('click', () => void download());
async function choose(action) {
  const controls = [...document.querySelectorAll('#choice button')]; controls.forEach(button => button.disabled = true);
  try {
    await command('UI_DOCUMENT_CHOICE', { action, remember: document.querySelector('#remember').checked });
    document.querySelector('#choice').hidden = true;
    if (action === 'preview') await preview(); else await download();
  } catch { if (!expired) notices.show(t('documentActionFailed'), true); controls.forEach(button => button.disabled = false); }
}
document.querySelector('#preview').onclick = () => void choose('preview');
document.querySelector('#choice-download').onclick = () => void choose('download');
try {
  metadata = await command('UI_DOCUMENT_GET');
  const cached = await documentStore.get(id);
  if (expired || !cached?.blob || cached.epoch !== metadata.epoch || cached.context !== metadata.context) throw Error();
  metadata = await command('UI_DOCUMENT_GET'); // The source may have closed during the cache read.
  if (expired) throw Error();
  defaultTheme = normalizeDocumentAppearance(metadata.appearance); siteTheme = metadata.siteTheme;
  updateTheme();
  blob = cached.blob;
  document.querySelector('#filename').textContent = metadata.filename;
  document.querySelector('#filename').title = metadata.filename;
  document.title = metadata.filename + ' · Document Preview';
  document.querySelector('#metadata').textContent = metadata.site + (blob.size ? ' · ' + new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(blob.size / 1024) + ' KiB' : '');
  downloadButton.disabled = false;
  if (mode === 'choose') { notices.show(''); document.querySelector('#choice').hidden = false; }
  else if (mode === 'download') await download();
  else await preview();
} catch { expire(); }
