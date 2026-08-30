import {
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  LEGACY_SETTINGS_KEY,
  SETTINGS_KEY,
  anyCopyEnhancedState,
  anyCopyState,
  featureState,
  hostnameFromUrl,
  normalizeRule,
  normalizeSettings,
  updateFeature
} from '../core/config.js';
import { normalizeLocale } from '../core/locale.js';
import {
  bilibiliDashCandidates,
  bilibiliPageContext,
  completeBilibiliPageContext,
  fetchBilibiliPlayInfo
} from '../core/bilibili-video.js';
import { youtubePageContext } from '../core/youtube-video.js';
import { siteVideoPageDiscovery } from '../core/site-video.js';
import { unwrapObfuscatedHls } from '../core/obfuscated-hls.js';
import { imagePageDiscovery } from '../core/image-page.js';
import {
  groupImageCandidates,
  imageContentLength,
  imageExtension,
  imageMimeFromHeaders,
  imageSessionKey,
  mergeImageCandidate,
  normalizeImageCandidate,
  sanitizeImageFilename
} from '../core/image-download.js';
import {
  BILI_DAILY_ALARM,
  BILI_DAILY_MAX_ATTEMPTS,
  BILI_DAILY_RETRY_MS,
  BILI_DAILY_RETRY_KEY,
  bilibiliDateKey,
  browserReportsOffline,
  nextBilibiliSchedule
} from '../core/bili-daily-login.js';
import {
  classifyVideoResource,
  mediaRequestDirectoryFilters,
  mediaRequestReferrer,
  mergeVideoCandidate,
  parseHlsMaster,
  parseHlsMedia,
  sanitizeVideoFilename,
  videoSessionKey
} from '../core/video-download.js';

const DEFAULT_ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const ACTIVE_ICONS = { 16: 'icons/icon-suppressing-16.png', 32: 'icons/icon-suppressing-32.png', 48: 'icons/icon-suppressing-48.png', 128: 'icons/icon-suppressing-128.png' };
const ACTIVITY_PREFIX = 'tabActivity:';
const FEATURE_LISTS = new Set(['enabledRules', 'whitelistRules', 'enhancedRules', 'standardRules', 'permanentAudioAllowRules', 'siteRules']);
const LEGACY_AUDIO_SESSION_PREFIXES = ['temporaryAudioAllow:', 'audioPromptShown:'];
const LEGACY_AUDIO_ALARM_PREFIX = 'temporaryAudio:';
let writeQueue = Promise.resolve();
let biliDailyRun = null;
let activeVideoAssemblies = 0;
const activeVideoProcessing = new Map();
let nextMediaHeaderRuleId = 700000;
const pendingVideoFilenames = new Map();
const expandingVideoManifests = new Set();
const activeVideoTabs = new Set();
const activeImageTabs = new Set();
const preparedImageSidePanels = new Map();
const activeVideoTabsReady = chrome.storage.session.get(null).then(values => {
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('videoDownloadSession:') && value?.active === true && Number.isInteger(value.tabId)) {
      activeVideoTabs.add(value.tabId);
    }
  }
}).catch(() => {});
const activeImageTabsReady = chrome.storage.session.get(null).then(values => {
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('imageDownloadSession:') && value?.active === true && Number.isInteger(value.tabId)) {
      activeImageTabs.add(value.tabId);
    }
  }
}).catch(() => {});

function sendTabMessage(tabId, message) {
  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(tabId, message, response => {
        void chrome.runtime.lastError;
        resolve(response);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function updateAction(method, details) {
  return new Promise(resolve => {
    try {
      chrome.action[method](details, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function readSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  return normalizeSettings(stored[SETTINGS_KEY] || stored[LEGACY_SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  const settings = normalizeSettings(stored[SETTINGS_KEY] || stored[LEGACY_SETTINGS_KEY] || DEFAULT_SETTINGS);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  if (stored[LEGACY_SETTINGS_KEY]) await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
}

async function saveSettings(value) {
  const settings = normalizeSettings(value);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function refreshOpenPages() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
    sendTabMessage(tab.id, { type: 'CG_REFRESH_CONFIG' })));
}

async function mutateSettings(update, refresh = true) {
  writeQueue = writeQueue.then(async () => {
    const current = await readSettings();
    const next = await saveSettings(typeof update === 'function' ? update(current) : update);
    if (refresh) await refreshOpenPages();
    return next;
  });
  return writeQueue;
}

function activityKey(tabId) {
  return ACTIVITY_PREFIX + tabId;
}

async function readActivity(tabId) {
  if (!Number.isInteger(tabId)) return { nativeScroll: false, noAutoplay: false, anyCopy: false, anyCopyEnhanced: false, imageDownload: false, videoDownload: false };
  try {
    const value = (await chrome.storage.session.get(activityKey(tabId)))[activityKey(tabId)];
    return {
      nativeScroll: value?.nativeScroll === true,
      noAutoplay: value?.noAutoplay === true,
      anyCopy: value?.anyCopy === true,
      anyCopyEnhanced: value?.anyCopyEnhanced === true,
      imageDownload: value?.imageDownload === true,
      videoDownload: value?.videoDownload === true
    };
  } catch { return { nativeScroll: false, noAutoplay: false, anyCopy: false, anyCopyEnhanced: false, imageDownload: false, videoDownload: false }; }
}

async function toolbarTitle(activity) {
  const products = [
    activity.nativeScroll && 'Native Scroll',
    activity.noAutoplay && 'No Autoplay',
    activity.anyCopy && 'Any Copy',
    activity.anyCopyEnhanced && 'Any Copy Enhanced',
    activity.imageDownload && 'Image Download',
    activity.videoDownload && 'Video Download'
  ].filter(Boolean);
  if (!products.length) return 'Cosmic Gemini';
  const stored = await chrome.storage.local.get('interfaceLocale');
  const locale = normalizeLocale(stored.interfaceLocale || chrome.i18n.getUILanguage());
  const name = products.length === 1 ? products[0] : 'Cosmic Gemini';
  return locale === 'zh-CN' ? name + ' · 正在处理此页面' : name + ' · Working on this page';
}

async function renderToolbar(tabId, activity) {
  if (!Number.isInteger(tabId)) return;
  const active = activity.nativeScroll || activity.noAutoplay || activity.anyCopy || activity.anyCopyEnhanced || activity.imageDownload || activity.videoDownload;
  await Promise.allSettled([
    updateAction('setIcon', { tabId, path: active ? ACTIVE_ICONS : DEFAULT_ICONS }),
    updateAction('setBadgeText', { tabId, text: '' }),
    updateAction('setTitle', { tabId, title: await toolbarTitle(activity) })
  ]);
}

async function setFeatureActivity(tabId, featureId, value) {
  if (!Number.isInteger(tabId) || !Object.values(FEATURE_IDS).includes(featureId)) return;
  const activity = await readActivity(tabId);
  activity[featureId] = value === true;
  const key = activityKey(tabId);
  if (activity.nativeScroll || activity.noAutoplay || activity.anyCopy || activity.anyCopyEnhanced || activity.imageDownload || activity.videoDownload) await chrome.storage.session.set({ [key]: activity });
  else await chrome.storage.session.remove(key);
  await renderToolbar(tabId, activity);
}

async function clearTabActivity(tabId) {
  if (!Number.isInteger(tabId)) return;
  await chrome.storage.session.remove(activityKey(tabId));
  await renderToolbar(tabId, { nativeScroll: false, noAutoplay: false, anyCopy: false, anyCopyEnhanced: false, imageDownload: false, videoDownload: false });
}

async function clearLegacyAudioPromptState() {
  const values = await chrome.storage.session.get(null);
  const keys = Object.keys(values).filter(key => LEGACY_AUDIO_SESSION_PREFIXES.some(prefix => key.startsWith(prefix)));
  if (keys.length) await chrome.storage.session.remove(keys);
  const alarms = await chrome.alarms.getAll();
  await Promise.allSettled(alarms
    .filter(alarm => alarm.name.startsWith(LEGACY_AUDIO_ALARM_PREFIX))
    .map(alarm => chrome.alarms.clear(alarm.name)));
}

function originFromUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}

function runtimeToken() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function withMediaRequestHeaders(candidate, pageUrl, task) {
  const referrer = mediaRequestReferrer(pageUrl);
  const filters = mediaRequestDirectoryFilters(candidate);
  if (!referrer || !filters.length || !chrome.declarativeNetRequest?.updateSessionRules) return task();
  const existing = new Set((await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id));
  const rules = filters.map(urlFilter => {
    do {
      nextMediaHeaderRuleId += 1;
      if (nextMediaHeaderRuleId > 2_000_000_000) nextMediaHeaderRuleId = 700001;
    } while (existing.has(nextMediaHeaderRuleId));
    existing.add(nextMediaHeaderRuleId);
    return {
      id: nextMediaHeaderRuleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ operation: 'set', header: 'Referer', value: referrer }]
      },
      condition: { urlFilter, resourceTypes: ['xmlhttprequest'] }
    };
  });
  const ruleIds = rules.map(rule => rule.id);
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
  try { return await task(); }
  finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds }).catch(() => {});
  }
}

