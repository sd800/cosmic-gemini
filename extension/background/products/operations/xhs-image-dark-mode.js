import { createContextSessionStorage } from '../../commissions/central-cc.js';
import {
  FEATURE_IDS,
  hostnameFromUrl,
  updateFeature,
  xhsImageDarkModeState
} from '../../../core/config.js';
import { createKeyedTaskQueue } from '../../../core/keyed-task-queue.js';

const SESSION_PREFIX = 'xhsImageDarkModePage:';

export function createXhsImageDarkModeProduct(pageRuntimeHost, platform) {
  const sessionStorage = createContextSessionStorage(platform.isIncognitoContext?.() === true);
  let localePromise = null;
  const pageStateQueue = createKeyedTaskQueue();
  const syncGenerations = new Map();
  let nextSyncGeneration = 0;
  const key = tabId => SESSION_PREFIX + tabId;

  function locale() {
    if (!localePromise) localePromise = platform.getLocale().catch(() => 'en-US');
    return localePromise;
  }

  async function readPageState(tabId) {
    if (!Number.isInteger(tabId)) return {};
    return (await sessionStorage.get(key(tabId)))[key(tabId)] || {};
  }

  async function writePageState(tabId, value, documentId = '') {
    if (!Number.isInteger(tabId)) return false;
    return pageStateQueue.run(tabId, async () => {
      const current = await readPageState(tabId);
      const sequence = Number.isSafeInteger(value?.sequence) && value.sequence > 0 ? value.sequence : 0;
      const nextDocumentId = String(documentId || current.documentId || '');
      const next = {
        documentId: nextDocumentId,
        sequence,
        darkModeDetected: value?.darkModeDetected === true,
        processing: value?.processing === true,
        intervened: value?.intervened === true
      };
      if (current.documentId && next.documentId && current.documentId !== next.documentId) return false;
      const sameDocument = current.documentId === next.documentId;
      const currentSequence = Number(current.sequence) || 0;
      if (sameDocument && currentSequence > 0 && sequence === 0) return false;
      if (sameDocument && sequence && sequence <= currentSequence) return false;
      const stateChanged = current.darkModeDetected !== next.darkModeDetected
        || current.processing !== next.processing
        || current.intervened !== next.intervened;
      const metadataChanged = !sameDocument || sequence !== currentSequence;
      if (!stateChanged && !metadataChanged) return false;
      await sessionStorage.set({ [key(tabId)]: next });
      if (stateChanged) {
        platform.notifyCentralUi(tabId);
        await platform.setFeatureActivity(tabId, FEATURE_IDS.XHS_IMAGE_DARK_MODE, next.intervened);
      }
      return true;
    });
  }

  async function bindPageDocument(tabId, documentId) {
    if (!Number.isInteger(tabId) || !documentId) return;
    await pageStateQueue.run(tabId, async () => {
      const current = await readPageState(tabId);
      if (current.documentId === documentId) return;
      await sessionStorage.set({
        [key(tabId)]: {
          documentId,
          sequence: 0,
          darkModeDetected: false,
          processing: false,
          intervened: false
        }
      });
      platform.notifyCentralUi(tabId);
      await platform.setFeatureActivity(tabId, FEATURE_IDS.XHS_IMAGE_DARK_MODE, false);
    });
  }

  async function updateSettings(update, tabId) {
    const settings = await platform.mutateSettings(current => updateFeature(
      current,
      FEATURE_IDS.XHS_IMAGE_DARK_MODE,
      update
    ), false);
    if (Number.isInteger(tabId)) await platform.refreshTabPage(tabId);
    else await platform.refreshOpenPages();
    return settings;
  }

  const product = Object.freeze({
    id: FEATURE_IDS.XHS_IMAGE_DARK_MODE,
    bridge: 'content/xhs-image-dark-mode/xhs-image-dark-mode-bridge.js',
    runtime: 'content/xhs-image-dark-mode/xhs-image-dark-mode-runtime.js',
    awaitConfiguration: true,
    async state(settings, url, tabId) {
      const state = xhsImageDarkModeState(settings, url, await readPageState(tabId));
      return state.active ? { ...state, locale: await locale() } : state;
    },
    async sync(context, settings) {
      if (context.frameId !== 0) {
        await pageRuntimeHost.sync(product, context, false);
        return false;
      }
      const generation = ++nextSyncGeneration;
      syncGenerations.set(context.tabId, generation);
      const state = await product.state(settings, context.topUrl, context.tabId);
      const active = state.active;
      if (active && syncGenerations.get(context.tabId) === generation) {
        await bindPageDocument(context.tabId, context.documentId);
      }
      if (syncGenerations.get(context.tabId) !== generation) return false;
      await pageRuntimeHost.sync(product, context, active);
      if (!active && syncGenerations.get(context.tabId) === generation) {
        await product.removeTab(context.tabId, context.documentId);
      }
      return active;
    },
    async handleMessage(message, context = {}) {
      if (message.type === 'CG_XHS_IMAGE_DARK_MODE_STATUS') {
        const tabId = context.sender?.tab?.id;
        const hostname = hostnameFromUrl(context.sender?.tab?.url || context.sender?.url || '');
        if (context.sender?.frameId !== 0 || hostname !== 'www.xiaohongshu.com') return { recorded: false };
        const settings = await platform.readSettings();
        if (!settings.xhsImageDarkMode.enabled) return { recorded: false };
        return { recorded: await writePageState(tabId, message.status, context.sender?.documentId) };
      }
      if (message.type === 'UI_SET_XHS_IMAGE_DARK_MODE_ENABLED') {
        const enabled = message.enabled === true;
        const requestedTabId = Number(message.tabId);
        const tabId = Number.isInteger(requestedTabId) ? requestedTabId : null;
        const settings = await updateSettings(feature => ({ ...feature, enabled }), tabId);
        if (!enabled && tabId !== null) await product.removeTab(tabId);
        return settings.xhsImageDarkMode;
      }
      if (message.type === 'UI_SET_XHS_IMAGE_DARK_MODE_SETTING') {
        const name = String(message.name || '');
        if (!['overrideDarkMode', 'showImageControl', 'controlOpacity'].includes(name)) {
          throw new Error('XHS Image Dark Mode does not support this setting.');
        }
        const value = name === 'controlOpacity'
          ? Math.min(0.9, Math.max(0.2, Number(message.value) || 0.5))
          : message.value === true;
        const requestedTabId = Number(message.tabId);
        const tabId = Number.isInteger(requestedTabId) ? requestedTabId : null;
        const settings = await updateSettings(feature => ({ ...feature, [name]: value }), tabId);
        return settings.xhsImageDarkMode;
      }
      throw new Error('XHS Image Dark Mode does not support this command.');
    },
    async removeTab(tabId, documentId = '') {
      if (!Number.isInteger(tabId)) return;
      if (!documentId) syncGenerations.delete(tabId);
      await pageStateQueue.run(tabId, async () => {
        const current = await readPageState(tabId);
        if (!Object.keys(current).length) return;
        if (documentId && current.documentId && current.documentId !== documentId) return;
        await sessionStorage.remove(key(tabId));
        await platform.setFeatureActivity(tabId, product.id, false);
      });
    },
    async cleanupOrphans() {
      const [values, tabs] = await Promise.all([sessionStorage.get(null), chrome.tabs.query({})]);
      const liveTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger));
      const keys = Object.keys(values).filter(value => {
        if (!value.startsWith(SESSION_PREFIX)) return false;
        const tabId = Number(value.slice(SESSION_PREFIX.length));
        return !Number.isInteger(tabId) || !liveTabIds.has(tabId);
      });
      if (keys.length) await sessionStorage.remove(keys);
    },
    clearLocale() { localePromise = null; }
  });

  return product;
}
