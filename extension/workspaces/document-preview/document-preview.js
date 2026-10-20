import { loadLocale } from '../../core/locale.js';
import { localizeDocument, translator } from '../../shared/localization.js';
import { icon, send } from '../../shared/ui.js';
import { createDocumentContent } from './content-host.js';
import { buildEmailLabels } from './email-labels.js';
import { normalizeDocumentAppearance, toggleDocumentAppearance } from '../../core/document-preview/document-appearance.js';
import { createDocumentStatus } from './status.js';
import { documentKind, inspectPdf } from '../../core/document-preview/document-preview.js';

const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('id'), mode = params.get('mode');
let locale = await loadLocale(), t = translator(locale);
document.documentElement.lang = locale; localizeDocument(t);
document.querySelector('#document-icon').innerHTML = icon('documentPreview');
const status = document.querySelector('#status'), downloadButton = document.querySelector('#download');
const notices = createDocumentStatus(status, document.querySelector('#loading-progress'));
let contentViewer, metadata, blob, worker, workerTimer, pdfViewer, rendered, expired = false, downloadPending = false;
let generation = 0, suspended = false, previewRequested = false;
const current = value => !expired && !suspended && value === generation;
const assertCurrent = value => { if (!current(value)) throw new Error('Document view ended.'); };
const frame = document.querySelector('#document');
const emailLanguage=document.querySelector('#email-language');
const partControls = document.querySelector('#part-controls'), partSelect = document.querySelector('#document-part');
const previousPart = document.querySelector('#part-previous'), nextPart = document.querySelector('#part-next');
previousPart.setAttribute('aria-label', t('documentPreviousPart')); nextPart.setAttribute('aria-label', t('documentNextPart'));
const isSlides = () => documentKind(metadata?.format) === 'pptx';
function updatePartControls(index) {
  partSelect.value = String(index); previousPart.disabled = index === 0; nextPart.disabled = index === rendered.parts.length - 1;
}
function ensureContent() {
  if (!contentViewer) {
    const started = generation;
    contentViewer = createDocumentContent(frame, locale, () => {
      if (current(started)) notices.show(t('documentRenderFailed'));
    }, index => {
      if (current(started) && isSlides()) updatePartControls(index);
    }, value => { if (current(started)) updateZoom(value*100,true); });
  }
  return contentViewer;
}
function showContent(html) {
  const reader=ensureContent();
  if(metadata.format==='eml')reader.setEmailLocale(locale,emailLabels());
  reader.render(html, rendered.formatting);
}
function emailLabels() { return buildEmailLabels(t,locale); }
function updateEmailLanguage() {
  emailLanguage.hidden=metadata?.format!=='eml';emailLanguage.disabled=expired;
  emailLanguage.textContent=locale==='zh-CN'?'English':'中文';emailLanguage.lang=locale==='zh-CN'?'en-US':'zh-CN';
  emailLanguage.title=t('documentEmailLanguage');emailLanguage.setAttribute('aria-label',emailLanguage.title);
}
emailLanguage.onclick=()=>{
  if(metadata?.format!=='eml'||expired||suspended)return;
  const old=t, previousStatus=status.textContent;locale=locale==='zh-CN'?'en-US':'zh-CN';t=translator(locale);
  document.documentElement.lang=locale;localizeDocument(t);
  status.textContent=previousStatus;
  for(const element of document.querySelectorAll('[data-i18n-aria-label]'))element.setAttribute('aria-label',t(element.dataset.i18nAriaLabel));
  for(const [button,key] of [[zoomOut,'documentZoomOut'],[zoomIn,'documentZoomIn'],[zoomReset,'documentZoomReset']])button.title=t(key);
  for(const key of ['documentLoading','documentActionFailed','documentDownloadStarted','documentRenderFailed','documentExpired'])if(status.textContent===old(key)){status.textContent=t(key);break;}
  document.querySelector('#metadata').textContent=[metadata.local?t('documentLocalFile'):metadata.site,t('documentToolbarEmail')].join(' · ');
  updateEmailLanguage();updateTheme();contentViewer?.setEmailLocale(locale,emailLabels());
};
function showPart(index) {
  const parts = rendered?.parts; if (!parts?.length || expired || suspended) return;
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
function updateZoom(next, fromGesture = false) {
  zoom = Math.max(50, Math.min(200, next));
  // Zoom the reading surface, not the toolbar/iframe viewport. Gesture updates
  // come from that surface; never echo rounded percentages back into it.
  if (!fromGesture) contentViewer?.setZoom(zoom / 100);
  zoomReset.textContent = Math.round(zoom) + '%';
  zoomOut.disabled = zoom === 50; zoomIn.disabled = zoom === 200;
}
zoomOut.onclick = () => updateZoom(Math.round(zoom) - 10);
zoomIn.onclick = () => updateZoom(Math.round(zoom) + 10);
zoomReset.onclick = () => updateZoom(100);
for (const [button, key] of [[zoomOut, 'documentZoomOut'], [zoomIn, 'documentZoomIn'], [zoomReset, 'documentZoomReset']]) button.title = t(key);
const themeToggle = document.querySelector('#theme-toggle'), themeAuto = document.querySelector('#theme-auto');
const appearance = matchMedia('(prefers-color-scheme: dark)');
let defaultTheme = normalizeDocumentAppearance(params.get('appearance')), siteTheme = null, themeSaving = false, themeRevision = 0;
function updateTheme() {
  if (suspended) return;
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
  const started = generation;
  if (themeSaving || !current(started) || !metadata) return;
  const previous = siteTheme, revision = themeRevision;
  siteTheme = value; themeSaving = true; updateTheme();
  try { await command('UI_DOCUMENT_SET_THEME', { theme: value }); }
  catch { if (current(started)) {
    if (revision === themeRevision) siteTheme = previous;
    notices.show(t('documentActionFailed'), true);
  } }
  finally { if (current(started)) { themeSaving = false; updateTheme(); } }
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
  frame.hidden = true;
  generation += 1; expired = true; contentViewer?.destroy(); contentViewer = null; blob = null; rendered = null; pdfViewer?.destroy(); pdfViewer = null; worker?.terminate(); clearTimeout(workerTimer);
  worker = null; blobDownloads.clear();
  document.body.classList.remove('pdf-active');
  downloadButton.disabled = true; document.querySelector('#choice').hidden = true;
  zoomControls.hidden = true; partControls.hidden = true;
  frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); notices.show(t('documentExpired')); updateTheme();
  updateEmailLanguage();
}
async function preparePdfViewer() {
  const started = generation;
  if (!current(started) || pdfViewer) return;
  const { createPdfViewer } = await import('../pdf-viewer/host.js');
  if (!current(started) || pdfViewer) return;
  const theme = siteTheme || defaultTheme;
  const ownedViewer = pdfViewer = createPdfViewer({ container: document.querySelector('main'),
    filename: metadata.filename, documentUrl: metadata.url, locale, sampling: metadata.pdfSampling,
    dark: theme === 'dark' || (theme === 'auto' && appearance.matches),
    onDownload: () => { if (current(started)) void download(); },
    onTheme: () => { if (current(started)) void setSiteTheme(toggleDocumentAppearance(defaultTheme, siteTheme, appearance.matches)); },
    onError: () => {
      if (!current(started) || pdfViewer !== ownedViewer) return;
      ownedViewer.destroy(); pdfViewer = null;
      document.body.classList.remove('pdf-active'); notices.show(t('documentRenderFailed'));
    }
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
    if (metadata.local) inspectPdf(bytes);
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
  try {
    const bytes = await blob.arrayBuffer();
    if (worker === ownedWorker && current(started)) ownedWorker.postMessage({ bytes, format: metadata.format, labels: metadata.format==='eml'?emailLabels():undefined }, [bytes]);
    else finish();
  } catch (error) { finish(); throw error; }
}
async function download() {
  const started = generation;
  if (!current(started) || downloadPending || !metadata) return;
  downloadPending = true; downloadButton.disabled = true;
  try {
    const result = await command('UI_DOCUMENT_DOWNLOAD');
    // The accepted download belongs to the background product. A departing
    // view must not repaint, close a restored tab, or unlock a newer action.
    if (!current(started)) return;
    blobDownloads.add(result.downloadId);
    notices.show(t('documentDownloadStarted'), true);
    // Chrome already accepted the download. Optional bookkeeping must not
    // turn that success into a failure message or encourage a duplicate retry.
    try {
      const [item] = await chrome.downloads.search({ id: result.downloadId });
      if (current(started) && item && item.state !== 'in_progress') releaseDownload(result.downloadId);
    } catch {}
  } catch { if (current(started)) notices.show(t('documentActionFailed'), true); }
  finally { if (current(started)) { downloadPending = false; downloadButton.disabled = false; } }
}
function releaseDownload(downloadId) {
  if (suspended || expired) return;
  if (!blobDownloads.delete(downloadId)) return;
  if (mode === 'download' && !blobDownloads.size) window.close();
}
chrome.downloads.onChanged.addListener(delta => { if (['complete', 'interrupted'].includes(delta.state?.current)) releaseDownload(delta.id); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (!metadata || expired || suspended) return;
  if (area === 'session') {
    const changed = changes['documentPreview:' + metadata.context];
    if (changed) {
      if (!changed.newValue?.documents?.some(doc => doc.id === id)) { expire(); return; }
      const nextTheme = changed.newValue.themes?.[metadata.site] || null;
      if (nextTheme !== siteTheme) { siteTheme = nextTheme; themeRevision += 1; }
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
  themeSaving = downloadPending = false; blobDownloads.clear();
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
    else { downloadButton.disabled = !metadata.prepared; document.querySelectorAll('#choice button').forEach(button => button.disabled = false); notices.show(''); }
  })().catch(() => { if (current(started)) expire(); });
});
downloadButton.addEventListener('click', () => void download());
async function choose(action) {
  const started = generation;
  if (!current(started)) return;
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
  defaultTheme = normalizeDocumentAppearance(metadata.appearance); siteTheme = metadata.siteTheme; themeRevision += 1;
  updateTheme();
  document.querySelector('#filename').textContent = metadata.filename;
  document.querySelector('#filename').title = metadata.filename;
  document.title = metadata.filename + ' · Document Preview';
  const family = documentKind(metadata.format);
  const typeKey = {docx:'documentToolbarDocuments',xlsx:'documentToolbarSpreadsheets',pptx:'documentToolbarSlides',pdf:'documentToolbarPdf',eml:'documentToolbarEmail'}[family];
  document.querySelector('#metadata').textContent = [metadata.local ? t('documentLocalFile') : metadata.site, typeKey && t(typeKey)].filter(Boolean).join(' · ');
  updateEmailLanguage();
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
