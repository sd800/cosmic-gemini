import {
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  LEGACY_SETTINGS_KEY,
  SETTINGS_KEY,
  anyCopyState,
  featureState,
  hostnameFromUrl,
  normalizeRule,
  normalizeSettings,
  toggleRule,
  updateFeature
} from './core/config.js';
import {
  createTemporaryAudioGrant,
  hostnameFromTemporaryAudioAlarm,
  isTemporaryAudioGrantValid,
  temporaryAudioAlarm,
  temporaryAudioKey
} from './core/audio-grants.js';
import { normalizeLocale } from './core/locale.js';
import {
  bilibiliDashCandidates,
  bilibiliPageContext,
  fetchBilibiliPlayInfo
} from './core/bilibili-video.js';
import { youtubePageContext } from './core/youtube-video.js';
import { siteVideoPageDiscovery } from './core/site-video.js';
import { unwrapObfuscatedHls } from './core/obfuscated-hls.js';
import {
  BILI_DAILY_ALARM,
  BILI_DAILY_MAX_ATTEMPTS,
  BILI_DAILY_RETRY_MS,
  BILI_DAILY_RETRY_KEY,
  bilibiliDateKey,
  browserReportsOffline,
  nextBilibiliSchedule
} from './core/bili-daily-login.js';
import {
  classifyVideoResource,
  mergeVideoCandidate,
  parseHlsMaster,
  parseHlsMedia,
  sanitizeVideoFilename,
  videoSessionKey
} from './core/video-download.js';