async function readVideoPageMetadata(tabId) {
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      injectImmediately: true,
      func: () => {
        const content = selector => document.querySelector(selector)?.getAttribute('content') || '';
        const title = content('meta[property="og:title"]')
          || content('meta[name="twitter:title"]') || document.title || '';
        const rawThumbnail = content('meta[property="og:image"]')
          || content('meta[property="og:image:url"]')
          || content('meta[name="twitter:image"]')
          || document.querySelector('link[rel="image_src"]')?.href
          || document.querySelector('video[poster]')?.poster || '';
        let thumbnailUrl = '';
        try {
          const resolved = new URL(rawThumbnail, location.href);
          if (['http:', 'https:'].includes(resolved.protocol)) thumbnailUrl = resolved.href;
        } catch {}
        return { title: String(title).trim().slice(0, 240), thumbnailUrl };
      }
    });
    return frames.find(frame => frame.frameId === 0)?.result || frames[0]?.result || {};
  } catch { return {}; }
}

function bytesFromBase64(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readVideoSession(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    const key = videoSessionKey(tabId);
    const session = (await chrome.storage.session.get(key))[key];
    if (session?.active === true) {
      activeVideoTabs.add(tabId);
      return session;
    }
    activeVideoTabs.delete(tabId);
    return null;
  } catch { return null; }
}

async function saveVideoSession(session) {
  if (!session?.active || !Number.isInteger(session.tabId)) return;
  activeVideoTabs.add(session.tabId);
  await chrome.storage.session.set({ [videoSessionKey(session.tabId)]: session });
}

function sortVideoCandidates(candidates) {
  const kindRank = { muxed: 0, direct: 1, hls: 2, dash: 3, audio: 4, subtitle: 5 };
  return [...candidates].sort((a, b) =>
    Number(b.downloadable) - Number(a.downloadable) ||
    (b.height || 0) - (a.height || 0) ||
    (b.bandwidth || 0) - (a.bandwidth || 0) ||
    (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9) ||
    a.id.localeCompare(b.id));
}

function isBilibiliVideoUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')
      || hostname === 'bilibili.tv' || hostname.endsWith('.bilibili.tv');
  } catch { return false; }
}

function isYoutubeVideoUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  } catch { return false; }
}

async function discoverBilibiliCandidates(tabId, pageUrl) {
  if (!isBilibiliVideoUrl(pageUrl)) return [];
  const frames = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    injectImmediately: true,
    func: bilibiliPageContext
  });
  let context = frames.find(frame => frame.frameId === 0)?.result || frames[0]?.result;
  context = await completeBilibiliPageContext(context, requestBilibiliJson);
  const embedded = context?.playInfo?.data?.dash || context?.playInfo?.result?.dash || context?.playInfo?.dash;
  const standard = embedded || (context?.cid && (context.bvid || context.aid));
  const international = context?.internationalEpisodeId || context?.internationalAid;
  if (!standard && !international) return [];
  const playInfo = await fetchBilibiliPlayInfo(context, requestBilibiliJson);
  const candidates = bilibiliDashCandidates(playInfo, context);
  if (candidates.length) await addVideoCandidates(tabId, candidates, false);
  return candidates;
}

async function discoverYoutubeCandidates(tabId, pageUrl) {
  if (!isYoutubeVideoUrl(pageUrl)) return [];
  const frames = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    injectImmediately: true,
    func: youtubePageContext
  });
  const context = frames.find(frame => frame.frameId === 0)?.result || frames[0]?.result;
  if (!context?.videoId) return [];
  const candidates = await sendVideoOffscreen({ type: 'CG_VIDEO_DISCOVER_YOUTUBE', context, pageUrl });
  if (Array.isArray(candidates) && candidates.length) await addVideoCandidates(tabId, candidates);
  return Array.isArray(candidates) ? candidates : [];
}

async function discoverAdapterCandidates(tabId) {
  const frames = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    injectImmediately: true,
    func: siteVideoPageDiscovery
  });
  const result = frames.find(frame => frame.frameId === 0)?.result || frames[0]?.result || {};
  if (Array.isArray(result.candidates) && result.candidates.length) {
    await addVideoCandidates(tabId, result.candidates);
  }
  if (Array.isArray(result.manifests) && result.manifests.length) {
    await addInlineVideoManifests(tabId, result.manifests);
  }
  return [...(result.candidates || []), ...(result.manifests || [])];
}

async function discoverSiteVideoCandidates(tabId, pageUrl) {
  const tasks = [discoverAdapterCandidates(tabId)];
  if (isBilibiliVideoUrl(pageUrl)) tasks.push(discoverBilibiliCandidates(tabId, pageUrl));
  if (isYoutubeVideoUrl(pageUrl)) tasks.push(discoverYoutubeCandidates(tabId, pageUrl));
  const results = await Promise.allSettled(tasks);
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

async function updateVideoCandidate(tabId, candidateId, update) {
  const session = await readVideoSession(tabId);
  if (!session) return null;
  const index = session.candidates.findIndex(candidate => candidate.id === candidateId);
  if (index < 0) return null;
  const current = session.candidates[index];
  session.candidates[index] = typeof update === 'function' ? update(current) : { ...current, ...update };
  session.updatedAt = Date.now();
  await saveVideoSession(session);
  return session.candidates[index];
}

async function expandHlsCandidate(tabId, candidate) {
  const expansionKey = `${tabId}:${candidate.url}:${candidate.inlineId || ''}`;
  if (expandingVideoManifests.has(expansionKey)) return;
  expandingVideoManifests.add(expansionKey);
  try {
    const session = await readVideoSession(tabId);
    if (!session) return;
    let manifestUrl = candidate.manifestBaseUrl || candidate.manifestUrl || candidate.url;
    let text = candidate.manifestText || '';
    if (!text) {
      const response = await withMediaRequestHeaders(candidate, session.pageUrl, () => fetch(candidate.url, {
        cache: 'no-store',
        credentials: 'include',
        redirect: 'follow'
      }));
      if (!response.ok) return;
      manifestUrl = response.url || candidate.url;
      text = await response.text();
    }
    const variants = parseHlsMaster(text, manifestUrl);
    if (!variants.length) {
      const media = parseHlsMedia(text, manifestUrl);
      if (media.duration > 0) {
        await updateVideoCandidate(tabId, candidate.id, value => ({
          ...value,
          duration: Math.max(Number(value.duration) || 0, media.duration),
          downloadable: !media.unsupportedEncryption,
          protected: media.unsupportedEncryption
        }));
      }
      return;
    }
    await updateVideoCandidate(tabId, candidate.id, value => ({ ...value, downloadable: false, master: true }));
    await addVideoCandidates(tabId, variants.map(variant => ({
      ...variant,
      kind: 'hls',
      source: 'hls-variant',
      title: session.title
    })), false);
    for (const variant of variants) {
      const normalized = classifyVideoResource({
        ...variant,
        kind: 'hls',
        source: 'hls-variant',
        title: session.title
      });
      if (normalized) void expandHlsCandidate(tabId, normalized);
    }
  } catch {}
  finally { expandingVideoManifests.delete(expansionKey); }
}

async function addInlineVideoManifests(tabId, manifests) {
  const session = await readVideoSession(tabId);
  if (!session || !Array.isArray(manifests)) return session;
  const candidates = [];
  for (const item of manifests.slice(0, 12)) {
    const kind = item?.kind === 'dash' ? 'dash' : item?.kind === 'hls' ? 'hls' : '';
    const manifestText = String(item?.manifestText || '').slice(0, 2 * 1024 * 1024);
    const manifestBaseUrl = originFromUrl(item?.baseUrl) ? String(item.baseUrl) : session.pageUrl;
    if (!kind || !manifestText) continue;
    candidates.push({
      url: manifestBaseUrl,
      kind,
      source: String(item.source || 'inline-manifest'),
      title: session.title,
      manifestText,
      manifestBaseUrl,
      inlineId: String(item.inlineId || runtimeToken()),
      downloadable: kind === 'hls'
    });
  }
  return addVideoCandidates(tabId, candidates);
}

async function expandDashCandidate(tabId, candidate) {
  const expansionKey = `${tabId}:dash:${candidate.url}:${candidate.inlineId || ''}`;
  if (expandingVideoManifests.has(expansionKey)) return;
  expandingVideoManifests.add(expansionKey);
  try {
    const session = await readVideoSession(tabId);
    if (!session) return;
    await updateVideoCandidate(tabId, candidate.id, value => ({ ...value, master: true }));
    const variants = await withMediaRequestHeaders(candidate, session.pageUrl, () => sendVideoOffscreen({
      type: 'CG_VIDEO_EXPAND_DASH',
      candidate: { ...candidate, manifestUrl: candidate.url },
      pageUrl: session.pageUrl
    }));
    if (Array.isArray(variants) && variants.length) await addVideoCandidates(tabId, variants, false);
  } catch {}
  finally { expandingVideoManifests.delete(expansionKey); }
}

async function addVideoCandidates(tabId, rawCandidates, expand = true) {
  const session = await readVideoSession(tabId);
  if (!session || !Array.isArray(rawCandidates)) return session;
  const byId = new Map(session.candidates.map(candidate => [candidate.id, candidate]));
  const addedHls = [];
  const addedDash = [];
  for (const raw of rawCandidates.slice(0, 100)) {
    const candidate = classifyVideoResource({ ...raw, title: raw.title || session.title });
    if (!candidate) continue;
    const existing = byId.get(candidate.id);
    const merged = mergeVideoCandidate(existing, candidate);
    byId.set(candidate.id, merged);
    if (!existing && merged.kind === 'hls') addedHls.push(merged);
    if (!existing && merged.kind === 'dash' && merged.source !== 'dash-variant') addedDash.push(merged);
  }
  session.candidates = sortVideoCandidates([...byId.values()]).slice(0, 80);
  session.updatedAt = Date.now();
  session.status = session.candidates.some(candidate => !candidate.master) ? 'found' : 'scanning';
  await saveVideoSession(session);
  await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, session.status === 'found');
  if (expand) for (const candidate of addedHls) void expandHlsCandidate(tabId, candidate);
  if (expand) for (const candidate of addedDash) void expandDashCandidate(tabId, candidate);
  return session;
}

