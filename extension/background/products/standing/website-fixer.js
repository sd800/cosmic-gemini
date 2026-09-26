import {
  FEATURE_IDS,
  hostnameFromUrl,
  ruleMatches,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  normalizeWebsiteFixerDomain,
  normalizeWebsiteFixerSite,
  updateFeature,
  websiteFixerState
} from '../../../core/config.js';
import { normalizeGeneralDomainInput } from '../../../core/website-rule-input.js';
import { createStayOnPage, stayDomains } from './website-fixer-stay.js';

const SCRIPT_ID = 'cosmic-gemini-website-fixer-translate';
const SCRIPT_FILE = 'content/website-fixer/website-fixer-translate.js';
const DOMAIN_LIMIT = 100;

const STAY_SCRIPTS = ['cosmic-gemini-website-fixer-stay-main', 'cosmic-gemini-website-fixer-stay-isolated'];

export function createWebsiteFixerProduct(platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const scriptId = id => incognito ? id + '-incognito' : id;
  const contextFile = kind => `content/website-fixer/website-fixer-${kind}-${incognito ? 'incognito' : 'regular'}.js`;
  const stay = createStayOnPage(platform);
  let queue = Promise.resolve();
  const serialize = task => {
    const operation = queue.then(task);
    queue = operation.catch(() => undefined);
    return operation;
  };

  const reconcile = providedSettings => serialize(async () => {
    const settings = providedSettings || await platform.readSettings();
    await stay.reconcile(settings);
    const translate = settings.websiteFixer;
    const translateMatches = translate.enabled && translate.translateOverride.enabled
      ? translate.translateOverride.whitelistDomains.map(domain => `*://*.${domain}/*`).sort() : [];
    const stayMatches = stayDomains(settings).map(domain => `*://*.${domain}/*`).sort();
    const scripts = [{ id: scriptId(SCRIPT_ID), matches: translateMatches, js: [SCRIPT_FILE, contextFile('translate')], world: 'ISOLATED', allFrames: false },
      ...STAY_SCRIPTS.map((id, index) => ({ id: scriptId(id), matches: stayMatches,
        js: index === 0 ? ['content/website-fixer/website-fixer-site-key.js', 'content/website-fixer/website-fixer-stay.js']
          : ['content/website-fixer/website-fixer-stay-browser-menu.js', contextFile('stay')],
        world: index === 0 ? 'MAIN' : 'ISOLATED', allFrames: true, matchOriginAsFallback: true }))];
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: scripts.map(script => script.id) });
    for (const desired of scripts) {
      const current = registered.find(script => script.id === desired.id);
      if (!desired.matches.length) {
        if (current) await chrome.scripting.unregisterContentScripts({ ids: [desired.id] });
        continue;
      }
      const script = { ...desired, runAt: 'document_start', persistAcrossSessions: !incognito };
      if (current && Object.entries(script).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value))) continue;
      if (current) await chrome.scripting.updateContentScripts([script]);
      else await chrome.scripting.registerContentScripts([script]);
    }
  });

  async function ensureReconciled(settings) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await reconcile(settings); }
      catch (error) {
        failure = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw failure;
  }

  return Object.freeze({
    id: FEATURE_IDS.WEBSITE_FIXER,
    state: websiteFixerState,
    async handleMessage(message, context) {
      if (message.type === 'CG_WEBSITE_FIXER_ACTIVATE') {
        const settings = await platform.readSettings(); // Also verifies a fresh private-window session.
        const feature = settings.websiteFixer;
        const fix = ['translateOverride', 'stayOnPage'].includes(message.kind) ? feature[message.kind] : null;
        const hostname = hostnameFromUrl(context.sender.url);
        return { active: !!hostname && feature.enabled && fix?.enabled === true
          && fix.whitelistDomains.some(domain => ruleMatches(hostname, '*.' + domain)) };
      }
      if (message.type === 'CG_WEBSITE_FIXER_CONTEXT_MENU') {
        return stay.handleContextMenu(message, context.sender);
      }
      if (!String(context.sender.url || '').startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('Website Fixer can be changed only from Settings.');
      }
      let revise;
      if (message.type === 'UI_SET_ENABLED') {
        revise = feature => ({ ...feature, enabled: message.enabled === true });
      } else if (['UI_SET_WEBSITE_FIXER_TRANSLATE_OVERRIDE', 'UI_SET_WEBSITE_FIXER_STAY_ON_PAGE'].includes(message.type)) {
        const group = message.type === 'UI_SET_WEBSITE_FIXER_STAY_ON_PAGE' ? 'stayOnPage' : 'translateOverride';
        revise = feature => ({ ...feature, [group]: { ...feature[group], enabled: message.enabled === true } });
      } else if (['UI_ADD_RULE', 'UI_DELETE_RULE', 'UI_ALPHABETIZE_RULES', 'UI_CLEAR_RULES'].includes(message.type)
        && message.listName === 'whitelistDomains') {
        const group = message.settingGroup || 'translateOverride';
        if (!['translateOverride', 'stayOnPage'].includes(group)) throw new Error('Unknown Website Fixer option.');
        const normalize = group === 'stayOnPage' ? normalizeWebsiteFixerSite : normalizeWebsiteFixerDomain;
        const domain = ['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type)
          ? normalize(normalizeGeneralDomainInput(message.rule || '')) : '';
        revise = feature => {
          const current = feature[group].whitelistDomains;
          if (message.type === 'UI_ADD_RULE' && current.length >= DOMAIN_LIMIT && !current.includes(domain)) {
            throw new Error('Website Fixer has reached its domain limit.');
          }
          const domains = message.type === 'UI_ADD_RULE' ? current.includes(domain) ? current : [...current, domain]
            : message.type === 'UI_DELETE_RULE' ? current.filter(item => item !== domain)
              : message.type === 'UI_CLEAR_RULES' ? [] : [...current].sort((a, b) => a.localeCompare(b));
          return { ...feature, [group]: { ...feature[group], whitelistDomains: domains } };
        };
      } else throw new Error('Website Fixer does not support this command.');
      try {
        const settings = await platform.mutateSettings(async current => {
          const next = updateFeature(current, FEATURE_IDS.WEBSITE_FIXER, revise);
          await ensureReconciled(next);
          return next;
        });
        return settings.websiteFixer;
      } catch (error) {
        // A failed storage write or partial registration must leave the last
        // saved website lists and their installed rules in agreement.
        await ensureReconciled().catch(() => {});
        throw error;
      }
    },
    initialize: () => ensureReconciled(),
    handleNavigationRequest: stay.handleNavigationRequest,
    async handleTabCreated(tab) {
      await stay.handleTabCreated(tab);
      return ensureReconciled();
    },
    async handleTabUpdated(tabId, change, tab) {
      await stay.handleTabUpdated(tabId, change, tab);
      if (change.url) return ensureReconciled();
    },
    async handleTabRemoved(tabId) {
      stay.handleTabRemoved(tabId);
      return ensureReconciled();
    },
    handleStorageChanged(changes) {
      const key = platform.isIncognitoContext?.() === true ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
      const change = changes[key];
      if (!change || JSON.stringify(change.oldValue?.websiteFixer) === JSON.stringify(change.newValue?.websiteFixer)) return;
      return ensureReconciled();
    },
    reset() { return serialize(async () => {
      await stay.reset();
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID, ...STAY_SCRIPTS].map(scriptId) });
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
    }); }
  });
}
