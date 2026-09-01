import { formatImageBytes, imageLayout } from '../../core/image-download.js';
import { loadLocale } from '../../core/locale.js';
import { localizeDocument, translator } from '../../shared/localization.js';
import { icon, retryRead, send } from '../../shared/ui.js';

const root = document.documentElement;
const workspaceUrl = new URL(location.href);
const sourceTabValue = workspaceUrl.searchParams.get('sourceTab');
const sourceTabId = /^\d+$/.test(sourceTabValue || '') ? Number(sourceTabValue) : Number.NaN;
const workspaceView = workspaceUrl.searchParams.get('view') === 'side-panel' ? 'side-panel' : 'page';
document.body.dataset.workspaceView = workspaceView;
const grid = document.querySelector('#image-grid');
const empty = document.querySelector('#empty');
const selected = new Map();
const choices = new Map();
const metadataSent = new Set();
const failedCandidates = new Set();
let state = null;
let t = key => key;
let viewPort = null;
let viewReconnectAttempts = 0;
let reloadTimer = 0;
let renderedAt = -1;
let preferencesInitialized = false;
let scanPending = false;
let downloadPending = false;
let workspaceClosing = false;
const pendingControls = new WeakSet();

function setWorkspaceVisible(visible) {
  if (workspaceClosing) return;
  if (!Number.isInteger(sourceTabId)) return;
  if (!visible && !viewPort) return;
  if (!viewPort) {
    const port = chrome.runtime.connect({ name: `download-view:imageDownload:${sourceTabId}` });
    viewPort = port;
    port.onMessage.addListener(message => {
      if (message?.type === 'central-state-changed' && message.tabId === sourceTabId) scheduleReload(false);
    });
    setTimeout(() => {
      if (viewPort === port) viewReconnectAttempts = 0;
    }, 1_000);
    port.onDisconnect.addListener(() => {
      if (viewPort !== port) return;
      viewPort = null;
      if (!workspaceClosing && !document.hidden && viewReconnectAttempts < 5) {
        viewReconnectAttempts += 1;
        setTimeout(() => setWorkspaceVisible(true), Math.min(250 * (2 ** viewReconnectAttempts), 4_000));
      }
    });
  }
  try { viewPort.postMessage({ visible }); } catch {}
}

function scheduleReload(force = false) {
  if (workspaceClosing || document.hidden || reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = 0;
    void retryRead(() => reload(force)).catch(() => {});
  }, 100);
}

function label(element, value) {
  element.title = value;
  element.setAttribute('aria-label', value);
}

function candidateFor(group) {
  const id = choices.get(group.id) || group.selectedCandidateId || group.recommended.id;
  return group.candidates.find(candidate => candidate.id === id && !failedCandidates.has(candidate.id))
    || group.candidates.find(candidate => !failedCandidates.has(candidate.id))
    || group.recommended;
}

function candidateLabel(candidate) {
  const details = [];
  if (candidate.width && candidate.height) details.push(`${candidate.width} × ${candidate.height}`);
  const format = String(candidate.extension || candidate.mime?.replace('image/', '') || t('unknownFormat')).toUpperCase();
  details.push(format);
  const bytes = formatImageBytes(candidate.contentLength);
  if (bytes) details.push(bytes);
  return details.join(' · ');
}

function groupTitle(group, index) {
  const candidate = candidateFor(group);
  if (candidate.alt || candidate.title) return candidate.alt || candidate.title;
  try { return decodeURIComponent(new URL(candidate.url).pathname.split('/').pop() || '') || t('imageNumber', { number: index + 1 }); }
  catch { return t('imageNumber', { number: index + 1 }); }
}