async function injectVideoScanner(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/video-download-page.js'],
      world: 'MAIN',
      injectImmediately: true
    });
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/video-download-scanner.js'],
      world: 'ISOLATED',
      injectImmediately: true
    });
    const candidates = frames.flatMap(frame => Array.isArray(frame.result) ? frame.result : []);
    if (candidates.length) await addVideoCandidates(tabId, candidates);
    return true;
  } catch { return false; }
}

async function startVideoSession(tabId, url, title = '') {
  if (!Number.isInteger(tabId)) throw new Error('This tab is unavailable.');
  const origin = originFromUrl(url);
  if (!origin) throw new Error('Video Download is unavailable on this page.');
  const existing = await readVideoSession(tabId);
  if (existing?.origin === origin) {
    const metadata = await readVideoPageMetadata(tabId);
    existing.pageUrl = url;
    existing.title = metadata.title || title || existing.title;
    existing.thumbnailUrl = metadata.thumbnailUrl || existing.thumbnailUrl || '';
    await saveVideoSession(existing);
    await Promise.allSettled([
      injectVideoScanner(tabId),
      discoverSiteVideoCandidates(tabId, url)
    ]);
    return readVideoSession(tabId);
  }
  if (existing) await stopVideoSession(tabId);
  const metadata = await readVideoPageMetadata(tabId);
  const session = {
    active: true,
    tabId,
    origin,
    pageUrl: url,
    title: String(metadata.title || title || 'Video').slice(0, 240),
    thumbnailUrl: String(metadata.thumbnailUrl || ''),
    status: 'scanning',
    candidates: [],
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveVideoSession(session);
  await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, false);
  const [injected, site] = await Promise.allSettled([
    injectVideoScanner(tabId),
    discoverSiteVideoCandidates(tabId, url)
  ]);
  const siteFound = site.status === 'fulfilled' && site.value.length > 0;
  if ((injected.status !== 'fulfilled' || injected.value !== true) && !siteFound) {
    const current = await readVideoSession(tabId);
    if (current && !current.candidates.length) {
      current.status = 'unavailable';
      await saveVideoSession(current);
    }
  }
  return readVideoSession(tabId);
}

async function stopVideoSession(tabId) {
  if (!Number.isInteger(tabId)) return;
  const session = await readVideoSession(tabId);
  await sendTabMessage(tabId, { type: 'CG_VIDEO_STOP' });
  const artifacts = [...new Set((session?.candidates || []).map(candidate => candidate.artifactId).filter(Boolean))];
  await Promise.allSettled(artifacts.map(artifactId => sendVideoOffscreen({
    type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId
  })));
  await activeVideoTabsReady;
  activeVideoTabs.delete(tabId);
  await chrome.storage.session.remove(videoSessionKey(tabId));
  await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, false);
  await maybeCloseVideoOffscreen();
}

async function videoDownloadState(settings, tabId, url) {
  const supported = !!originFromUrl(url);
  const session = await readVideoSession(tabId);
  const active = supported && session?.origin === originFromUrl(url);
  return {
    ...settings.videoDownload,
    supported,
    active,
    status: active ? session.status : 'off',
    candidates: active ? session.candidates : [],
    title: active ? session.title : '',
    thumbnailUrl: active ? session.thumbnailUrl || '' : '',
    startedAt: active ? session.startedAt : 0
  };
}

function candidateExtension(candidate) {
  if (/^[a-z0-9]{2,5}$/i.test(candidate.extension || '')) return candidate.extension.toLowerCase();
  const mime = String(candidate.mime || '').toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  return 'mp4';
}

async function ensureVideoOffscreenDocument() {
  const path = 'offscreen/video-download.html';
  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(path)]
    });
    if (contexts.length) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: path,
      reasons: ['BLOBS'],
      justification: 'Assemble user-requested video segments into a local downloadable file.'
    });
  } catch (error) {
    if (!String(error?.message || '').includes('single offscreen')) throw error;
  }
}

async function sendVideoOffscreen(message) {
  await ensureVideoOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ ...message, target: 'video-download-offscreen' });
  if (!response?.ok) {
    const error = new Error(response?.error || 'Video processing failed.');
    error.cancelled = response?.cancelled === true;
    throw error;
  }
  return response.result;
}

async function maybeCloseVideoOffscreen() {
  if (activeVideoAssemblies > 0) return;
  const values = await chrome.storage.session.get(null);
  const hasArtifact = Object.entries(values).some(([key, session]) =>
    (key.startsWith('videoDownloadSession:') && session?.candidates?.some(candidate => candidate.artifactId))
    || (key.startsWith('imageDownloadArtifact:') && session?.artifactId)
    || (key.startsWith('imageCaptureArtifact:') && session?.artifactId));
  if (hasArtifact) return;
  try { await chrome.offscreen.closeDocument(); } catch {}
}

async function downloadVideoCandidate(tabId, candidateId) {
  const processingKey = `${tabId}:${candidateId}`;
  if (activeVideoProcessing.has(processingKey)) return { alreadyProcessing: true };
  const session = await readVideoSession(tabId);
  if (!session) throw new Error('Video Download is not active in this tab.');
  let candidate = session.candidates.find(item => item.id === candidateId);
  if (!candidate || candidate.downloadable === false) throw new Error('This video format is not downloadable.');
  if (['preparing', 'downloading', 'complete'].includes(candidate.status)) return { alreadyProcessing: true };
  if (candidate.inlineId && !candidate.manifestText) {
    const manifestSource = session.candidates.find(item => item.inlineId === candidate.inlineId && item.manifestText);
    if (manifestSource) candidate = {
      ...candidate,
      manifestText: manifestSource.manifestText,
      manifestBaseUrl: manifestSource.manifestBaseUrl || candidate.manifestBaseUrl
    };
  }
  const settings = await readSettings();
  if (activeVideoProcessing.has(processingKey)) return { alreadyProcessing: true };
  const requestId = runtimeToken();
  const processing = { requestId, cancelled: false, phase: 'processing' };
  activeVideoProcessing.set(processingKey, processing);
  await updateVideoCandidate(tabId, candidateId, value => ({
    ...value,
    status: 'preparing',
    progress: 0,
    error: '',
    processingRequestId: requestId
  }));
  let artifact = null;
  try {
    let downloadUrl = candidate.url;
    let extension = candidateExtension(candidate);
    if (['direct', 'audio', 'subtitle', 'hls', 'muxed', 'dash'].includes(candidate.kind)) {
      activeVideoAssemblies += 1;
      try {
        artifact = await withMediaRequestHeaders(candidate, session.pageUrl, () => {
          if (processing.cancelled) {
            const error = new Error('Video processing was canceled.');
            error.cancelled = true;
            throw error;
          }
          return sendVideoOffscreen({
            type: ['direct', 'audio', 'subtitle'].includes(candidate.kind) ? 'CG_VIDEO_FETCH_DIRECT'
              : candidate.kind === 'hls'
              ? (candidate.audioUrl ? 'CG_VIDEO_MUX_TRACKS' : 'CG_VIDEO_ASSEMBLE_HLS')
              : candidate.kind === 'dash' ? 'CG_VIDEO_ASSEMBLE_DASH' : 'CG_VIDEO_MUX_TRACKS',
            requestId,
            tabId,
            candidate,
            pageUrl: session.pageUrl,
            preferredQuality: settings.videoDownload.preferredQuality
          });
        });
      } finally { activeVideoAssemblies -= 1; }
      downloadUrl = artifact.url;
      extension = artifact.extension;
    }
    if (processing.cancelled) {
      const error = new Error('Video processing was canceled.');
      error.cancelled = true;
      throw error;
    }
    processing.phase = 'handoff';
    const sourceTitle = String(session.title || candidate.title || 'Video').trim();
    const downloadTitle = candidate.kind === 'subtitle' && candidate.languageLabel
      ? `${sourceTitle} · ${candidate.languageLabel}` : sourceTitle;
    const filename = sanitizeVideoFilename(downloadTitle, extension);
    pendingVideoFilenames.set(downloadUrl, filename);
    let downloadId;
    try {
      downloadId = await chrome.downloads.download({
        url: downloadUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: settings.videoDownload.askWhereToSave
      });
    } finally {
      setTimeout(() => pendingVideoFilenames.delete(downloadUrl), 30_000);
    }
    await updateVideoCandidate(tabId, candidateId, value => ({
      ...value,
      status: 'downloading',
      progress: 100,
      processingRequestId: '',
      downloadId,
      artifactId: artifact?.artifactId || '',
      outputBytes: artifact?.bytes || value.contentLength || 0,
      outputExtension: extension,
      liveSnapshot: artifact?.liveSnapshot === true
    }));
    return { downloadId };
  } catch (error) {
    if (artifact?.artifactId) {
      await sendVideoOffscreen({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: artifact.artifactId }).catch(() => {});
    }
    const cancelled = processing.cancelled || error?.cancelled === true || error?.name === 'AbortError';
    await updateVideoCandidate(tabId, candidateId, value => {
      if (value.processingRequestId && value.processingRequestId !== requestId) return value;
      return {
        ...value,
        status: cancelled ? 'ready' : 'failed',
        progress: 0,
        processingRequestId: '',
        error: cancelled ? '' : String(error?.message || 'Video download failed.').slice(0, 240)
      };
    });
    await maybeCloseVideoOffscreen();
    if (!cancelled) throw error;
    return { cancelled: true };
  } finally {
    if (activeVideoProcessing.get(processingKey) === processing) activeVideoProcessing.delete(processingKey);
  }
}