const DEFAULT_ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const ACTIVE_ICONS = { 16: 'icons/icon-suppressing-16.png', 32: 'icons/icon-suppressing-32.png', 48: 'icons/icon-suppressing-48.png', 128: 'icons/icon-suppressing-128.png' };
const ACTIVITY_PREFIX = 'tabActivity:';
const FEATURE_LISTS = new Set(['whitelistRules', 'enhancedRules', 'permanentAudioAllowRules', 'enforcedRules']);
let writeQueue = Promise.resolve();
let biliDailyRun = null;
let activeVideoAssemblies = 0;
const expandingVideoManifests = new Set();
const activeVideoTabs = new Set();
const activeVideoTabsReady = chrome.storage.session.get(null).then(values => {
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('videoDownloadSession:') && value?.active === true && Number.isInteger(value.tabId)) {
      activeVideoTabs.add(value.tabId);
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
  if (!Number.isInteger(tabId)) return { nativeScroll: false, noAutoplay: false, anyCopy: false, videoDownload: false };
  try {
    const value = (await chrome.storage.session.get(activityKey(tabId)))[activityKey(tabId)];
    return {
      nativeScroll: value?.nativeScroll === true,
      noAutoplay: value?.noAutoplay === true,
      anyCopy: value?.anyCopy === true,
      videoDownload: value?.videoDownload === true
    };
  } catch { return { nativeScroll: false, noAutoplay: false, anyCopy: false, videoDownload: false }; }
}

async function toolbarTitle(activity) {
  const products = [
    activity.nativeScroll && 'Native Scroll',
    activity.noAutoplay && 'No Autoplay',
    activity.anyCopy && 'Any Copy',
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
  const active = activity.nativeScroll || activity.noAutoplay || activity.anyCopy || activity.videoDownload;
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
  if (activity.nativeScroll || activity.noAutoplay || activity.anyCopy || activity.videoDownload) await chrome.storage.session.set({ [key]: activity });
  else await chrome.storage.session.remove(key);
  await renderToolbar(tabId, activity);
}

async function clearTabActivity(tabId) {
  if (!Number.isInteger(tabId)) return;
  await chrome.storage.session.remove(activityKey(tabId));
  await renderToolbar(tabId, { nativeScroll: false, noAutoplay: false, anyCopy: false, videoDownload: false });
}

async function temporaryAudioAllowed(hostname) {
  if (!hostname) return false;
  const key = temporaryAudioKey(hostname);
  const grant = (await chrome.storage.session.get(key))[key];
  if (isTemporaryAudioGrantValid(grant)) return true;
  if (grant) {
    await chrome.storage.session.remove(key);
    await chrome.alarms.clear(temporaryAudioAlarm(hostname));
  }
  return false;
}

async function setTemporaryAudioAllowed(hostname) {
  const grant = createTemporaryAudioGrant();
  await chrome.storage.session.set({ [temporaryAudioKey(hostname)]: grant });
  await chrome.alarms.create(temporaryAudioAlarm(hostname), { when: grant.expiresAt });
}

async function clearTemporaryAudioAllowed(hostname) {
  if (!hostname) return;
  await Promise.allSettled([
    chrome.storage.session.remove(temporaryAudioKey(hostname)),
    chrome.alarms.clear(temporaryAudioAlarm(hostname))
  ]);
}

async function cleanupTemporaryAudioIfUnused(hostname) {
  if (!hostname) return;
  const tabs = await chrome.tabs.query({});
  const stillOpen = tabs.some(tab => hostnameFromUrl(tab.url || '') === hostname);
  if (!stillOpen) await clearTemporaryAudioAllowed(hostname);
}

async function cleanupUnusedTemporaryAudio() {
  const values = await chrome.storage.session.get(null);
  for (const key of Object.keys(values)) {
    if (!key.startsWith('temporaryAudioAllow:')) continue;
    await cleanupTemporaryAudioIfUnused(key.slice('temporaryAudioAllow:'.length));
  }
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
  const kindRank = { muxed: 0, direct: 1, hls: 2, dash: 3 };
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
  const context = frames.find(frame => frame.frameId === 0)?.result || frames[0]?.result;
  const standard = context?.cid && (context.bvid || context.aid);
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
      const response = await fetch(candidate.url, {
        cache: 'no-store',
        credentials: 'include',
        redirect: 'follow',
        referrer: session.pageUrl || undefined
      });
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
    const variants = await sendVideoOffscreen({
      type: 'CG_VIDEO_EXPAND_DASH',
      candidate: { ...candidate, manifestUrl: candidate.url },
      pageUrl: session.pageUrl
    });
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
    existing.pageUrl = url;
    existing.title = title || existing.title;
    await saveVideoSession(existing);
    await Promise.allSettled([
      injectVideoScanner(tabId),
      discoverSiteVideoCandidates(tabId, url)
    ]);
    return readVideoSession(tabId);
  }
  if (existing) await stopVideoSession(tabId);
  const session = {
    active: true,
    tabId,
    origin,
    pageUrl: url,
    title: String(title || 'Video').slice(0, 240),
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
  await sendTabMessage(tabId, { type: 'CG_VIDEO_STOP' });
  await activeVideoTabsReady;
  activeVideoTabs.delete(tabId);
  await chrome.storage.session.remove(videoSessionKey(tabId));
  await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, false);
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
  if (!response?.ok) throw new Error(response?.error || 'Video processing failed.');
  return response.result;
}

async function maybeCloseVideoOffscreen() {
  if (activeVideoAssemblies > 0) return;
  const values = await chrome.storage.session.get(null);
  const hasArtifact = Object.entries(values).some(([key, session]) =>
    key.startsWith('videoDownloadSession:') && session?.candidates?.some(candidate => candidate.artifactId));
  if (hasArtifact) return;
  try { await chrome.offscreen.closeDocument(); } catch {}
}

async function downloadVideoCandidate(tabId, candidateId) {
  const session = await readVideoSession(tabId);
  if (!session) throw new Error('Video Download is not active in this tab.');
  let candidate = session.candidates.find(item => item.id === candidateId);
  if (!candidate || candidate.downloadable === false) throw new Error('This video format is not downloadable.');
  if (candidate.inlineId && !candidate.manifestText) {
    const manifestSource = session.candidates.find(item => item.inlineId === candidate.inlineId && item.manifestText);
    if (manifestSource) candidate = {
      ...candidate,
      manifestText: manifestSource.manifestText,
      manifestBaseUrl: manifestSource.manifestBaseUrl || candidate.manifestBaseUrl
    };
  }
  const settings = await readSettings();
  await updateVideoCandidate(tabId, candidateId, value => ({ ...value, status: 'preparing', progress: 0, error: '' }));
  let artifact = null;
  try {
    let downloadUrl = candidate.url;
    let extension = candidateExtension(candidate);
    if (['direct', 'subtitle', 'hls', 'muxed', 'dash'].includes(candidate.kind)) {
      activeVideoAssemblies += 1;
      try {
        artifact = await sendVideoOffscreen({
          type: ['direct', 'subtitle'].includes(candidate.kind) ? 'CG_VIDEO_FETCH_DIRECT'
            : candidate.kind === 'hls'
            ? (candidate.audioUrl ? 'CG_VIDEO_MUX_TRACKS' : 'CG_VIDEO_ASSEMBLE_HLS')
            : candidate.kind === 'dash' ? 'CG_VIDEO_ASSEMBLE_DASH' : 'CG_VIDEO_MUX_TRACKS',
          requestId: runtimeToken(),
          tabId,
          candidate,
          pageUrl: session.pageUrl,
          preferredQuality: settings.videoDownload.preferredQuality
        });
      } finally { activeVideoAssemblies -= 1; }
      downloadUrl = artifact.url;
      extension = artifact.extension;
    }
    const filename = sanitizeVideoFilename(candidate.title || session.title, extension);
    const downloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename,
      saveAs: settings.videoDownload.askWhereToSave
    });
    await updateVideoCandidate(tabId, candidateId, value => ({
      ...value,
      status: 'downloading',
      progress: 100,
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
    await updateVideoCandidate(tabId, candidateId, value => ({
      ...value,
      status: 'failed',
      progress: 0,
      error: String(error?.message || 'Video download failed.').slice(0, 240)
    }));
    await maybeCloseVideoOffscreen();
    throw error;
  }
}

async function updateVideoDownloadProgress(tabId, candidateId, progress) {
  await updateVideoCandidate(tabId, candidateId, value => ({
    ...value,
    status: 'preparing',
    progress: Math.max(0, Math.min(100, Number(progress) || 0))
  }));
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

async function stateFor(settings, featureId, url) {
  if (featureId === FEATURE_IDS.ANY_COPY) return anyCopyState(settings, url);
  const hostname = hostnameFromUrl(url);
  const temporary = featureId === FEATURE_IDS.NO_AUTOPLAY && hostname
    ? await temporaryAudioAllowed(hostname)
    : false;
  return featureState(settings, featureId, url, temporary);
}

async function pageStates(url, tabId) {
  const settings = await readSettings();
  const [nativeScroll, noAutoplay, anyCopy, videoDownload, activity] = await Promise.all([
    stateFor(settings, FEATURE_IDS.NATIVE_SCROLL, url),
    stateFor(settings, FEATURE_IDS.NO_AUTOPLAY, url),
    stateFor(settings, FEATURE_IDS.ANY_COPY, url),
    videoDownloadState(settings, tabId, url),
    readActivity(tabId)
  ]);
  return { nativeScroll, noAutoplay, anyCopy, videoDownload, satellites: settings.satellites, activity };
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
  if (featureId === FEATURE_IDS.VIDEO_DOWNLOAD) throw new Error('Video Download does not use website rule lists.');
  if (value === 'permanentAudioAllowRules' && featureId !== FEATURE_IDS.NO_AUTOPLAY) throw new Error('That rule list is unavailable.');
  if (value === 'enforcedRules' && featureId !== FEATURE_IDS.ANY_COPY) throw new Error('That rule list is unavailable.');
  if (featureId === FEATURE_IDS.ANY_COPY && !['enforcedRules', 'enhancedRules'].includes(value)) throw new Error('That rule list is unavailable.');
  return value;
}

async function updateFeatureRules(featureId, listName, update) {
  return mutateSettings(settings => updateFeature(settings, featureId, feature => ({
    ...feature,
    [listName]: update(feature[listName] || [])
  })));
}

chrome.runtime.onInstalled.addListener(() => { void ensureSettings().then(ensureBiliDailySchedule).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void ensureSettings().then(ensureBiliDailySchedule).catch(() => {}); });

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.url) void clearTabActivity(tabId);
  if (change.url) void cleanupUnusedTemporaryAudio();
  void (async () => {
    const session = await readVideoSession(tabId);
    if (!session) return;
    if (change.url) {
      const nextOrigin = originFromUrl(change.url);
      if (!nextOrigin || nextOrigin !== session.origin) {
        await stopVideoSession(tabId);
        return;
      }
      session.pageUrl = change.url;
      session.title = tab.title || session.title;
      session.candidates = [];
      session.status = 'scanning';
      session.updatedAt = Date.now();
      await saveVideoSession(session);
      await injectVideoScanner(tabId);
    }
      if (change.status === 'complete') {
        await Promise.allSettled([
          injectVideoScanner(tabId),
          discoverSiteVideoCandidates(tabId, session.pageUrl)
        ]);
      }
  })().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void chrome.storage.session.remove(activityKey(tabId));
  void chrome.storage.session.remove(videoSessionKey(tabId));
  void activeVideoTabsReady.then(() => activeVideoTabs.delete(tabId));
  void cleanupUnusedTemporaryAudio();
});

