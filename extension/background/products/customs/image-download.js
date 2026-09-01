import { FEATURE_IDS } from '../../../core/config.js';
import { normalizeLocale } from '../../../core/locale.js';
import { createKeyedTaskQueue } from '../../../core/keyed-task-queue.js';
import { imagePageDiscovery } from '../../../core/image-page.js';
import {
  activateDownloadScan,
  deferDownloadScan,
  downloadScanAlarmName,
  downloadScanCollects,
  parseDownloadScanAlarm,
  pauseDownloadScan
} from '../../../core/download-session.js';
import {
  groupImageCandidates,
  imageContentLength,
  imageExtension,
  imageMimeFromHeaders,
  imageSessionKey,
  limitImageCandidatesForSession,
  mergeImageCandidate,
  normalizeImageCandidate,
  sanitizeImageFilename
} from '../../../core/image-download.js';

export function createImageDownloadProduct(platform, offscreen, observation) {
  const { readSettings, sendTabMessage, setFeatureActivity, notifyCentralUi, runtimeToken } = platform;
  const activeTabs = new Set();
  const pendingNetworkCandidates = new Map();
  const pendingPageScans = new Map();
  const preparedImageSidePanels = new Map();
  const viewPorts = new Map();
  const sessionUpdates = createKeyedTaskQueue();
  const sendImageOffscreen = message => offscreen.sendImage(message);
  async function restoreCollectingTabs() {
    try {
      const [values, tabs] = await Promise.all([chrome.storage.session.get(null), chrome.tabs.query({})]);
      const liveTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger));
      const liveCaptureArtifacts = new Set();
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith('imageDownloadSession:') || value?.active !== true || !Number.isInteger(value.tabId)) continue;
        if (liveTabIds.has(value.tabId)) {
          for (const artifactId of (value.candidates || []).map(candidate => candidate.artifactId).filter(Boolean)) {
            liveCaptureArtifacts.add(artifactId);
          }
          if (downloadScanCollects(value)) await setCollecting(value.tabId, true);
          continue;
        }
        await cleanupImageCaptureArtifacts(value);
        await chrome.storage.session.remove(key);
        await chrome.alarms.clear(downloadScanAlarmName('imageDownload', value.tabId));
      }
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith('imageCaptureArtifact:') || !value?.artifactId || liveCaptureArtifacts.has(value.artifactId)) continue;
        try {
          await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId: value.artifactId });
          await chrome.storage.session.remove(key);
        } catch {}
      }
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith('imageDownloadArtifact:') || !value?.artifactId) continue;
        const downloadId = Number(key.slice('imageDownloadArtifact:'.length));
        let download;
        try {
          [download] = Number.isInteger(downloadId) ? await chrome.downloads.search({ id: downloadId }) : [];
        } catch { continue; }
        if (download?.state === 'in_progress') continue;
        try {
          await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId: value.artifactId });
          await chrome.storage.session.remove(key);
        } catch {}
      }
      await offscreen.maybeClose();
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
    observation.setCollecting(FEATURE_IDS.IMAGE_DOWNLOAD, tabId, active);
  }

  function originFromUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
    } catch { return ''; }
  }

  function clearPending(tabId) {
    const pending = pendingNetworkCandidates.get(tabId);
    if (pending?.timer) clearTimeout(pending.timer);
    pendingNetworkCandidates.delete(tabId);
  }

  function clearPageScan(tabId) {
    const timer = pendingPageScans.get(tabId);
    if (timer) clearTimeout(timer);
    pendingPageScans.delete(tabId);
  }

  function schedulePageScan(tabId, expectedPageUrl) {
    clearPageScan(tabId);
    const timer = setTimeout(() => {
      pendingPageScans.delete(tabId);
      void readImageSession(tabId).then(session => {
        if (session?.pageUrl !== expectedPageUrl || !downloadScanCollects(session)) return;
        return scanImageSession(tabId, false);
      }).catch(() => {});
    }, 180);
    pendingPageScans.set(tabId, timer);
  }

  function queueCandidate(tabId, candidate) {
    const pending = pendingNetworkCandidates.get(tabId) || { candidates: [], timer: 0 };
    if (pending.candidates.length < 2000) pending.candidates.push(candidate);
    if (!pending.timer) {
      pending.timer = setTimeout(() => {
        pendingNetworkCandidates.delete(tabId);
        void addImageCandidates(tabId, pending.candidates).catch(() => {});
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
  async function readImageSession(tabId) {
    if (!Number.isInteger(tabId)) return null;
    const key = imageSessionKey(tabId);
    const session = (await chrome.storage.session.get(key))[key];
    if (session?.active === true) {
      await setCollecting(tabId, downloadScanCollects(session));
      return session;
    }
    await setCollecting(tabId, false);
    return null;
  }

  async function saveImageSession(session) {
    if (!session?.active || !Number.isInteger(session.tabId)) return;
    const key = imageSessionKey(session.tabId);
    for (const budget of [2_500_000, 1_250_000, 625_000, 312_500]) {
      session.candidates = limitImageCandidatesForSession(session.candidates, 1200, budget);
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

  function sortImageCandidates(candidates) {
    return [...candidates].sort((a, b) =>
      (b.score || 0) - (a.score || 0)
      || (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
      || a.url.localeCompare(b.url));
  }

  function mergeCandidates(session, rawCandidates) {
    const byUrl = new Map((session.candidates || []).map(candidate => [candidate.url, candidate]));
    for (const raw of rawCandidates.slice(0, 1600)) {
      const candidate = normalizeImageCandidate(raw);
      if (!candidate) continue;
      byUrl.set(candidate.url, mergeImageCandidate(byUrl.get(candidate.url), candidate));
    }
    session.candidates = limitImageCandidatesForSession(sortImageCandidates([...byUrl.values()]));
    session.status = session.candidates.length ? 'found' : 'scanning';
    session.updatedAt = Date.now();
    return session;
  }

  async function addImageCandidates(tabId, rawCandidates) {
    if (!Array.isArray(rawCandidates)) return readImageSession(tabId);
    const session = await sessionUpdates.run(tabId, async () => {
      const current = await readImageSession(tabId);
      if (!current) return null;
      mergeCandidates(current, rawCandidates);
      await saveImageSession(current);
      return current;
    });
    if (session) await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, session.status === 'found');
    return session;
  }

  async function scanImageSession(tabId, deep = false) {
    const expectedPageUrl = await sessionUpdates.run(tabId, async () => {
      const session = await readImageSession(tabId);
      if (!session) throw new Error('Image Download is not active in this tab.');
      session.status = 'scanning';
      session.updatedAt = Date.now();
      await saveImageSession(session);
      return session.pageUrl;
    });
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
        for (const candidate of result.candidates) {
          candidates.push({
            ...candidate,
            familyKey: `${frame.frameId}:${candidate.familyKey || candidate.url}`,
            frameUrl: candidate.frameUrl || result.frameUrl
          });
        }
      }
      const topResult = frames.find(frame => frame.frameId === 0)?.result;
      const updated = await sessionUpdates.run(tabId, async () => {
        const current = await readImageSession(tabId);
        if (!current || current.pageUrl !== expectedPageUrl) return null;
        if (topResult) {
          current.pageUrl = topResult.pageUrl || current.pageUrl;
          current.title = String(topResult.pageTitle || current.title).slice(0, 240);
        }
        mergeCandidates(current, candidates);
        if (!current.candidates.length) current.status = 'empty';
        current.updatedAt = Date.now();
        await saveImageSession(current);
        return current;
      });
      if (updated) await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, updated.status === 'found');
      return readImageSession(tabId);
    } catch (error) {
      await sessionUpdates.run(tabId, async () => {
        const current = await readImageSession(tabId);
        if (current?.pageUrl === expectedPageUrl && !current.candidates.length) {
          current.status = 'unavailable';
          current.updatedAt = Date.now();
          await saveImageSession(current);
        }
      });
      throw error;
    }
  }
  
  async function startImageSession(tabId, url, title = '') {
    if (!Number.isInteger(tabId)) throw new Error('This tab is unavailable.');
    const origin = originFromUrl(url);
    if (!origin) throw new Error('Image Download is unavailable on this page.');
    const session = await sessionUpdates.run(tabId, async () => {
      const existing = await readImageSession(tabId);
      if (existing?.origin !== origin) {
        await cleanupImageCaptureArtifacts(existing);
        clearPending(tabId);
        preparedImageSidePanels.delete(tabId);
      }
      const next = activateDownloadScan(existing?.origin === origin ? {
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
      });
      await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
      await saveImageSession(next);
      return next;
    });
    await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, !!session.candidates.length);
    void scanImageSession(tabId, false).catch(() => {});
    await schedulePause(tabId);
    return session;
  }
  
  async function cleanupImageCaptureArtifacts(session) {
    if (!session) return;
    const tabId = session.tabId;
    const captureArtifacts = [...new Set((session?.candidates || []).map(candidate => candidate.artifactId).filter(Boolean))];
    for (const artifactId of captureArtifacts) {
      try {
        await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId });
        await chrome.storage.session.remove(`imageCaptureArtifact:${tabId}:${artifactId}`);
      } catch {}
    }
  }
  
  async function stopImageSession(tabId, expectedOrigin = '') {
    if (!Number.isInteger(tabId)) return;
    return sessionUpdates.run(tabId, async () => {
      const current = await readImageSession(tabId);
      if (expectedOrigin && current?.origin !== expectedOrigin) return false;
      await cleanupImageCaptureArtifacts(current);
      await initialize();
      await setCollecting(tabId, false);
      clearPending(tabId);
      clearPageScan(tabId);
      await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
      await chrome.storage.session.remove(imageSessionKey(tabId));
      await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, false);
      preparedImageSidePanels.delete(tabId);
      if (current?.workspaceMode === 'sidePanel' && chrome.sidePanel?.setOptions) {
        await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
      }
      return true;
    });
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
  
  async function completeImageCapture(tabId, rect, expectedPageUrl = '') {
    const session = await readImageSession(tabId);
    if (!session) throw new Error('Image Download is not active in this tab.');
    if (expectedPageUrl && session.pageUrl !== expectedPageUrl) throw new Error('The source page changed before the capture completed.');
    const tab = await chrome.tabs.get(tabId);
    if (expectedPageUrl && tab.url !== expectedPageUrl) throw new Error('The source page changed before the capture completed.');
    if (!tab.active || !Number.isInteger(tab.windowId)) throw new Error('Keep the source tab visible while capturing an area.');
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const [visibleTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (visibleTab?.id !== tabId) throw new Error('The source tab changed before the capture completed.');
    const artifact = await sendImageOffscreen({ type: 'CG_IMAGE_CROP_CAPTURE', dataUrl, rect });
    const storedLocale = await chrome.storage.local.get('interfaceLocale');
    const captureTitle = normalizeLocale(storedLocale.interfaceLocale || chrome.i18n.getUILanguage()) === 'zh-CN'
      ? '截取的区域' : 'Captured area';
    const artifactKey = `imageCaptureArtifact:${tabId}:${artifact.artifactId}`;
    try {
      await chrome.storage.session.set({
        [artifactKey]: { artifactId: artifact.artifactId }
      });
      const updatedSession = await addImageCandidates(tabId, [{
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
      if (!updatedSession) throw new Error('The Image Download session ended before the capture was saved.');
    } catch (error) {
      await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId: artifact.artifactId }).catch(() => {});
      await chrome.storage.session.remove(artifactKey).catch(() => {});
      throw error;
    }
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
    return sessionUpdates.run(tabId, async () => {
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
    });
  }
  
  function imageCandidateFilename(candidate, pageTitle, index, outputFormat) {
    let urlName = '';
    try { urlName = decodeURIComponent(new URL(candidate.url).pathname.split('/').pop() || '').replace(/\.[a-z0-9]{2,5}$/i, ''); }
    catch {}
    const extension = outputFormat !== 'original' ? outputFormat : imageExtension(candidate.url, candidate.mime) || 'jpg';
    const label = candidate.alt || candidate.title || urlName || pageTitle || `Image ${index + 1}`;
    return sanitizeImageFilename(label, extension, index + 1);
  }
  
  async function rememberImageArtifact(downloadId, artifactId) {
    if (!Number.isInteger(downloadId) || !artifactId) return false;
    for (const delay of [0, 100, 500]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await chrome.storage.session.set({ [`imageDownloadArtifact:${downloadId}`]: { artifactId } });
        return true;
      } catch {}
    }
    return false;
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
      let downloadId;
      try {
        downloadId = await chrome.downloads.download({
          url: artifact.url,
          filename: sanitizeImageFilename(`${session.title || 'Images'} Images`, 'zip'),
          saveAs: settings.imageDownload.askWhereToSave
        });
      } catch (error) {
        await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId: artifact.artifactId }).catch(() => {});
        throw error;
      }
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
      let downloadId;
      try {
        downloadId = await chrome.downloads.download({
          url: artifact.url,
          filename: artifact.filename || files[index].filename,
          saveAs: settings.imageDownload.askWhereToSave && files.length === 1
        });
      } catch (error) {
        await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId: artifact.artifactId }).catch(() => {});
        throw error;
      }
      await rememberImageArtifact(downloadId, artifact.artifactId);
      downloadIds.push(downloadId);
    }
    return { downloadIds, count: files.length };
  }
  
  async function handleImageDownloadChanged(delta) {
    if (!Number.isInteger(delta?.id) || !delta.state?.current) return;
    if (!['complete', 'interrupted'].includes(delta.state.current)) return;
    const key = `imageDownloadArtifact:${delta.id}`;
    for (const delay of [0, 100, 500]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        const artifact = (await chrome.storage.session.get(key))[key];
        if (!artifact?.artifactId) return;
        await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId: artifact.artifactId });
        await chrome.storage.session.remove(key);
        await offscreen.maybeClose();
        return;
      } catch {}
    }
  }

  async function pauseDiscovery(tabId) {
    if (hasVisibleView(tabId)) return;
    await sessionUpdates.run(tabId, async () => {
      const session = await readImageSession(tabId);
      if (session) await saveImageSession(pauseDownloadScan(session));
    });
    clearPending(tabId);
  }

  async function schedulePause(tabId) {
    if (hasVisibleView(tabId)) return;
    const deferred = await sessionUpdates.run(tabId, async () => {
      const session = await readImageSession(tabId);
      if (!session || !downloadScanCollects(session)) return null;
      const next = deferDownloadScan(session);
      await saveImageSession(next);
      return next;
    });
    if (!deferred) return;
    for (const delay of [0, 100, 500]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await chrome.alarms.create(downloadScanAlarmName('imageDownload', tabId), { when: deferred.scanDeadline });
        return;
      } catch {}
    }
    await pauseDiscovery(tabId);
  }

  async function resumeDiscovery(tabId) {
    const active = await sessionUpdates.run(tabId, async () => {
      const session = await readImageSession(tabId);
      if (!session) return null;
      const next = activateDownloadScan(session);
      await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
      await saveImageSession(next);
      return next;
    });
    if (!active) return;
    await scanImageSession(tabId, false).catch(() => {});
  }

  function connect(port) {
    const match = String(port.name || '').match(/^download-view:imageDownload:(\d+)$/);
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
    if (message.type === 'CG_IMAGE_CAPTURE_RECT') {
      if (!Number.isInteger(senderTabId)) throw new Error('The image source tab is unavailable.');
      const artifact = await completeImageCapture(senderTabId, message.rect || {}, String(context.sender.url || ''));
      return { captured: true, artifactId: artifact.artifactId };
    }
    if (message.type === 'UI_IMAGE_OPEN') {
      const tabId = Number(message.tabId);
      const sourceTab = await chrome.tabs.get(tabId);
      const sourceUrl = String(sourceTab.url || '');
      const workspace = await openImageWorkspace(tabId, message.workspaceMode);
      try {
        await startImageSession(tabId, sourceUrl, sourceTab.title || '');
        await sessionUpdates.run(tabId, async () => {
          const current = await readImageSession(tabId);
          if (!current) throw new Error('Image Download could not start in this tab.');
          current.workspaceMode = workspace.mode;
          current.workspaceTabId = workspace.workspaceTabId;
          await saveImageSession(current);
        });
      } catch (error) {
        if (workspace.mode === 'page' && Number.isInteger(workspace.workspaceTabId)) {
          await chrome.tabs.remove(workspace.workspaceTabId).catch(() => {});
        } else if (chrome.sidePanel?.setOptions) {
          await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
        }
        throw error;
      }
      return { active: true, ...workspace };
    }
    if (message.type === 'UI_IMAGE_OPEN_PAGE') {
      const tabId = Number(message.tabId);
      const workspaceTabId = await openImageWorkspacePage(tabId);
      await sessionUpdates.run(tabId, async () => {
        const current = await readImageSession(tabId);
        if (!current) throw new Error('Image Download is not active in this tab.');
        current.workspaceTabId = workspaceTabId;
        await saveImageSession(current);
      });
      return { active: true, mode: 'page', workspaceTabId };
    }
    if (message.type === 'UI_IMAGE_STATE') {
      const tabId = Number(message.tabId);
      const session = await readImageSession(tabId);
      return imageDownloadState(await readSettings(), tabId, session?.pageUrl || '');
    }
    if (message.type === 'UI_IMAGE_RESCAN') {
      const tabId = Number(message.tabId);
      await sessionUpdates.run(tabId, async () => {
        const session = await readImageSession(tabId);
        if (!session) throw new Error('Image Download is not active in this tab.');
        await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
        await saveImageSession(activateDownloadScan(session));
      });
      await scanImageSession(tabId, message.deep === true);
      if (!hasVisibleView(tabId)) await schedulePause(tabId);
      const session = await readImageSession(tabId);
      return imageDownloadState(await readSettings(), tabId, session?.pageUrl || '');
    }
    if (message.type === 'UI_IMAGE_STOP') {
      await stopImageSession(Number(message.tabId));
      return { active: false };
    }
    if (message.type === 'UI_IMAGE_CAPTURE_AREA') return beginImageCapture(Number(message.tabId));
    if (message.type === 'UI_IMAGE_UPDATE_METADATA') return updateImageMetadata(Number(message.tabId), String(message.candidateId || ''), message.metadata || {});
    if (message.type === 'UI_IMAGE_DOWNLOAD') return downloadImageSelections(Number(message.tabId), message.selections, message.options || {});
    if (message.type === 'UI_IMAGE_FOCUS_SOURCE') {
      const tabId = Number(message.tabId);
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
      return { focused: true };
    }
    if (message.type === 'UI_SET_IMAGE_SETTING') {
      const name = String(message.name || '');
      if (!['workspaceMode', 'batchMode', 'outputFormat', 'askWhereToSave'].includes(name)) throw new Error('Unknown Image Download setting.');
      const settings = await platform.mutateSettings(current => ({
        ...current,
        imageDownload: { ...current.imageDownload, [name]: message.value }
      }), false);
      return settings.imageDownload;
    }
    throw new Error('Image Download does not support this command.');
  }

  async function handleTabUpdated(tabId, change, tab) {
    if (change.status === 'loading' || change.url) {
      clearPending(tabId);
      clearPageScan(tabId);
    }
    const session = await readImageSession(tabId);
    if (!session) return;
    if (change.url) {
      const nextOrigin = originFromUrl(change.url);
      if (!nextOrigin || nextOrigin !== session.origin) {
        await stopImageSession(tabId, session.origin);
        return;
      }
      await sessionUpdates.run(tabId, async () => {
        const current = await readImageSession(tabId);
        if (!current || current.origin !== nextOrigin) return;
        current.pageUrl = change.url;
        current.title = tab.title || current.title;
        await cleanupImageCaptureArtifacts(current);
        current.candidates = [];
        current.status = 'scanning';
        current.updatedAt = Date.now();
        await saveImageSession(current);
      });
      schedulePageScan(tabId, change.url);
    }
    if (change.status === 'complete') clearPageScan(tabId);
    const current = change.status === 'complete' ? await readImageSession(tabId) : null;
    if (current && downloadScanCollects(current)) await scanImageSession(tabId, false).catch(() => {});
  }

  async function reset() {
    const tabIds = new Set(activeTabs);
    try { await initialize(); } catch {}
    try {
      const values = await chrome.storage.session.get(null);
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith('imageDownloadSession:') && Number.isInteger(value?.tabId)) tabIds.add(value.tabId);
      }
    } catch {}
    await Promise.allSettled([...tabIds].map(stopImageSession));
    await Promise.allSettled([...tabIds].map(async tabId => {
      await setCollecting(tabId, false);
      clearPending(tabId);
      clearPageScan(tabId);
      await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId)).catch(() => {});
      await setFeatureActivity(tabId, FEATURE_IDS.IMAGE_DOWNLOAD, false).catch(() => {});
      if (chrome.sidePanel?.setOptions) await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
    }));
    preparedImageSidePanels.clear();
  }

  return Object.freeze({
    id: FEATURE_IDS.IMAGE_DOWNLOAD,
    initialize,
    state: imageDownloadState,
    prepareWorkspace: prepareImageWorkspaceSidePanel,
    handleMessage,
    connect,
    handleTabUpdated,
    async handleTabRemoved(tabId) {
      await stopImageSession(tabId);
      clearPending(tabId);
      clearPageScan(tabId);
      await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
    },
    handleDownloadChanged: handleImageDownloadChanged,
    async handleHeadersReceived(details) {
      if (!Number.isInteger(details.tabId) || details.tabId < 0 || details.type !== 'image') return;
      await initialize();
      if (!activeTabs.has(details.tabId)) return;
      const mime = imageMimeFromHeaders(details.responseHeaders);
      if (!mime && !imageExtension(details.url)) return;
      queueCandidate(details.tabId, {
        url: details.url,
        mime,
        contentLength: imageContentLength(details.responseHeaders),
        source: 'network',
        originalHint: 1
      });
    },
    async handleAlarm(alarm) {
      const discovery = parseDownloadScanAlarm(alarm.name);
      if (discovery?.product !== 'imageDownload') return false;
      await pauseDiscovery(discovery.tabId);
      return true;
    },
    reset
  });
}
