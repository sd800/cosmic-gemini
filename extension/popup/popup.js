import { loadLocale } from '../core/locale.js';
import { saveSettingsViewCache } from '../core/settings-view-cache.js';
import { candidateQuality, compactVideoCandidates, formatMediaDuration } from '../core/video-download.js';
import { localizeDocument, translator } from '../shared/localization.js';
import { icon, send } from '../shared/ui.js';

const root = document.documentElement;
const live = document.querySelector('#live');
const productKey = {
  nativeScroll: 'nativeScrollName',
  noAutoplay: 'noAutoplayName',
  anyCopy: 'anyCopyName',
  anyCopyEnhanced: 'anyCopyEnhancedName',
  imageDownload: 'imageDownloadName',
  videoDownload: 'videoDownloadName'
};
let state;
let t;
let currentTab = null;
let viewMode = null;
let videoViewPort = null;
let videoViewPortTabId = null;
let videoViewReconnectAttempts = 0;
let reloadTimer = 0;
let selectedVideoCandidateId = '';
let videoSelectionTabId = null;
let videoPanelSignature = '';
let videoPickerActive = false;
let videoPanelRenderPending = false;
let actionPending = false;

function label(element, value) {
  element.title = value;
  element.setAttribute('aria-label', value);
}

function iconState(featureId, feature) {
  return feature?.active ? 'active' : 'off';
}

function renderImageRow() {
  const feature = state.imageDownload;
  const toggle = document.querySelector('#imageDownload-status');
  toggle.disabled = !feature?.supported;
  toggle.dataset.state = iconState('imageDownload', feature || { active: false });
  toggle.dataset.persistent = 'false';
  toggle.setAttribute('aria-pressed', String(!!feature?.active));
  label(toggle, t(!feature?.supported ? 'unsupportedTitle' : feature.active ? 'imageOpenTitle' : 'imageStartTitle'));
}

function renderGuardFeature(featureId) {
  const feature = state[featureId];
  const product = t(productKey[featureId]);
  const primary = document.querySelector('#' + featureId + '-status');
  const enhanced = document.querySelector('#' + featureId + '-enhanced');
  const enhancedActive = feature.active && feature.mode === 'enhanced';
  const intervened = feature.active && state.activity?.[featureId] === true;

  primary.disabled = !feature.supported;
  primary.dataset.state = feature.active ? 'active' : 'off';
  primary.dataset.persistent = String(feature.active);
  primary.dataset.intervened = String(intervened && !enhancedActive);
  primary.setAttribute('aria-pressed', String(feature.active));
  if (!feature.supported) label(primary, t('unsupportedTitle'));
  else if (feature.exactBehaviorOverride) label(primary, t('removeSiteOverrideTitle', { product }));
  else label(primary, t(feature.active ? 'disableProductOnSiteTitle' : 'enableProductOnSiteTitle', { product }));

  enhanced.disabled = !feature.supported;
  enhanced.dataset.state = enhancedActive ? 'active' : 'off';
  enhanced.dataset.persistent = String(enhancedActive);
  enhanced.dataset.intervened = String(intervened && enhancedActive);
  enhanced.setAttribute('aria-pressed', String(enhancedActive));
  if (!feature.supported) label(enhanced, t('unsupportedTitle'));
  else label(enhanced, t(enhancedActive ? 'useStandardOnSiteTitle' : 'useEnhancedOnSiteTitle', { product }));
}

function renderSiteFeature(featureId) {
  const feature = state[featureId];
  const toggle = document.querySelector('#' + featureId + '-status');
  const product = t(productKey[featureId]);
  if (!feature) {
    toggle.disabled = true;
    label(toggle, t('unavailable'));
    return;
  }
  toggle.dataset.state = iconState(featureId, feature);
  toggle.dataset.persistent = String(feature.active);
  toggle.setAttribute('aria-pressed', String(feature.active));
  if (!feature.supported) {
    toggle.disabled = true;
    label(toggle, t('unsupportedTitle'));
  } else if (featureId === 'anyCopyEnhanced') {
    toggle.disabled = false;
    label(toggle, t(feature.active ? 'anyCopyEnhancedOnTitle' : 'anyCopyEnhancedOffTitle'));
  } else if (feature.active && !feature.exactActive) {
    toggle.disabled = false;
    label(toggle, t('siteFeatureCoveredTitle', { product, rule: feature.matchedRule }));
  } else {
    toggle.disabled = false;
    label(toggle, t(feature.active ? 'siteFeatureOnTitle' : 'siteFeatureOffTitle', { product }));
  }
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function visibleVideoCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const hasVariant = list.some(candidate => candidate.kind === 'hls' && candidate.source === 'hls-variant');
  const hasDashVariant = list.some(candidate => candidate.source === 'dash-variant');
  return list.filter(candidate => !(candidate.master && (candidate.kind === 'hls' ? hasVariant : hasDashVariant)));
}

