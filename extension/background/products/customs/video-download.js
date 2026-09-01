import { FEATURE_IDS } from '../../../core/config.js';
import { createKeyedTaskQueue } from '../../../core/keyed-task-queue.js';
import {
  bilibiliDashCandidates,
  bilibiliPageContext,
  completeBilibiliPageContext,
  fetchBilibiliPlayInfo
} from '../../../core/bilibili-video.js';
import { youtubePageContext } from '../../../core/youtube-video.js';
import { siteVideoPageDiscovery } from '../../../core/site-video.js';
import { unwrapObfuscatedHls } from '../../../core/obfuscated-hls.js';
import {
  activateDownloadScan,
  deferDownloadScan,
  downloadScanAlarmName,
  downloadScanCollects,
  downloadScanState,
  parseDownloadScanAlarm,
  pauseDownloadScan
} from '../../../core/download-session.js';
import {
  classifyVideoResource,
  limitVideoCandidatesForSession,
  mediaRequestDirectoryFilters,
  mediaRequestReferrer,
  mergeVideoCandidate,
  parseHlsMaster,
  parseHlsMedia,
  recoverInterruptedVideoCandidates,
  sanitizeVideoFilename,
  videoSessionKey
} from '../../../core/video-download.js';

export function createVideoDownloadProduct(platform, offscreen, observation) {
  const { readSettings, sendTabMessage, setFeatureActivity, notifyCentralUi } = platform;
  const activeVideoProcessing = new Map();
  const incognitoContext = chrome.extension?.inIncognitoContext === true;
  const MEDIA_HEADER_RULE_MIN = incognitoContext ? 750001 : 700001;
  const MEDIA_HEADER_RULE_MAX = incognitoContext ? 799999 : 749999;
  let nextMediaHeaderRuleId = MEDIA_HEADER_RULE_MIN - 1;
  const pendingVideoFilenames = new Map();
  const untrackedDownloadArtifacts = new Map();
  const expandingVideoManifests = new Set();
  const activeTabs = new Set();
  const pendingNetworkCandidates = new Map();
  const viewPorts = new Map();
  const sessionUpdates = createKeyedTaskQueue();

  async function cleanupOrphanedMediaHeaderRules() {
    if (!chrome.declarativeNetRequest?.getSessionRules || !chrome.declarativeNetRequest?.updateSessionRules) return true;
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const removeRuleIds = rules.filter(rule =>
      rule.id >= MEDIA_HEADER_RULE_MIN
      && rule.id <= MEDIA_HEADER_RULE_MAX
      && rule.action?.type === 'modifyHeaders'
      && rule.action.requestHeaders?.some(header => String(header.header || '').toLowerCase() === 'referer')
      && rule.condition?.resourceTypes?.includes('xmlhttprequest'))
      .map(rule => rule.id);
    if (removeRuleIds.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    return true;
  }

  let mediaHeaderRulesReady = cleanupOrphanedMediaHeaderRules();

  async function ensureMediaHeaderRulesReady() {
    const current = mediaHeaderRulesReady;
    try { return await current; }
    catch {
      if (mediaHeaderRulesReady === current) mediaHeaderRulesReady = cleanupOrphanedMediaHeaderRules();
      return mediaHeaderRulesReady;
    }
  }
  async function restoreCollectingTabs() {
    try {
      const priorCollecting = new Set(activeTabs);
      const restoredCollecting = new Set();
      const [values, tabs] = await Promise.all([chrome.storage.session.get(null), chrome.tabs.query({})]);
      const liveTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger));
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith('videoDownloadSession:') || value?.active !== true || !Number.isInteger(value.tabId)) continue;
        let updated = false;
        const recovered = recoverInterruptedVideoCandidates(value.candidates);
        if (recovered.changed) {
          value.candidates = recovered.candidates;
          updated = true;
          await Promise.allSettled(recovered.requestIds.map(requestId => offscreen.sendVideo({
            type: 'CG_VIDEO_CANCEL_REQUEST', requestId
          })));
        }
        for (const candidate of value.candidates || []) {
          if (!candidate.artifactId || !Number.isInteger(candidate.downloadId)) continue;
          let download;
          try { [download] = await chrome.downloads.search({ id: candidate.downloadId }); }
          catch { continue; }
          if (download?.state === 'in_progress') continue;
          try {
            await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: candidate.artifactId });
            candidate.artifactId = '';
            updated = true;
          } catch {}
        }
        if (updated) await chrome.storage.session.set({ [key]: value });
        if (liveTabIds.has(value.tabId)) {
          if (downloadScanCollects(value)) {
            restoredCollecting.add(value.tabId);
            await setCollecting(value.tabId, true);
          }
          continue;
        }
        const artifacts = [...new Set((value.candidates || []).map(candidate => candidate.artifactId).filter(Boolean))];
        const cleanup = await Promise.allSettled(artifacts.map(artifactId => offscreen.sendVideo({
          type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId
        })));
        if (cleanup.some(result => result.status === 'rejected')) continue;
        await chrome.storage.session.remove(key);
        await chrome.alarms.clear(downloadScanAlarmName('videoDownload', value.tabId));
      }
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith('videoDownloadArtifact:') || !value?.artifactId) continue;
        const downloadId = Number(key.slice('videoDownloadArtifact:'.length));
        let download;
        try {
          [download] = Number.isInteger(downloadId) ? await chrome.downloads.search({ id: downloadId }) : [];
        } catch { continue; }
        if (download?.state === 'in_progress') continue;
        try {
          await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: value.artifactId });
          await chrome.storage.session.remove(key);
        } catch {}
      }
      for (const tabId of priorCollecting) {
        if (restoredCollecting.has(tabId)) continue;
        const key = videoSessionKey(tabId);
        const latest = (await chrome.storage.session.get(key))[key];
        if (!liveTabIds.has(tabId) || !downloadScanCollects(latest)) await setCollecting(tabId, false);
      }
      await offscreen.maybeClose();
      return true;
    } catch { return false; }
  }
  let activeTabsReady = restoreCollectingTabs();

  async function initialize() {
    await ensureMediaHeaderRulesReady();
    const current = activeTabsReady;
    if (await current) return true;
    if (activeTabsReady === current) activeTabsReady = restoreCollectingTabs();
    return activeTabsReady;
  }

  async function setCollecting(tabId, active) {
    const changed = active === true ? !activeTabs.has(tabId) : activeTabs.has(tabId);
    if (!changed) return;
    if (active === true) activeTabs.add(tabId);
    else activeTabs.delete(tabId);
    observation.setCollecting(FEATURE_IDS.VIDEO_DOWNLOAD, tabId, active);
  }

  function clearPending(tabId) {
    const pending = pendingNetworkCandidates.get(tabId);
    if (pending?.timer) clearTimeout(pending.timer);
    pendingNetworkCandidates.delete(tabId);
  }

  function queuePendingFilename(url, filename) {
    const entry = { token: runtimeToken(), filename };
    const queue = pendingVideoFilenames.get(url) || [];
    queue.push(entry);
    pendingVideoFilenames.set(url, queue);
    return () => {
      const current = pendingVideoFilenames.get(url) || [];
      const remaining = current.filter(item => item.token !== entry.token);
      if (remaining.length) pendingVideoFilenames.set(url, remaining);
      else pendingVideoFilenames.delete(url);
    };
  }

  function takePendingFilename(url) {
    const queue = pendingVideoFilenames.get(url);
    if (!queue?.length) return '';
    const [entry, ...remaining] = queue;
    if (remaining.length) pendingVideoFilenames.set(url, remaining);
    else pendingVideoFilenames.delete(url);
    return entry.filename;
  }

  function queueCandidate(tabId, candidate) {
    const pending = pendingNetworkCandidates.get(tabId) || { candidates: [], timer: 0 };
    if (pending.candidates.length < 800) pending.candidates.push(candidate);
    if (!pending.timer) {
      pending.timer = setTimeout(() => {
        pendingNetworkCandidates.delete(tabId);
        void addVideoCandidates(tabId, pending.candidates).catch(() => {});
      }, 140);
    }
    pendingNetworkCandidates.set(tabId, pending);
  }

  function hasVisibleView(tabId) {
    const clients = viewPorts.get(tabId);
    return !!clients && [...clients.values()].some(Boolean);
  }

  function notifyViews(tabId) {
    const clients = viewPorts.get(tabId);
    if (!clients) return;
    for (const port of clients.keys()) {
      try { port.postMessage({ type: 'central-state-changed', tabId }); } catch {}
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

  async function requestBilibiliJson(url) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Bilibili request failed.');
    return response.json();
  }
  
  async function withMediaRequestHeaders(candidate, pageUrl, task) {
    const referrer = mediaRequestReferrer(pageUrl);
    const filters = mediaRequestDirectoryFilters(candidate);
    if (!referrer || !filters.length || !chrome.declarativeNetRequest?.updateSessionRules) return task();
    await ensureMediaHeaderRulesReady();
    const existing = new Set((await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id));
    const rules = filters.map(urlFilter => {
      do {
        nextMediaHeaderRuleId += 1;
        if (nextMediaHeaderRuleId > MEDIA_HEADER_RULE_MAX) nextMediaHeaderRuleId = MEDIA_HEADER_RULE_MIN;
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
    const encoded = String(value || '');
    if (encoded.length > 3 * 1024 * 1024) return new Uint8Array();
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  
  async function readVideoSession(tabId) {
    if (!Number.isInteger(tabId)) return null;
    const key = videoSessionKey(tabId);
    const session = (await chrome.storage.session.get(key))[key];
    if (session?.active === true) {
      await setCollecting(tabId, downloadScanCollects(session));
      return session;
    }
    await setCollecting(tabId, false);
    return null;
  }
  
  async function saveVideoSession(session) {
    if (!session?.active || !Number.isInteger(session.tabId)) return;
    const key = videoSessionKey(session.tabId);
    for (const budget of [2_500_000, 1_250_000, 625_000, 312_500]) {
      session.candidates = limitVideoCandidatesForSession(session.candidates, 80, budget);
      try {
        await chrome.storage.session.set({ [key]: session });
        break;
      } catch (error) {
        const quotaError = /quota|max(?:imum)?\s+bytes|exceed/i.test(String(error?.message || error));
        if (!quotaError || budget === 312_500) throw error;
      }
    }
    await setCollecting(session.tabId, downloadScanCollects(session));
    notifyViews(session.tabId);
    notifyCentralUi(session.tabId);
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

  function scopeFrameCandidates(candidates, frameId = 0) {
    return (Array.isArray(candidates) ? candidates : []).map(candidate => ({
      ...candidate,
      mediaKey: candidate?.mediaKey ? `frame-${frameId}:${candidate.mediaKey}` : candidate?.mediaKey
    }));
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
    if (candidates.length) await addVideoCandidates(tabId, candidates, false, pageUrl);
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
    const discovered = await offscreen.sendVideo({ type: 'CG_VIDEO_DISCOVER_YOUTUBE', context, pageUrl });
    const candidates = (Array.isArray(discovered) ? discovered : []).map(candidate => ({
      ...candidate,
      mediaKey: candidate.mediaKey || `youtube:${context.videoId}`,
      mediaTitle: candidate.mediaTitle || context.title,
      thumbnailUrl: candidate.thumbnailUrl || context.thumbnailUrl
    }));
    if (candidates.length) await addVideoCandidates(tabId, candidates, true, pageUrl);
    return candidates;
  }
  
  async function discoverAdapterCandidates(tabId, pageUrl) {
    const frames = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      injectImmediately: true,
      func: siteVideoPageDiscovery
    });
    const result = frames.find(frame => frame.frameId === 0)?.result || frames[0]?.result || {};
    const candidates = (Array.isArray(result.candidates) ? result.candidates : []).map(candidate => ({
      ...candidate,
      mediaKey: candidate.mediaKey || `adapter:${pageUrl}`,
      mediaTitle: candidate.mediaTitle || candidate.title || '',
      thumbnailUrl: candidate.thumbnailUrl || ''
    }));
    if (candidates.length) {
      await addVideoCandidates(tabId, candidates, true, pageUrl);
    }
    if (Array.isArray(result.manifests) && result.manifests.length) {
      await addInlineVideoManifests(tabId, result.manifests, pageUrl);
    }
    return [...candidates, ...(result.manifests || [])];
  }
  
  async function discoverSiteVideoCandidates(tabId, pageUrl) {
    const tasks = [discoverAdapterCandidates(tabId, pageUrl)];
    if (isBilibiliVideoUrl(pageUrl)) tasks.push(discoverBilibiliCandidates(tabId, pageUrl));
    if (isYoutubeVideoUrl(pageUrl)) tasks.push(discoverYoutubeCandidates(tabId, pageUrl));
    const results = await Promise.allSettled(tasks);
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  }
  
  async function updateVideoCandidate(tabId, candidateId, update, expectedPageUrl = '') {
    return sessionUpdates.run(tabId, async () => {
      const session = await readVideoSession(tabId);
      if (!session) return null;
      if (expectedPageUrl && session.pageUrl !== expectedPageUrl) return null;
      const index = session.candidates.findIndex(candidate => candidate.id === candidateId);
      if (index < 0) return null;
      const current = session.candidates[index];
      session.candidates[index] = typeof update === 'function' ? update(current) : { ...current, ...update };
      session.updatedAt = Date.now();
      await saveVideoSession(session);
      return session.candidates[index];
    });
  }
  
  async function expandHlsCandidate(tabId, candidate) {
    const expansionKey = `${tabId}:${candidate.url}:${candidate.inlineId || ''}`;
    if (expandingVideoManifests.has(expansionKey)) return;
    expandingVideoManifests.add(expansionKey);
    try {
      const session = await readVideoSession(tabId);
      if (!session) return;
      const expectedPageUrl = session.pageUrl;
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
          }), expectedPageUrl);
        }
        return;
      }
      await updateVideoCandidate(tabId, candidate.id, value => ({ ...value, downloadable: false, master: true }), expectedPageUrl);
      const expandedSession = await addVideoCandidates(tabId, variants.map(variant => ({
        ...variant,
        kind: 'hls',
        source: 'hls-variant',
        title: session.title,
        mediaKey: candidate.mediaKey || `hls:${candidate.inlineId || candidate.url}`,
        mediaTitle: candidate.mediaTitle,
        thumbnailUrl: candidate.thumbnailUrl
      })), false, expectedPageUrl);
      if (!expandedSession) return;
      for (const variant of variants) {
        const normalized = classifyVideoResource({
          ...variant,
          kind: 'hls',
          source: 'hls-variant',
          title: session.title,
          mediaKey: candidate.mediaKey || `hls:${candidate.inlineId || candidate.url}`,
          mediaTitle: candidate.mediaTitle,
          thumbnailUrl: candidate.thumbnailUrl
        });
        if (normalized) void expandHlsCandidate(tabId, normalized);
      }
    } catch {}
    finally { expandingVideoManifests.delete(expansionKey); }
  }
  
  async function addInlineVideoManifests(tabId, manifests, expectedPageUrl = '') {
    const session = await readVideoSession(tabId);
    if (!session || !Array.isArray(manifests)) return session;
    const candidates = [];
    for (const item of manifests.slice(0, 12)) {
      const kind = item?.kind === 'dash' ? 'dash' : item?.kind === 'hls' ? 'hls' : '';
      const manifestText = String(item?.manifestText || '').slice(0, 2 * 1024 * 1024);
      const manifestBaseUrl = originFromUrl(item?.baseUrl) ? String(item.baseUrl) : session.pageUrl;
      const inlineId = String(item.inlineId || runtimeToken());
      if (!kind || !manifestText) continue;
      candidates.push({
        url: manifestBaseUrl,
        kind,
        source: String(item.source || 'inline-manifest'),
        title: session.title,
        manifestText,
        manifestBaseUrl,
        inlineId,
        mediaKey: String(item.mediaKey || `inline:${inlineId}`),
        mediaTitle: String(item.mediaTitle || ''),
        thumbnailUrl: String(item.thumbnailUrl || ''),
        downloadable: kind === 'hls'
      });
    }
    return addVideoCandidates(tabId, candidates, true, expectedPageUrl);
  }
  
  async function expandDashCandidate(tabId, candidate) {
    const expansionKey = `${tabId}:dash:${candidate.url}:${candidate.inlineId || ''}`;
    if (expandingVideoManifests.has(expansionKey)) return;
    expandingVideoManifests.add(expansionKey);
    try {
      const session = await readVideoSession(tabId);
      if (!session) return;
      const expectedPageUrl = session.pageUrl;
      await updateVideoCandidate(tabId, candidate.id, value => ({ ...value, master: true }), expectedPageUrl);
      const variants = await withMediaRequestHeaders(candidate, session.pageUrl, () => offscreen.sendVideo({
        type: 'CG_VIDEO_EXPAND_DASH',
        candidate: { ...candidate, manifestUrl: candidate.url },
        pageUrl: session.pageUrl
      }));
      if (Array.isArray(variants) && variants.length) {
        await addVideoCandidates(tabId, variants.map(variant => ({
          ...variant,
          mediaKey: candidate.mediaKey || `dash:${candidate.inlineId || candidate.manifestUrl || candidate.url}`,
          mediaTitle: candidate.mediaTitle,
          thumbnailUrl: candidate.thumbnailUrl
        })), false, expectedPageUrl);
      }
    } catch {}
    finally { expandingVideoManifests.delete(expansionKey); }
  }
  
  async function addVideoCandidates(tabId, rawCandidates, expand = true, expectedPageUrl = '') {
    if (!Array.isArray(rawCandidates)) return readVideoSession(tabId);
    const outcome = await sessionUpdates.run(tabId, async () => {
      const session = await readVideoSession(tabId);
      if (!session) return { session: null, addedHls: [], addedDash: [] };
      if (expectedPageUrl && session.pageUrl !== expectedPageUrl) {
        return { session: null, addedHls: [], addedDash: [] };
      }
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
      session.candidates = limitVideoCandidatesForSession(sortVideoCandidates([...byId.values()]));
      session.updatedAt = Date.now();
      session.status = session.candidates.some(candidate => !candidate.master) ? 'found' : 'scanning';
      await saveVideoSession(session);
      const retainedIds = new Set(session.candidates.map(candidate => candidate.id));
      return {
        session,
        addedHls: addedHls.filter(candidate => retainedIds.has(candidate.id)),
        addedDash: addedDash.filter(candidate => retainedIds.has(candidate.id))
      };
    });
    if (!outcome.session) return null;
    await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, outcome.session.status === 'found');
    if (expand) for (const candidate of outcome.addedHls.slice(0, 12)) void expandHlsCandidate(tabId, candidate);
    if (expand) for (const candidate of outcome.addedDash.slice(0, 12)) void expandDashCandidate(tabId, candidate);
    return outcome.session;
  }
  
  async function injectVideoScanner(tabId, expectedPageUrl = '') {
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
      const candidates = frames.flatMap(frame => scopeFrameCandidates(frame.result, frame.frameId));
      if (candidates.length) await addVideoCandidates(tabId, candidates, true, expectedPageUrl);
      return true;
    } catch {
      await stopVideoScanner(tabId);
      return false;
    }
  }
  
  async function stopVideoScanner(tabId) {
    const results = await Promise.allSettled([
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'ISOLATED',
        injectImmediately: true,
        func: () => globalThis[Symbol.for('cosmic-gemini.video-download.scanner')]?.stop()
      }),
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        injectImmediately: true,
        func: () => globalThis[Symbol.for('cosmic-gemini.video-download.page-runtime')]?.stop()
      })
    ]);
    if (results.every(result => result.status === 'rejected')) await sendTabMessage(tabId, { type: 'CG_VIDEO_STOP' });
  }
  
  async function startVideoSession(tabId, url, title = '') {
    if (!Number.isInteger(tabId)) throw new Error('This tab is unavailable.');
    const origin = originFromUrl(url);
    if (!origin) throw new Error('Video Download is unavailable on this page.');
    const metadata = await readVideoPageMetadata(tabId);
    const session = await sessionUpdates.run(tabId, async () => {
      const existing = await readVideoSession(tabId);
      if (existing && existing.origin !== origin) await stopVideoSessionUnlocked(tabId, existing);
      const next = existing?.origin === origin ? {
        ...activateDownloadScan(existing),
        pageUrl: url,
        title: String(metadata.title || title || existing.title).slice(0, 240),
        thumbnailUrl: String(metadata.thumbnailUrl || existing.thumbnailUrl || '')
      } : {
        active: true,
        tabId,
        origin,
        pageUrl: url,
        title: String(metadata.title || title || 'Video').slice(0, 240),
        thumbnailUrl: String(metadata.thumbnailUrl || ''),
        status: 'scanning',
        candidates: [],
        startedAt: Date.now(),
        updatedAt: Date.now(),
        scanState: 'active',
        scanDeadline: 0
      };
      await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
      await saveVideoSession(next);
      return next;
    });
    await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, session.status === 'found');
    const [injected, site] = await Promise.allSettled([
      injectVideoScanner(tabId, url),
      discoverSiteVideoCandidates(tabId, url)
    ]);
    const siteFound = site.status === 'fulfilled' && site.value.length > 0;
    if ((injected.status !== 'fulfilled' || injected.value !== true) && !siteFound) {
      await sessionUpdates.run(tabId, async () => {
        const current = await readVideoSession(tabId);
        if (current && current.pageUrl === url && !current.candidates.length) {
          current.status = 'unavailable';
          await saveVideoSession(current);
        }
      });
    }
    await schedulePause(tabId);
    return readVideoSession(tabId);
  }
  
  async function stopVideoSessionUnlocked(tabId, session = undefined) {
    const current = session === undefined ? await readVideoSession(tabId) : session;
    await stopVideoScanner(tabId);
    const artifacts = [];
    for (const candidate of current?.candidates || []) {
      if (!candidate.artifactId) continue;
      if (candidate.status === 'downloading' && Number.isInteger(candidate.downloadId)) {
        if (await rememberVideoArtifact(candidate.downloadId, candidate.artifactId)) {
          untrackedDownloadArtifacts.delete(candidate.downloadId);
          offscreen.releaseArtifact(candidate.artifactId);
        } else {
          untrackedDownloadArtifacts.set(candidate.downloadId, candidate.artifactId);
          offscreen.retainArtifact(candidate.artifactId);
        }
        continue;
      }
      artifacts.push(candidate.artifactId);
    }
    await Promise.allSettled([...new Set(artifacts)].map(artifactId => offscreen.sendVideo({
      type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId
    })));
    await initialize();
    await setCollecting(tabId, false);
    clearPending(tabId);
    await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
    await chrome.storage.session.remove(videoSessionKey(tabId));
    await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, false);
    await offscreen.maybeClose();
  }

  async function cancelTabVideoProcessing(tabId) {
    const cancellations = [];
    for (const [key, processing] of activeVideoProcessing) {
      if (!key.startsWith(`${tabId}:`) || processing.phase !== 'processing') continue;
      processing.cancelled = true;
      if (processing.requestId) cancellations.push(
        offscreen.sendVideo({ type: 'CG_VIDEO_CANCEL_REQUEST', requestId: processing.requestId })
      );
    }
    await Promise.allSettled(cancellations);
  }

  async function stopVideoSession(tabId, expectedOrigin = '') {
    if (!Number.isInteger(tabId)) return;
    await cancelTabVideoProcessing(tabId);
    return sessionUpdates.run(tabId, async () => {
      const session = await readVideoSession(tabId);
      if (expectedOrigin && session?.origin !== expectedOrigin) return false;
      await stopVideoSessionUnlocked(tabId, session);
      return true;
    });
  }
  
  async function videoDownloadState(settings, tabId, url) {
    const supported = !!originFromUrl(url);
    const session = await readVideoSession(tabId);
    const active = supported && session?.origin === originFromUrl(url);
    return {
      ...settings.videoDownload,
      supported,
      active,
      scanState: active ? downloadScanState(session) : 'paused',
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

  async function rememberVideoArtifact(downloadId, artifactId) {
    if (!Number.isInteger(downloadId) || !artifactId) return false;
    const key = `videoDownloadArtifact:${downloadId}`;
    for (const delay of [0, 100, 500, 1_500, 3_000]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await chrome.storage.session.set({ [key]: { artifactId } });
        try {
          const [download] = await chrome.downloads.search({ id: downloadId });
          if (['complete', 'interrupted'].includes(download?.state)) {
            await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId });
            await chrome.storage.session.remove(key);
          }
        } catch {}
        return true;
      } catch {}
    }
    return false;
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
    let artifactRetained = false;
    let handedOffToChrome = false;
    try {
      let downloadUrl = candidate.url;
      let extension = candidateExtension(candidate);
      if (['direct', 'audio', 'subtitle', 'hls', 'muxed', 'dash'].includes(candidate.kind)) {
        offscreen.beginAssembly();
        try {
          artifact = await withMediaRequestHeaders(candidate, session.pageUrl, () => {
            if (processing.cancelled) {
              const error = new Error('Video processing was canceled.');
              error.cancelled = true;
              throw error;
            }
            return offscreen.sendVideoArtifact({
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
        } finally { offscreen.endAssembly(); }
        if (artifact?.artifactId) artifactRetained = true;
        downloadUrl = artifact.url;
        extension = artifact.extension;
      }
      if (processing.cancelled) {
        const error = new Error('Video processing was canceled.');
        error.cancelled = true;
        throw error;
      }
      processing.phase = 'handoff';
      const sourceTitle = String(candidate.mediaTitle || candidate.title || session.title || 'Video').trim();
      const downloadTitle = candidate.kind === 'subtitle' && candidate.languageLabel
        ? `${sourceTitle} · ${candidate.languageLabel}` : sourceTitle;
      const filename = sanitizeVideoFilename(downloadTitle, extension);
      const releasePendingFilename = queuePendingFilename(downloadUrl, filename);
      let downloadId;
      try {
        downloadId = await chrome.downloads.download({
          url: downloadUrl,
          filename,
          conflictAction: 'uniquify',
          saveAs: settings.videoDownload.askWhereToSave
        });
      } finally {
        setTimeout(releasePendingFilename, 30_000);
      }
      handedOffToChrome = true;
      if (artifact?.artifactId) {
        untrackedDownloadArtifacts.set(downloadId, artifact.artifactId);
      }
      const artifactRemembered = artifact?.artifactId
        ? await rememberVideoArtifact(downloadId, artifact.artifactId)
        : false;
      if (artifact?.artifactId && artifactRemembered) {
        untrackedDownloadArtifacts.delete(downloadId);
        offscreen.releaseArtifact(artifact.artifactId);
        artifactRetained = false;
      }
      await updateVideoCandidate(tabId, candidateId, value => ({
        ...value,
        status: 'downloading',
        progress: 100,
        processingRequestId: '',
        downloadId,
        artifactId: artifactRemembered ? '' : artifact?.artifactId || '',
        outputBytes: artifact?.bytes || value.contentLength || 0,
        outputExtension: extension,
        liveSnapshot: artifact?.liveSnapshot === true
      }));
      for (const delay of [0, 100, 500]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        try {
          const [download] = await chrome.downloads.search({ id: downloadId });
          if (['complete', 'interrupted'].includes(download?.state)) {
            await handleVideoDownloadChanged({
              id: downloadId,
              state: { current: download.state },
              ...(download.error ? { error: { current: download.error } } : {})
            });
          }
          break;
        } catch {}
      }
      return { downloadId };
    } catch (error) {
      if (artifact?.artifactId && !handedOffToChrome) {
        await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: artifact.artifactId }).catch(() => {});
        if (artifactRetained) {
          offscreen.releaseArtifact(artifact.artifactId);
          artifactRetained = false;
        }
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
      await offscreen.maybeClose();
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
      await offscreen.sendVideo({ type: 'CG_VIDEO_CANCEL_REQUEST', requestId }).catch(() => {});
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
    const cleanedArtifacts = new Set();
    if (['complete', 'interrupted'].includes(delta.state.current)) {
      const artifactKey = `videoDownloadArtifact:${delta.id}`;
      for (const delay of [0, 100, 500, 1_500]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        try {
          const artifact = (await chrome.storage.session.get(artifactKey))[artifactKey];
          if (!artifact?.artifactId) break;
          await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: artifact.artifactId });
          cleanedArtifacts.add(artifact.artifactId);
          await chrome.storage.session.remove(artifactKey);
          await offscreen.maybeClose();
          break;
        } catch {}
      }
      const untrackedArtifactId = untrackedDownloadArtifacts.get(delta.id) || '';
      if (untrackedArtifactId) {
        try {
          if (!cleanedArtifacts.has(untrackedArtifactId)) {
            await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: untrackedArtifactId });
            cleanedArtifacts.add(untrackedArtifactId);
          }
          untrackedDownloadArtifacts.delete(delta.id);
          offscreen.releaseArtifact(untrackedArtifactId);
        } catch {}
      }
    }
    let all = null;
    for (const delay of [0, 100, 500]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try { all = await chrome.storage.session.get(null); break; }
      catch {}
    }
    if (!all) return;
    for (const [key, session] of Object.entries(all)) {
      if (!key.startsWith('videoDownloadSession:') || !session?.active) continue;
      const candidate = session.candidates?.find(item => item.downloadId === delta.id);
      if (!candidate) continue;
      const artifactId = candidate.artifactId || '';
      await updateVideoCandidate(session.tabId, candidate.id, value => ({
        ...value,
        status: delta.state.current === 'complete' ? 'complete' : 'failed',
        error: delta.error?.current || ''
      }));
      if (artifactId) {
        if (cleanedArtifacts.has(artifactId)) {
          await updateVideoCandidate(session.tabId, candidate.id, value => (
            value.artifactId === artifactId ? { ...value, artifactId: '' } : value
          ));
          continue;
        }
        for (const delay of [0, 100, 500]) {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          try {
            await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId });
            await updateVideoCandidate(session.tabId, candidate.id, value => (
              value.artifactId === artifactId ? { ...value, artifactId: '' } : value
            ));
            await offscreen.maybeClose();
            break;
          } catch {}
        }
      }
    }
  }
  

  async function pauseDiscovery(tabId) {
    if (hasVisibleView(tabId)) return;
    await sessionUpdates.run(tabId, async () => {
      const session = await readVideoSession(tabId);
      if (session) await saveVideoSession(pauseDownloadScan(session));
    });
    clearPending(tabId);
    await stopVideoScanner(tabId);
  }

  async function schedulePause(tabId) {
    if (hasVisibleView(tabId)) return;
    const deferred = await sessionUpdates.run(tabId, async () => {
      const session = await readVideoSession(tabId);
      if (!session || !downloadScanCollects(session)) return null;
      const next = deferDownloadScan(session);
      await saveVideoSession(next);
      return next;
    });
    if (!deferred) return;
    for (const delay of [0, 100, 500]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await chrome.alarms.create(downloadScanAlarmName('videoDownload', tabId), { when: deferred.scanDeadline });
        return;
      } catch {}
    }
    await pauseDiscovery(tabId);
  }

  async function resumeDiscovery(tabId) {
    const active = await sessionUpdates.run(tabId, async () => {
      const session = await readVideoSession(tabId);
      if (!session) return null;
      const next = activateDownloadScan(session);
      await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
      await saveVideoSession(next);
      return next;
    });
    if (!active) return;
    await Promise.allSettled([injectVideoScanner(tabId, active.pageUrl), discoverSiteVideoCandidates(tabId, active.pageUrl)]);
  }

  function connect(port) {
    const match = String(port.name || '').match(/^download-view:videoDownload:(\d+)$/);
    if (!match) return false;
    const tabId = Number(match[1]);
    const clients = viewPorts.get(tabId) || new Map();
    clients.set(port, false);
    viewPorts.set(tabId, clients);
    port.onMessage.addListener(message => {
      if (typeof message?.visible !== 'boolean') return;
      const wasVisible = hasVisibleView(tabId);
      clients.set(port, message.visible);
      const visible = hasVisibleView(tabId);
      if (!wasVisible && visible) void resumeDiscovery(tabId).catch(() => {});
      if (wasVisible && !visible) void schedulePause(tabId).catch(() => {});
    });
    port.onDisconnect.addListener(() => {
      const wasVisible = hasVisibleView(tabId);
      clients.delete(port);
      if (!clients.size) viewPorts.delete(tabId);
      if (wasVisible && !hasVisibleView(tabId)) void schedulePause(tabId).catch(() => {});
    });
    return true;
  }

  async function handleMessage(message, context) {
    const senderTabId = context.sender.tab?.id;
    const expectedSenderPageUrl = context.sender.frameId === 0
      ? String(message.pageUrl || context.sender.url || context.sender.tab?.url || '')
      : String(context.sender.tab?.url || '');
    if (message.type === 'CG_VIDEO_CANDIDATES') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const session = await addVideoCandidates(
        senderTabId,
        scopeFrameCandidates(message.candidates, context.sender.frameId),
        true,
        expectedSenderPageUrl
      );
      return { accepted: session?.candidates?.length || 0 };
    }
    if (message.type === 'CG_VIDEO_INLINE_MANIFESTS') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const session = await addInlineVideoManifests(senderTabId, message.manifests, expectedSenderPageUrl);
      return { accepted: session?.candidates?.length || 0 };
    }
    if (message.type === 'CG_VIDEO_WRAPPED_MANIFEST') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const manifestText = unwrapObfuscatedHls(bytesFromBase64(message.data));
      if (!manifestText) return { accepted: 0 };
      const session = await addInlineVideoManifests(senderTabId, [{
        kind: 'hls', manifestText, baseUrl: message.baseUrl,
        source: 'wrapped-hls', inlineId: runtimeToken()
      }], expectedSenderPageUrl);
      return { accepted: session?.candidates?.length || 0 };
    }
    if (message.type === 'CG_VIDEO_DOWNLOAD_PROGRESS') {
      await updateVideoDownloadProgress(Number(message.tabId), String(message.candidateId || ''), String(message.requestId || ''), message.progress);
      return { updated: true };
    }
    if (message.type === 'UI_VIDEO_OPEN') {
      const tabId = Number(message.tabId);
      const sourceTab = await chrome.tabs.get(tabId);
      const sourceUrl = String(sourceTab.url || '');
      await startVideoSession(tabId, sourceUrl, sourceTab.title || '');
      return videoDownloadState(await readSettings(), tabId, sourceUrl);
    }
    if (message.type === 'UI_VIDEO_RESCAN') {
      const tabId = Number(message.tabId);
      const session = await sessionUpdates.run(tabId, async () => {
        const current = await readVideoSession(tabId);
        if (!current) throw new Error('Video Download is not active in this tab.');
        const next = activateDownloadScan(current);
        await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
        await saveVideoSession(next);
        return next;
      });
      await Promise.allSettled([injectVideoScanner(tabId, session.pageUrl), discoverSiteVideoCandidates(tabId, session.pageUrl)]);
      if (!hasVisibleView(tabId)) await schedulePause(tabId);
      return videoDownloadState(await readSettings(), tabId, session.pageUrl);
    }
    if (message.type === 'UI_VIDEO_STOP') {
      await stopVideoSession(Number(message.tabId));
      return { active: false };
    }
    if (message.type === 'UI_VIDEO_DOWNLOAD') {
      void downloadVideoCandidate(Number(message.tabId), String(message.candidateId || '')).catch(() => {});
      return { accepted: true };
    }
    if (message.type === 'UI_VIDEO_CANCEL_PROCESSING') return cancelVideoProcessing(Number(message.tabId), String(message.candidateId || ''));
    if (message.type === 'UI_SET_VIDEO_SETTING') {
      const name = String(message.name || '');
      if (!['preferredQuality', 'askWhereToSave'].includes(name)) throw new Error('Unknown Video Download setting.');
      const settings = await platform.mutateSettings(current => ({
        ...current,
        videoDownload: { ...current.videoDownload, [name]: message.value }
      }), false);
      return settings.videoDownload;
    }
    throw new Error('Video Download does not support this command.');
  }

  async function handleTabUpdated(tabId, change, tab) {
    if (change.status === 'loading' || change.url) clearPending(tabId);
    const session = await readVideoSession(tabId);
    if (!session) return;
    if (change.url) {
      const nextOrigin = originFromUrl(change.url);
      if (!nextOrigin || nextOrigin !== session.origin) {
        await stopVideoSession(tabId, session.origin);
        return;
      }
      await sessionUpdates.run(tabId, async () => {
        const current = await readVideoSession(tabId);
        if (!current || current.origin !== nextOrigin) return;
        current.pageUrl = change.url;
        current.title = tab.title || current.title;
        current.candidates = [];
        current.status = 'scanning';
        current.updatedAt = Date.now();
        await saveVideoSession(current);
      });
      if (downloadScanCollects(session)) await injectVideoScanner(tabId, change.url);
    }
    const current = change.status === 'complete' ? await readVideoSession(tabId) : null;
    if (current && downloadScanCollects(current)) {
      await Promise.allSettled([injectVideoScanner(tabId, current.pageUrl), discoverSiteVideoCandidates(tabId, current.pageUrl)]);
    }
  }

  async function reset() {
    const tabIds = new Set(activeTabs);
    try { await initialize(); } catch {}
    try {
      const values = await chrome.storage.session.get(null);
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith('videoDownloadSession:') && Number.isInteger(value?.tabId)) tabIds.add(value.tabId);
      }
    } catch {}
    await Promise.allSettled([...tabIds].map(stopVideoSession));
    await Promise.allSettled([...tabIds].map(async tabId => {
      await stopVideoScanner(tabId);
      await setCollecting(tabId, false);
      clearPending(tabId);
      await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId)).catch(() => {});
      await setFeatureActivity(tabId, FEATURE_IDS.VIDEO_DOWNLOAD, false).catch(() => {});
    }));
    expandingVideoManifests.clear();
    pendingVideoFilenames.clear();
  }

  return Object.freeze({
    id: FEATURE_IDS.VIDEO_DOWNLOAD,
    initialize,
    state: videoDownloadState,
    handleMessage,
    connect,
    handleTabUpdated,
    async handleTabRemoved(tabId) {
      await stopVideoSession(tabId);
      clearPending(tabId);
      await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
    },
    handleDownloadChanged: handleVideoDownloadChanged,
    handleDeterminingFilename(item, suggest) {
      const sourceUrl = [item.url, item.finalUrl].find(value => pendingVideoFilenames.get(value)?.length);
      if (!sourceUrl) return false;
      const filename = takePendingFilename(sourceUrl);
      suggest({ filename, conflictAction: 'uniquify' });
      return true;
    },
    async handleHeadersReceived(details) {
      if (!Number.isInteger(details.tabId) || details.tabId < 0 || details.type === 'image') return;
      await initialize();
      if (!activeTabs.has(details.tabId)) return;
      const candidate = classifyVideoResource({ url: details.url, responseHeaders: details.responseHeaders, source: 'network' });
      if (candidate) queueCandidate(details.tabId, candidate);
    },
    async handleAlarm(alarm) {
      const discovery = parseDownloadScanAlarm(alarm.name);
      if (discovery?.product !== 'videoDownload') return false;
      await pauseDiscovery(discovery.tabId);
      return true;
    },
    reset
  });
}
