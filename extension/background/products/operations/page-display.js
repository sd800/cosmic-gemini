import { createPageDisplaySession } from './page-display-session.js';
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
  const temporary = createPageDisplaySession(platform);
  let commands = Promise.resolve();
  const command = task => {
    const result = commands.then(task);
    commands = result.catch(() => undefined);
    return result;
  };
  const pageStyleFiles = Object.freeze(['content/page-display/page-display.css']);
  const refreshPages = () => platform.refreshOpenPages(async context => product.sync(
    { ...context, explicitRefresh: true }, await platform.readSettings()
  )).catch(() => {});
  const product = Object.freeze({
    id: FEATURE_IDS.PAGE_DISPLAY,
    bridge: 'content/page-display/page-display-bridge.js',
    runtime: 'content/page-display/page-display-runtime.js',
    pageStyleFiles,
    preservePageStylesOnRefresh: true,
    awaitConfiguration: true,
    recoverInactiveRuntimeOnRefresh: true,
    async state(settings, url) { return pageDisplayState(settings, url, await temporary.read()); },
    async sync(context, settings) {
      const state = await product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active, active ? pageStyleFiles : []);
      return active;
    },
    handleMessage(message, context = {}) { return command(async () => {
      if (message.type === 'UI_SET_ENABLED' && message.featureId === FEATURE_IDS.PAGE_DISPLAY) {
        const settings = await platform.mutateSettings(current => updateFeature(
          current,
          FEATURE_IDS.PAGE_DISPLAY,
          feature => ({ ...feature, enabled: message.enabled === true })
        ), false);
        await refreshPages();
        return settings.pageDisplay;
      }
      if (['UI_ADD_RULE', 'UI_DELETE_RULE', 'UI_CLEAR_RULES', 'UI_ALPHABETIZE_RULES'].includes(message.type)) {
        if (message.settingGroup !== 'reduceWhitePoint' || message.listName !== 'siteRules') {
          throw new Error('Page Display does not support this website list.');
        }
        const rule = ['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type)
          ? normalizePageDisplaySite(message.rule) : '';
        const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => {
          const kind = message.settingGroup;
          const rules = feature[kind].siteRules;
          if (message.type === 'UI_ADD_RULE' && !rules.includes(rule) && rules.length >= 1000) {
            throw new Error('The website list is full.');
          }
          const siteRules = message.type === 'UI_CLEAR_RULES' ? []
            : message.type === 'UI_ALPHABETIZE_RULES' ? [...rules].sort((a, b) => a.localeCompare(b))
              : message.type === 'UI_DELETE_RULE' ? rules.filter(entry => entry !== rule)
                : rules.includes(rule) ? rules : [...rules, rule];
          return { ...feature, [kind]: { ...feature[kind], siteRules } };
        }), false);
        await refreshPages();
        return settings.pageDisplay;
      }
      if (message.type !== 'UI_SET_PAGE_DISPLAY_SETTING' || !SETTING_NAMES.has(message.name)) {
        throw new Error('Page Display does not support this command.');
      }
      if (message.scope) {
        if (context.sender?.url !== chrome.runtime.getURL('popup/index.html')
          || !['site', 'global'].includes(message.scope)
          || !['reduceWhitePointEnabled', 'greyscaleEnabled'].includes(message.name)
          || typeof message.value !== 'boolean') {
          throw new Error('Unknown display action.');
        }
        if (message.scope === 'site') {
          if (!Number.isInteger(message.tabId) || message.tabId < 0) throw new Error('The current tab is unavailable.');
          const tab = await chrome.tabs.get(message.tabId);
          const hostname = hostnameFromUrl(tab.pendingUrl || tab.url || '');
          const site = hostname ? normalizePageDisplaySite(hostname) : '';
          if (!site || site !== message.expectedSite || hostname !== message.expectedHostname
            || (tab.incognito === true) !== (platform.isIncognitoContext?.() === true)) {
            throw new Error('The page changed before the action completed.');
          }
          const settings = await platform.readSettings();
          if (!settings.pageDisplay.enabled) throw new Error('Page Display is turned off.');
          const kind = message.name === 'greyscaleEnabled' ? 'greyscale' : 'reduceWhitePoint';
          await temporary.set(kind, site, message.value);
          platform.notifyCentralUi?.();
          await refreshPages();
          return settings.pageDisplay;
        }
      }
      const settings = await platform.mutateSettings(current => {
        if (message.scope && !current.pageDisplay.enabled) throw new Error('Page Display is turned off.');
        return updateFeature(current, FEATURE_IDS.PAGE_DISPLAY,
          feature => updatePageDisplaySetting(feature, message.name, message.value));
      }, false);
      await refreshPages();
      return settings.pageDisplay;
    }); },
    reset: () => command(() => temporary.clear())
  });

  return product;
}