async function cancelVideoProcessing(tabId, candidateId) {
  const processingKey = `${tabId}:${candidateId}`;
  const active = activeVideoProcessing.get(processingKey);
  if (active && active.phase !== 'processing') return { cancelled: false };
  const session = await readVideoSession(tabId);
  const candidate = session?.candidates?.find(item => item.id === candidateId);
  if (!candidate || candidate.status !== 'preparing') return { cancelled: false };
  const requestId = active?.requestId || String(candidate.processingRequestId || '');
  if (active) active.cancelled = true;
  await updateVideoCandidate(tabId, candidateId, value => {
    if (requestId && value.processingRequestId && value.processingRequestId !== requestId) return value;
    return { ...value, status: 'ready', progress: 0, error: '', processingRequestId: '' };
  });
  if (requestId) {
    await sendVideoOffscreen({ type: 'CG_VIDEO_CANCEL_REQUEST', requestId }).catch(() => {});
  }
  return { cancelled: true };
}

async function updateVideoDownloadProgress(tabId, candidateId, requestId, progress) {
  await updateVideoCandidate(tabId, candidateId, value => {
    if (value.status !== 'preparing' || value.processingRequestId !== requestId) return value;
    return {
      ...value,
      progress: Math.max(0, Math.min(100, Number(progress) || 0))
    };
  });
}

async function handleVideoDownloadChanged(delta) {
  if (!Number.isInteger(delta?.id) || !delta.state?.current) return;
  const all = await chrome.storage.session.get(null);
  for (const [key, session] of Object.entries(all)) {
    if (!key.startsWith('videoDownloadSession:') || !session?.active) continue;
    const candidate = session.candidates?.find(item => item.downloadId === delta.id);
    if (!candidate) continue;
    candidate.status = delta.state.current === 'complete' ? 'complete' : 'failed';
    candidate.error = delta.error?.current || '';
    session.updatedAt = Date.now();
    await chrome.storage.session.set({ [key]: session });
    if (candidate.artifactId) {
      await sendVideoOffscreen({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: candidate.artifactId }).catch(() => {});
      candidate.artifactId = '';
      await chrome.storage.session.set({ [key]: session });
      await maybeCloseVideoOffscreen();
    }
  }
}

async function readImageSession(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    const key = imageSessionKey(tabId);
    const session = (await chrome.storage.session.get(key))[key];
    if (session?.active === true) {
      activeImageTabs.add(tabId);
      return session;
    }
    activeImageTabs.delete(tabId);
    return null;
  } catch { return null; }
}

async function saveImageSession(session) {
  if (!session?.active || !Number.isInteger(session.tabId)) return;
  activeImageTabs.add(session.tabId);
  await chrome.storage.session.set({ [imageSessionKey(session.tabId)]: session });
}

function sortImageCandidates(candidates) {
  return [...candidates].sort((a, b) =>
    (b.score || 0) - (a.score || 0)
    || (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
    || a.url.localeCompare(b.url));
}

async function addImageCandidates(tabId, rawCandidates) {
  const session = await readImageSession(tabId);
  if (!session || !Array.isArray(rawCandidates)) return session;
  const byUrl = new Map((session.candidates || []).map(candidate => [candidate.url, candidate]));
  for (const raw of rawCandidates.slice(0, 1600)) {
    const candidate = normalizeImageCandidate(raw);
    if (!candidate) continue;
    byUrl.set(candidate.url, mergeImageCandidate(byUrl.get(candidate.url), candidate));
  }
  session.candidates = sortImageCandidates([...byUrl.values()]).slice(0, 1200);
  session.status = session.candidates.length ? 'found' : 'scanning';
  session.updatedAt = Date.now();
  await saveImageSession(session);
  await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, session.status === 'found');
  return session;
}

async function scanImageSession(tabId, deep = false) {
  const session = await readImageSession(tabId);
  if (!session) throw new Error('Image Download is not active in this tab.');
  session.status = 'scanning';
  session.updatedAt = Date.now();
  await saveImageSession(session);
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'ISOLATED',
      injectImmediately: true,
      func: imagePageDiscovery,
      args: [{ deep }]
    });
    const candidates = [];
    for (const frame of frames) {
      const result = frame.result;
      if (!result || !Array.isArray(result.candidates)) continue;
      if (frame.frameId === 0) {
        session.pageUrl = result.pageUrl || session.pageUrl;
        session.title = String(result.pageTitle || session.title).slice(0, 240);
      }
      for (const candidate of result.candidates) {
        candidates.push({
          ...candidate,
          familyKey: `${frame.frameId}:${candidate.familyKey || candidate.url}`,
          frameUrl: candidate.frameUrl || result.frameUrl
        });
      }
    }
    await saveImageSession(session);
    const updated = await addImageCandidates(tabId, candidates);
    if (updated && !updated.candidates.length) {
      updated.status = 'empty';
      updated.updatedAt = Date.now();
      await saveImageSession(updated);
    }
    return readImageSession(tabId);
  } catch (error) {
    const current = await readImageSession(tabId);
    if (current && !current.candidates.length) {
      current.status = 'unavailable';
      current.updatedAt = Date.now();
      await saveImageSession(current);
    }
    throw error;
  }
}

async function startImageSession(tabId, url, title = '') {
  if (!Number.isInteger(tabId)) throw new Error('This tab is unavailable.');
  const origin = originFromUrl(url);
  if (!origin) throw new Error('Image Download is unavailable on this page.');
  const existing = await readImageSession(tabId);
  if (existing?.origin !== origin) await stopImageSession(tabId);
  const session = existing?.origin === origin ? {
    ...existing,
    pageUrl: url,
    title: String(title || existing.title || 'Images').slice(0, 240),
    status: existing.candidates?.length ? 'found' : 'scanning',
    updatedAt: Date.now()
  } : {
    active: true,
    tabId,
    origin,
    pageUrl: url,
    title: String(title || 'Images').slice(0, 240),
    status: 'scanning',
    candidates: [],
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveImageSession(session);
  await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, !!session.candidates.length);
  void scanImageSession(tabId, false).catch(() => {});
  return session;
}

async function cleanupImageCaptureArtifacts(session) {
  if (!session) return;
  const tabId = session.tabId;
  const captureArtifacts = [...new Set((session?.candidates || []).map(candidate => candidate.artifactId).filter(Boolean))];
  for (const artifactId of captureArtifacts) {
    await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId }).catch(() => {});
    await chrome.storage.session.remove(`imageCaptureArtifact:${tabId}:${artifactId}`);
  }
}

async function stopImageSession(tabId) {
  if (!Number.isInteger(tabId)) return;
  const session = await readImageSession(tabId);
  await cleanupImageCaptureArtifacts(session);
  await activeImageTabsReady;
  activeImageTabs.delete(tabId);
  await chrome.storage.session.remove(imageSessionKey(tabId));
  await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, false);
  preparedImageSidePanels.delete(tabId);
  if (session?.workspaceMode === 'sidePanel' && chrome.sidePanel?.setOptions) {
    await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
  }
}