function filteredGroups() {
  if (!state?.groups) return [];
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const type = document.querySelector('#type-filter').value;
  const layout = document.querySelector('#layout-filter').value;
  const minWidth = Number(document.querySelector('#min-width').value) || 0;
  const minHeight = Number(document.querySelector('#min-height').value) || 0;
  const groups = state.groups.filter(group => {
    const candidate = candidateFor(group);
    const text = `${candidate.alt} ${candidate.title} ${candidate.url}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (type !== 'all' && (candidate.extension || 'unknown') !== type) return false;
    if (layout !== 'all' && imageLayout(candidate.width, candidate.height) !== layout) return false;
    if ((candidate.width || 0) < minWidth || (candidate.height || 0) < minHeight) return false;
    return true;
  });
  const sort = document.querySelector('#sort').value;
  return [...groups].sort((a, b) => {
    if (sort === 'page') return a.recommended.discoveredAt - b.recommended.discoveredAt;
    const aArea = candidateFor(a).width * candidateFor(a).height;
    const bArea = candidateFor(b).width * candidateFor(b).height;
    return sort === 'smallest' ? aArea - bArea : bArea - aArea;
  });
}

function updateFilterSummary() {
  const count = [
    document.querySelector('#search').value.trim() !== '',
    document.querySelector('#type-filter').value !== 'all',
    document.querySelector('#layout-filter').value !== 'all',
    (Number(document.querySelector('#min-width').value) || 0) > 0,
    (Number(document.querySelector('#min-height').value) || 0) > 0,
    document.querySelector('#sort').value !== 'largest'
  ].filter(Boolean).length;
  const indicator = document.querySelector('#filter-count');
  indicator.textContent = count ? `· ${count}` : '';
  indicator.setAttribute('aria-label', count ? t('activeFilterCount', { count }) : '');
}

function updateTypeOptions() {
  const select = document.querySelector('#type-filter');
  const current = select.value || 'all';
  const formats = [...new Set((state?.groups || []).flatMap(group => group.candidates.map(candidate => candidate.extension).filter(Boolean)))].sort();
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = t('allTypes');
  select.append(all);
  for (const format of formats) {
    const option = document.createElement('option');
    option.value = format;
    option.textContent = format.toUpperCase();
    select.append(option);
  }
  select.value = formats.includes(current) || current === 'all' ? current : 'all';
}

async function download(selections) {
  if (downloadPending || !selections.length) return;
  downloadPending = true;
  const button = document.querySelector('#download-selected');
  button.disabled = true;
  for (const control of document.querySelectorAll('.image-card-actions button')) control.disabled = true;
  try {
    await send({
      type: 'UI_IMAGE_DOWNLOAD',
      tabId: sourceTabId,
      selections,
      options: {
        outputFormat: document.querySelector('#output-format').value,
        batchMode: document.querySelector('#batch-mode').value
      }
    });
    document.querySelector('#status-text').textContent = t('imageDownloadStarted', { count: selections.length });
  } catch {
    document.querySelector('#status-text').textContent = t('imageDownloadFailed');
  } finally {
    downloadPending = false;
    for (const control of document.querySelectorAll('.image-card-actions button')) control.disabled = false;
    updateSelectionBar();
  }
}

function createCard(group, index) {
  const candidate = candidateFor(group);
  const card = document.createElement('article');
  card.className = 'image-card';
  card.dataset.selected = String(selected.has(group.id));
  const preview = document.createElement('div');
  preview.className = 'image-preview';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'image-select';
  checkbox.checked = selected.has(group.id);
  checkbox.setAttribute('aria-label', t('selectImage', { name: groupTitle(group, index) }));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selected.set(group.id, candidate.id);
    else selected.delete(group.id);
    card.dataset.selected = String(checkbox.checked);
    updateSelectionBar();
  });
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.decoding = 'async';
  image.alt = candidate.alt || '';
  image.src = candidate.url;
  image.addEventListener('error', () => {
    failedCandidates.add(candidate.id);
    const fallback = group.candidates.find(item => !failedCandidates.has(item.id));
    if (!fallback) {
      preview.classList.add('image-preview-failed');
      return;
    }
    choices.set(group.id, fallback.id);
    if (selected.has(group.id)) selected.set(group.id, fallback.id);
    renderGallery();
  });
  image.addEventListener('load', () => {
    if (!image.naturalWidth || metadataSent.has(candidate.id)) return;
    if (image.naturalWidth === candidate.width && image.naturalHeight === candidate.height) return;
    metadataSent.add(candidate.id);
    void send({
      type: 'UI_IMAGE_UPDATE_METADATA',
      tabId: sourceTabId,
      candidateId: candidate.id,
      metadata: { width: image.naturalWidth, height: image.naturalHeight }
    }).catch(() => { metadataSent.delete(candidate.id); });
  });
  const badge = document.createElement('span');
  badge.className = 'recommended-badge';
  badge.textContent = t('recommendedOriginal');
  preview.append(image, checkbox);
  if (candidate.id === group.recommended.id && !failedCandidates.has(candidate.id)) preview.append(badge);

  const body = document.createElement('div');
  body.className = 'image-card-body';
  const title = document.createElement('strong');
  title.className = 'image-card-title';
  title.textContent = groupTitle(group, index);
  title.title = title.textContent;
  const metadata = document.createElement('span');
  metadata.className = 'image-metadata';
  metadata.textContent = candidateLabel(candidate);
  const actions = document.createElement('div');
  actions.className = 'image-card-actions';
  const variants = document.createElement('select');
  variants.setAttribute('aria-label', t('imageVariantLabel'));
  for (const item of group.candidates) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.id === group.recommended.id
      ? `${t('recommendedOriginal')} · ${candidateLabel(item)}`
      : candidateLabel(item) || t('alternateImage');
    variants.append(option);
  }
  variants.value = candidate.id;
  variants.disabled = group.candidates.length === 1;
  variants.addEventListener('change', () => {
    choices.set(group.id, variants.value);
    if (selected.has(group.id)) selected.set(group.id, variants.value);
    renderGallery();
  });
  const downloadButton = document.createElement('button');
  downloadButton.className = 'icon-button';
  downloadButton.type = 'button';
  downloadButton.disabled = downloadPending;
  downloadButton.innerHTML = icon('download');
  label(downloadButton, t('downloadImageTitle'));
  downloadButton.addEventListener('click', () => void download([{ groupId: group.id, candidateId: candidate.id }]));
  actions.append(variants, downloadButton);
  body.append(title, metadata, actions);
  card.append(preview, body);
  return card;
}

function updateSelectionBar() {
  const visibleIds = new Set(filteredGroups().map(group => group.id));
  for (const id of [...selected.keys()]) if (!(state?.groups || []).some(group => group.id === id)) selected.delete(id);
  const selectedVisible = [...selected.keys()].filter(id => visibleIds.has(id)).length;
  const count = selected.size;
  document.querySelector('#download-selected').textContent = count
    ? t('downloadSelectedCount', { count }) : t('downloadSelected');
  document.querySelector('#download-selected').disabled = downloadPending || count === 0;
  document.querySelector('#clear-selection').disabled = count === 0;
  document.querySelector('#select-visible').disabled = visibleIds.size === 0 || selectedVisible === visibleIds.size;
}

function renderGallery() {
  updateFilterSummary();
  const groups = filteredGroups();
  grid.replaceChildren();
  groups.forEach((group, index) => grid.append(createCard(group, index)));
  empty.hidden = groups.length > 0 || state?.status === 'scanning';
  grid.hidden = groups.length === 0;
  document.querySelector('#result-count').textContent = t('imageResults', { count: groups.length });
  updateSelectionBar();
}

function renderState(force = false) {
  if (!state) return;
  if (!preferencesInitialized) {
    document.querySelector('#output-format').value = state.outputFormat || 'original';
    document.querySelector('#batch-mode').value = state.batchMode || 'zip';
    preferencesInitialized = true;
  }
  const status = document.querySelector('#status-text');
  if (!state.active) status.textContent = t('imageSessionStopped');
  else if (state.status === 'scanning') status.textContent = t('imageScanning');
  else if (state.status === 'unavailable') status.textContent = t('imageUnavailablePage');
  else status.textContent = t('imageOriginalPreferred');
  updateWorkspaceControls();
  if (force || renderedAt !== state.updatedAt) {
    renderedAt = state.updatedAt;
    updateTypeOptions();
    renderGallery();
  }
}

async function reload(force = false) {
  state = await send({ type: 'UI_IMAGE_STATE', tabId: sourceTabId });
  renderState(force);
}

async function reloadAfterAction(force = false) {
  try { await retryRead(() => reload(force)); }
  catch { scheduleReload(force); }
}

async function rescan(deep) {
  if (scanPending) return;
  scanPending = true;
  updateWorkspaceControls();
  document.querySelector('#status-text').textContent = deep ? t('imageDeepScanning') : t('imageScanning');
  try {
    state = await send({ type: 'UI_IMAGE_RESCAN', tabId: sourceTabId, deep });
    renderState(true);
  } catch { document.querySelector('#status-text').textContent = t('imageUnavailablePage'); }
  finally {
    scanPending = false;
    updateWorkspaceControls();
  }
}

function updateWorkspaceControls() {
  const active = state?.active === true;
  const scanning = scanPending || state?.status === 'scanning';
  for (const button of document.querySelectorAll('#stop, #focus-source, #open-page, #capture-area')) {
    button.disabled = !active || pendingControls.has(button);
  }
  for (const button of document.querySelectorAll('#rescan, #deep-scan')) {
    button.disabled = !active || scanning || pendingControls.has(button);
  }
}

async function runWorkspaceAction(button, task) {
  if (pendingControls.has(button)) return;
  pendingControls.add(button);
  updateWorkspaceControls();
  try { await task(); }
  catch { document.querySelector('#status-text').textContent = t('imageUnavailablePage'); }
  finally {
    pendingControls.delete(button);
    updateWorkspaceControls();
  }
}

for (const input of document.querySelectorAll('#search, #type-filter, #layout-filter, #min-width, #min-height, #sort')) {
  input.addEventListener(input.tagName === 'INPUT' ? 'input' : 'change', () => renderGallery());
}
document.querySelector('#clear-filters').addEventListener('click', () => {
  document.querySelector('#search').value = '';
  document.querySelector('#type-filter').value = 'all';
  document.querySelector('#layout-filter').value = 'all';
  document.querySelector('#min-width').value = '0';
  document.querySelector('#min-height').value = '0';
  document.querySelector('#sort').value = 'largest';
  renderGallery();
});
document.querySelector('#select-visible').addEventListener('click', () => {
  for (const group of filteredGroups()) selected.set(group.id, candidateFor(group).id);
  renderGallery();
});
document.querySelector('#clear-selection').addEventListener('click', () => { selected.clear(); renderGallery(); });
document.querySelector('#download-selected').addEventListener('click', () => void download(
  [...selected.entries()].map(([groupId, candidateId]) => ({ groupId, candidateId }))
));
document.querySelector('#focus-source').innerHTML = icon('external');
document.querySelector('#open-page').innerHTML = icon('external');
document.querySelector('#capture-area').innerHTML = icon('capture');
document.querySelector('#rescan').innerHTML = icon('refresh');
document.querySelector('#deep-scan').innerHTML = icon('scan');
document.querySelector('#stop').innerHTML = icon('stop');
document.querySelector('#focus-source').addEventListener('click', event => void runWorkspaceAction(event.currentTarget, () => send({ type: 'UI_IMAGE_FOCUS_SOURCE', tabId: sourceTabId })));
document.querySelector('#open-page').addEventListener('click', event => void runWorkspaceAction(event.currentTarget, () => send({ type: 'UI_IMAGE_OPEN_PAGE', tabId: sourceTabId })));
document.querySelector('#capture-area').addEventListener('click', event => void runWorkspaceAction(event.currentTarget, () => send({ type: 'UI_IMAGE_CAPTURE_AREA', tabId: sourceTabId })));
document.querySelector('#rescan').addEventListener('click', () => void rescan(false));
document.querySelector('#deep-scan').addEventListener('click', () => void rescan(true));
document.querySelector('#stop').addEventListener('click', event => void runWorkspaceAction(event.currentTarget, async () => {
  await send({ type: 'UI_IMAGE_STOP', tabId: sourceTabId });
  await reloadAfterAction(true);
}));

const locale = await loadLocale();
root.lang = locale;
t = translator(locale);
localizeDocument(t);
for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
  element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
}
label(document.querySelector('#focus-source'), t('imageFocusSourceTitle'));
label(document.querySelector('#open-page'), t('imageOpenPageTitle'));
label(document.querySelector('#capture-area'), t('imageCaptureAreaTitle'));
label(document.querySelector('#rescan'), t('imageRescanTitle'));
label(document.querySelector('#deep-scan'), t('imageDeepScanTitle'));
label(document.querySelector('#stop'), t('imageStopTitle'));
document.querySelector('#version').textContent = t('version', { version: chrome.runtime.getManifest().version });
root.dataset.localePending = 'false';
try {
  if (!Number.isInteger(sourceTabId)) throw new Error('The image source tab is unavailable.');
  setWorkspaceVisible(!document.hidden);
  await retryRead(() => reload(true));
} catch {
  document.querySelector('#status-text').textContent = t('imageUnavailablePage');
  updateWorkspaceControls();
}
document.addEventListener('visibilitychange', () => {
  setWorkspaceVisible(!document.hidden);
  if (!document.hidden) scheduleReload(true);
});
window.addEventListener('pagehide', () => {
  workspaceClosing = true;
  try { viewPort?.postMessage({ visible: false }); } catch {}
  try { viewPort?.disconnect(); } catch {}
  viewPort = null;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = 0;
}, { once: true });
