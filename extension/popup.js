import { loadLocale } from './core/locale.js';
import { saveSettingsViewCache } from './core/settings-view-cache.js';
import { candidateQuality, formatMediaDuration } from './core/video-download.js';
import { localizeDocument, translator } from './localization.js';
import { icon, send } from './ui.js';

const root = document.documentElement;
const live = document.querySelector('#live');
const productKey = {
  nativeScroll: 'nativeScrollName',
  noAutoplay: 'noAutoplayName',
  anyCopy: 'anyCopyName',
  videoDownload: 'videoDownloadName'
};
let state;
let t;
let currentTab = null;
let viewMode = null;
let pollTimer = 0;

function label(element, value) {
  element.title = value;
  element.setAttribute('aria-label', value);
}

function iconState(featureId, feature) {
  if (featureId === 'anyCopy') return feature.active ? 'active' : 'off';
  if (featureId === 'videoDownload') {
    if (!feature.active) return 'off';
    return feature.status === 'found' ? 'active' : 'on';
  }
  if (!feature.active) return 'off';
  return state.activity?.[featureId] ? 'active' : 'on';
}

function renderStandardFeature(featureId) {
  const feature = state[featureId];
  const row = document.querySelector('[data-feature="' + featureId + '"]');
  const product = t(productKey[featureId]);
  const status = row.querySelector('.feature-status');
  const power = row.querySelector('[data-action="power"]');
  const enhanced = row.querySelector('[data-action="enhanced"]');
  const whitelist = row.querySelector('[data-action="whitelist"]');
  const settings = row.querySelector('[data-action="settings"]');

  status.dataset.state = iconState(featureId, feature);
  status.title = product;
  power.setAttribute('aria-pressed', String(feature.enabled));
  label(power, t(feature.enabled ? 'featureOnTitle' : 'featureOffTitle', { product }));

  enhanced.disabled = !feature.enabled || !feature.supported || !!feature.matchedWhitelistRule;
  enhanced.setAttribute('aria-pressed', String(!!feature.matchedEnhancedRule));
  if (!feature.supported) label(enhanced, t('unsupportedTitle'));
  else if (feature.matchedWhitelistRule) label(enhanced, t('enhancedUnavailableTitle'));
  else if (feature.matchedEnhancedRule && !feature.exactEnhanced) {
    label(enhanced, t('enhancedCoveredTitle', { rule: feature.matchedEnhancedRule }));
  } else label(enhanced, t(feature.exactEnhanced ? 'enhancedSiteTitle' : 'standardSiteTitle'));

  whitelist.disabled = !feature.enabled || !feature.supported;
  if (!feature.supported) {
    whitelist.innerHTML = icon('siteAdd');
    label(whitelist, t('unsupportedTitle'));
  } else if (feature.exactWhitelisted) {
    whitelist.innerHTML = icon('siteRemove');
    label(whitelist, t('removeWhitelistTitle', { product }));
  } else if (feature.matchedWhitelistRule) {
    whitelist.innerHTML = icon('siteCovered');
    label(whitelist, t('coveredWhitelistTitle', { rule: feature.matchedWhitelistRule }));
  } else {
    whitelist.innerHTML = icon('siteAdd');
    label(whitelist, t('addWhitelistTitle', { product }));
  }
  whitelist.setAttribute('aria-pressed', String(!!feature.matchedWhitelistRule));
  label(settings, t('settingsTitle', { product }));
}

