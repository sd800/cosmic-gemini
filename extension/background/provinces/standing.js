import {
  FEATURE_IDS,
  featureState,
  hostnameFromUrl,
  normalizeRule,
  updateFeature
} from '../../core/config.js';
import { createPageRuntimeHost } from '../features/page-runtime-host.js';
import { createAdMarshalProduct } from '../products/standing/ad-marshal.js';
import { createAccessControlProduct } from '../products/standing/access-control.js';
import { createWebsiteKnowledgeControlProduct } from '../products/standing/website-knowledge-control.js';
import { createClipboardProtectProduct } from '../products/standing/clipboard-protect.js';
import { createMailtoCaptureProduct } from '../products/standing/mailto-capture.js';
import { createDocumentPreviewProduct } from '../products/standing/document-preview.js';
import { createLangGoogleProduct } from '../products/standing/lang-google.js';
import { createNativeScrollProduct } from '../products/standing/native-scroll.js';
import { createNoAutoplayProduct } from '../products/standing/no-autoplay.js';
import { defineProvince } from './interface.js';

const WEBSITE_BEHAVIORS = new Set(['inactive', 'standard', 'enhanced']);

function withoutRule(rules, rule) { return rules.filter(item => item !== rule); }
function withRule(rules, rule) { return rules.includes(rule) ? rules : [...rules, rule]; }
function alphabetized(rules) { return [...rules].sort((a, b) => a.localeCompare(b)); }
function withoutBehaviorRule(feature, rule) {
  return {
    ...feature,
    inactiveRules: withoutRule(feature.inactiveRules, rule),
    standardRules: withoutRule(feature.standardRules, rule),
    enhancedRules: withoutRule(feature.enhancedRules, rule)
  };
}
function withBehaviorRule(feature, rule, behavior) {
  const next = withoutBehaviorRule(feature, rule);
  if (behavior === 'inactive') next.inactiveRules = withRule(next.inactiveRules, rule);
  if (behavior === 'standard') next.standardRules = withRule(next.standardRules, rule);
  if (behavior === 'enhanced') next.enhancedRules = withRule(next.enhancedRules, rule);
  return next;
}

