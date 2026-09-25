import { FEATURE_IDS, hostnameFromUrl } from '../core/config.js';
import { DOWNLOAD_SCAN_ALARM_PREFIX } from '../core/download-session.js';
import { DOCUMENT_CLEANUP_ALARM_PREFIX } from '../core/document-preview.js';
import { centralPageDirectives, syncCentralPageProducts } from './central-policy.js';
import { validateMessageSource, validatePortSource } from './message-source.js';
import { createPlatform } from './platform.js';
import { createCustomsProvince } from './provinces/customs.js';
import { createCustomsResponseIngress } from './provinces/customs-response-ingress.js';
import { createOperationsProvince } from './provinces/operations.js';
import { createStandingProvince } from './provinces/standing.js';

export const PROVINCE_PRODUCTS = Object.freeze({
  standing: Object.freeze([FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY, FEATURE_IDS.MAILTO_CAPTURE,
    FEATURE_IDS.CLIPBOARD_PROTECT, FEATURE_IDS.WHITE_SOFTER, FEATURE_IDS.ACCESS_CONTROL, FEATURE_IDS.WEBSITE_KNOWLEDGE_CONTROL,
    FEATURE_IDS.AD_MARSHAL, FEATURE_IDS.WEBSITE_FIXER, FEATURE_IDS.LANG_GOOGLE]),
  operations: Object.freeze([
    FEATURE_IDS.ANY_COPY, FEATURE_IDS.ANY_COPY_ENHANCED, FEATURE_IDS.PAGE_DISPLAY, FEATURE_IDS.LEETCODE_DARK_MODE, FEATURE_IDS.XHS_IMAGE_DARK_MODE,
    FEATURE_IDS.CHINESE_RESPONSE_CLAUDE, FEATURE_IDS.FOLLOW_LIST_INSTAGRAM, 'satellites', 'administration'
  ]),
  customs: Object.freeze([FEATURE_IDS.IMAGE_DOWNLOAD, FEATURE_IDS.VIDEO_DOWNLOAD, FEATURE_IDS.DOCUMENT_PREVIEW])
});

const PAGE_PRODUCTS = Object.freeze([
  FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY, FEATURE_IDS.MAILTO_CAPTURE, FEATURE_IDS.WEBSITE_KNOWLEDGE_CONTROL, FEATURE_IDS.CLIPBOARD_PROTECT, FEATURE_IDS.WHITE_SOFTER,
  FEATURE_IDS.AD_MARSHAL, FEATURE_IDS.LANG_GOOGLE, FEATURE_IDS.ANY_COPY, FEATURE_IDS.ANY_COPY_ENHANCED,
  FEATURE_IDS.PAGE_DISPLAY, FEATURE_IDS.LEETCODE_DARK_MODE, FEATURE_IDS.XHS_IMAGE_DARK_MODE, FEATURE_IDS.CHINESE_RESPONSE_CLAUDE
]);
const STATE_PRODUCTS = Object.freeze([
  ...PAGE_PRODUCTS, FEATURE_IDS.ACCESS_CONTROL, FEATURE_IDS.DOCUMENT_PREVIEW, FEATURE_IDS.WEBSITE_FIXER,
  FEATURE_IDS.FOLLOW_LIST_INSTAGRAM, FEATURE_IDS.IMAGE_DOWNLOAD, FEATURE_IDS.VIDEO_DOWNLOAD,
  'satellites'
]);
const EVENT_PROVINCES = Object.freeze({
  initialize: Object.freeze(['standing', 'operations', 'customs']),
  tabCreated: Object.freeze(['standing', 'operations', 'customs']),
  tabUpdated: Object.freeze(['standing', 'operations', 'customs']),
  tabRemoved: Object.freeze(['standing', 'operations', 'customs']),
  actionClicked: Object.freeze(['standing']),
  windowCreated: Object.freeze(['operations']),
  windowRemoved: Object.freeze(['operations']),
  downloadChanged: Object.freeze(['customs']),
  headersReceived: Object.freeze(['customs']),
  storageChanged: Object.freeze(['standing', 'operations', 'customs'])
});

const platform = createPlatform();
const customsResponseIngress = createCustomsResponseIngress(details => dispatchEvent('headersReceived', details));
const provinces = Object.freeze({
  standing: createStandingProvince(platform),
  operations: createOperationsProvince(platform),
  customs: createCustomsProvince(platform, customsResponseIngress)
});
const productProvince = new Map(Object.entries(PROVINCE_PRODUCTS)
  .flatMap(([provinceId, productIds]) => productIds.map(productId => [productId, provinceId])));