async function beginImageCapture(tabId) {
  const session = await readImageSession(tabId);
  if (!session) throw new Error('Image Download is not active in this tab.');
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/image-capture.js'],
    world: 'ISOLATED',
    injectImmediately: true
  });
  return { started: true };
}

async function completeImageCapture(tabId, rect) {
  const session = await readImageSession(tabId);
  if (!session) throw new Error('Image Download is not active in this tab.');
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const artifact = await sendImageOffscreen({ type: 'CG_IMAGE_CROP_CAPTURE', dataUrl, rect });
  const storedLocale = await chrome.storage.local.get('interfaceLocale');
  const captureTitle = normalizeLocale(storedLocale.interfaceLocale || chrome.i18n.getUILanguage()) === 'zh-CN'
    ? '截取的区域' : 'Captured area';
  await chrome.storage.session.set({
    [`imageCaptureArtifact:${tabId}:${artifact.artifactId}`]: { artifactId: artifact.artifactId }
  });
  await addImageCandidates(tabId, [{
    url: artifact.url,
    familyKey: `capture:${artifact.artifactId}`,
    source: 'canvas',
    width: artifact.width,
    height: artifact.height,
    contentLength: artifact.bytes,
    mime: 'image/png',
    originalHint: 8,
    title: captureTitle,
    artifactId: artifact.artifactId
  }]);
  const updated = await readImageSession(tabId);
  if (Number.isInteger(updated?.workspaceTabId)) {
    const workspace = await chrome.tabs.get(updated.workspaceTabId).catch(() => null);
    if (workspace?.id) {
      await chrome.tabs.update(workspace.id, { active: true });
      if (Number.isInteger(workspace.windowId)) await chrome.windows.update(workspace.windowId, { focused: true });
    }
  }
  return artifact;
}

async function imageDownloadState(settings, tabId, url = '') {
  const session = await readImageSession(tabId);
  const supported = !!originFromUrl(url || session?.pageUrl || '');
  const active = !!session && (!url || session.origin === originFromUrl(url));
  return {
    ...settings.imageDownload,
    supported,
    active,
    status: active ? session.status : 'off',
    sourceTabId: active ? session.tabId : 0,
    pageUrl: active ? session.pageUrl : '',
    title: active ? session.title : '',
    groups: active ? groupImageCandidates(session.candidates || []) : [],
    updatedAt: active ? session.updatedAt : 0,
    startedAt: active ? session.startedAt : 0
  };
}

function imageWorkspaceUrl(tabId, view = 'page') {
  const url = new URL(chrome.runtime.getURL('workspaces/image-download/image-download.html'));
  url.searchParams.set('sourceTab', String(tabId));
  url.searchParams.set('view', view);
  return url.toString();
}

function imageSidePanelPath(tabId) {
  return `workspaces/image-download/image-download.html?sourceTab=${encodeURIComponent(tabId)}&view=side-panel`;
}

async function prepareImageWorkspaceSidePanel(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('The source tab is unavailable.');
  if (!chrome.sidePanel?.setOptions || !chrome.sidePanel?.open) throw new Error('Side Panel is unavailable.');
  const path = imageSidePanelPath(tabId);
  if (preparedImageSidePanels.get(tabId) === path) return;
  await chrome.sidePanel.setOptions({ tabId, path, enabled: true });
  preparedImageSidePanels.set(tabId, path);
}

async function openImageWorkspacePage(tabId) {
  const base = chrome.runtime.getURL('workspaces/image-download/image-download.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => {
    if (!tab.url?.startsWith(base)) return false;
    try { return Number(new URL(tab.url).searchParams.get('sourceTab')) === tabId; }
    catch { return false; }
  });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (Number.isInteger(existing.windowId)) await chrome.windows.update(existing.windowId, { focused: true });
    return existing.id;
  }
  const opened = await chrome.tabs.create({ url: imageWorkspaceUrl(tabId, 'page') });
  return opened.id;
}

async function openImageWorkspaceSidePanel(tabId) {
  if (!chrome.sidePanel?.setOptions || !chrome.sidePanel?.open) throw new Error('Side Panel is unavailable.');
  const path = imageSidePanelPath(tabId);
  if (preparedImageSidePanels.get(tabId) !== path) await prepareImageWorkspaceSidePanel(tabId);
  await chrome.sidePanel.open({ tabId });
}

async function openImageWorkspace(tabId, preferredMode = 'sidePanel') {
  if (preferredMode === 'page') {
    preparedImageSidePanels.delete(tabId);
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
    }
    return { mode: 'page', workspaceTabId: await openImageWorkspacePage(tabId) };
  }
  await openImageWorkspaceSidePanel(tabId);
  return { mode: 'sidePanel', workspaceTabId: 0 };
}

async function updateImageMetadata(tabId, candidateId, metadata = {}) {
  const session = await readImageSession(tabId);
  if (!session) return null;
  const index = session.candidates.findIndex(candidate => candidate.id === candidateId);
  if (index < 0) return null;
  const next = normalizeImageCandidate({ ...session.candidates[index], ...metadata });
  if (!next) return null;
  session.candidates[index] = next;
  session.candidates = sortImageCandidates(session.candidates);
  session.updatedAt = Date.now();
  await saveImageSession(session);
  return next;
}

function imageCandidateFilename(candidate, pageTitle, index, outputFormat) {
  let urlName = '';
  try { urlName = decodeURIComponent(new URL(candidate.url).pathname.split('/').pop() || '').replace(/\.[a-z0-9]{2,5}$/i, ''); }
  catch {}
  const extension = outputFormat !== 'original' ? outputFormat : imageExtension(candidate.url, candidate.mime) || 'jpg';
  const label = candidate.alt || candidate.title || urlName || pageTitle || `Image ${index + 1}`;
  return sanitizeImageFilename(label, extension, index + 1);
}

async function sendImageOffscreen(message) {
  await ensureVideoOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ ...message, target: 'image-download-offscreen' });
  if (!response?.ok) throw new Error(response?.error || 'Image processing failed.');
  return response.result;
}

async function rememberImageArtifact(downloadId, artifactId) {
  if (!Number.isInteger(downloadId) || !artifactId) return;
  await chrome.storage.session.set({ [`imageDownloadArtifact:${downloadId}`]: { artifactId } });
}

async function downloadImageSelections(tabId, selections, options = {}) {
  const session = await readImageSession(tabId);
  if (!session) throw new Error('Image Download is not active in this tab.');
  const settings = await readSettings();
  const groups = groupImageCandidates(session.candidates || []);
  const selected = [];
  for (const selection of Array.isArray(selections) ? selections.slice(0, 500) : []) {
    const group = groups.find(item => item.id === selection.groupId);
    if (!group) continue;
    const candidate = group.candidates.find(item => item.id === selection.candidateId) || group.recommended;
    if (!candidate || selected.some(item => item.candidate.url === candidate.url)) continue;
    selected.push({ group, candidate });
  }
  if (!selected.length) throw new Error('Select at least one image.');
  const outputFormat = ['original', 'jpg', 'png', 'webp'].includes(options.outputFormat)
    ? options.outputFormat : settings.imageDownload.outputFormat;
  const batchMode = options.batchMode === 'separate' ? 'separate'
    : options.batchMode === 'zip' ? 'zip' : settings.imageDownload.batchMode;
  const files = selected.map((item, index) => ({
    candidate: item.candidate,
    filename: imageCandidateFilename(item.candidate, session.title, index, outputFormat)
  }));
  if (files.length > 1 && batchMode === 'zip') {
    const artifact = await sendImageOffscreen({
      type: 'CG_IMAGE_CREATE_ZIP',
      files,
      pageUrl: session.pageUrl,
      outputFormat
    });
    const downloadId = await chrome.downloads.download({
      url: artifact.url,
      filename: sanitizeImageFilename(`${session.title || 'Images'} Images`, 'zip'),
      saveAs: settings.imageDownload.askWhereToSave
    });
    await rememberImageArtifact(downloadId, artifact.artifactId);
    return { downloadIds: [downloadId], count: files.length };
  }
  const downloadIds = [];
  for (let index = 0; index < files.length; index += 1) {
    const artifact = await sendImageOffscreen({
      type: 'CG_IMAGE_FETCH',
      file: files[index],
      pageUrl: session.pageUrl,
      outputFormat
    });
    const downloadId = await chrome.downloads.download({
      url: artifact.url,
      filename: artifact.filename || files[index].filename,
      saveAs: settings.imageDownload.askWhereToSave && files.length === 1
    });
    await rememberImageArtifact(downloadId, artifact.artifactId);
    downloadIds.push(downloadId);
  }
  return { downloadIds, count: files.length };
}

async function handleImageDownloadChanged(delta) {
  if (!Number.isInteger(delta?.id) || !delta.state?.current) return;
  if (!['complete', 'interrupted'].includes(delta.state.current)) return;
  const key = `imageDownloadArtifact:${delta.id}`;
  const artifact = (await chrome.storage.session.get(key))[key];
  if (!artifact?.artifactId) return;
  await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId: artifact.artifactId }).catch(() => {});
  await chrome.storage.session.remove(key);
  await maybeCloseVideoOffscreen();
}