function videoButtonCopy(candidate) {
  if (candidate.downloadable === false) return t('videoUnavailableFormat');
  if (candidate.status === 'preparing') return t('videoPreparing', { progress: candidate.progress || 0 });
  if (candidate.status === 'downloading') return t('videoDownloading');
  if (candidate.status === 'complete') return t('videoDownloaded');
  if (candidate.status === 'failed') return t('videoRetry');
  return t('download');
}

function createVideoCandidate(candidate) {
  const item = document.createElement('article');
  item.className = 'video-candidate';
  const info = document.createElement('div');
  info.className = 'video-candidate-info';
  const title = document.createElement('strong');
  title.textContent = videoDisplayLabel(candidate);
  const details = document.createElement('small');
  const pieces = [];
  if (candidate.kind === 'audio') pieces.push(t('videoAudioFile'));
  else if (candidate.kind === 'hls') pieces.push(t('videoStream'));
  else if (candidate.kind === 'muxed') pieces.push(t('videoCombinedStream'));
  else if (candidate.kind === 'dash') pieces.push(t('videoDashStream'));
  else if (candidate.kind === 'subtitle') pieces.push(t('videoSubtitles'));
  else pieces.push(String(candidate.extension || candidate.mime?.replace('video/', '') || t('videoFile')).toUpperCase());
  if (candidate.codecLabel) pieces.push(candidate.codecLabel);
  else if (candidate.videoCodec) pieces.push(String(candidate.videoCodec).split('.')[0].toUpperCase());
  else if (candidate.audioCodec) pieces.push(String(candidate.audioCodec).split('.')[0].toUpperCase());
  const bytes = formatBytes(candidate.outputBytes || candidate.contentLength);
  if (bytes) pieces.push(bytes);
  const duration = formatMediaDuration(candidate.duration);
  if (duration) pieces.push(duration);
  if (candidate.liveSnapshot) pieces.push(t('videoLiveSnapshot'));
  if (candidate.protected) pieces.push(t('videoProtectedMedia'));
  if (candidate.status === 'failed') pieces.push(t('videoDownloadFailedHelp'));
  details.textContent = pieces.join(' · ');
  info.append(title, details);
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'video-download-button';
  download.dataset.status = candidate.status || 'ready';
  download.textContent = videoButtonCopy(candidate);
  download.disabled = candidate.downloadable === false || ['preparing', 'downloading', 'complete'].includes(candidate.status);
  download.addEventListener('click', () => void act(async () => {
    await send({ type: 'UI_VIDEO_DOWNLOAD', tabId: currentTab?.id, candidateId: candidate.id });
  }));
  const controls = document.createElement('div');
  controls.className = 'video-candidate-controls';
  if (candidate.status === 'preparing') {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'icon-button video-processing-cancel';
    cancel.innerHTML = icon('close');
    label(cancel, t('videoCancelProcessingTitle'));
    cancel.addEventListener('click', () => void act(() => send({
      type: 'UI_VIDEO_CANCEL_PROCESSING',
      tabId: currentTab?.id,
      candidateId: candidate.id
    })));
    controls.append(cancel);
  }
  controls.append(download);
  item.append(info, controls);
  return item;
}

function videoOptionLabel(candidate) {
  return videoDisplayLabel(candidate);
}

function videoCandidateType(candidate) {
  if (candidate.kind === 'audio') return 'audio';
  if (candidate.kind === 'subtitle') return 'subtitle';
  return 'video';
}

function videoDisplayLabel(candidate) {
  if (candidate.kind === 'audio') return t('videoAudioOnly');
  if (candidate.kind === 'subtitle') return candidate.languageLabel || candidate.qualityLabel || t('videoSubtitles');
  return candidateQuality(candidate);
}