function renderAnyCopy() {
  const feature = state.anyCopy;
  const row = document.querySelector('[data-feature="anyCopy"]');
  const product = t('anyCopyName');
  const toggle = row.querySelector('.feature-toggle');
  const enhanced = row.querySelector('[data-action="enhanced"]');
  const settings = row.querySelector('[data-action="settings"]');

  if (!feature) {
    toggle.disabled = true;
    enhanced.disabled = true;
    settings.disabled = true;
    label(toggle, t('unavailable'));
    label(enhanced, t('unavailable'));
    label(settings, t('unavailable'));
    return;
  }
  settings.disabled = false;

  toggle.dataset.state = iconState('anyCopy', feature);
  toggle.setAttribute('aria-pressed', String(feature.active));
  if (!feature.supported) {
    toggle.disabled = true;
    label(toggle, t('unsupportedTitle'));
  } else if (feature.active && !feature.exactEnforced && !feature.exactEnhanced) {
    toggle.disabled = false;
    label(toggle, t('anyCopyCoveredTitle', { rule: feature.matchedEnhancedRule || feature.matchedEnforcedRule }));
  } else {
    toggle.disabled = false;
    label(toggle, t(feature.active ? 'anyCopyOnTitle' : 'anyCopyOffTitle'));
  }

  enhanced.disabled = !feature.supported;
  enhanced.setAttribute('aria-pressed', String(!!feature.matchedEnhancedRule));
  if (!feature.supported) label(enhanced, t('unsupportedTitle'));
  else if (feature.matchedEnhancedRule && !feature.exactEnhanced) {
    label(enhanced, t('enhancedCoveredTitle', { rule: feature.matchedEnhancedRule }));
  } else label(enhanced, t(feature.exactEnhanced ? 'anyCopyEnhancedOnTitle' : 'anyCopyEnhancedOffTitle'));
  label(settings, t('settingsTitle', { product }));
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
  title.textContent = candidateQuality(candidate);
  const details = document.createElement('small');
  const pieces = [];
  if (candidate.kind === 'hls') pieces.push(t('videoStream'));
  else if (candidate.kind === 'muxed') pieces.push(t('videoCombinedStream'));
  else if (candidate.kind === 'dash') pieces.push(t('videoDashStream'));
  else if (candidate.kind === 'subtitle') pieces.push(t('videoSubtitles'));
  else pieces.push(String(candidate.extension || candidate.mime?.replace('video/', '') || t('videoFile')).toUpperCase());
  if (candidate.codecLabel) pieces.push(candidate.codecLabel);
  else if (candidate.videoCodec) pieces.push(String(candidate.videoCodec).split('.')[0].toUpperCase());
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
  item.append(info, download);
  return item;
}

function renderVideoPanel() {
  const feature = state.videoDownload;
  const status = document.querySelector('#video-status-text');
  const results = document.querySelector('#video-results');
  const otherFormatsOpen = results.querySelector('.video-other-formats')?.open === true;
  results.replaceChildren();
  if (!feature?.active) {
    status.textContent = t('videoStopped');
    return;
  }
  const candidates = visibleVideoCandidates(feature.candidates);
  if (!candidates.length) {
    status.textContent = feature.status === 'unavailable' ? t('videoUnavailablePage') : t('videoScanningHelp');
    return;
  }
  status.textContent = t('videoFound', { count: candidates.length });
  const preferred = candidates.find(candidate => candidate.downloadable !== false) || candidates[0];
  results.append(createVideoCandidate(preferred));
  const others = candidates.filter(candidate => candidate.id !== preferred.id);
  if (others.length) {
    const details = document.createElement('details');
    details.className = 'video-other-formats';
    details.open = otherFormatsOpen;
    const summary = document.createElement('summary');
    summary.textContent = t('otherFormats', { count: others.length });
    const list = document.createElement('div');
    list.className = 'video-candidate-list';
    for (const candidate of others) list.append(createVideoCandidate(candidate));
    details.append(summary, list);
    results.append(details);
  }
}

function renderVideoRow() {
  const feature = state.videoDownload;
  const toggle = document.querySelector('#videoDownload-status');
  const settings = document.querySelector('[data-feature="videoDownload"] [data-action="settings"]');
  toggle.disabled = !feature?.supported;
  toggle.dataset.state = iconState('videoDownload', feature || { active: false });
  toggle.setAttribute('aria-pressed', String(!!feature?.active));
  label(toggle, t(!feature?.supported ? 'unsupportedTitle' : feature.active ? 'videoOpenTitle' : 'videoStartTitle'));
  label(settings, t('settingsTitle', { product: t('videoDownloadName') }));
  renderVideoPanel();
}

