import { createSettingsSurface } from '../../features/settings-surface.js';
import { FEATURE_IDS } from '../../../core/config.js';

const SETTINGS_PATHS = Object.freeze({
  [FEATURE_IDS.NATIVE_SCROLL]: 'settings/native-scroll.html',
  [FEATURE_IDS.NO_AUTOPLAY]: 'settings/no-autoplay.html',
  [FEATURE_IDS.ANY_COPY]: 'settings/any-copy.html',
  [FEATURE_IDS.ANY_COPY_ENHANCED]: 'settings/any-copy.html',
  [FEATURE_IDS.IMAGE_DOWNLOAD]: 'settings/image-download.html',
  [FEATURE_IDS.VIDEO_DOWNLOAD]: 'settings/video-download.html',
  [FEATURE_IDS.PAGE_DISPLAY]: 'settings/page-display.html',
  satellites: 'settings/satellites.html'
});

export function createAdministrationProduct(platform) {
  let settingsUrls;
  let reloadTimer = 0;
  const isSettingsPage = url => typeof url === 'string' && (settingsUrls ||= new Set([...Object.values(SETTINGS_PATHS), 'settings/all-settings.html'].map(path => chrome.runtime.getURL(path)))).has(url.split(/[?#]/, 1)[0]);
  const registerSettings = createSettingsSurface(isSettingsPage, 'administration-settings-surface');

  return Object.freeze({
    id: 'administration',
    async handleMessage(message, context) {
      const senderUrl = String(context.sender.url || '');
      if (message.type === 'UI_SETTINGS_OPENED') return registerSettings(context.sender, message.openedAt);
      if (message.type === 'UI_GET_ACTIVE_PAGE_STATE') {
        if (!senderUrl.startsWith(chrome.runtime.getURL('popup/'))) {
          throw new Error('The active page can only be read from the popup.');
        }
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        // Reading popup state must not claim the tab's side panel for Image Download.
        // Each workspace claims it only after the user explicitly opens that product.
        const state = await context.collectPageState(tab?.url || '', tab?.id, { prepareWorkspace: false, includePreferences: true });
        return {
          tab: tab ? { id: tab.id, windowId: tab.windowId, url: tab.url || '', title: tab.title || '' } : null,
          state
        };
      }
      if (message.type === 'UI_GET') {
        if (!senderUrl.startsWith(chrome.runtime.getURL('settings/'))) {
          throw new Error('Settings can only be read from the settings page.');
        }
        return context.collectPageState(message.url || '', message.tabId, {
          prepareWorkspace: false,
          includePreferences: true
        });
      }
      if (message.type === 'UI_OPEN_SETTINGS') {
        const path = SETTINGS_PATHS[message.featureId] || SETTINGS_PATHS[FEATURE_IDS.NATIVE_SCROLL];
        await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
        return { opened: true };
      }
      if (message.type === 'UI_OPEN_ALL_SETTINGS') {
        await chrome.tabs.create({ url: chrome.runtime.getURL('settings/all-settings.html') });
        return { opened: true };
      }
      if (message.type === 'UI_RELOAD_EXTENSION') {
        if (senderUrl !== chrome.runtime.getURL('popup/index.html')) {
          throw new Error('The extension can only be reloaded from the popup.');
        }
        // Acknowledge the command before invalidating popup and worker contexts.
        if (!reloadTimer) reloadTimer = setTimeout(() => chrome.runtime.reload(), 100);
        return { reloading: true };
      }
      if (message.type === 'UI_GET_LOCALE') {
        if (!senderUrl.startsWith(chrome.runtime.getURL(''))) {
          throw new Error('The interface language is available only to extension pages.');
        }
        return { locale: await platform.getLocale() };
      }
      if (message.type === 'UI_SET_LOCALE') {
        if (!senderUrl.startsWith(chrome.runtime.getURL('settings/'))) {
          throw new Error('The interface language can only be changed from settings.');
        }
        return { locale: await platform.setLocale(message.locale) };
      }
      if (message.type === 'UI_RESET_ALL_SETTINGS') {
        if (!senderUrl.startsWith(chrome.runtime.getURL('settings/'))) {
          throw new Error('All settings can only be reset from the settings page.');
        }
        await context.resetProvinces();
        return platform.resetStorage();
      }
      throw new Error('Administration does not support this command.');
    }
  });
}