function createVideoIdentity(feature) {
  if (!feature.thumbnailUrl && !feature.title) return null;
  const identity = document.createElement('div');
  identity.className = 'video-target';
  if (feature.thumbnailUrl) {
    const image = document.createElement('img');
    image.src = feature.thumbnailUrl;
    image.alt = '';
    image.addEventListener('error', () => image.remove(), { once: true });
    identity.append(image);
  }
  if (feature.title) {
    const title = document.createElement('strong');
    title.textContent = feature.title;
    identity.append(title);
  }
  return identity;
}

function createVideoFormatPicker(candidates) {
  const picker = document.createElement('label');
  picker.className = 'video-format-picker';
  const heading = document.createElement('span');
  heading.textContent = t('videoQuality');
  const select = document.createElement('select');
  select.className = 'video-format-select';
  const types = [...new Set(candidates.map(videoCandidateType))];
  const groups = {
    video: t('videoGroup'),
    audio: t('audioGroup'),
    subtitle: t('subtitleGroup')
  };
  const appendOption = (parent, candidate) => {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = videoOptionLabel(candidate);
    option.disabled = candidate.downloadable === false;
    parent.append(option);
  };
  if (types.length > 1) {
    for (const type of ['video', 'audio', 'subtitle']) {
      const matching = candidates.filter(candidate => videoCandidateType(candidate) === type);
      if (!matching.length) continue;
      const group = document.createElement('optgroup');
      group.label = groups[type];
      for (const candidate of matching) appendOption(group, candidate);
      select.append(group);
    }
  } else {
    for (const candidate of candidates) appendOption(select, candidate);
  }
  select.value = selectedVideoCandidateId;
  const markActive = () => { videoPickerActive = true; };
  select.addEventListener('pointerdown', markActive);
  select.addEventListener('focus', markActive);
  select.addEventListener('change', () => {
    selectedVideoCandidateId = select.value;
    videoPickerActive = false;
    const selected = candidates.find(candidate => candidate.id === selectedVideoCandidateId) || candidates[0];
    const slot = document.querySelector('.video-candidate-slot');
    if (slot && selected) slot.replaceChildren(createVideoCandidate(selected));
    videoPanelSignature = videoPanelStateSignature(state.videoDownload, candidates);
  });
  select.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === select) return;
    videoPickerActive = false;
    if (!videoPanelRenderPending) return;
    videoPanelRenderPending = false;
    videoPanelSignature = '';
    renderVideoPanel(true);
  }, 0));
  picker.append(heading, select);
  return picker;
}

function videoPanelStateSignature(feature, candidates) {
  return JSON.stringify({
    active: !!feature?.active,
    status: feature?.status || '',
    title: feature?.title || '',
    thumbnailUrl: feature?.thumbnailUrl || '',
    selectedVideoCandidateId,
    candidates: candidates.map(candidate => [
      candidate.id, candidate.kind, candidate.status, candidate.progress, candidate.downloadable,
      candidate.contentLength, candidate.outputBytes, candidate.duration, candidate.qualityLabel,
      candidate.width, candidate.height, candidate.bandwidth, candidate.codecLabel,
      candidate.videoCodec, candidate.audioCodec, candidate.extension, candidate.protected
    ])
  });
}

function renderVideoPanel(force = false) {
  const feature = state.videoDownload;
  const status = document.querySelector('#video-status-text');
  const results = document.querySelector('#video-results');
  const visible = visibleVideoCandidates(feature?.candidates);
  let candidates = compactVideoCandidates(visible, selectedVideoCandidateId);
  if (candidates.length && !candidates.some(candidate => candidate.id === selectedVideoCandidateId && candidate.downloadable !== false)) {
    selectedVideoCandidateId = candidates.find(candidate => candidate.downloadable !== false)?.id || candidates[0].id;
    candidates = compactVideoCandidates(visible, selectedVideoCandidateId);
  }
  const signature = videoPanelStateSignature(feature, candidates);
  if (!force && signature === videoPanelSignature) return;
  if (!force && videoPickerActive) {
    videoPanelRenderPending = true;
    return;
  }
  videoPanelRenderPending = false;
  videoPanelSignature = signature;
  results.replaceChildren();
  if (!feature?.active) {
    status.textContent = t('videoStopped');
    return;
  }
  if (!candidates.length) {
    status.textContent = feature.status === 'unavailable' ? t('videoUnavailablePage') : t('videoScanningHelp');
    return;
  }
  status.textContent = t('videoFound', { count: candidates.length });
  const card = document.createElement('section');
  card.className = 'video-media-card';
  const identity = createVideoIdentity(feature);
  if (identity) card.append(identity);
  card.append(createVideoFormatPicker(candidates));
  const selected = candidates.find(candidate => candidate.id === selectedVideoCandidateId) || candidates[0];
  const slot = document.createElement('div');
  slot.className = 'video-candidate-slot';
  slot.append(createVideoCandidate(selected));
  card.append(slot);
  results.append(card);
}

