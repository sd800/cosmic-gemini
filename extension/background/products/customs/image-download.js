import { FEATURE_IDS } from '../../../core/config.js';
import { normalizeLocale } from '../../../core/locale.js';
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
  mergeImageCandidate,
  normalizeImageCandidate,
  sanitizeImageFilename
} from '../../../core/image-download.js';

export function createImageDownloadProduct(platform, offscreen, observation) {
  const { readSettings, sendTabMessage, setFeatureActivity, notifyCentralUi, runtimeToken } = platform;
  const activeTabs = new Set();
  const pendingNetworkCandidates = new Map();
  const preparedImageSidePanels = new Map();
  const viewPorts = new Map();
  const sendImageOffscreen = message => offscreen.sendImage(message);
  async function restoreCollectingTabs() {
    try {
      const values = await chrome.storage.session.get(null);
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith('imageDownloadSession:') && value?.active === true && Number.isInteger(value.tabId) && downloadScanCollects(value)) {
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

  function queueCandidate(tabId, candidate) {
    const pending = pendingNetworkCandidates.get(tabId) || { candidates: [], timer: 0 };
    pending.candidates.push(candidate);
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
    try {
      const key = imageSessionKey(tabId);
      const session = (await chrome.storage.session.get(key))[key];
      if (session?.active === true) {
        await setCollecting(tabId, downloadScanCollects(session));
        return session;
      }
      await setCollecting(tabId, false);
      return null;
    } catch { return null; }
  }
  
  async function saveImageSession(session) {
    if (!session?.active || !Number.isInteger(session.tabId)) return;
    await setCollecting(session.tabId, downloadScanCollects(session));
    await chrome.storage.session.set({ [imageSessionKey(session.tabId)]: session });
    notifyViews(session.tabId);
    notifyCentralUi(session.tabId);
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
    const session = activateDownloadScan(existing?.origin === origin ? {
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
    await saveImageSession(session);
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
      await sendImageOffscreen({ type: 'CG_IMAGE_CLEANUP_ARTIFACT', artifactId }).catch(() => {});
      await chrome.storage.session.remove(`imageCaptureArtifact:${tabId}:${artifactId}`);
    }
  }
  
  async function stopImageSession(tabId) {
    if (!Number.isInteger(tabId)) return;
    const session = await readImageSession(tabId);
    await cleanupImageCaptureArtifacts(session);
    await initialize();
    await setCollecting(tabId, false);
    clearPending(tabId);
    await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
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
    await offscreen.maybeClose();
  }

  async function pauseDiscovery(tabId) {
    if (hasVisibleView(tabId)) return;
    const session = await readImageSession(tabId);
    if (!session) return;
    await saveImageSession(pauseDownloadScan(session));
    clearPending(tabId);
  }

  async function schedulePause(tabId) {
    if (hasVisibleView(tabId)) return;
    const session = await readImageSession(tabId);
    if (!session || !downloadScanCollects(session)) return;
    const deferred = deferDownloadScan(session);
    await saveImageSession(deferred);
    await chrome.alarms.create(downloadScanAlarmName('imageDownload', tabId), { when: deferred.scanDeadline });
  }

  async function resumeDiscovery(tabId) {
    const session = await readImageSession(tabId);
    if (!session) return;
    const active = activateDownloadScan(session);
    await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
    await saveImageSession(active);
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
      const artifact = await completeImageCapture(senderTabId, message.rect || {});
      return { captured: true, artifactId: artifact.artifactId };
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
      return { active: true, ...workspace };
    }
    if (message.type === 'UI_IMAGE_OPEN_PAGE') {
      const tabId = Number(message.tabId);
      const session = await readImageSession(tabId);
      if (!session) throw new Error('Image Download is not active in this tab.');
      const workspaceTabId = await openImageWorkspacePage(tabId);
      session.workspaceTabId = workspaceTabId;
      await saveImageSession(session);
      return { active: true, mode: 'page', workspaceTabId };
    }
    if (message.type === 'UI_IMAGE_STATE') {
      const tabId = Number(message.tabId);
      const session = await readImageSession(tabId);
      return imageDownloadState(await readSettings(), tabId, session?.pageUrl || '');
    }
    if (message.type === 'UI_IMAGE_RESCAN') {
      const tabId = Number(message.tabId);
      const current = await readImageSession(tabId);
      if (!current) throw new Error('Image Download is not active in this tab.');
      await chrome.alarms.clear(downloadScanAlarmName('imageDownload', tabId));
      await saveImageSession(activateDownloadScan(current));
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
    if (change.status === 'loading' || change.url) clearPending(tabId);
    const session = await readImageSession(tabId);
    if (!session) return;
    if (change.url) {
      const nextOrigin = originFromUrl(change.url);
      if (!nextOrigin || nextOrigin !== session.origin) {
        await stopImageSession(tabId);
        return;
      }
      session.pageUrl = change.url;
      session.title = tab.title || session.title;
      await cleanupImageCaptureArtifacts(session);
      session.candidates = [];
      session.status = 'scanning';
      session.updatedAt = Date.now();
      await saveImageSession(session);
    }
    const current = change.status === 'complete' ? await readImageSession(tabId) : null;
    if (current && downloadScanCollects(current)) await scanImageSession(tabId, false).catch(() => {});
  }

  async function reset() {
    await initialize();
    const values = await chrome.storage.session.get(null);
    const tabIds = Object.entries(values).filter(([key, value]) => key.startsWith('imageDownloadSession:') && Number.isInteger(value?.tabId)).map(([, value]) => value.tabId);
    await Promise.allSettled([...new Set(tabIds)].map(stopImageSession));
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