function provinceForProduct(productId) {
  const provinceId = productProvince.get(productId) || 'operations';
  const province = provinces[provinceId];
  if (!province) throw new Error('The assigned province is unavailable.');
  return province;
}

function unavailableProductState(productId, settings) {
  const configured = productId === 'satellites' ? settings.satellites : settings[productId];
  return {
    ...(configured && typeof configured === 'object' ? configured : {}),
    supported: false,
    active: false,
    unavailable: true,
    status: 'unavailable',
    candidates: [],
    groups: []
  };
}

async function resolvedPageDirectives(settings, url, tabId) {
  const initial = centralPageDirectives(settings, url);
  const state = await provinces.operations.getProductState(FEATURE_IDS.ANY_COPY, {
    settings, directives: initial, url, tabId
  });
  return centralPageDirectives(settings, url, { anyCopyActive: state?.active === true });
}

function productForMessage(message) {
  if (message.type === 'UI_ADD_NSNA_WHITELIST_RULE' || message.type === 'UI_DELETE_NSNA_WHITELIST_RULE') {
    return FEATURE_IDS.NATIVE_SCROLL;
  }
  if (message.type === 'UI_SET_AUDIO_AUTOPLAY_ALL_SITES') return FEATURE_IDS.NO_AUTOPLAY;
  if (message.type === 'UI_SET_AD_MARSHAL_SITE') return FEATURE_IDS.AD_MARSHAL;
  if (message.type === 'UI_SET_BILI_DAILY_LOGIN') return 'satellites';
  if (message.type === 'UI_SET_WEBSITE_KNOWLEDGE_SETTING') return FEATURE_IDS.WEBSITE_KNOWLEDGE_CONTROL;
  if (message.type === 'UI_SET_CLAUDE_BROWSER_IDENTITY') return FEATURE_IDS.CHINESE_RESPONSE_CLAUDE;
  if (message.type === 'UI_SET_PAGE_DISPLAY_SETTING') return FEATURE_IDS.PAGE_DISPLAY;
  if (message.type.startsWith('UI_SET_XHS_IMAGE_DARK_MODE')
    || message.type === 'CG_XHS_IMAGE_DARK_MODE_STATUS') return FEATURE_IDS.XHS_IMAGE_DARK_MODE;
  if (/^(?:CG|UI)_IMAGE_|^UI_SET_IMAGE_SETTING$/.test(message.type)) return FEATURE_IDS.IMAGE_DOWNLOAD;
  if (/^(?:CG|UI)_VIDEO_|^UI_SET_VIDEO_SETTING$/.test(message.type)) return FEATURE_IDS.VIDEO_DOWNLOAD;
  if (['UI_GET', 'UI_GET_ACTIVE_PAGE_STATE', 'UI_OPEN_SETTINGS', 'UI_OPEN_ALL_SETTINGS',
    'UI_GET_LOCALE', 'UI_SET_LOCALE', 'UI_RESET_ALL_SETTINGS', 'UI_RELOAD_EXTENSION'].includes(message.type)) return 'administration';
  if (message.featureId) return String(message.featureId);
  return 'administration';
}

async function collectPageState(url, tabId, options = {}) {
  const settings = await platform.readSettings();
  const directives = await resolvedPageDirectives(settings, url, tabId);
  const results = await Promise.allSettled(STATE_PRODUCTS.map(productId =>
    provinceForProduct(productId).getProductState(productId, {
      settings,
      directives,
      url,
      tabId,
      prepareWorkspace: options.prepareWorkspace === true
    })));
  const entries = STATE_PRODUCTS.map((productId, index) => [
    productId,
    results[index].status === 'fulfilled'
      ? results[index].value
      : unavailableProductState(productId, settings)
  ]);
  return {
    incognito: platform.isIncognitoContext(),
    nsna: settings.nsna,
    ...(options.includePreferences === true ? { preferences: settings } : {}),
    ...Object.fromEntries(entries),
    activity: await platform.readActivity(tabId)
  };
}

async function syncPageProducts(sender, message) {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  const documentId = String(sender.documentId || '');
  const frameUrl = sender.url || message.url || '';
  const topUrl = sender.tab?.url || frameUrl;
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId) || !hostnameFromUrl(frameUrl)) {
    throw new Error('The central page controller is unavailable.');
  }
  const settings = await platform.readSettings();
  const directives = await resolvedPageDirectives(settings, topUrl, tabId);
  return syncCentralPageProducts(PAGE_PRODUCTS, directives, productId =>
    provinceForProduct(productId).syncProduct(productId, {
      settings,
      directives,
      tabId,
      frameId,
      documentId,
      frameUrl,
      topUrl
    }));
}

