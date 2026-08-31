import { FEATURE_IDS } from '../../../core/config.js';
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
  parseDownloadScanAlarm,
  pauseDownloadScan
} from '../../../core/download-session.js';
import {
  classifyVideoResource,
  mediaRequestDirectoryFilters,
  mediaRequestReferrer,
  mergeVideoCandidate,
  parseHlsMaster,
  parseHlsMedia,
  sanitizeVideoFilename,
  videoSessionKey
} from '../../../core/video-download.js';

export function createVideoDownloadProduct(platform, offscreen, observation) {
  const { readSettings, sendTabMessage, setFeatureActivity, notifyCentralUi } = platform;
  const activeVideoProcessing = new Map();
  let nextMediaHeaderRuleId = 700000;
  const pendingVideoFilenames = new Map();
  const expandingVideoManifests = new Set();
  const activeTabs = new Set();
  const pendingNetworkCandidates = new Map();
  const viewPorts = new Map();
  async function restoreCollectingTabs() {
    try {
      const values = await chrome.storage.session.get(null);
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith('videoDownloadSession:') && value?.active === true && Number.isInteger(value.tabId) && downloadScanCollects(value)) {
          await setCollecting(value.tabId, true);
        }
      }
      return true;
    } catch { return false; }
  }
  let activeTabsReady = restoreCollectingTabs();

  async function initialize() {
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

  function queueCandidate(tabId, candidate) {
    const pending = pendingNetworkCandidates.get(tabId) || { candidates: [], timer: 0 };
    pending.candidates.push(candidate);
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
        await setCollecting(tabId, downloadScanCollects(session));
        return session;
      }
      await setCollecting(tabId, false);
      return null;
    } catch { return null; }
  }
  
  async function saveVideoSession(session) {
    if (!session?.active || !Number.isInteger(session.tabId)) return;
    await setCollecting(session.tabId, downloadScanCollects(session));
    await chrome.storage.session.set({ [videoSessionKey(session.tabId)]: session });
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
    const candidates = await offscreen.sendVideo({ type: 'CG_VIDEO_DISCOVER_YOUTUBE', context, pageUrl });
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
      const variants = await withMediaRequestHeaders(candidate, session.pageUrl, () => offscreen.sendVideo({
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
  
  async function stopVideoScanner(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'ISOLATED',
        injectImmediately: true,
        func: () => globalThis[Symbol.for('cosmic-gemini.video-download.scanner')]?.stop()
      });
    } catch {
      await sendTabMessage(tabId, { type: 'CG_VIDEO_STOP' });
    }
  }
  
  async function startVideoSession(tabId, url, title = '') {
    if (!Number.isInteger(tabId)) throw new Error('This tab is unavailable.');
    const origin = originFromUrl(url);
    if (!origin) throw new Error('Video Download is unavailable on this page.');
    const existing = await readVideoSession(tabId);
    if (existing?.origin === origin) {
      Object.assign(existing, activateDownloadScan(existing));
      await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
      const metadata = await readVideoPageMetadata(tabId);
      existing.pageUrl = url;
      existing.title = metadata.title || title || existing.title;
      existing.thumbnailUrl = metadata.thumbnailUrl || existing.thumbnailUrl || '';
      await saveVideoSession(existing);
      await Promise.allSettled([
        injectVideoScanner(tabId),
        discoverSiteVideoCandidates(tabId, url)
      ]);
      await schedulePause(tabId);
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
      updatedAt: Date.now(),
      scanState: 'active',
      scanDeadline: 0
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
    await schedulePause(tabId);
    return readVideoSession(tabId);
  }
  
  async function stopVideoSession(tabId) {
    if (!Number.isInteger(tabId)) return;
    const session = await readVideoSession(tabId);
    await stopVideoScanner(tabId);
    const artifacts = [...new Set((session?.candidates || []).map(candidate => candidate.artifactId).filter(Boolean))];
    await Promise.allSettled(artifacts.map(artifactId => offscreen.sendVideo({
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
        offscreen.beginAssembly();
        try {
          artifact = await withMediaRequestHeaders(candidate, session.pageUrl, () => {
            if (processing.cancelled) {
              const error = new Error('Video processing was canceled.');
              error.cancelled = true;
              throw error;
            }
            return offscreen.sendVideo({
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
        await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: artifact.artifactId }).catch(() => {});
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
    const all = await chrome.storage.session.get(null);
    for (const [key, session] of Object.entries(all)) {
      if (!key.startsWith('videoDownloadSession:') || !session?.active) continue;
      const candidate = session.candidates?.find(item => item.downloadId === delta.id);
      if (!candidate) continue;
      candidate.status = delta.state.current === 'complete' ? 'complete' : 'failed';
      candidate.error = delta.error?.current || '';
      session.updatedAt = Date.now();
      await saveVideoSession(session);
      if (candidate.artifactId) {
        await offscreen.sendVideo({ type: 'CG_VIDEO_CLEANUP_ARTIFACT', artifactId: candidate.artifactId }).catch(() => {});
        candidate.artifactId = '';
        await saveVideoSession(session);
        await offscreen.maybeClose();
      }
    }
  }
  

  async function pauseDiscovery(tabId) {
    if (hasVisibleView(tabId)) return;
    const session = await readVideoSession(tabId);
    if (!session) return;
    await saveVideoSession(pauseDownloadScan(session));
    clearPending(tabId);
    await stopVideoScanner(tabId);
  }

  async function schedulePause(tabId) {
    if (hasVisibleView(tabId)) return;
    const session = await readVideoSession(tabId);
    if (!session || !downloadScanCollects(session)) return;
    const deferred = deferDownloadScan(session);
    await saveVideoSession(deferred);
    await chrome.alarms.create(downloadScanAlarmName('videoDownload', tabId), { when: deferred.scanDeadline });
  }

  async function resumeDiscovery(tabId) {
    const session = await readVideoSession(tabId);
    if (!session) return;
    const active = activateDownloadScan(session);
    await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
    await saveVideoSession(active);
    await Promise.allSettled([injectVideoScanner(tabId), discoverSiteVideoCandidates(tabId, active.pageUrl)]);
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
    if (message.type === 'CG_VIDEO_CANDIDATES') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const session = await addVideoCandidates(senderTabId, message.candidates);
      return { accepted: session?.candidates?.length || 0 };
    }
    if (message.type === 'CG_VIDEO_INLINE_MANIFESTS') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const session = await addInlineVideoManifests(senderTabId, message.manifests);
      return { accepted: session?.candidates?.length || 0 };
    }
    if (message.type === 'CG_VIDEO_WRAPPED_MANIFEST') {
      if (!Number.isInteger(senderTabId)) throw new Error('The video source tab is unavailable.');
      const manifestText = unwrapObfuscatedHls(bytesFromBase64(message.data));
      if (!manifestText) return { accepted: 0 };
      const session = await addInlineVideoManifests(senderTabId, [{
        kind: 'hls', manifestText, baseUrl: message.baseUrl,
        source: 'wrapped-hls', inlineId: runtimeToken()
      }]);
      return { accepted: session?.candidates?.length || 0 };
    }
    if (message.type === 'CG_VIDEO_DOWNLOAD_PROGRESS') {
      await updateVideoDownloadProgress(Number(message.tabId), String(message.candidateId || ''), String(message.requestId || ''), message.progress);
      return { updated: true };
    }
    if (message.type === 'UI_VIDEO_OPEN') {
      const tabId = Number(message.tabId);
      await startVideoSession(tabId, message.url || '', message.title || '');
      return videoDownloadState(await readSettings(), tabId, message.url || '');
    }
    if (message.type === 'UI_VIDEO_RESCAN') {
      const tabId = Number(message.tabId);
      const session = await readVideoSession(tabId);
      if (!session) throw new Error('Video Download is not active in this tab.');
      await chrome.alarms.clear(downloadScanAlarmName('videoDownload', tabId));
      await saveVideoSession(activateDownloadScan(session));
      await Promise.allSettled([injectVideoScanner(tabId), discoverSiteVideoCandidates(tabId, session.pageUrl)]);
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
        await stopVideoSession(tabId);
        return;
      }
      session.pageUrl = change.url;
      session.title = tab.title || session.title;
      session.candidates = [];
      session.status = 'scanning';
      session.updatedAt = Date.now();
      await saveVideoSession(session);
      if (downloadScanCollects(session)) await injectVideoScanner(tabId);
    }
    const current = change.status === 'complete' ? await readVideoSession(tabId) : null;
    if (current && downloadScanCollects(current)) {
      await Promise.allSettled([injectVideoScanner(tabId), discoverSiteVideoCandidates(tabId, current.pageUrl)]);
    }
  }

  async function reset() {
    for (const processing of activeVideoProcessing.values()) {
      processing.cancelled = true;
      if (processing.requestId) void offscreen.sendVideo({ type: 'CG_VIDEO_CANCEL_REQUEST', requestId: processing.requestId }).catch(() => {});
    }
    await initialize();
    const values = await chrome.storage.session.get(null);
    const tabIds = Object.entries(values).filter(([key, value]) => key.startsWith('videoDownloadSession:') && Number.isInteger(value?.tabId)).map(([, value]) => value.tabId);
    await Promise.allSettled([...new Set(tabIds)].map(stopVideoSession));
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
      const sourceUrl = [item.url, item.finalUrl].find(value => pendingVideoFilenames.has(value));
      if (!sourceUrl) return false;
      const filename = pendingVideoFilenames.get(sourceUrl);
      pendingVideoFilenames.delete(sourceUrl);
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
