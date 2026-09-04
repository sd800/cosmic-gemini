import {
  DEFAULT_INCOGNITO_SETTINGS,
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  hostnameFromUrl,
  INCOGNITO_LOCALE_KEY,
  INCOGNITO_SETTINGS_KEY,
  INCOGNITO_WINDOWS_KEY,
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
  const incognitoContext = chrome.extension?.inIncognitoContext === true;
  const settingsStorage = incognitoContext ? chrome.storage.session : chrome.storage.local;
  const settingsKey = incognitoContext ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
  const localeKey = incognitoContext ? INCOGNITO_LOCALE_KEY : 'interfaceLocale';
  const settingsAreaName = incognitoContext ? 'session' : 'local';
  const defaultSettings = incognitoContext ? DEFAULT_INCOGNITO_SETTINGS : DEFAULT_SETTINGS;
  let writeQueue = Promise.resolve();
  let resettingStorage = false;
  let pageRefreshTimer = 0;
  let toolbarRefreshTimer = 0;
  let incognitoSessionPreparation = null;
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
    await prepareIncognitoSession();
    const keys = incognitoContext ? [settingsKey] : [settingsKey, LEGACY_SETTINGS_KEY];
    const stored = await settingsStorage.get(keys);
    return normalizeSettings(stored[settingsKey] || (!incognitoContext && stored[LEGACY_SETTINGS_KEY]) || defaultSettings);
  }

  async function writeSettings(value) {
    const settings = normalizeSettings(value);
    await settingsStorage.set({ [settingsKey]: settings });
    return settings;
  }

  function saveSettings(value) {
    return queueWrite(() => writeSettings(value));
  }

  async function reconcileIncognitoSession() {
    if (!incognitoContext || typeof chrome.windows?.getAll !== 'function') return false;
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const currentIds = windows
      .filter(window => window.incognito === true && Number.isInteger(window.id))
      .map(window => window.id)
      .sort((a, b) => a - b);
    const stored = await chrome.storage.session.get([
      INCOGNITO_WINDOWS_KEY,
      INCOGNITO_SETTINGS_KEY,
      INCOGNITO_LOCALE_KEY
    ]);
    const previousIds = Array.isArray(stored[INCOGNITO_WINDOWS_KEY])
      ? stored[INCOGNITO_WINDOWS_KEY].filter(Number.isInteger)
      : [];
    const continuingSession = currentIds.some(id => previousIds.includes(id));
    const staleSettings = !continuingSession
      && (stored[INCOGNITO_SETTINGS_KEY] !== undefined || stored[INCOGNITO_LOCALE_KEY] !== undefined);
    if (!currentIds.length || staleSettings) {
      await chrome.storage.session.remove([INCOGNITO_SETTINGS_KEY, INCOGNITO_LOCALE_KEY]);
    }
    if (currentIds.length) await chrome.storage.session.set({ [INCOGNITO_WINDOWS_KEY]: currentIds });
    else await chrome.storage.session.remove(INCOGNITO_WINDOWS_KEY);
    return true;
  }

  function prepareIncognitoSession() {
    if (!incognitoContext) return Promise.resolve(false);
    if (!incognitoSessionPreparation) {
      incognitoSessionPreparation = reconcileIncognitoSession().catch(error => {
        incognitoSessionPreparation = null;
        throw error;
      });
    }
    return incognitoSessionPreparation;
  }

  function ensureSettings() {
    return queueWrite(async () => {
      await prepareIncognitoSession();
      const keys = incognitoContext ? [settingsKey] : [settingsKey, LEGACY_SETTINGS_KEY];
      const stored = await settingsStorage.get(keys);
      const settings = await writeSettings(stored[settingsKey] || (!incognitoContext && stored[LEGACY_SETTINGS_KEY]) || defaultSettings);
      if (!incognitoContext && stored[LEGACY_SETTINGS_KEY]) await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
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
      xhsImageDarkReader: value?.xhsImageDarkReader === true,
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
    return {
      nativeScroll: false,
      noAutoplay: false,
      anyCopy: false,
      anyCopyEnhanced: false,
      xhsImageDarkReader: false,
      imageDownload: false,
      videoDownload: false
    };
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
      activity.xhsImageDarkReader && 'XHS Image Dark Reader',
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
    await prepareIncognitoSession();
    const stored = await settingsStorage.get(localeKey);
    return normalizeLocale(stored[localeKey] || chrome.i18n.getUILanguage());
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
    const settings = normalizeSettings(value || defaultSettings);
    return JSON.stringify({
      nsna: settings.nsna,
      nativeScroll: settings.nativeScroll,
      noAutoplay: settings.noAutoplay,
      anyCopy: settings.anyCopy,
      xhsImageDarkReader: settings.xhsImageDarkReader,
      mailtoCapture: settings.mailtoCapture,
      adMarshal: settings.adMarshal
    });
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== settingsAreaName || !changes || typeof changes !== 'object') return false;
    const settingsChange = changes[settingsKey] || (!incognitoContext && changes[LEGACY_SETTINGS_KEY]);
    if (settingsChange && pageSettingsSignature(settingsChange.oldValue) !== pageSettingsSignature(settingsChange.newValue)) {
      scheduleOpenPageRefresh();
    }
    if (changes[localeKey]) {
      scheduleToolbarRefresh();
      scheduleOpenPageRefresh();
    }
    if (settingsChange || changes[localeKey]) notifyCentralUi();
    return !!(settingsChange || changes[localeKey]);
  }

  function setLocale(value) {
    const locale = normalizeLocale(value);
    return queueWrite(async () => {
      await prepareIncognitoSession();
      await settingsStorage.set({ [localeKey]: locale });
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
          .filter(key => !RETAINED_DOWNLOAD_PREFIXES.some(prefix => key.startsWith(prefix)))
          .filter(key => key !== INCOGNITO_WINDOWS_KEY)
          .filter(key => incognitoContext || ![INCOGNITO_SETTINGS_KEY, INCOGNITO_LOCALE_KEY].includes(key));
        if (disposableSessionKeys.length) await chrome.storage.session.remove(disposableSessionKeys);
        if (incognitoContext) {
          await chrome.storage.session.remove([INCOGNITO_SETTINGS_KEY, INCOGNITO_LOCALE_KEY]);
        } else {
          await chrome.storage.local.remove([SETTINGS_KEY, LEGACY_SETTINGS_KEY, 'interfaceLocale']);
        }
        const settings = await writeSettings(defaultSettings);
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
    isIncognitoContext: () => incognitoContext,
    handleIncognitoWindowChange: () => queueWrite(reconcileIncognitoSession),
    resetStorage
  });
}
