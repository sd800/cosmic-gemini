import { loadLocale } from '../../core/locale.js';
import { documentStore } from '../../core/document-preview-store.js';
import { localizeDocument, translator } from '../../shared/localization.js';
import { icon, send } from '../../shared/ui.js';
import { safeDocumentHtml, previewSrcdoc } from './sanitize.js';

const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('id'), mode = params.get('mode');
const locale = await loadLocale(), t = translator(locale);
document.documentElement.lang = locale; localizeDocument(t);
document.querySelector('#document-icon').innerHTML = icon('documentPreview');
const status = document.querySelector('#status'), downloadButton = document.querySelector('#download');
const frame = document.querySelector('#document');
const themeToggle = document.querySelector('#theme-toggle'), themeAuto = document.querySelector('#theme-auto');
const appearance = matchMedia('(prefers-color-scheme: dark)');
let theme = 'auto';
function updateTheme() {
  const dark = theme === 'dark' || (theme === 'auto' && appearance.matches);
  document.documentElement.dataset.appearance = theme;
  document.documentElement.style.colorScheme = theme === 'auto' ? 'light dark' : theme;
  // An opaque sandbox cannot be restyled through its DOM. The embedding
  // element's color scheme updates its media queries without reloading it.
  frame.style.colorScheme = dark ? 'dark' : 'light';
  themeToggle.innerHTML = icon(dark ? 'pageDisplay' : 'moon');
  themeToggle.title = t(dark ? 'documentThemeLight' : 'documentThemeDark');
  themeToggle.setAttribute('aria-label', themeToggle.title);
  themeAuto.hidden = theme === 'auto';
  themeAuto.title = t('documentThemeFollow');
}
themeToggle.onclick = () => { theme = theme === 'dark' || (theme === 'auto' && appearance.matches) ? 'light' : 'dark'; updateTheme(); };
themeAuto.onclick = () => { theme = 'auto'; updateTheme(); };
appearance.addEventListener('change', updateTheme);
updateTheme();
let metadata, blob, worker, workerTimer, expired = false, downloadPending = false;
const blobDownloads = new Map();
const command = (type, rest = {}) => send({ type, featureId: 'documentPreview', id, ...rest });

function expire() {
  expired = true; blob = null; worker?.terminate(); clearTimeout(workerTimer);
  downloadButton.disabled = true; document.querySelector('#choice').hidden = true;
  frame.removeAttribute('srcdoc'); frame.hidden = true; status.textContent = t('documentExpired');
}
async function preview() {
  if (expired) return;
  document.querySelector('#choice').hidden = true; status.textContent = t('documentLoading');
  worker?.terminate();
  worker = new Worker('render-worker.js');
  const finish = () => { clearTimeout(workerTimer); worker?.terminate(); worker = null; };
  workerTimer = setTimeout(() => { finish(); status.textContent = t('documentRenderFailed'); }, 15000);
  worker.onerror = () => { finish(); status.textContent = t('documentRenderFailed'); };
  worker.onmessage = event => {
    finish(); if (expired) return;
    try {
      if (event.data.error) throw Error();
      const safe = safeDocumentHtml(event.data.html);
      if (!safe.trim()) throw Error();
      frame.srcdoc = previewSrcdoc(safe, locale); frame.hidden = false;
      status.textContent = ''; document.querySelector('#layout-note').hidden = false;
    } catch { status.textContent = t('documentRenderFailed'); }
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
    status.textContent = t('documentDownloadStarted');
    const [item] = await chrome.downloads.search({ id: result.downloadId });
    if (item?.state !== 'in_progress') releaseDownload(result.downloadId);
  } catch { URL.revokeObjectURL(url); status.textContent = t('documentActionFailed'); }
  finally { downloadPending = false; downloadButton.disabled = expired; }
}
function releaseDownload(downloadId) {
  const url = blobDownloads.get(downloadId); if (!url) return;
  URL.revokeObjectURL(url); blobDownloads.delete(downloadId);
  if (mode === 'download' && !blobDownloads.size) window.close();
}
chrome.downloads.onChanged.addListener(delta => { if (['complete', 'interrupted'].includes(delta.state?.current)) releaseDownload(delta.id); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !metadata) return;
  const changed = changes['documentPreview:' + metadata.context];
  if (changed && !changed.newValue?.documents?.some(doc => doc.id === id)) expire();
});
window.addEventListener('pagehide', () => { worker?.terminate(); clearTimeout(workerTimer); for (const url of blobDownloads.values()) URL.revokeObjectURL(url); });
downloadButton.addEventListener('click', () => void download());
async function choose(action) {
  const controls = [...document.querySelectorAll('#choice button')]; controls.forEach(button => button.disabled = true);
  try {
    await command('UI_DOCUMENT_CHOICE', { action, remember: document.querySelector('#remember').checked });
    document.querySelector('#choice').hidden = true;
    if (action === 'preview') await preview(); else await download();
  } catch { status.textContent = t('documentActionFailed'); controls.forEach(button => button.disabled = false); }
}
document.querySelector('#preview').onclick = () => void choose('preview');
document.querySelector('#choice-download').onclick = () => void choose('download');
try {
  metadata = await command('UI_DOCUMENT_GET');
  const cached = await documentStore.get(id);
  if (expired || !cached?.blob || cached.epoch !== metadata.epoch || cached.context !== metadata.context) throw Error();
  await command('UI_DOCUMENT_GET'); // The source may have closed during the cache read.
  if (expired) throw Error();
  blob = cached.blob;
  document.querySelector('#filename').textContent = metadata.filename;
  document.title = metadata.filename + ' · Document Preview';
  document.querySelector('#metadata').textContent = metadata.site + (blob.size ? ' · ' + new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(blob.size / 1024) + ' KiB' : '');
  downloadButton.disabled = false;
  if (mode === 'choose') { status.textContent = ''; document.querySelector('#choice').hidden = false; }
  else if (mode === 'download') await download();
  else await preview();
} catch { expire(); }
