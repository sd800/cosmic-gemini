import {
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  hostnameFromUrl,
  LEGACY_SETTINGS_KEY,
  SETTINGS_KEY,
  normalizeSettings
} from '../core/config.js';
import { normalizeLocale } from '../core/locale.js';
import { createKeyedTaskQueue } from '../core/keyed-task-queue.js';

const DEFAULT_ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const ACTIVE_ICONS = { 16: 'icons/icon-suppressing-16.png', 32: 'icons/icon-suppressing-32.png', 48: 'icons/icon-suppressing-48.png', 128: 'icons/icon-suppressing-128.png' };
const ACTIVITY_PREFIX = 'tabActivity:';
const LEGACY_AUDIO_SESSION_PREFIXES = ['temporaryAudioAllow:', 'audioPromptShown:'];
const LEGACY_AUDIO_ALARM_PREFIX = 'temporaryAudio:';
const RETAINED_DOWNLOAD_PREFIXES = ['videoDownloadArtifact:', 'imageDownloadArtifact:', 'imageCaptureArtifact:'];

export function createPlatform() {
  let writeQueue = Promise.resolve();
  let resettingStorage = false;
  let pageRefreshTimer = 0;
  let toolbarRefreshTimer = 0;
  const activityQueue = createKeyedTaskQueue();
  const centralUiPorts = new Set();

  function queueWrite(task) {
    const operation = writeQueue.then(task);
    writeQueue = operation.catch(() => undefined);
    return operation;
  }

  function sendTabMessage(tabId, message, options = undefined) {
    return new Promise(resolve => {
      try {
        const callback = response => {
          void chrome.runtime.lastError;
          resolve(response);
        };
        if (options) chrome.tabs.sendMessage(tabId, message, options, callback);
        else chrome.tabs.sendMessage(tabId, message, callback);
      } catch { resolve(undefined); }
    });
  }

  async function readSettings() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
    return normalizeSettings(stored[SETTINGS_KEY] || stored[LEGACY_SETTINGS_KEY] || DEFAULT_SETTINGS);
  }

  async function writeSettings(value) {
    const settings = normalizeSettings(value);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return settings;
  }

  function saveSettings(value) {
    return queueWrite(() => writeSettings(value));
  }

  function ensureSettings() {
    return queueWrite(async () => {
      const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
      const settings = await writeSettings(stored[SETTINGS_KEY] || stored[LEGACY_SETTINGS_KEY] || DEFAULT_SETTINGS);
      if (stored[LEGACY_SETTINGS_KEY]) await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
      return settings;
    });
  }

  async function refreshOpenPages() {
    let tabs;
    try { tabs = await chrome.tabs.query({}); }
    catch { return; }
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id) && hostnameFromUrl(tab.url || ''))
      .map(tab => refreshTabPage(tab.id)));
  }

  function scheduleOpenPageRefresh() {
    if (pageRefreshTimer) return;
    pageRefreshTimer = setTimeout(() => {
      pageRefreshTimer = 0;
      void refreshOpenPages().catch(() => {});
    }, 20);
  }

  async function refreshTabPage(tabId) {
    if (!Number.isInteger(tabId)) return false;
    for (const delay of [0, 80, 240]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        const frames = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'ISOLATED',
          injectImmediately: true,
          func: async () => {
            const controller = globalThis[Symbol.for('cosmic-gemini.central')];
            if (typeof controller?.sync !== 'function') return false;
            await controller.sync();
            return true;
          }
        });
        if (frames.some(frame => frame.result === true)) return true;
      } catch {}
    }
    return false;
  }

  async function mutateSettings(update, refresh = true) {
    return queueWrite(async () => {
      const current = await readSettings();
      const next = await writeSettings(typeof update === 'function' ? update(current) : update);
      if (refresh) scheduleOpenPageRefresh();
      return next;
    });
  }

  function activityKey(tabId) { return ACTIVITY_PREFIX + tabId; }

  async function readActivityRecord(tabId) {
    const value = (await chrome.storage.session.get(activityKey(tabId)))[activityKey(tabId)];
    return {
      nativeScroll: value?.nativeScroll === true,
      noAutoplay: value?.noAutoplay === true,
      anyCopy: value?.anyCopy === true,
      anyCopyEnhanced: value?.anyCopyEnhanced === true,
      imageDownload: value?.imageDownload === true,
      videoDownload: value?.videoDownload === true
    };
  }

  async function readActivity(tabId) {
    if (!Number.isInteger(tabId)) return emptyActivity();
    try { return await readActivityRecord(tabId); }
    catch { return emptyActivity(); }
  }

  function emptyActivity() {
    return { nativeScroll: false, noAutoplay: false, anyCopy: false, anyCopyEnhanced: false, imageDownload: false, videoDownload: false };
  }

  function updateAction(method, details) {
    return new Promise(resolve => {
      try {
        chrome.action[method](details, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch { resolve(); }
    });
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
    let locale = 'en-US';
    try { locale = await getLocale(); } catch {}
    const name = products.length === 1 ? products[0] : 'Cosmic Gemini';
    return locale === 'zh-CN' ? name + ' · 正在处理此页面' : name + ' · Working on this page';
  }

  async function renderToolbar(tabId, activity) {
    if (!Number.isInteger(tabId)) return;
    const active = Object.values(activity).some(Boolean);
    await Promise.allSettled([
      updateAction('setIcon', { tabId, path: active ? ACTIVE_ICONS : DEFAULT_ICONS }),
      updateAction('setBadgeText', { tabId, text: '' }),
      updateAction('setTitle', { tabId, title: await toolbarTitle(activity) })
    ]);
  }

  function notifyCentralUi(tabId) {
    for (const port of centralUiPorts) {
      try {
        port.postMessage(Number.isInteger(tabId)
          ? { type: 'central-state-changed', tabId }
          : { type: 'central-state-changed', global: true });
      } catch {}
    }
  }

  async function setFeatureActivity(tabId, featureId, value) {
    if (resettingStorage || !Number.isInteger(tabId) || !Object.values(FEATURE_IDS).includes(featureId)) return;
    return activityQueue.run(tabId, async () => {
      const activity = await readActivityRecord(tabId);
      activity[featureId] = value === true;
      const key = activityKey(tabId);
      if (Object.values(activity).some(Boolean)) await chrome.storage.session.set({ [key]: activity });
      else await chrome.storage.session.remove(key);
      notifyCentralUi(tabId);
      await renderToolbar(tabId, activity);
    });
  }

  async function clearTabActivity(tabId) {
    if (resettingStorage || !Number.isInteger(tabId)) return;
    return activityQueue.run(tabId, async () => {
      await chrome.storage.session.remove(activityKey(tabId));
      notifyCentralUi(tabId);
      await renderToolbar(tabId, emptyActivity());
    });
  }

  function connectCentralUi(port) {
    if (!['central-ui:popup', 'central-ui:settings'].includes(port.name)) return false;
    centralUiPorts.add(port);
    port.onDisconnect.addListener(() => centralUiPorts.delete(port));
    return true;
  }

  async function clearLegacyAudioPromptState() {
    const values = await chrome.storage.session.get(null);
    const keys = Object.keys(values).filter(key => LEGACY_AUDIO_SESSION_PREFIXES.some(prefix => key.startsWith(prefix)));
    if (keys.length) await chrome.storage.session.remove(keys);
    const alarms = await chrome.alarms.getAll();
    await Promise.allSettled(alarms.filter(alarm => alarm.name.startsWith(LEGACY_AUDIO_ALARM_PREFIX))
      .map(alarm => chrome.alarms.clear(alarm.name)));
  }

  async function clearOrphanedActivity() {
    const [values, tabs] = await Promise.all([chrome.storage.session.get(null), chrome.tabs.query({})]);
    const liveTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger));
    const keys = Object.keys(values).filter(key => {
      if (!key.startsWith(ACTIVITY_PREFIX)) return false;
      const tabId = Number(key.slice(ACTIVITY_PREFIX.length));
      return !Number.isInteger(tabId) || !liveTabIds.has(tabId);
    });
    if (keys.length) await chrome.storage.session.remove(keys);
  }

  async function getLocale() {
    const stored = await chrome.storage.local.get('interfaceLocale');
    return normalizeLocale(stored.interfaceLocale || chrome.i18n.getUILanguage());
  }

  async function refreshToolbarTitles() {
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(async tab => {
        const activity = await readActivity(tab.id);
        await renderToolbar(tab.id, activity);
      }));
    } catch {}
  }

  function scheduleToolbarRefresh() {
    if (toolbarRefreshTimer) return;
    toolbarRefreshTimer = setTimeout(() => {
      toolbarRefreshTimer = 0;
      void refreshToolbarTitles();
    }, 20);
  }

  function pageSettingsSignature(value) {
    const settings = normalizeSettings(value || DEFAULT_SETTINGS);
    return JSON.stringify({
      nsna: settings.nsna,
      nativeScroll: settings.nativeScroll,
      noAutoplay: settings.noAutoplay,
      anyCopy: settings.anyCopy
    });
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes || typeof changes !== 'object') return false;
    const settingsChange = changes[SETTINGS_KEY] || changes[LEGACY_SETTINGS_KEY];
    if (settingsChange && pageSettingsSignature(settingsChange.oldValue) !== pageSettingsSignature(settingsChange.newValue)) {
      scheduleOpenPageRefresh();
    }
    if (changes.interfaceLocale) scheduleToolbarRefresh();
    if (settingsChange || changes.interfaceLocale) notifyCentralUi();
    return !!(settingsChange || changes.interfaceLocale);
  }

  function setLocale(value) {
    const locale = normalizeLocale(value);
    return queueWrite(async () => {
      await chrome.storage.local.set({ interfaceLocale: locale });
      scheduleToolbarRefresh();
      return locale;
    });
  }

  function runtimeToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function resetStorage() {
    return queueWrite(async () => {
      resettingStorage = true;
      try {
        await activityQueue.drain();
        const sessionValues = await chrome.storage.session.get(null);
        const disposableSessionKeys = Object.keys(sessionValues)
          .filter(key => !RETAINED_DOWNLOAD_PREFIXES.some(prefix => key.startsWith(prefix)));
        if (disposableSessionKeys.length) await chrome.storage.session.remove(disposableSessionKeys);
        await chrome.storage.local.remove([SETTINGS_KEY, LEGACY_SETTINGS_KEY, 'interfaceLocale']);
        const settings = await writeSettings(DEFAULT_SETTINGS);
        let tabs = [];
        try { tabs = await chrome.tabs.query({}); } catch {}
        await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => renderToolbar(tab.id, emptyActivity())));
        await refreshOpenPages();
        return settings;
      } finally { resettingStorage = false; }
    });
  }

  return Object.freeze({
    sendTabMessage,
    readSettings,
    saveSettings,
    ensureSettings,
    mutateSettings,
    refreshOpenPages,
    refreshTabPage,
    handleStorageChanged,
    readActivity,
    setFeatureActivity,
    clearTabActivity,
    connectCentralUi,
    notifyCentralUi,
    clearLegacyAudioPromptState,
    clearOrphanedActivity,
    getLocale,
    setLocale,
    runtimeToken,
    resetStorage
  });
}
