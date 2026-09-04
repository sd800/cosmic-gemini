import { FEATURE_IDS, hostnameFromUrl } from '../../core/config.js';
import { createPageRuntimeHost } from '../features/page-runtime-host.js';
import { createAdministrationProduct } from '../products/operations/administration.js';
import { createAnyCopyProduct } from '../products/operations/any-copy.js';
import { createAnyCopyEnhancedProduct } from '../products/operations/any-copy-enhanced.js';
import { createSatellitesProduct } from '../products/operations/satellites.js';
import { createReduceWhitePointProduct } from '../products/operations/reduce-white-point.js';
import { createXhsImageDarkModeProduct } from '../products/operations/xhs-image-dark-mode.js';
import { defineProvince } from './interface.js';

export function createOperationsProvince(platform) {
  const host = createPageRuntimeHost(platform);
  const anyCopy = createAnyCopyProduct(host, platform);
  const anyCopyEnhanced = createAnyCopyEnhancedProduct(host, platform);
  const satellites = createSatellitesProduct(platform);
  const reduceWhitePoint = createReduceWhitePointProduct(host, platform);
  const xhsImageDarkMode = createXhsImageDarkModeProduct(host, platform);
  const administration = createAdministrationProduct(platform);
  const products = {
    [anyCopy.id]: anyCopy,
    [anyCopyEnhanced.id]: anyCopyEnhanced,
    [satellites.id]: satellites,
    [reduceWhitePoint.id]: reduceWhitePoint,
    [xhsImageDarkMode.id]: xhsImageDarkMode,
    [administration.id]: administration
  };

  function product(productId) {
    const value = products[productId];
    if (!value) throw new Error('Operations Province does not govern this product.');
    return value;
  }

  async function handleMessage(productId, message, context) {
    const governed = product(productId);
    const senderUrl = context.sender.tab?.url || message.url || '';
    const senderTabId = context.sender.tab?.id;
    if (message.type === 'CG_FEATURE_INTERVENED') {
      const eventHostname = hostnameFromUrl(message.pageUrl || context.sender.url || '');
      const currentHostname = hostnameFromUrl(context.sender.tab?.url || '');
      if (eventHostname && currentHostname && eventHostname !== currentHostname) return { recorded: false };
      const settings = await platform.readSettings();
      const state = await governed.state(settings, senderUrl, senderTabId);
      if (state.active) await platform.setFeatureActivity(senderTabId, governed.id, true);
      return { recorded: state.active };
    }
    if (message.type === 'CG_CONFIG_APPLIED') {
      if (message.active !== true) await platform.setFeatureActivity(senderTabId, governed.id, false);
      return { updated: true };
    }
    return governed.handleMessage(message, context);
  }

  return defineProvince({
    id: 'operations',
    products,
    async initialize() {
      await platform.ensureSettings();
      await Promise.allSettled([
        platform.clearOrphanedActivity(),
        anyCopyEnhanced.cleanupOrphans(),
        xhsImageDarkMode.cleanupOrphans()
      ]);
      await satellites.ensureSchedule();
    },
    async getProductState(productId, context) {
      if (productId === satellites.id) return satellites.state(context.settings);
      if (productId === administration.id) return null;
      return product(productId).state(context.settings, context.url, context.tabId);
    },
    async syncProduct(productId, context) {
      return product(productId).sync(context, context.settings);
    },
    handleMessage,
    handleConnect(port) { return platform.connectCentralUi(port); },
    async handleTabUpdated(tabId, change) {
      if (change.status === 'loading' || change.url) {
        await Promise.allSettled([
          platform.clearTabActivity(tabId),
          xhsImageDarkMode.removeTab(tabId)
        ]);
      }
    },
    async handleTabRemoved(tabId) {
      await anyCopyEnhanced.removeTab(tabId);
      await xhsImageDarkMode.removeTab(tabId);
      await platform.clearTabActivity(tabId);
    },
    handleWindowCreated() { return platform.handleIncognitoWindowChange(); },
    handleWindowRemoved() { return platform.handleIncognitoWindowChange(); },
    handleAlarm(alarm) { return satellites.handleAlarm(alarm); },
    async handleStorageChanged(changes, areaName) {
      platform.handleStorageChanged(changes, areaName);
      const localeKey = platform.isIncognitoContext() ? 'cosmicGeminiIncognitoLocale' : 'interfaceLocale';
      const localeArea = platform.isIncognitoContext() ? 'session' : 'local';
      if (areaName === localeArea && changes?.[localeKey]) xhsImageDarkMode.clearLocale();
      return satellites.handleStorageChanged(changes, areaName);
    },
    reset() { return satellites.reset(); }
  });
}
