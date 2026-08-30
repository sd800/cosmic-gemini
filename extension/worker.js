import { DEFAULT_SETTINGS, SETTINGS_KEY, normalizeRule, normalizeSettings, pageState } from './core/config.js';
import { normalizeLocale } from './core/locale.js';

const DEFAULT_ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const SUPPRESSING_ICONS = { 16: 'icons/icon-suppressing-16.png', 32: 'icons/icon-suppressing-32.png', 48: 'icons/icon-suppressing-48.png', 128: 'icons/icon-suppressing-128.png' };
const SUPPRESSION_KEY_PREFIX = 'suppressingTab:';
let writeQueue = Promise.resolve();

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function saveSettings(update) {
  const current = await readSettings();
  const next = normalizeSettings(typeof update === 'function' ? update(current) : update);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
}

function suppressionKey(tabId) {
  return `${SUPPRESSION_KEY_PREFIX}${tabId}`;
}

async function toolbarTitle(suppressing) {
  if (!suppressing) return 'Native Scroll';
  const stored = await chrome.storage.local.get('interfaceLocale');
  const locale = stored.interfaceLocale || chrome.i18n.getUILanguage();
  return normalizeLocale(locale) === 'zh-CN' ? 'Native Scroll · 正在保护此页面' : 'Native Scroll · Protecting this page';
}

async function setToolbarState(tabId, suppressing) {
  if (!Number.isInteger(tabId)) return;
  const key = suppressionKey(tabId);
  await Promise.allSettled([
    suppressing ? chrome.storage.session.set({ [key]: true }) : chrome.storage.session.remove(key),
    chrome.action.setIcon({ tabId, path: suppressing ? SUPPRESSING_ICONS : DEFAULT_ICONS }),
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: await toolbarTitle(suppressing) })
  ]);
}

async function isToolbarSuppressing(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    const key = suppressionKey(tabId);
    return (await chrome.storage.session.get(key))[key] === true;
  } catch { return false; }
}

async function refreshOpenPages() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
    chrome.tabs.sendMessage(tab.id, { type: 'NS_REFRESH_CONFIG' }).catch(() => {})));
}

async function mutateSettings(update) {
  writeQueue = writeQueue.then(async () => {
    const result = await saveSettings(update);
    await refreshOpenPages();
    return result;
  });
  return writeQueue;
}

chrome.runtime.onInstalled.addListener(() => { void ensureSettings(); });
chrome.runtime.onStartup.addListener(() => { void ensureSettings(); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) void setToolbarState(tabId, false);
});
chrome.tabs.onRemoved.addListener(tabId => { void chrome.storage.session.remove(suppressionKey(tabId)); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid extension message.');
    if (message.type === 'NS_PAGE_STATE') {
      const settings = await readSettings();
      const state = pageState(settings, sender.tab?.url || message.url || '');
      sendResponse({ ok: true, result: { ...state, suppressing: await isToolbarSuppressing(sender.tab?.id) } });
      return;
    }
    if (message.type === 'NS_SUPPRESSED') {
      const settings = await readSettings();
      const state = pageState(settings, sender.tab?.url || '');
      if (Number.isInteger(sender.tab?.id) && state.active) await setToolbarState(sender.tab.id, true);
      sendResponse({ ok: true, result: { recorded: state.active } });
      return;
    }
    if (message.type === 'NS_CONFIG_APPLIED') {
      if (Number.isInteger(sender.tab?.id) && message.active !== true) await setToolbarState(sender.tab.id, false);
      sendResponse({ ok: true, result: { updated: true } });
      return;
    }
    if (message.type === 'UI_GET') {
      const settings = await readSettings();
      const state = pageState(settings, message.url || '');
      sendResponse({ ok: true, result: { ...state, suppressing: await isToolbarSuppressing(message.tabId) } });
      return;
    }
    if (message.type === 'UI_SET_ENABLED') {
      const settings = await mutateSettings(current => ({ ...current, enabled: message.enabled === true }));
      if (!settings.enabled) {
        const tabs = await chrome.tabs.query({});
        await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => setToolbarState(tab.id, false)));
      }
      sendResponse({ ok: true, result: settings });
      return;
    }
    if (message.type === 'UI_SET_MODE') {
      const settings = await mutateSettings(current => ({ ...current, mode: message.mode === 'strong' ? 'strong' : 'standard' }));
      sendResponse({ ok: true, result: settings });
      return;
    }
    if (message.type === 'UI_TOGGLE_HOST') {
      const hostname = normalizeRule(message.hostname || '');
      if (hostname.startsWith('*.')) throw new Error('The current-site action requires an exact hostname.');
      const settings = await mutateSettings(current => {
        const whitelist = current.whitelist.includes(hostname)
          ? current.whitelist.filter(rule => rule !== hostname)
          : [...current.whitelist, hostname];
        return { ...current, whitelist };
      });
      sendResponse({ ok: true, result: settings });
      return;
    }
    if (message.type === 'UI_ADD_RULE') {
      const rule = normalizeRule(message.rule || '');
      const settings = await mutateSettings(current => ({ ...current, whitelist: [...current.whitelist, rule] }));
      sendResponse({ ok: true, result: settings });
      return;
    }
    if (message.type === 'UI_DELETE_RULE') {
      const rule = normalizeRule(message.rule || '');
      const settings = await mutateSettings(current => ({ ...current, whitelist: current.whitelist.filter(item => item !== rule) }));
      sendResponse({ ok: true, result: settings });
      return;
    }
    if (message.type === 'UI_OPEN_SETTINGS') {
      await chrome.runtime.openOptionsPage();
      sendResponse({ ok: true, result: { opened: true } });
      return;
    }
    throw new Error('Unsupported extension message.');
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