export function createStandingProvince(platform) {
  const host = createPageRuntimeHost(platform);
  const nativeScroll = createNativeScrollProduct(host);
  const noAutoplay = createNoAutoplayProduct(host);
  const mailtoCapture = createMailtoCaptureProduct(host, platform);
  const documentPreview = createDocumentPreviewProduct(platform);
  const langGoogle = createLangGoogleProduct(platform);
  const clipboardProtect = createClipboardProtectProduct(host, platform);
  const accessControl = createAccessControlProduct(platform);
  const adMarshal = createAdMarshalProduct(host, platform);
  const websiteKnowledgeControl = createWebsiteKnowledgeControlProduct(host, platform);
  const products = {
    [nativeScroll.id]: nativeScroll,
    [noAutoplay.id]: noAutoplay,
    [mailtoCapture.id]: mailtoCapture,
    [documentPreview.id]: documentPreview,
    [langGoogle.id]: langGoogle,
    [clipboardProtect.id]: clipboardProtect,
    [accessControl.id]: accessControl,
    [websiteKnowledgeControl.id]: websiteKnowledgeControl,
    [adMarshal.id]: adMarshal
  };

  function product(productId) {
    const value = products[productId];
    if (!value) throw new Error('Standing Province does not govern this product.');
    return value;
  }

  async function currentPageHostname(message) {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) throw new Error('The current tab is unavailable.');
    const tab = await chrome.tabs.get(tabId);
    const hostname = hostnameFromUrl(tab.url || '');
    if (!hostname || hostname !== normalizeRule(message.hostname || '')) {
      throw new Error('The page changed before the action completed.');
    }
    return hostname;
  }

  async function handleMessage(productId, message, context) {
    const governed = productId && products[productId] ? product(productId) : null;
    const senderUrl = context.sender.tab?.url || message.url || '';
    const senderTabId = context.sender.tab?.id;

    if (message.type === 'CG_FEATURE_INTERVENED') {
      const eventHostname = hostnameFromUrl(message.pageUrl || context.sender.url || '');
      const currentHostname = hostnameFromUrl(context.sender.tab?.url || '');
      const allowedChildFrameReport = governed.id === FEATURE_IDS.NO_AUTOPLAY
        && Number(context.sender.frameId) > 0;
      if (!allowedChildFrameReport && eventHostname && currentHostname && eventHostname !== currentHostname) {
        return { recorded: false };
      }
      const settings = await platform.readSettings();
      const state = await governed.state(settings, senderUrl);
      if (state.active) await platform.setFeatureActivity(senderTabId, governed.id, true);
      return { recorded: state.active };
    }
    if (message.type === 'CG_CONFIG_APPLIED') {
      if (message.active !== true) await platform.setFeatureActivity(senderTabId, governed.id, false);
      return { updated: true };
    }
    if ([websiteKnowledgeControl.id, clipboardProtect.id, accessControl.id, documentPreview.id].includes(governed?.id)) {
      return governed.handleMessage(message, context);
    }
    if (message.type === 'UI_SET_ENABLED') {
      const settings = await platform.mutateSettings(current => updateFeature(current, governed.id, feature => ({
        ...feature,
        enabled: message.enabled === true
      })));
      return settings[governed.id];
    }
    if (message.type === 'UI_SET_AUDIO_AUTOPLAY_ALL_SITES') {
      const settings = await platform.mutateSettings(current => updateFeature(current, FEATURE_IDS.NO_AUTOPLAY, feature => ({
        ...feature,
        audioAutoplayAllSites: message.enabled === true
      })));
      return settings.noAutoplay;
    }
    if (message.type === 'UI_SET_AD_MARSHAL_SITE') return governed.handleMessage(message, context);
    if (message.type === 'UI_ALPHABETIZE_RULES' || message.type === 'UI_CLEAR_RULES') {
      if (!String(context.sender.url || '').startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('Domain rules can be managed only from Settings.');
      }
      const revise = rules => message.type === 'UI_CLEAR_RULES' ? [] : alphabetized(rules);
      if (message.listName === 'behaviorRules'
        && [FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY].includes(governed.id)) {
        const settings = await platform.mutateSettings(current => updateFeature(current, governed.id, feature => ({
          ...feature,
          inactiveRules: revise(feature.inactiveRules),
          standardRules: revise(feature.standardRules),
          enhancedRules: revise(feature.enhancedRules)
        })));
        return settings[governed.id];
      }
      if (governed.id === FEATURE_IDS.NATIVE_SCROLL && message.listName === 'whitelistRules') {
        const settings = await platform.mutateSettings(current => ({
          ...current,
          nsna: { ...current.nsna, whitelistRules: revise(current.nsna.whitelistRules) }
        }));
        return settings.nsna;
      }
      if (governed.id === FEATURE_IDS.NO_AUTOPLAY && message.listName === 'permanentAudioAllowRules') {
        const settings = await platform.mutateSettings(current => updateFeature(current, governed.id, feature => ({
          ...feature,
          permanentAudioAllowRules: revise(feature.permanentAudioAllowRules)
        })));
        return settings[governed.id];
      }
      throw new Error('Unknown Standing Province domain list.');
    }
    if (message.type === 'UI_TOGGLE_PAGE_FEATURE') {
      const hostname = await currentPageHostname(message);
      const settings = await platform.mutateSettings(current => {
        const state = featureState(current, governed.id, `https://${hostname}/`);
        return updateFeature(current, governed.id, feature => {
          if (state.exactBehaviorOverride) return withoutBehaviorRule(feature, hostname);
          return withBehaviorRule(feature, hostname, state.active ? 'inactive' : 'standard');
        });
      });
      return settings[governed.id];
    }
    if (message.type === 'UI_TOGGLE_PAGE_ENHANCED') {
      const hostname = await currentPageHostname(message);
      const settings = await platform.mutateSettings(current => {
        const state = featureState(current, governed.id, `https://${hostname}/`);
        return updateFeature(current, governed.id, feature => withBehaviorRule(
          feature,
          hostname,
          state.active && state.mode === 'enhanced' ? 'standard' : 'enhanced'
        ));
      });
      return settings[governed.id];
    }
    if (message.type === 'UI_SET_BEHAVIOR_RULE' || message.type === 'UI_DELETE_BEHAVIOR_RULE') {
      const rule = normalizeRule(message.rule || '');
      const behavior = message.type === 'UI_SET_BEHAVIOR_RULE' && WEBSITE_BEHAVIORS.has(message.behavior)
        ? message.behavior : '';
      if (message.type === 'UI_SET_BEHAVIOR_RULE' && !behavior) throw new Error('Unknown website behavior.');
      const settings = await platform.mutateSettings(current => updateFeature(current, governed.id, feature => (
        behavior ? withBehaviorRule(feature, rule, behavior) : withoutBehaviorRule(feature, rule)
      )));
      return settings[governed.id];
    }
    if (message.type === 'UI_ADD_NSNA_WHITELIST_RULE' || message.type === 'UI_DELETE_NSNA_WHITELIST_RULE') {
      // Settings views share a document; in-page navigation can retain its original sender URL.
      const allowed = String(context.sender.url || '').startsWith(chrome.runtime.getURL('settings/'));
      if (!allowed) throw new Error('The shared whitelist can be changed only from Settings.');
      const rule = normalizeRule(message.rule || '');
      const settings = await platform.mutateSettings(current => ({
        ...current,
        nsna: {
          ...current.nsna,
          whitelistRules: message.type === 'UI_ADD_NSNA_WHITELIST_RULE'
            ? withRule(current.nsna.whitelistRules, rule)
            : withoutRule(current.nsna.whitelistRules, rule)
        }
      }));
      return settings.nsna;
    }
    if (message.type === 'UI_ADD_RULE' || message.type === 'UI_DELETE_RULE') {
      if (governed.id !== FEATURE_IDS.NO_AUTOPLAY || message.listName !== 'permanentAudioAllowRules') {
        throw new Error('Unknown Standing Province rule.');
      }
      if (message.type === 'UI_ADD_RULE' && !String(context.sender.url || '').startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('That rule must be added from No Autoplay settings.');
      }
      const rule = normalizeRule(message.rule || '');
      const settings = await platform.mutateSettings(current => updateFeature(current, governed.id, feature => ({
        ...feature,
        permanentAudioAllowRules: message.type === 'UI_ADD_RULE'
          ? withRule(feature.permanentAudioAllowRules, rule)
          : withoutRule(feature.permanentAudioAllowRules, rule)
      })));
      return settings[governed.id];
    }
    throw new Error('Standing Province does not support this command.');
  }

  return defineProvince({
    id: 'standing',
    products,
    async initialize() {
      await platform.ensureSettings();
      await Promise.allSettled([adMarshal.reconcile(), accessControl.reconcile(), websiteKnowledgeControl.initialize(), documentPreview.initialize()]);
    },
    async getProductState(productId, context) {
      return product(productId).state(
        context.settings,
        productId === websiteKnowledgeControl.id ? (context.frameUrl || context.url) : context.url,
        context.tabId,
        context.directives
      );
    },
    async syncProduct(productId, context) {
      return product(productId).sync(context, context.settings);
    },
    handleMessage,
    handleDeterminingFilename: (item, suggest) => documentPreview.handleDeterminingFilename(item, suggest),
    handleAlarm: alarm => documentPreview.handleAlarm(alarm),
    handleTabCreated(tab) { return Promise.allSettled([websiteKnowledgeControl.handleTabCreated(tab), documentPreview.handleTabCreated(tab)]); },
    handleTabUpdated(tabId, change, tab) { return Promise.allSettled([
      adMarshal.handleTabUpdated(tabId, change, tab), websiteKnowledgeControl.handleTabUpdated(tabId, change, tab),
      accessControl.handleTabUpdated(tabId, change, tab), langGoogle.handleTabUpdated(tabId, change, tab), documentPreview.handleTabUpdated(tabId, change, tab)
    ]); },
    handleTabRemoved(tabId) { return Promise.allSettled([
      adMarshal.handleTabRemoved(tabId), accessControl.handleTabRemoved(tabId), websiteKnowledgeControl.handleTabRemoved(tabId), documentPreview.handleTabRemoved(tabId)
    ]); },
    handleStorageChanged(changes, areaName) {
      mailtoCapture.handleStorageChanged(changes, areaName);
      return Promise.allSettled([
        adMarshal.handleStorageChanged(changes, areaName),
        accessControl.handleStorageChanged(changes, areaName),
        documentPreview.handleStorageChanged(changes, areaName),
        websiteKnowledgeControl.handleStorageChanged(changes, areaName)
      ]);
    },
    reset() { return Promise.allSettled([adMarshal.reset(), accessControl.reset(), websiteKnowledgeControl.reset(), documentPreview.reset()]); }
  });
}