function showView(mode) {
  viewMode = mode;
  document.body.dataset.view = mode;
  document.querySelector('.popup-shell').hidden = mode === 'video';
  document.querySelector('#video-panel').hidden = mode !== 'video';
  clearInterval(pollTimer);
  pollTimer = 0;
  if (mode === 'video') pollTimer = setInterval(() => void reload(false), 800);
}

function render() {
  if (!state) return;
  renderStandardFeature('nativeScroll');
  renderStandardFeature('noAutoplay');
  renderAnyCopy();
  renderVideoRow();
}

async function reload(selectInitialView = true) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  state = await send({ type: 'UI_GET', tabId: tab?.id, url: tab?.url || '' });
  saveSettingsViewCache(state);
  render();
  if (selectInitialView && viewMode === null) showView(state.videoDownload?.active ? 'video' : 'main');
}

async function act(task) {
  try { await task(); await reload(); }
  catch { live.textContent = t('unavailable'); }
}

for (const row of document.querySelectorAll('.feature-row')) {
  const featureId = row.dataset.feature;
  row.querySelector('.feature-status').innerHTML = icon(featureId);
  const enhanced = row.querySelector('[data-action="enhanced"]');
  if (enhanced) enhanced.innerHTML = icon('bolt');
  row.querySelector('[data-action="settings"]').innerHTML = icon('settings');

  const power = row.querySelector('[data-action="power"]');
  if (power) {
    power.innerHTML = icon('power');
    power.addEventListener('click', () => void act(() => send({
      type: 'UI_SET_ENABLED', featureId, enabled: !state[featureId].enabled
    })));
  }
  const whitelist = row.querySelector('[data-action="whitelist"]');
  if (whitelist) {
    whitelist.innerHTML = icon('siteAdd');
    whitelist.addEventListener('click', () => void act(() => {
      const feature = state[featureId];
      if (feature.matchedWhitelistRule && !feature.exactWhitelisted) {
        return send({ type: 'UI_OPEN_SETTINGS', featureId });
      }
      return send({ type: 'UI_TOGGLE_WHITELIST', featureId, hostname: feature.hostname });
    }));
  }
  if (enhanced) enhanced.addEventListener('click', () => void act(() => {
      const feature = state[featureId];
      if (feature.matchedEnhancedRule && !feature.exactEnhanced) {
        return send({ type: 'UI_OPEN_SETTINGS', featureId });
      }
      return send({ type: 'UI_TOGGLE_ENHANCED', featureId, hostname: feature.hostname });
    }));
  row.querySelector('[data-action="settings"]').addEventListener('click', () => void act(async () => {
    await send({ type: 'UI_OPEN_SETTINGS', featureId });
    window.close();
  }));
}

document.querySelector('#anyCopy-status').addEventListener('click', () => void act(() => {
  const feature = state.anyCopy;
  if (feature.active && !feature.exactEnforced && !feature.exactEnhanced) {
    return send({ type: 'UI_OPEN_SETTINGS', featureId: 'anyCopy' });
  }
  return send({ type: 'UI_TOGGLE_ANY_COPY', hostname: feature.hostname });
}));

document.querySelector('#videoDownload-status').addEventListener('click', () => void (async () => {
  try {
    await send({
      type: 'UI_VIDEO_OPEN',
      tabId: currentTab?.id,
      url: currentTab?.url || '',
      title: currentTab?.title || ''
    });
    showView('video');
    await reload(false);
  } catch { live.textContent = t('unavailable'); }
})());

document.querySelector('#video-back').innerHTML = icon('back');
document.querySelector('#video-stop').innerHTML = icon('stop');
document.querySelector('#video-rescan').innerHTML = icon('refresh');
document.querySelector('#video-back').addEventListener('click', () => showView('main'));
document.querySelector('#video-stop').addEventListener('click', () => void (async () => {
  try {
    await send({ type: 'UI_VIDEO_STOP', tabId: currentTab?.id });
    showView('main');
    await reload(false);
  } catch { live.textContent = t('unavailable'); }
})());
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
root.dataset.localePending = 'false';
try { await reload(); } catch { live.textContent = t('unavailable'); }
