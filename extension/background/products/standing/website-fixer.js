import {
  FEATURE_IDS,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  normalizeWebsiteFixerDomain,
  updateFeature,
  websiteFixerState
} from '../../../core/config.js';

const SCRIPT_ID = 'cosmic-gemini-website-fixer-translate';
const SCRIPT_FILE = 'content/website-fixer-translate.js';
const DOMAIN_LIMIT = 100;

function desiredMatches(settings) {
  const feature = settings.websiteFixer;
  if (feature?.enabled !== true || feature.translateOverride?.enabled !== true) return [];
  return feature.translateOverride.whitelistDomains.map(domain => `*://*.${domain}/*`).sort();
}

export function createWebsiteFixerProduct(platform) {
  let queue = Promise.resolve();
  const serialize = task => {
    const operation = queue.then(task);
    queue = operation.catch(() => undefined);
    return operation;
  };

  const reconcile = () => serialize(async () => {
    const settings = await platform.readSettings();
    const matches = desiredMatches(settings);
    const [registered] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (!matches.length) {
      if (registered) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      return false;
    }
    if (registered && JSON.stringify(registered.matches) === JSON.stringify(matches)) return true;
    const script = {
      id: SCRIPT_ID,
      matches,
      js: [SCRIPT_FILE],
      runAt: 'document_start',
      world: 'ISOLATED',
      allFrames: false,
      persistAcrossSessions: true
    };
    if (registered) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
    return true;
  });

  return Object.freeze({
    id: FEATURE_IDS.WEBSITE_FIXER,
    state: websiteFixerState,
    async handleMessage(message, context) {
      if (!String(context.sender.url || '').startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('Website Fixer can be changed only from Settings.');
      }
      let revise;
      if (message.type === 'UI_SET_ENABLED') {
        revise = feature => ({ ...feature, enabled: message.enabled === true });
      } else if (message.type === 'UI_SET_WEBSITE_FIXER_TRANSLATE_OVERRIDE') {
        revise = feature => ({ ...feature, translateOverride: {
          ...feature.translateOverride, enabled: message.enabled === true
        } });
      } else if (['UI_ADD_RULE', 'UI_DELETE_RULE', 'UI_ALPHABETIZE_RULES', 'UI_CLEAR_RULES'].includes(message.type)
        && message.listName === 'whitelistDomains') {
        const domain = ['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type)
          ? normalizeWebsiteFixerDomain(message.rule || '') : '';
        revise = feature => {
          const current = feature.translateOverride.whitelistDomains;
          if (message.type === 'UI_ADD_RULE' && current.length >= DOMAIN_LIMIT && !current.includes(domain)) {
            throw new Error('Website Fixer has reached its domain limit.');
          }
          const domains = message.type === 'UI_ADD_RULE' ? current.includes(domain) ? current : [...current, domain]
            : message.type === 'UI_DELETE_RULE' ? current.filter(item => item !== domain)
              : message.type === 'UI_CLEAR_RULES' ? [] : [...current].sort((a, b) => a.localeCompare(b));
          return { ...feature, translateOverride: { ...feature.translateOverride, whitelistDomains: domains } };
        };
      } else throw new Error('Website Fixer does not support this command.');
      const settings = await platform.mutateSettings(current => updateFeature(current, FEATURE_IDS.WEBSITE_FIXER, revise));
      await reconcile();
      return settings.websiteFixer;
    },
    initialize: reconcile,
    handleStorageChanged(changes) {
      const key = platform.isIncognitoContext?.() === true ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
      const change = changes[key];
      if (!change || JSON.stringify(change.oldValue?.websiteFixer) === JSON.stringify(change.newValue?.websiteFixer)) return;
      return reconcile();
    },
    reset() { return serialize(async () => {
      const [registered] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
      if (registered) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }); }
  });
}