async function collectProductPageState(sender, message) {
  const productId = String(message.featureId || '');
  if (!PAGE_PRODUCTS.includes(productId)) throw new Error('Unknown page product.');
  const url = sender.tab?.url || message.url || sender.url || '';
  const tabId = sender.tab?.id;
  const settings = await platform.readSettings();
  const directives = await resolvedPageDirectives(settings, url, tabId);
  return {
    [productId]: await provinceForProduct(productId).getProductState(productId, {
      settings, directives, url, tabId, frameUrl: sender.url, frameId: sender.frameId
    })
  };
}

async function resetProvinces() {
  await Promise.allSettled(Object.values(provinces).map(province => province.reset()));
}

function messageContext(sender) {
  return Object.freeze({
    sender,
    collectPageState,
    resetProvinces,
    async resolvePageDirectives(url) {
      const settings = await platform.readSettings();
      return resolvedPageDirectives(settings, url, sender.tab?.id);
    }
  });
}

async function dispatchMessage(message, sender) {
  validateMessageSource(message, sender, chrome.runtime.getURL(''));
  if (message.type === 'CG_SYNC_CENTRAL') return syncPageProducts(sender, message);
  if (message.type === 'CG_PAGE_STATE') return collectProductPageState(sender, message);
  const productId = productForMessage(message);
  return provinceForProduct(productId).handleMessage(productId, message, messageContext(sender));
}

async function dispatchEvent(eventName, ...args) {
  const provinceIds = EVENT_PROVINCES[eventName] || [];
  await Promise.allSettled(provinceIds.map(provinceId => {
    const handlerName = eventName === 'initialize' ? 'initialize'
      : eventName === 'tabCreated' ? 'handleTabCreated'
      : eventName === 'tabUpdated' ? 'handleTabUpdated'
      : eventName === 'tabRemoved' ? 'handleTabRemoved'
        : eventName === 'actionClicked' ? 'handleActionClicked'
          : eventName === 'windowCreated' ? 'handleWindowCreated'
            : eventName === 'windowRemoved' ? 'handleWindowRemoved'
              : eventName === 'downloadChanged' ? 'handleDownloadChanged'
                : eventName === 'headersReceived' ? 'handleHeadersReceived'
                  : 'handleStorageChanged';
    return provinces[provinceId][handlerName](...args);
  }));
}
void dispatchEvent('initialize');
chrome.runtime.onInstalled.addListener(() => void dispatchEvent('initialize'));
chrome.runtime.onStartup.addListener(() => void dispatchEvent('initialize'));

chrome.runtime.onConnect.addListener(port => {
  if (!validatePortSource(port, chrome.runtime.getURL(''))) {
    port.disconnect();
    return;
  }
  const province = port.name.startsWith('central-ui:') ? provinces.operations
    : port.name.startsWith('download-view:') ? provinces.customs
      : provinces.operations;
  province.handleConnect(port);
});

chrome.tabs.onCreated?.addListener(tab => void dispatchEvent('tabCreated', tab));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  void dispatchEvent('tabUpdated', tabId, change, tab);
});
chrome.tabs.onRemoved.addListener(tabId => void dispatchEvent('tabRemoved', tabId));
chrome.webRequest.onBeforeRequest.addListener(details => void provinces.standing.handleNavigationRequest(details), { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
chrome.action.onClicked.addListener(tab => void dispatchEvent('actionClicked', tab));
chrome.windows.onCreated.addListener(window => {
  void dispatchEvent('windowCreated', window);
});
chrome.windows.onRemoved.addListener(windowId => {
  void dispatchEvent('windowRemoved', windowId);
});
chrome.downloads.onChanged.addListener(delta => {
  void dispatchEvent('downloadChanged', delta);
});
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  return provinces.customs.handleDeterminingFilename(item, suggest);
});
chrome.alarms.onAlarm.addListener(alarm => {
  const province = alarm.name.startsWith(DOWNLOAD_SCAN_ALARM_PREFIX) ? provinces.customs
    : alarm.name.startsWith(DOCUMENT_CLEANUP_ALARM_PREFIX) ? provinces.customs : provinces.operations;
  void province.handleAlarm(alarm).catch(() => {});
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  void dispatchEvent('storageChanged', changes, areaName);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (['video-download-offscreen', 'image-download-offscreen', 'ephemeral-blob-cache', 'offscreen-resource-status'].includes(message?.target)) return false;
  void (async () => {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid extension message.');
    const result = await dispatchMessage(message, sender);
    sendResponse({ ok: true, result });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