async function stateFor(settings, featureId, url) {
  if (featureId === FEATURE_IDS.ANY_COPY) return anyCopyState(settings, url);
  if (featureId === FEATURE_IDS.ANY_COPY_ENHANCED) return anyCopyEnhancedState(settings, url);
  return featureState(settings, featureId, url);
}

async function pageStates(url, tabId) {
  const settings = await readSettings();
  const [nativeScroll, noAutoplay, anyCopy, anyCopyEnhanced, imageDownload, videoDownload, activity] = await Promise.all([
    stateFor(settings, FEATURE_IDS.NATIVE_SCROLL, url),
    stateFor(settings, FEATURE_IDS.NO_AUTOPLAY, url),
    stateFor(settings, FEATURE_IDS.ANY_COPY, url),
    stateFor(settings, FEATURE_IDS.ANY_COPY_ENHANCED, url),
    imageDownloadState(settings, tabId, url),
    videoDownloadState(settings, tabId, url),
    readActivity(tabId)
  ]);
  return { nativeScroll, noAutoplay, anyCopy, anyCopyEnhanced, imageDownload, videoDownload, satellites: settings.satellites, activity };
}

async function requestBilibiliJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('Bilibili request failed.');
  return response.json();
}

async function scheduleBiliDailyLogin(when) {
  await chrome.alarms.create(BILI_DAILY_ALARM, { when: Math.max(Date.now() + 1_000, Number(when)) });
}

async function ensureBiliDailySchedule() {
  const settings = await readSettings();
  const feature = settings.satellites.biliDailyLogin;
  if (!feature.enabled) {
    await chrome.alarms.clear(BILI_DAILY_ALARM);
    await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
    return;
  }
  const existing = await chrome.alarms.get(BILI_DAILY_ALARM);
  if (existing?.scheduledTime > Date.now()) return;
  const completedToday = feature.lastCompletedDate === bilibiliDateKey();
  await scheduleBiliDailyLogin(completedToday ? nextBilibiliSchedule() : Date.now() + 1_000);
}

async function runBiliDailyLogin() {
  const settings = await readSettings();
  const feature = settings.satellites.biliDailyLogin;
  const today = bilibiliDateKey();
  if (!feature.enabled) {
    await chrome.alarms.clear(BILI_DAILY_ALARM);
    await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
    return;
  }
  if (feature.lastCompletedDate === today) {
    await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
    await scheduleBiliDailyLogin(nextBilibiliSchedule());
    return;
  }

  if (browserReportsOffline()) {
    await scheduleBiliDailyLogin(Math.min(Date.now() + BILI_DAILY_RETRY_MS, nextBilibiliSchedule()));
    return;
  }

  const storedRetry = (await chrome.storage.session.get(BILI_DAILY_RETRY_KEY))[BILI_DAILY_RETRY_KEY];
  const attempts = storedRetry?.date === today ? Number(storedRetry.attempts || 0) : 0;
  if (attempts >= BILI_DAILY_MAX_ATTEMPTS) {
    await scheduleBiliDailyLogin(nextBilibiliSchedule());
    return;
  }
  const nextAttempts = attempts + 1;
  await chrome.storage.session.set({
    [BILI_DAILY_RETRY_KEY]: { date: today, attempts: nextAttempts }
  });

  let completed = false;
  try {
    const account = await requestBilibiliJson('https://api.bilibili.com/x/web-interface/nav');
    if (account?.code === 0 && account?.data?.isLogin === true) {
      const reward = await requestBilibiliJson('https://api.bilibili.com/x/member/web/exp/reward');
      completed = reward?.code === 0 && reward?.data?.login === true;
    }
  } catch {}

  if (completed) {
    await mutateSettings(current => ({
      ...current,
      satellites: {
        ...current.satellites,
        biliDailyLogin: { ...current.satellites.biliDailyLogin, lastCompletedDate: today }
      }
    }), false);
    await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
    await scheduleBiliDailyLogin(nextBilibiliSchedule());
    return;
  }
  await scheduleBiliDailyLogin(nextAttempts < BILI_DAILY_MAX_ATTEMPTS
    ? Math.min(Date.now() + BILI_DAILY_RETRY_MS, nextBilibiliSchedule())
    : nextBilibiliSchedule());
}

function runBiliDailyLoginOnce() {
  if (biliDailyRun) return biliDailyRun;
  biliDailyRun = runBiliDailyLogin().finally(() => { biliDailyRun = null; });
  return biliDailyRun;
}

function validFeatureId(value) {
  if (!Object.values(FEATURE_IDS).includes(value)) throw new Error('Unknown feature.');
  return value;
}

function validList(featureId, value) {
  if (!FEATURE_LISTS.has(value)) throw new Error('Unknown rule list.');
  if ([FEATURE_IDS.IMAGE_DOWNLOAD, FEATURE_IDS.VIDEO_DOWNLOAD].includes(featureId)) throw new Error('This product does not use website rule lists.');
  if (value === 'permanentAudioAllowRules' && featureId !== FEATURE_IDS.NO_AUTOPLAY) throw new Error('That rule list is unavailable.');
  if (value === 'siteRules' && ![FEATURE_IDS.ANY_COPY, FEATURE_IDS.ANY_COPY_ENHANCED].includes(featureId)) throw new Error('That rule list is unavailable.');
  if ([FEATURE_IDS.ANY_COPY, FEATURE_IDS.ANY_COPY_ENHANCED].includes(featureId) && value !== 'siteRules') throw new Error('That rule list is unavailable.');
  if ([FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY].includes(featureId)
    && !['enabledRules', 'whitelistRules', 'enhancedRules', 'standardRules', 'permanentAudioAllowRules'].includes(value)) {
    throw new Error('That rule list is unavailable.');
  }
  return value;
}

async function updateFeatureRules(featureId, listName, update) {
  return mutateSettings(settings => updateFeature(settings, featureId, feature => ({
    ...feature,
    [listName]: update(feature[listName] || [])
  })));
}

function withoutRule(rules, rule) {
  return (Array.isArray(rules) ? rules : []).filter(item => item !== rule);
}

function withRule(rules, rule) {
  const current = withoutRule(rules, rule);
  return [...current, rule];
}

async function resetAllSettings() {
  for (const processing of activeVideoProcessing.values()) {
    processing.cancelled = true;
    if (processing.requestId) {
      void sendVideoOffscreen({ type: 'CG_VIDEO_CANCEL_REQUEST', requestId: processing.requestId }).catch(() => {});
    }
  }
  await Promise.allSettled([activeVideoTabsReady, activeImageTabsReady]);
  await Promise.allSettled([
    ...[...activeVideoTabs].map(tabId => stopVideoSession(tabId)),
    ...[...activeImageTabs].map(tabId => stopImageSession(tabId))
  ]);
  await chrome.alarms.clear(BILI_DAILY_ALARM);
  await chrome.storage.session.clear();
  await chrome.storage.local.remove([SETTINGS_KEY, LEGACY_SETTINGS_KEY, 'interfaceLocale']);
  const settings = await saveSettings(DEFAULT_SETTINGS);
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => renderToolbar(tab.id, {
    nativeScroll: false,
    noAutoplay: false,
    anyCopy: false,
    anyCopyEnhanced: false,
    imageDownload: false,
    videoDownload: false
  })));
  await refreshOpenPages();
  return settings;
}

chrome.runtime.onInstalled.addListener(() => {
  void Promise.allSettled([ensureSettings().then(ensureBiliDailySchedule), clearLegacyAudioPromptState()]);
});
chrome.runtime.onStartup.addListener(() => {
  void Promise.allSettled([ensureSettings().then(ensureBiliDailySchedule), clearLegacyAudioPromptState()]);
});
void clearLegacyAudioPromptState().catch(() => {});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.url) void clearTabActivity(tabId);
  void (async () => {
    const videoSession = await readVideoSession(tabId);
    if (videoSession) {
      if (change.url) {
        const nextOrigin = originFromUrl(change.url);
        if (!nextOrigin || nextOrigin !== videoSession.origin) {
          await stopVideoSession(tabId);
        } else {
          videoSession.pageUrl = change.url;
          videoSession.title = tab.title || videoSession.title;
          videoSession.candidates = [];
          videoSession.status = 'scanning';
          videoSession.updatedAt = Date.now();
          await saveVideoSession(videoSession);
          await injectVideoScanner(tabId);
        }
      }
      if (change.status === 'complete' && await readVideoSession(tabId)) {
        await Promise.allSettled([
          injectVideoScanner(tabId),
          discoverSiteVideoCandidates(tabId, videoSession.pageUrl)
        ]);
      }
    }

    const imageSession = await readImageSession(tabId);
    if (imageSession) {
      if (change.url) {
        const nextOrigin = originFromUrl(change.url);
        if (!nextOrigin || nextOrigin !== imageSession.origin) {
          await stopImageSession(tabId);
        } else {
          imageSession.pageUrl = change.url;
          imageSession.title = tab.title || imageSession.title;
          await cleanupImageCaptureArtifacts(imageSession);
          imageSession.candidates = [];
          imageSession.status = 'scanning';
          imageSession.updatedAt = Date.now();
          await saveImageSession(imageSession);
        }
      }
      if (change.status === 'complete' && await readImageSession(tabId)) {
        await scanImageSession(tabId, false).catch(() => {});
      }
    }
  })().catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.storage.session.remove(activityKey(tabId));
  void chrome.storage.session.remove(videoSessionKey(tabId));
  void stopImageSession(tabId).catch(() => {});
  void activeVideoTabsReady.then(() => activeVideoTabs.delete(tabId));
});

