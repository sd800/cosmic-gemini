import {
  FEATURE_IDS,
  hostnameFromUrl,
  normalizePageDisplaySite,
  pageDisplayState,
  updateFeature
} from '../../../core/config.js';

const SETTING_NAMES = Object.freeze(new Set([
  'reduceWhitePointEnabled',
  'reduceWhitePointSiteSpecific',
  'reduction',
  'greyscaleEnabled'
]));

function updatePageDisplaySetting(feature, name, value) {
  if (name === 'reduceWhitePointSiteSpecific') return {
    ...feature, reduceWhitePoint: { ...feature.reduceWhitePoint, siteSpecific: value === true }
  };
  if (name === 'reduceWhitePointEnabled') {
    return {
      ...feature,
      enabled: value === true ? true : feature.enabled,
      reduceWhitePoint: { ...feature.reduceWhitePoint, enabled: value === true }
    };
  }
  if (name === 'greyscaleEnabled') {
    return {
      ...feature,
      enabled: value === true ? true : feature.enabled,
      greyscale: { ...feature.greyscale, enabled: value === true }
    };
  }
  const raw = Number(value);
  const reduction = Number.isFinite(raw) ? Math.min(0.8, Math.max(0.1, raw)) : 0.25;
  return {
    ...feature,
    reduceWhitePoint: { ...feature.reduceWhitePoint, reduction }
  };
}

export function createPageDisplayProduct(pageRuntimeHost, platform) {
  const pageStyleFiles = Object.freeze(['content/page-display/page-display.css']);
  const product = Object.freeze({
    id: FEATURE_IDS.PAGE_DISPLAY,
    bridge: 'content/page-display/page-display-bridge.js',
    runtime: 'content/page-display/page-display-runtime.js',
    pageStyleFiles,
    preservePageStylesOnRefresh: true,
    awaitConfiguration: true,
    state(settings, url) { return pageDisplayState(settings, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active, active ? pageStyleFiles : []);
      return active;
    },
    async handleMessage(message) {
      if (message.type === 'UI_SET_ENABLED' && message.featureId === FEATURE_IDS.PAGE_DISPLAY) {
        const settings = await platform.mutateSettings(current => updateFeature(
          current,
          FEATURE_IDS.PAGE_DISPLAY,
          feature => ({ ...feature, enabled: message.enabled === true })
        ), false);
        await platform.refreshOpenPages().catch(() => {});
        return settings.pageDisplay;
      }
      if (['UI_ADD_RULE', 'UI_DELETE_RULE', 'UI_CLEAR_RULES', 'UI_ALPHABETIZE_RULES'].includes(message.type)) {
        if (message.settingGroup !== 'reduceWhitePoint' || message.listName !== 'siteRules') {
          throw new Error('Page Display does not support this website list.');
        }
        const rule = ['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type)
          ? normalizePageDisplaySite(message.rule) : '';
        const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => {
          const rules = feature.reduceWhitePoint.siteRules;
          if (message.type === 'UI_ADD_RULE' && !rules.includes(rule) && rules.length >= 1000) {
            throw new Error('The website list is full.');
          }
          const siteRules = message.type === 'UI_CLEAR_RULES' ? []
            : message.type === 'UI_ALPHABETIZE_RULES' ? [...rules].sort((a, b) => a.localeCompare(b))
              : message.type === 'UI_DELETE_RULE' ? rules.filter(entry => entry !== rule)
                : rules.includes(rule) ? rules : [...rules, rule];
          return { ...feature, reduceWhitePoint: { ...feature.reduceWhitePoint, siteRules } };
        }), false);
        await platform.refreshOpenPages().catch(() => {});
        return settings.pageDisplay;
      }
      if (message.type !== 'UI_SET_PAGE_DISPLAY_SETTING' || !SETTING_NAMES.has(message.name)) {
        throw new Error('Page Display does not support this command.');
      }
      const settings = await platform.mutateSettings(async current => {
        if (message.name === 'reduceWhitePointEnabled' && message.scope) {
          const feature = current.pageDisplay;
          if (!['site', 'global'].includes(message.scope) || !feature.enabled
            || feature.reduceWhitePoint.siteSpecific !== (message.scope === 'site')) {
            throw new Error('The display settings changed. Please try again.');
          }
          const tabId = message.tabId;
          if (!Number.isInteger(tabId) || tabId < 0) throw new Error('The current tab is unavailable.');
          const tab = await chrome.tabs.get(tabId);
          const hostname = hostnameFromUrl(tab.url || '');
          if (!hostname || hostname !== message.expectedHostname
            || (tab.incognito === true) !== (platform.isIncognitoContext?.() === true)) {
            throw new Error('The page changed before the action completed.');
          }
          if (message.scope === 'site') return updateFeature(current, product.id, value => {
            const rule = normalizePageDisplaySite(hostname), saved = value.reduceWhitePoint;
            if (message.value === true && !saved.siteRules.includes(rule) && saved.siteRules.length >= 1000) {
              throw new Error('The website list is full.');
            }
            const siteRules = message.value === true
              ? saved.siteRules.includes(rule) ? saved.siteRules : [...saved.siteRules, rule]
              : saved.siteRules.filter(entry => entry !== rule);
            return { ...value, reduceWhitePoint: { ...saved, siteRules,
              enabled: message.value === true ? true : saved.enabled } };
          });
        }
        return updateFeature(
          current,
          FEATURE_IDS.PAGE_DISPLAY,
          feature => updatePageDisplaySetting(feature, message.name, message.value)
        );
      }, false);
      await platform.refreshOpenPages().catch(() => {});
      return settings.pageDisplay;
    }
  });

  return product;
}
