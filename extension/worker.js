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

const DEFAULT_ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const ACTIVE_ICONS = { 16: 'icons/icon-suppressing-16.png', 32: 'icons/icon-suppressing-32.png', 48: 'icons/icon-suppressing-48.png', 128: 'icons/icon-suppressing-128.png' };
const ACTIVITY_PREFIX = 'tabActivity:';
const FEATURE_LISTS = new Set(['whitelistRules', 'enhancedRules', 'permanentAudioAllowRules', 'enforcedRules']);
let writeQueue = Promise.resolve();

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

async function mutateSettings(update) {
  writeQueue = writeQueue.then(async () => {
    const current = await readSettings();
    const next = await saveSettings(typeof update === 'function' ? update(current) : update);
    await refreshOpenPages();
    return next;
  });
  return writeQueue;
}

function activityKey(tabId) {
  return ACTIVITY_PREFIX + tabId;
}

async function readActivity(tabId) {
  if (!Number.isInteger(tabId)) return { nativeScroll: false, noAutoplay: false, anyCopy: false };
  try {
    const value = (await chrome.storage.session.get(activityKey(tabId)))[activityKey(tabId)];
    return {
      nativeScroll: value?.nativeScroll === true,
      noAutoplay: value?.noAutoplay === true,
      anyCopy: value?.anyCopy === true
    };
  } catch { return { nativeScroll: false, noAutoplay: false, anyCopy: false }; }
}

async function toolbarTitle(activity) {
  const products = [
    activity.nativeScroll && 'Native Scroll',
    activity.noAutoplay && 'No Autoplay',
    activity.anyCopy && 'Any Copy'
  ].filter(Boolean);
  if (!products.length) return 'Cosmic Gemini';
  const stored = await chrome.storage.local.get('interfaceLocale');
  const locale = normalizeLocale(stored.interfaceLocale || chrome.i18n.getUILanguage());
  const name = products.length === 1 ? products[0] : 'Cosmic Gemini';
  return locale === 'zh-CN' ? name + ' · 正在处理此页面' : name + ' · Working on this page';
}

async function renderToolbar(tabId, activity) {
  if (!Number.isInteger(tabId)) return;
  const active = activity.nativeScroll || activity.noAutoplay || activity.anyCopy;
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
  if (activity.nativeScroll || activity.noAutoplay || activity.anyCopy) await chrome.storage.session.set({ [key]: activity });
  else await chrome.storage.session.remove(key);
  await renderToolbar(tabId, activity);
}

async function clearTabActivity(tabId) {
  if (!Number.isInteger(tabId)) return;
  await chrome.storage.session.remove(activityKey(tabId));
  await renderToolbar(tabId, { nativeScroll: false, noAutoplay: false, anyCopy: false });
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
  const [nativeScroll, noAutoplay, anyCopy, activity] = await Promise.all([
    stateFor(settings, FEATURE_IDS.NATIVE_SCROLL, url),
    stateFor(settings, FEATURE_IDS.NO_AUTOPLAY, url),
    stateFor(settings, FEATURE_IDS.ANY_COPY, url),
    readActivity(tabId)
  ]);
  return { nativeScroll, noAutoplay, anyCopy, activity };
}

function validFeatureId(value) {
  if (!Object.values(FEATURE_IDS).includes(value)) throw new Error('Unknown feature.');
  return value;
}

function validList(featureId, value) {
  if (!FEATURE_LISTS.has(value)) throw new Error('Unknown rule list.');
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

chrome.runtime.onInstalled.addListener(() => { void ensureSettings(); });
chrome.runtime.onStartup.addListener(() => { void ensureSettings(); });

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.url) void clearTabActivity(tabId);
  if (change.url) void cleanupUnusedTemporaryAudio();
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void chrome.storage.session.remove(activityKey(tabId));
  void cleanupUnusedTemporaryAudio();
});

chrome.alarms.onAlarm.addListener(alarm => {
  const hostname = hostnameFromTemporaryAudioAlarm(alarm.name);
  if (hostname) void clearTemporaryAudioAllowed(hostname).then(refreshOpenPages);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    if (message.type === 'UI_GET') {
      sendResponse({ ok: true, result: await pageStates(message.url || '', message.tabId) });
      return;
    }
    if (message.type === 'UI_SET_ENABLED') {
      const featureId = validFeatureId(message.featureId);
      if (featureId === FEATURE_IDS.ANY_COPY) throw new Error('Any Copy is enabled per website.');
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
    if (message.type === 'UI_TOGGLE_ENHANCED' || message.type === 'UI_TOGGLE_WHITELIST') {
      const featureId = validFeatureId(message.featureId);
      const hostname = normalizeRule(message.hostname || '');
      if (hostname.startsWith('*.')) throw new Error('The current-site action requires an exact hostname.');
      if (message.type === 'UI_TOGGLE_WHITELIST' && featureId === FEATURE_IDS.ANY_COPY) throw new Error('Any Copy uses Enforced sites.');
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
        : featureId === FEATURE_IDS.ANY_COPY ? 'settings/any-copy.html' : 'settings/native-scroll.html';
      await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
      sendResponse({ ok: true, result: { opened: true } });
      return;
    }
    throw new Error('Unsupported extension message.');
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
