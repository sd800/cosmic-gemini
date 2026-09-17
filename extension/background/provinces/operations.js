import { FEATURE_IDS, hostnameFromUrl } from '../../core/config.js';
import { createPageRuntimeHost } from '../features/page-runtime-host.js';
import { createAdministrationProduct } from '../products/operations/administration.js';
import { createAnyCopyProduct } from '../products/operations/any-copy.js';
import { createAnyCopyEnhancedProduct } from '../products/operations/any-copy-enhanced.js';
import { createChineseResponseClaudeProduct } from '../products/operations/chinese-response-claude.js';
import { createSatellitesProduct } from '../products/operations/satellites.js';
import { createPageDisplayProduct } from '../products/operations/page-display.js';
import { createXhsImageDarkModeProduct } from '../products/operations/xhs-image-dark-mode.js';
import { defineProvince } from './interface.js';

export function createOperationsProvince(platform) {
  const host = createPageRuntimeHost(platform);
  const anyCopy = createAnyCopyProduct(host, platform);
  const anyCopyEnhanced = createAnyCopyEnhancedProduct(host, platform);
  const satellites = createSatellitesProduct(platform);
  const pageDisplay = createPageDisplayProduct(host, platform);
  const xhsImageDarkMode = createXhsImageDarkModeProduct(host, platform);
  const chineseResponseClaude = createChineseResponseClaudeProduct(host, platform);
  const administration = createAdministrationProduct(platform);
  const products = {
    [anyCopy.id]: anyCopy,
    [anyCopyEnhanced.id]: anyCopyEnhanced,
    [satellites.id]: satellites,
    [pageDisplay.id]: pageDisplay,
    [xhsImageDarkMode.id]: xhsImageDarkMode,
    [chineseResponseClaude.id]: chineseResponseClaude,
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
    if (message.type === 'CG_FEATURE_ACTIVITY') {
      if (governed.id !== FEATURE_IDS.CHINESE_RESPONSE_CLAUDE) {
        throw new Error('Live activity updates are unavailable for this product.');
      }
      const eventHostname = hostnameFromUrl(message.pageUrl || context.sender.url || '');
      const currentHostname = hostnameFromUrl(context.sender.tab?.url || '');
      if (eventHostname && currentHostname && eventHostname !== currentHostname) return { recorded: false };
      const settings = await platform.readSettings();
      const state = await governed.state(settings, senderUrl, senderTabId);
      const active = state.responseDisplay === true && message.active === true;
      await platform.setFeatureActivity(senderTabId, governed.id, active);
      return { recorded: true, active };
    }
    if (message.type === 'CG_FEATURE_INTERVENED') {
      const eventHostname = hostnameFromUrl(message.pageUrl || context.sender.url || '');
      const currentHostname = hostnameFromUrl(context.sender.tab?.url || '');
      if (eventHostname && currentHostname && eventHostname !== currentHostname) return { recorded: false };
      const settings = await platform.readSettings();
      const state = governed.id === FEATURE_IDS.ANY_COPY
        ? await governed.state(settings, senderUrl, senderTabId, await context.resolvePageDirectives?.(senderUrl))
        : await governed.state(settings, senderUrl, senderTabId);
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
        anyCopy.cleanupOrphans(),
        anyCopyEnhanced.cleanupOrphans(),
        xhsImageDarkMode.cleanupOrphans(),
        chineseResponseClaude.initialize()
      ]);
      await satellites.ensureSchedule();
    },
    async getProductState(productId, context) {
      if (productId === chineseResponseClaude.id) return chineseResponseClaude.state(context.settings, context.frameUrl || context.url, context.tabId, context.frameId);
      if (productId === satellites.id) return satellites.state(context.settings);
      if (productId === administration.id) return null;
      return product(productId).state(context.settings, context.url, context.tabId, context.directives);
    },
    async syncProduct(productId, context) {
      return product(productId).sync(context, context.settings);
    },
    handleMessage,
    handleConnect(port) { return platform.connectCentralUi(port); },
    handleTabCreated(tab) { return chineseResponseClaude.handleTabCreated(tab); },
    async handleTabUpdated(tabId, change, tab) {
      if (change.status === 'loading') {
        await platform.clearTabActivity(tabId);
      }
      await chineseResponseClaude.handleTabUpdated(tabId, change, tab);
    },
    async handleTabRemoved(tabId) {
      await anyCopy.removeTab(tabId);
      await anyCopyEnhanced.removeTab(tabId);
      await xhsImageDarkMode.removeTab(tabId);
      await chineseResponseClaude.handleTabRemoved(tabId);
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
    async reset() {
      await Promise.allSettled([satellites.reset(), chineseResponseClaude.reset()]);
    }
  });
}
