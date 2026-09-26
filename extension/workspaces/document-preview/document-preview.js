import { loadLocale } from '../../core/locale.js';
import { localizeDocument, translator } from '../../shared/localization.js';
import { icon, send } from '../../shared/ui.js';
import { createDocumentContent } from './content-host.js';
import { normalizeDocumentAppearance, toggleDocumentAppearance } from '../../core/document-preview/document-appearance.js';
import { createDocumentStatus } from './status.js';
import { documentKind } from '../../core/document-preview/document-preview.js';

const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('id'), mode = params.get('mode');
const locale = await loadLocale(), t = translator(locale);
document.documentElement.lang = locale; localizeDocument(t);
document.querySelector('#document-icon').innerHTML = icon('documentPreview');
const status = document.querySelector('#status'), downloadButton = document.querySelector('#download');
const notices = createDocumentStatus(status, document.querySelector('#loading-progress'));
let contentViewer, metadata, blob, worker, workerTimer, pdfViewer, rendered, expired = false, downloadPending = false;
let generation = 0, suspended = false, previewRequested = false;
const current = value => !expired && !suspended && value === generation;
const assertCurrent = value => { if (!current(value)) throw new Error('Document view ended.'); };
const frame = document.querySelector('#document');
const partControls = document.querySelector('#part-controls'), partSelect = document.querySelector('#document-part');
const previousPart = document.querySelector('#part-previous'), nextPart = document.querySelector('#part-next');
previousPart.setAttribute('aria-label', t('documentPreviousPart')); nextPart.setAttribute('aria-label', t('documentNextPart'));
const isSlides = () => documentKind(metadata?.format) === 'pptx';
function updatePartControls(index) {
  partSelect.value = String(index); previousPart.disabled = index === 0; nextPart.disabled = index === rendered.parts.length - 1;
}
function ensureContent() {
  return contentViewer ||= createDocumentContent(frame, locale, () => notices.show(t('documentRenderFailed')), index => {
    if (!expired && isSlides()) updatePartControls(index);
  });
}
function showContent(html) {
  ensureContent().render(html, rendered.formatting);
}
function showPart(index) {
  const parts = rendered?.parts; if (!parts?.length || expired) return;
  index = Math.max(0, Math.min(parts.length - 1, index));
  if (!Number.isInteger(index)) return;
  updatePartControls(index);
  if (isSlides()) contentViewer?.selectSlide(index);
  else showContent(parts[index].html);
}
partSelect.onchange = () => showPart(Number(partSelect.value));
previousPart.onclick = () => showPart(Number(partSelect.value) - 1);
nextPart.onclick = () => showPart(Number(partSelect.value) + 1);
const zoomControls = document.querySelector('#zoom-controls');
const zoomOut = document.querySelector('#zoom-out'), zoomIn = document.querySelector('#zoom-in'), zoomReset = document.querySelector('#zoom-reset');
let zoom = 100;
function updateZoom(next) {
  zoom = Math.max(50, Math.min(200, Math.round(next / 10) * 10));
  // Slides zoom within the sandbox so their navigation rail stays the same size.
  // Other documents retain frame zoom. Neither path reconverts the document.
  frame.style.setProperty('--document-zoom', String(isSlides() ? 1 : zoom / 100));
  if (isSlides()) contentViewer?.setZoom(zoom / 100);
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
  // Keep host/frame chrome consistent and send only a theme boolean to the
  // opaque content controller; document markup is not re-parsed or reloaded.
  frame.style.colorScheme = dark ? 'dark' : 'light';
  contentViewer?.setTheme(dark);
  pdfViewer?.setTheme(dark);
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
  generation += 1; expired = true; contentViewer?.destroy(); contentViewer = null; blob = null; rendered = null; pdfViewer?.destroy(); pdfViewer = null; worker?.terminate(); clearTimeout(workerTimer);
  document.body.classList.remove('pdf-active');
  downloadButton.disabled = true; document.querySelector('#choice').hidden = true;
  zoomControls.hidden = true; partControls.hidden = true;
  frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); frame.hidden = true; notices.show(t('documentExpired')); updateTheme();
}
async function preparePdfViewer() {
  const started = generation;
  if (!current(started) || pdfViewer) return;
  const { createPdfViewer } = await import('../pdf-viewer/host.js');
  if (!current(started) || pdfViewer) return;
  const theme = siteTheme || defaultTheme;
  pdfViewer = createPdfViewer({ container: document.querySelector('main'),
    filename: metadata.filename, locale, sampling: metadata.pdfSampling,
    dark: theme === 'dark' || (theme === 'auto' && appearance.matches),
    onDownload: () => void download(),
    onTheme: () => void setSiteTheme(toggleDocumentAppearance(defaultTheme, siteTheme, appearance.matches)),
    onError: () => { if (!expired) { document.body.classList.remove('pdf-active'); notices.show(t('documentRenderFailed')); } }
  });
  document.body.classList.add('pdf-active');
  zoomControls.hidden = true; partControls.hidden = true;
}
async function preview() {
  const started = generation;
  if (!current(started)) return;
  previewRequested = true;
  document.querySelector('#choice').hidden = true; notices.loading(t('documentLoading'));
  worker?.terminate();
  if (metadata.format === 'pdf') {
    await preparePdfViewer();
    assertCurrent(started);
    const bytes = await blob.arrayBuffer();
    if (!current(started)) return;
    pdfViewer.open(bytes);
    notices.show('');
    return;
  }
  const ownedWorker = worker = new Worker('render-worker.js');
  const finish = () => { clearTimeout(ownedTimer); ownedWorker.terminate(); if (worker === ownedWorker) worker = null; };
  const failed = () => { finish(); if (current(started)) notices.show(t('documentRenderFailed')); };
  const ownedTimer = workerTimer = setTimeout(failed, 15000);
  ownedWorker.onerror = failed;
  ownedWorker.onmessage = event => {
    finish(); if (!current(started)) return;
    try {
      if (event.data.error) throw Error();
      rendered = event.data;
      if (Array.isArray(rendered.parts) && rendered.parts.length) {
        if (rendered.parts.length > 300) throw Error();
        partSelect.replaceChildren(...rendered.parts.map((part, index) => new Option(part.name, String(index))));
        document.querySelector('#part-label').textContent = t(documentKind(metadata.format) === 'xlsx' ? 'documentSheet' : 'documentSlide');
        partControls.hidden = rendered.parts.length < 2;
        if (isSlides()) {
          ensureContent().renderSlides(rendered.parts, rendered.formatting, t('documentSlide'));
          // The sandbox now owns the deck; the host needs only its labels/count.
          rendered.parts = rendered.parts.map(part => ({name:part.name}));
          updatePartControls(0); updateZoom(zoom);
        } else showPart(0);
      } else {
        if (typeof rendered.html !== 'string' || !rendered.html.trim()) throw Error();
        showContent(rendered.html);
      }
      frame.hidden = false;
      zoomControls.hidden = false;
      notices.show('');
    } catch { notices.show(t('documentRenderFailed')); }
  };
  const bytes = await blob.arrayBuffer();
  if (worker === ownedWorker && current(started)) ownedWorker.postMessage({ bytes, format: metadata.format, labels: {
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
    // Chrome already accepted the download. Optional bookkeeping must not
    // turn that success into a failure message or encourage a duplicate retry.
    try {
      const [item] = await chrome.downloads.search({ id: result.downloadId });
      if (item && item.state !== 'in_progress') releaseDownload(result.downloadId);
    } catch {}
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
window.addEventListener('pagehide', () => {
  suspended = true; generation += 1;
  contentViewer?.destroy(); contentViewer = null; pdfViewer?.destroy(); pdfViewer = null;
  worker?.terminate(); worker = null; clearTimeout(workerTimer); blob = null; rendered = null; notices.clear();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted || expired) return;
  suspended = false;
  const started = generation;
  void (async () => {
    const restored = await command('UI_DOCUMENT_GET'); assertCurrent(started);
    metadata = restored; showMetadata();
    if (previewRequested) { await loadPreparedDocument(true); assertCurrent(started); await preview(); }
    // Never replay a download or a remembered choice during history restoration.
    else { document.querySelectorAll('#choice button').forEach(button => button.disabled = false); notices.show(''); }
  })().catch(() => { if (current(started)) expire(); });
});
downloadButton.addEventListener('click', () => void download());
async function choose(action) {
  const started = generation;
  notices.loading(t('documentLoading'));
  const controls = [...document.querySelectorAll('#choice button')]; controls.forEach(button => button.disabled = true);
  try {
    await command('UI_DOCUMENT_CHOICE', { action, remember: document.querySelector('#remember').checked });
    assertCurrent(started);
    await loadPreparedDocument(action === 'preview');
    assertCurrent(started);
    document.querySelector('#choice').hidden = true;
    if (action === 'preview') await preview(); else await download();
  } catch {
    if (!current(started)) return;
    pdfViewer?.destroy(); pdfViewer = null; document.body.classList.remove('pdf-active');
    if (!expired) notices.show(t('documentActionFailed'), true); controls.forEach(button => button.disabled = false);
  }
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
async function loadPreparedDocument(previewPdf = false) {
  if (previewPdf) previewRequested = true;
  const started = generation;
  notices.loading(t('documentLoading'));
  const prepared = await command('UI_DOCUMENT_GET'); assertCurrent(started); metadata = prepared;
  // Start the local shell/parser concurrently with authorized preparation and
  // cache reads, but only after Preview is selected, never while merely asking.
  if (previewPdf && metadata.format === 'pdf') await preparePdfViewer();
  assertCurrent(started);
  if (!metadata.prepared) { await command('UI_DOCUMENT_PREPARE'); assertCurrent(started); const next = await command('UI_DOCUMENT_GET'); assertCurrent(started); metadata = next; }
  if (expired || !metadata.blobUrl?.startsWith('blob:' + chrome.runtime.getURL(''))) throw Error();
  const cachedBlob = await (await fetch(metadata.blobUrl)).blob();
  assertCurrent(started);
  const latest = await command('UI_DOCUMENT_GET'); // The source may have closed during the cache read.
  assertCurrent(started); metadata = latest;
  blob = cachedBlob;
  showMetadata();
  downloadButton.disabled = false;
}
const initial = generation;
try {
  const first = await command('UI_DOCUMENT_GET'); assertCurrent(initial); metadata = first; showMetadata();
  if (mode === 'choose') { notices.show(''); document.querySelector('#choice').hidden = false; }
  else {
    await loadPreparedDocument(mode !== 'download');
    if (mode === 'download') await download(); else await preview();
  }
} catch { if (current(initial)) expire(); }