chrome.downloads.onChanged.addListener(delta => {
  void handleVideoDownloadChanged(delta).catch(() => {});
  void handleImageDownloadChanged(delta).catch(() => {});
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const sourceUrl = [item.url, item.finalUrl].find(value => pendingVideoFilenames.has(value));
  if (!sourceUrl) return;
  const filename = pendingVideoFilenames.get(sourceUrl);
  pendingVideoFilenames.delete(sourceUrl);
  suggest({ filename, conflictAction: 'uniquify' });
});

chrome.webRequest.onHeadersReceived.addListener(details => {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  void activeVideoTabsReady.then(() => {
    if (!activeVideoTabs.has(details.tabId)) return;
    const candidate = classifyVideoResource({
      url: details.url,
      responseHeaders: details.responseHeaders,
      source: 'network'
    });
    if (candidate) void addVideoCandidates(details.tabId, [candidate]).catch(() => {});
  });
}, {
  urls: ['http://*/*', 'https://*/*'],
  types: ['media', 'xmlhttprequest', 'other']
}, ['responseHeaders']);

chrome.webRequest.onHeadersReceived.addListener(details => {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  void activeImageTabsReady.then(() => {
    if (!activeImageTabs.has(details.tabId)) return;
    const mime = imageMimeFromHeaders(details.responseHeaders);
    if (!mime && !imageExtension(details.url)) return;
    void addImageCandidates(details.tabId, [{
      url: details.url,
      mime,
      contentLength: imageContentLength(details.responseHeaders),
      source: 'network',
      originalHint: 1
    }]).catch(() => {});
  });
}, {
  urls: ['http://*/*', 'https://*/*'],
  types: ['image']
}, ['responseHeaders']);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === BILI_DAILY_ALARM) {
    void runBiliDailyLoginOnce().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (['video-download-offscreen', 'image-download-offscreen'].includes(message?.target)) return false;
  void (async () => {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid extension message.');
    const senderUrl = sender.tab?.url || message.url || '';
    const senderExtensionUrl = String(sender.url || '');
    const senderTabId = sender.tab?.id;

    if (message.type === 'CG_PAGE_STATE') {
      sendResponse({ ok: true, result: await pageStates(senderUrl, senderTabId) });
      return;
    }
    if (message.type === 'CG_FEATURE_INTERVENED') {
      const featureId = validFeatureId(message.featureId);
      const settings = await readSettings();
      const state = await stateFor(settings, featureId, senderUrl);
      if (state.active) await setFeatureActivity(senderTabId, featureId, true);
      sendResponse({ ok: true, result: { recorded: state.active } });
      return;
    }
    if (message.type === 'CG_CONFIG_APPLIED') {
      const featureId = validFeatureId(message.featureId);
      if (message.active !== true) await setFeatureActivity(senderTabId, featureId, false);
      sendResponse({ ok: true, result: { updated: true } });
      return;
    }
    if (message.type === 'CG_IMAGE_CAPTURE_RECT') {
      if (!Number.isInteger(senderTabId)) throw new Error('The image source tab is unavailable.');
      const artifact = await completeImageCapture(senderTabId, message.rect || {});
      sendResponse({ ok: true, result: { captured: true, artifactId: artifact.artifactId } });
      return;
    }
    if (message.type === 'CG_VIDEO_CANDIDATES') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const session = await addVideoCandidates(senderTabId, message.candidates);
      sendResponse({ ok: true, result: { accepted: session?.candidates?.length || 0 } });
      return;
    }
    if (message.type === 'CG_VIDEO_INLINE_MANIFESTS') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const session = await addInlineVideoManifests(senderTabId, message.manifests);
      sendResponse({ ok: true, result: { accepted: session?.candidates?.length || 0 } });
      return;
    }
    if (message.type === 'CG_VIDEO_WRAPPED_MANIFEST') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const manifestText = unwrapObfuscatedHls(bytesFromBase64(message.data));
      if (manifestText) {
        const session = await addInlineVideoManifests(senderTabId, [{
          kind: 'hls', manifestText, baseUrl: message.baseUrl,
          source: 'wrapped-hls', inlineId: runtimeToken()
        }]);
        sendResponse({ ok: true, result: { accepted: session?.candidates?.length || 0 } });
      } else sendResponse({ ok: true, result: { accepted: 0 } });
      return;
    }
    if (message.type === 'CG_VIDEO_DOWNLOAD_PROGRESS') {
      await updateVideoDownloadProgress(
        Number(message.tabId),
        String(message.candidateId || ''),
        String(message.requestId || ''),
        message.progress
      );
      sendResponse({ ok: true, result: { updated: true } });
      return;
    }
    if (message.type === 'UI_GET') {
      const result = await pageStates(message.url || '', message.tabId);
      if (Number.isInteger(message.tabId)
        && result.imageDownload?.supported
        && result.imageDownload.workspaceMode !== 'page') {
        await prepareImageWorkspaceSidePanel(message.tabId).catch(() => {
          preparedImageSidePanels.delete(message.tabId);
        });
      }
      sendResponse({ ok: true, result });
      return;
    }
    if (message.type === 'UI_IMAGE_OPEN') {
      const tabId = Number(message.tabId);
      const workspace = await openImageWorkspace(tabId, message.workspaceMode);
      await startImageSession(tabId, message.url || '', message.title || '');
      const session = await readImageSession(tabId);
      if (session) {
        session.workspaceMode = workspace.mode;
        session.workspaceTabId = workspace.workspaceTabId;
        await saveImageSession(session);
      }
      sendResponse({ ok: true, result: { active: true, ...workspace } });
      return;
    }
    if (message.type === 'UI_IMAGE_OPEN_PAGE') {
      const tabId = Number(message.tabId);
      const session = await readImageSession(tabId);
      if (!session) throw new Error('Image Download is not active in this tab.');
      const workspaceTabId = await openImageWorkspacePage(tabId);
      session.workspaceTabId = workspaceTabId;
      await saveImageSession(session);
      sendResponse({ ok: true, result: { active: true, mode: 'page', workspaceTabId } });
      return;
    }
    if (message.type === 'UI_IMAGE_STATE') {
      const tabId = Number(message.tabId);
      const session = await readImageSession(tabId);
      const settings = await readSettings();
      sendResponse({ ok: true, result: await imageDownloadState(settings, tabId, session?.pageUrl || '') });
      return;
    }
    if (message.type === 'UI_IMAGE_RESCAN') {
      const tabId = Number(message.tabId);
      await scanImageSession(tabId, message.deep === true);
      const session = await readImageSession(tabId);
      const settings = await readSettings();
      sendResponse({ ok: true, result: await imageDownloadState(settings, tabId, session?.pageUrl || '') });
      return;
    }
    if (message.type === 'UI_IMAGE_STOP') {
      await stopImageSession(Number(message.tabId));
      sendResponse({ ok: true, result: { active: false } });
      return;
    }
    if (message.type === 'UI_IMAGE_CAPTURE_AREA') {
      sendResponse({ ok: true, result: await beginImageCapture(Number(message.tabId)) });
      return;
    }
    if (message.type === 'UI_IMAGE_UPDATE_METADATA') {
      const result = await updateImageMetadata(
        Number(message.tabId),
        String(message.candidateId || ''),
        message.metadata || {}
      );
      sendResponse({ ok: true, result });
      return;
    }
    if (message.type === 'UI_IMAGE_DOWNLOAD') {
      const result = await downloadImageSelections(Number(message.tabId), message.selections, message.options || {});
      sendResponse({ ok: true, result });
      return;
    }
    if (message.type === 'UI_IMAGE_FOCUS_SOURCE') {
      const tabId = Number(message.tabId);
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
      sendResponse({ ok: true, result: { focused: true } });
      return;
    }
    if (message.type === 'UI_VIDEO_OPEN') {
      const tabId = Number(message.tabId);
      const session = await startVideoSession(tabId, message.url || '', message.title || '');
      const settings = await readSettings();
      sendResponse({ ok: true, result: await videoDownloadState(settings, tabId, message.url || '') });
      return;
    }
    if (message.type === 'UI_VIDEO_RESCAN') {
      const tabId = Number(message.tabId);
      const session = await readVideoSession(tabId);
      if (!session) throw new Error('Video Download is not active in this tab.');
      await Promise.allSettled([
        injectVideoScanner(tabId),
        discoverSiteVideoCandidates(tabId, session.pageUrl)
      ]);
      const settings = await readSettings();
      sendResponse({ ok: true, result: await videoDownloadState(settings, tabId, session.pageUrl) });
      return;
    }
    if (message.type === 'UI_VIDEO_STOP') {
      await stopVideoSession(Number(message.tabId));
      sendResponse({ ok: true, result: { active: false } });
      return;
    }
    if (message.type === 'UI_VIDEO_DOWNLOAD') {
      const tabId = Number(message.tabId);
      const candidateId = String(message.candidateId || '');
      void downloadVideoCandidate(tabId, candidateId).catch(() => {});
      sendResponse({ ok: true, result: { accepted: true } });
      return;
    }
    if (message.type === 'UI_VIDEO_CANCEL_PROCESSING') {
      const result = await cancelVideoProcessing(
        Number(message.tabId),
        String(message.candidateId || '')
      );
      sendResponse({ ok: true, result });
      return;
    }
    if (message.type === 'UI_SET_VIDEO_SETTING') {
      const name = String(message.name || '');
      if (!['preferredQuality', 'askWhereToSave'].includes(name)) throw new Error('Unknown Video Download setting.');
      const settings = await mutateSettings(current => ({
        ...current,
        videoDownload: { ...current.videoDownload, [name]: message.value }
      }), false);
      sendResponse({ ok: true, result: settings.videoDownload });
      return;
    }
    if (message.type === 'UI_SET_IMAGE_SETTING') {
      const name = String(message.name || '');
      if (!['workspaceMode', 'batchMode', 'outputFormat', 'askWhereToSave'].includes(name)) throw new Error('Unknown Image Download setting.');
      const settings = await mutateSettings(current => ({
        ...current,
        imageDownload: { ...current.imageDownload, [name]: message.value }
      }), false);
      sendResponse({ ok: true, result: settings.imageDownload });
      return;
    }
    if (message.type === 'UI_SET_ENABLED') {
      const featureId = validFeatureId(message.featureId);
      if ([FEATURE_IDS.ANY_COPY, FEATURE_IDS.ANY_COPY_ENHANCED, FEATURE_IDS.IMAGE_DOWNLOAD, FEATURE_IDS.VIDEO_DOWNLOAD].includes(featureId)) throw new Error('This feature is enabled from the current tab.');
      const settings = await mutateSettings(current => updateFeature(current, featureId, feature => ({
        ...feature,
        enabled: message.enabled === true
      })));
      sendResponse({ ok: true, result: settings[featureId] });
      return;
    }
    if (message.type === 'UI_SET_AUDIO_AUTOPLAY_ALL_SITES') {
      const settings = await mutateSettings(current => updateFeature(current, FEATURE_IDS.NO_AUTOPLAY, feature => ({
        ...feature,
        audioAutoplayAllSites: message.enabled === true
      })));
      sendResponse({ ok: true, result: settings.noAutoplay });
      return;
    }
    if (message.type === 'UI_SET_BILI_DAILY_LOGIN') {
      const enabled = message.enabled === true;
      const settings = await mutateSettings(current => ({
        ...current,
        satellites: {
          ...current.satellites,
          biliDailyLogin: { ...current.satellites.biliDailyLogin, enabled }
        }
      }));
      await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
      await chrome.alarms.clear(BILI_DAILY_ALARM);
      if (enabled) await ensureBiliDailySchedule();
      sendResponse({ ok: true, result: settings.satellites.biliDailyLogin });
      return;
    }
    if (message.type === 'UI_TOGGLE_PAGE_FEATURE') {
      const featureId = validFeatureId(message.featureId);
      if (![FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY].includes(featureId)) throw new Error('This product does not use current-site controls.');
      const hostname = normalizeRule(message.hostname || '');
      if (hostname.startsWith('*.')) throw new Error('The current-site action requires an exact hostname.');
      const settings = await mutateSettings(current => {
        const currentState = featureState(current, featureId, `https://${hostname}/`);
        return updateFeature(current, featureId, feature => {
          if (currentState.exactActivationOverride) return {
            ...feature,
            enabledRules: withoutRule(feature.enabledRules, hostname),
            whitelistRules: withoutRule(feature.whitelistRules, hostname)
          };
          return currentState.active ? {
            ...feature,
            enabledRules: withoutRule(feature.enabledRules, hostname),
            whitelistRules: withRule(feature.whitelistRules, hostname)
          } : {
            ...feature,
            enabledRules: withRule(feature.enabledRules, hostname),
            whitelistRules: withoutRule(feature.whitelistRules, hostname)
          };
        });
      });
      sendResponse({ ok: true, result: settings[featureId] });
      return;
    }
    if (message.type === 'UI_TOGGLE_PAGE_ENHANCED') {
      const featureId = validFeatureId(message.featureId);
      if (![FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY].includes(featureId)) throw new Error('This product does not use current-site controls.');
      const hostname = normalizeRule(message.hostname || '');
      if (hostname.startsWith('*.')) throw new Error('The current-site action requires an exact hostname.');
      const settings = await mutateSettings(current => {
        const currentState = featureState(current, featureId, `https://${hostname}/`);
        return updateFeature(current, featureId, feature => currentState.active && currentState.mode === 'enhanced' ? {
          ...feature,
          enhancedRules: withoutRule(feature.enhancedRules, hostname),
          standardRules: withRule(feature.standardRules, hostname)
        } : {
          ...feature,
          enabledRules: currentState.active ? feature.enabledRules : withRule(feature.enabledRules, hostname),
          whitelistRules: withoutRule(feature.whitelistRules, hostname),
          enhancedRules: withRule(feature.enhancedRules, hostname),
          standardRules: withoutRule(feature.standardRules, hostname)
        });
      });
      sendResponse({ ok: true, result: settings[featureId] });
      return;
    }
    if (message.type === 'UI_TOGGLE_SITE_FEATURE') {
      const featureId = validFeatureId(message.featureId);
      if (![FEATURE_IDS.ANY_COPY, FEATURE_IDS.ANY_COPY_ENHANCED].includes(featureId)) throw new Error('This product does not use site activation.');
      const hostname = normalizeRule(message.hostname || '');
      if (hostname.startsWith('*.')) throw new Error('The current-site action requires an exact hostname.');
      const settings = await mutateSettings(current => updateFeature(current, featureId, feature => ({
        ...feature,
        siteRules: feature.siteRules.includes(hostname)
          ? feature.siteRules.filter(rule => rule !== hostname)
          : [...feature.siteRules, hostname]
      })));
      sendResponse({ ok: true, result: settings[featureId] });
      return;
    }
    if (message.type === 'UI_ADD_RULE' || message.type === 'UI_DELETE_RULE') {
      const featureId = validFeatureId(message.featureId);
      const listName = validList(featureId, message.listName);
      if (message.type === 'UI_ADD_RULE'
        && listName === 'permanentAudioAllowRules'
        && !senderExtensionUrl.startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('That rule must be added from No Autoplay settings.');
      }
      const rule = normalizeRule(message.rule || '');
      const oppositeList = {
        enabledRules: 'whitelistRules',
        whitelistRules: 'enabledRules',
        enhancedRules: 'standardRules',
        standardRules: 'enhancedRules'
      }[listName];
      const settings = await mutateSettings(current => updateFeature(current, featureId, feature => ({
        ...feature,
        [listName]: message.type === 'UI_ADD_RULE'
          ? withRule(feature[listName], rule)
          : withoutRule(feature[listName], rule),
        ...(message.type === 'UI_ADD_RULE' && oppositeList
          ? { [oppositeList]: withoutRule(feature[oppositeList], rule) }
          : {})
      })));
      sendResponse({ ok: true, result: settings[featureId] });
      return;
    }
    if (message.type === 'UI_OPEN_SETTINGS') {
      const featureId = validFeatureId(message.featureId);
      const path = featureId === FEATURE_IDS.NO_AUTOPLAY
        ? 'settings/no-autoplay.html'
        : [FEATURE_IDS.ANY_COPY, FEATURE_IDS.ANY_COPY_ENHANCED].includes(featureId) ? 'settings/any-copy.html'
          : featureId === FEATURE_IDS.IMAGE_DOWNLOAD ? 'settings/image-download.html'
          : featureId === FEATURE_IDS.VIDEO_DOWNLOAD ? 'settings/video-download.html' : 'settings/native-scroll.html';
      await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
      sendResponse({ ok: true, result: { opened: true } });
      return;
    }
    if (message.type === 'UI_OPEN_ALL_SETTINGS') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('settings/all-settings.html') });
      sendResponse({ ok: true, result: { opened: true } });
      return;
    }
    if (message.type === 'UI_RESET_ALL_SETTINGS') {
      if (!senderExtensionUrl.startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('All settings can only be reset from the settings page.');
      }
      const settings = await resetAllSettings();
      sendResponse({ ok: true, result: settings });
      return;
    }
    throw new Error('Unsupported extension message.');
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