function renderVideoRow() {
  const feature = state.videoDownload;
  const toggle = document.querySelector('#videoDownload-status');
  toggle.disabled = !feature?.supported;
  toggle.dataset.state = iconState('videoDownload', feature || { active: false });
  toggle.dataset.persistent = 'false';
  toggle.setAttribute('aria-pressed', String(!!feature?.active));
  label(toggle, t(!feature?.supported ? 'unsupportedTitle' : feature.active ? 'videoOpenTitle' : 'videoStartTitle'));
  renderVideoPanel();
}

function showView(mode) {
  viewMode = mode;
  document.body.dataset.view = mode;
  document.querySelector('.popup-shell').hidden = mode === 'video';
  document.querySelector('#video-panel').hidden = mode !== 'video';
  setVideoViewVisible(mode === 'video');
}

function setVideoViewVisible(visible) {
  const tabId = currentTab?.id;
  if (!Number.isInteger(tabId)) return;
  if (!visible && !videoViewPort) return;
  if (!videoViewPort || videoViewPortTabId !== tabId) {
    try { videoViewPort?.disconnect(); } catch {}
    const port = chrome.runtime.connect({ name: `download-view:videoDownload:${tabId}` });
    videoViewPort = port;
    videoViewPortTabId = tabId;
    setTimeout(() => {
      if (videoViewPort === port) videoViewReconnectAttempts = 0;
    }, 1_000);
    port.onDisconnect.addListener(() => {
      if (videoViewPort !== port) return;
      videoViewPort = null;
      videoViewPortTabId = null;
      if (viewMode === 'video' && Number.isInteger(currentTab?.id) && videoViewReconnectAttempts < 5) {
        videoViewReconnectAttempts += 1;
        setTimeout(() => setVideoViewVisible(true), Math.min(250 * (2 ** videoViewReconnectAttempts), 4_000));
      }
    });
  }
  try { videoViewPort.postMessage({ visible }); } catch {}
}

function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = 0;
    void reload(false).catch(() => {});
  }, 80);
}

function render() {
  if (!state) return;
  renderGuardFeature('nativeScroll');
  renderGuardFeature('noAutoplay');
  renderSiteFeature('anyCopy');
  renderSiteFeature('anyCopyEnhanced');
  renderImageRow();
  renderVideoRow();
}

async function reload(selectInitialView = true) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  if (videoSelectionTabId !== currentTab?.id) {
    videoSelectionTabId = currentTab?.id ?? null;
    selectedVideoCandidateId = '';
    videoPanelSignature = '';
    videoPickerActive = false;
    videoPanelRenderPending = false;
  }
  state = await send({ type: 'UI_GET', tabId: tab?.id, url: tab?.url || '' });
  saveSettingsViewCache(state);
  render();
  if (selectInitialView && viewMode === null) showView('main');
}

async function perform(task, reloadAfter = false) {
  if (actionPending) return false;
  actionPending = true;
  document.body.setAttribute('aria-busy', 'true');
  live.textContent = '';
  try {
    await task();
    if (reloadAfter) await reload();
    return true;
  } catch {
    live.textContent = t('unavailable');
    return false;
  } finally {
    actionPending = false;
    document.body.removeAttribute('aria-busy');
  }
}

function act(task) {
  return perform(task, true);
}