chrome.downloads.onChanged.addListener(delta => { void handleVideoDownloadChanged(delta).catch(() => {}); });

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

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === BILI_DAILY_ALARM) {
    void runBiliDailyLoginOnce().catch(() => {});
    return;
  }
  const hostname = hostnameFromTemporaryAudioAlarm(alarm.name);
  if (hostname) void clearTemporaryAudioAllowed(hostname).then(refreshOpenPages);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'video-download-offscreen') return false;
  void (async () => {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid extension message.');
    const senderUrl = sender.tab?.url || message.url || '';
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
    if (message.type === 'CG_AUDIO_BLOCKED') {
      const settings = await readSettings();
      const state = await stateFor(settings, FEATURE_IDS.NO_AUTOPLAY, senderUrl);
      if (state.active) await setFeatureActivity(senderTabId, FEATURE_IDS.NO_AUTOPLAY, true);
      sendResponse({ ok: true, result: { showPrompt: state.active && state.mode !== 'enhanced' && !state.audioAllowed } });
      return;
    }
    if (message.type === 'CG_AUDIO_DECISION') {
      const hostname = hostnameFromUrl(senderUrl);
      if (!hostname) throw new Error('This page is unavailable.');
      if (message.decision === 'temporary') {
        await setTemporaryAudioAllowed(hostname);
        await refreshOpenPages();
      }
      else if (message.decision === 'permanent') {
        await updateFeatureRules(FEATURE_IDS.NO_AUTOPLAY, 'permanentAudioAllowRules', rules => [...rules, hostname]);
      } else if (message.decision !== 'continue') throw new Error('Unknown audio decision.');
      const settings = await readSettings();
      sendResponse({ ok: true, result: await stateFor(settings, FEATURE_IDS.NO_AUTOPLAY, senderUrl) });
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
      await updateVideoDownloadProgress(Number(message.tabId), String(message.candidateId || ''), message.progress);
      sendResponse({ ok: true, result: { updated: true } });
      return;
    }
    if (message.type === 'UI_GET') {
      sendResponse({ ok: true, result: await pageStates(message.url || '', message.tabId) });
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
    if (message.type === 'UI_SET_ENABLED') {
      const featureId = validFeatureId(message.featureId);
      if ([FEATURE_IDS.ANY_COPY, FEATURE_IDS.VIDEO_DOWNLOAD].includes(featureId)) throw new Error('This feature is enabled from the current tab.');
      const settings = await mutateSettings(current => updateFeature(current, featureId, feature => ({
        ...feature,
        enabled: message.enabled === true
      })));
      if (!settings[featureId].enabled) {
        const tabs = await chrome.tabs.query({});
        await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => setFeatureActivity(tab.id, featureId, false)));
      }
      sendResponse({ ok: true, result: settings[featureId] });
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
    if (message.type === 'UI_TOGGLE_ENHANCED' || message.type === 'UI_TOGGLE_WHITELIST') {
      const featureId = validFeatureId(message.featureId);
      if (featureId === FEATURE_IDS.VIDEO_DOWNLOAD) throw new Error('Video Download does not use website rules.');
      const hostname = normalizeRule(message.hostname || '');
      if (hostname.startsWith('*.')) throw new Error('The current-site action requires an exact hostname.');
      if (message.type === 'UI_TOGGLE_WHITELIST' && featureId === FEATURE_IDS.ANY_COPY) throw new Error('Any Copy uses Standard mode sites.');
      const listName = message.type === 'UI_TOGGLE_ENHANCED' ? 'enhancedRules' : 'whitelistRules';
      const settings = await updateFeatureRules(featureId, listName, rules => toggleRule(rules, hostname));
      sendResponse({ ok: true, result: settings[featureId] });
      return;
    }
    if (message.type === 'UI_TOGGLE_ANY_COPY') {
      const hostname = normalizeRule(message.hostname || '');
      if (hostname.startsWith('*.')) throw new Error('The current-site action requires an exact hostname.');
      const settings = await mutateSettings(current => updateFeature(current, FEATURE_IDS.ANY_COPY, feature => {
        const exactActive = feature.enforcedRules.includes(hostname) || feature.enhancedRules.includes(hostname);
        return exactActive
          ? {
              ...feature,
              enforcedRules: feature.enforcedRules.filter(rule => rule !== hostname),
              enhancedRules: feature.enhancedRules.filter(rule => rule !== hostname)
            }
          : { ...feature, enforcedRules: [...feature.enforcedRules, hostname] };
      }));
      sendResponse({ ok: true, result: settings.anyCopy });
      return;
    }
    if (message.type === 'UI_ADD_RULE' || message.type === 'UI_DELETE_RULE') {
      const featureId = validFeatureId(message.featureId);
      const listName = validList(featureId, message.listName);
      const rule = normalizeRule(message.rule || '');
      const settings = await updateFeatureRules(featureId, listName, rules => message.type === 'UI_ADD_RULE'
        ? [...rules, rule]
        : rules.filter(item => item !== rule));
      sendResponse({ ok: true, result: settings[featureId] });
      return;
    }
    if (message.type === 'UI_OPEN_SETTINGS') {
      const featureId = validFeatureId(message.featureId);
      const path = featureId === FEATURE_IDS.NO_AUTOPLAY
        ? 'settings/no-autoplay.html'
        : featureId === FEATURE_IDS.ANY_COPY ? 'settings/any-copy.html'
          : featureId === FEATURE_IDS.VIDEO_DOWNLOAD ? 'settings/video-download.html' : 'settings/native-scroll.html';
      await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
      sendResponse({ ok: true, result: { opened: true } });
      return;
    }
    throw new Error('Unsupported extension message.');
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
