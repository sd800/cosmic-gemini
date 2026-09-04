import {
  FEATURE_IDS,
  hostnameFromUrl,
  updateFeature,
  xhsImageDarkReaderState
} from '../../../core/config.js';

const SESSION_PREFIX = 'xhsImageDarkReaderPage:';

export function createXhsImageDarkReaderProduct(pageRuntimeHost, platform) {
  let localePromise = null;
  const key = tabId => SESSION_PREFIX + tabId;

  function locale() {
    if (!localePromise) localePromise = platform.getLocale().catch(() => 'en-US');
    return localePromise;
  }

  async function readPageState(tabId) {
    if (!Number.isInteger(tabId)) return {};
    return (await chrome.storage.session.get(key(tabId)))[key(tabId)] || {};
  }

  async function writePageState(tabId, value) {
    if (!Number.isInteger(tabId)) return false;
    const next = {
      darkModeDetected: value?.darkModeDetected === true,
      processing: value?.processing === true
    };
    const current = await readPageState(tabId);
    if (current.darkModeDetected === next.darkModeDetected && current.processing === next.processing) return false;
    await chrome.storage.session.set({ [key(tabId)]: next });
    platform.notifyCentralUi(tabId);
    await platform.setFeatureActivity(tabId, FEATURE_IDS.XHS_IMAGE_DARK_READER, next.processing);
    return true;
  }

  const product = Object.freeze({
    id: FEATURE_IDS.XHS_IMAGE_DARK_READER,
    bridge: 'content/xhs-image-dark-reader-bridge.js',
    runtime: 'content/xhs-image-dark-reader-runtime.js',
    async state(settings, url, tabId) {
      const state = xhsImageDarkReaderState(settings, url, await readPageState(tabId));
      return state.active ? { ...state, locale: await locale() } : state;
    },
    async sync(context, settings) {
      if (context.frameId !== 0) {
        await pageRuntimeHost.sync(product, context, false);
        return false;
      }
      const state = await product.state(settings, context.topUrl, context.tabId);
      const active = state.active;
      await pageRuntimeHost.sync(product, context, active);
      if (!active) await product.removeTab(context.tabId);
      return active;
    },
    async handleMessage(message, context = {}) {
      if (message.type === 'CG_XHS_IMAGE_DARK_READER_STATUS') {
        const tabId = context.sender?.tab?.id;
        const hostname = hostnameFromUrl(context.sender?.tab?.url || context.sender?.url || '');
        if (context.sender?.frameId !== 0 || hostname !== 'www.xiaohongshu.com') return { recorded: false };
        const settings = await platform.readSettings();
        if (!settings.xhsImageDarkReader.enabled) return { recorded: false };
        return { recorded: await writePageState(tabId, message.status) };
      }
      if (message.type === 'UI_SET_XHS_IMAGE_DARK_READER_ENABLED') {
        const enabled = message.enabled === true;
        const settings = await platform.mutateSettings(current => updateFeature(
          current,
          product.id,
          feature => ({ ...feature, enabled })
        ));
        if (!enabled && Number.isInteger(Number(message.tabId))) await product.removeTab(Number(message.tabId));
        return settings.xhsImageDarkReader;
      }
      if (message.type === 'UI_SET_XHS_IMAGE_DARK_READER_SETTING') {
        const name = String(message.name || '');
        if (!['overrideDarkMode', 'showImageControl', 'controlOpacity'].includes(name)) {
          throw new Error('XHS Image Dark Reader does not support this setting.');
        }
        const value = name === 'controlOpacity'
          ? Math.min(0.9, Math.max(0.2, Number(message.value) || 0.5))
          : message.value === true;
        const settings = await platform.mutateSettings(current => updateFeature(
          current,
          product.id,
          feature => ({ ...feature, [name]: value })
        ));
        return settings.xhsImageDarkReader;
      }
      throw new Error('XHS Image Dark Reader does not support this command.');
    },
    async removeTab(tabId) {
      if (!Number.isInteger(tabId)) return;
      const current = await readPageState(tabId);
      if (!Object.keys(current).length) return;
      await chrome.storage.session.remove(key(tabId));
      await platform.setFeatureActivity(tabId, product.id, false);
    },
    async cleanupOrphans() {
      const [values, tabs] = await Promise.all([chrome.storage.session.get(null), chrome.tabs.query({})]);
      const liveTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger));
      const keys = Object.keys(values).filter(value => {
        if (!value.startsWith(SESSION_PREFIX)) return false;
        const tabId = Number(value.slice(SESSION_PREFIX.length));
        return !Number.isInteger(tabId) || !liveTabIds.has(tabId);
      });
      if (keys.length) await chrome.storage.session.remove(keys);
    },
    clearLocale() { localePromise = null; }
  });

  return product;
}