for (const featureId of ['nativeScroll', 'noAutoplay']) {
  const primary = document.querySelector('#' + featureId + '-status');
  const enhanced = document.querySelector('#' + featureId + '-enhanced');
  primary.innerHTML = icon(featureId);
  enhanced.innerHTML = icon('bolt');
  primary.addEventListener('click', () => void act(() => send({
    type: 'UI_TOGGLE_PAGE_FEATURE',
    featureId,
    hostname: state[featureId].hostname
  })));
  enhanced.addEventListener('click', () => void act(() => send({
    type: 'UI_TOGGLE_PAGE_ENHANCED',
    featureId,
    hostname: state[featureId].hostname
  })));
}

const anyCopyControl = document.querySelector('#anyCopy-status');
anyCopyControl.innerHTML = icon('anyCopy');
anyCopyControl.addEventListener('click', () => void act(() => {
  const feature = state.anyCopy;
  if (feature.matchedRule) return send({
    type: 'UI_DELETE_RULE', featureId: 'anyCopy', listName: 'siteRules', rule: feature.matchedRule
  });
  return send({ type: 'UI_TOGGLE_SITE_FEATURE', featureId: 'anyCopy', hostname: feature.hostname });
}));

const anyCopyEnhancedControl = document.querySelector('#anyCopyEnhanced-status');
anyCopyEnhancedControl.innerHTML = icon('anyCopyEnhanced');
anyCopyEnhancedControl.addEventListener('click', () => void act(() => send({
  type: 'UI_TOGGLE_TAB_FEATURE', featureId: 'anyCopyEnhanced', tabId: currentTab?.id
})));

document.querySelector('#imageDownload-status').innerHTML = icon('imageDownload');
document.querySelector('#videoDownload-status').innerHTML = icon('videoDownload');
document.querySelector('#video-panel-product-icon').innerHTML = icon('videoDownload');
document.querySelector('#all-settings').innerHTML = icon('menu');
label(document.querySelector('#all-settings'), t?.('allSettingsTitle') || 'All Settings');
document.querySelector('#all-settings').addEventListener('click', () => void perform(async () => {
  await send({ type: 'UI_OPEN_ALL_SETTINGS' });
  window.close();
}));

document.querySelector('#videoDownload-status').addEventListener('click', () => void perform(async () => {
  setVideoViewVisible(true);
  await send({
      type: 'UI_VIDEO_OPEN',
      tabId: currentTab?.id,
      url: currentTab?.url || '',
      title: currentTab?.title || ''
    });
    showView('video');
    await reload(false);
}));

document.querySelector('#imageDownload-status').addEventListener('click', () => void perform(async () => {
    await send({
      type: 'UI_IMAGE_OPEN',
      tabId: currentTab?.id,
      url: currentTab?.url || '',
      title: currentTab?.title || '',
      workspaceMode: state.imageDownload?.workspaceMode || 'sidePanel'
    });
    window.close();
}));

document.querySelector('#video-back').innerHTML = icon('back');
document.querySelector('#video-stop').innerHTML = icon('stop');
document.querySelector('#video-rescan').innerHTML = icon('refresh');
document.querySelector('#video-back').addEventListener('click', () => showView('main'));
document.querySelector('#video-stop').addEventListener('click', () => void perform(async () => {
    await send({ type: 'UI_VIDEO_STOP', tabId: currentTab?.id });
    showView('main');
    await reload(false);
}));
document.querySelector('#video-rescan').addEventListener('click', () => void act(() => send({
  type: 'UI_VIDEO_RESCAN', tabId: currentTab?.id
})));

const locale = await loadLocale();
root.lang = locale;
t = translator(locale);
localizeDocument(t);
for (const nav of document.querySelectorAll('[data-i18n-aria-label]')) nav.setAttribute('aria-label', t(nav.dataset.i18nAriaLabel));
label(document.querySelector('#video-back'), t('back'));
label(document.querySelector('#video-stop'), t('videoStopTitle'));
label(document.querySelector('#video-rescan'), t('videoRescanTitle'));
label(document.querySelector('#all-settings'), t('allSettingsTitle'));
root.dataset.localePending = 'false';
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Number.isInteger(currentTab?.id)
    ? [`tabActivity:${currentTab.id}`, `anyCopyEnhancedTab:${currentTab.id}`, `videoDownloadSession:${currentTab.id}`]
    : [];
  if (!(area === 'session') || !keys.length) return;
  if (keys.some(key => Object.hasOwn(changes, key))) scheduleReload();
});
try { await reload(); } catch { live.textContent = t('unavailable'); }
