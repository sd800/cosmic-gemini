import {
  FEATURE_IDS,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  normalizeAccessControlDomain
} from '../../../core/config.js';

const RULE_LIMIT = 1_000;
const REGULAR_RULE_ID_START = 920_001;
const INCOGNITO_RULE_ID_START = 922_001;

function ruleIdStart(incognito) {
  return incognito ? INCOGNITO_RULE_ID_START : REGULAR_RULE_ID_START;
}

function isOwnedRule(rule, incognito) {
  const start = ruleIdStart(incognito);
  return Number.isInteger(rule?.id) && rule.id >= start && rule.id < start + RULE_LIMIT;
}

function blockingRule(domain, id) {
  return {
    id,
    priority: 100,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame', 'sub_frame']
    }
  };
}

function addDomain(domains, domain) {
  return domains.includes(domain) ? domains : [...domains, domain];
}

function rulesMatch(existing, desired) {
  if (existing.length !== desired.length) return false;
  const current = new Map(existing.map(rule => [rule.id, rule]));
  return desired.every(rule => {
    const saved = current.get(rule.id);
    return saved?.priority === rule.priority
      && saved.action?.type === 'block'
      && saved.condition?.urlFilter === rule.condition.urlFilter
      && JSON.stringify(saved.condition?.resourceTypes || []) === JSON.stringify(rule.condition.resourceTypes);
  });
}

export function createAccessControlProduct(platform) {
  let networkQueue = Promise.resolve();

  function queueNetwork(task) {
    const operation = networkQueue.then(task);
    networkQueue = operation.catch(() => undefined);
    return operation;
  }

  async function writeRules(providedSettings) {
    if (!chrome.declarativeNetRequest?.getSessionRules || !chrome.declarativeNetRequest?.updateSessionRules) return false;
    const settings = providedSettings || await platform.readSettings();
    const incognito = platform.isIncognitoContext();
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const owned = existing.filter(rule => isOwnedRule(rule, incognito));
    const removeRuleIds = owned.map(rule => rule.id);
    const domains = settings.accessControl?.enabled === true
      ? (settings.accessControl.blockedDomains || []).slice(0, RULE_LIMIT)
      : [];
    const start = ruleIdStart(incognito);
    const addRules = domains.map((domain, index) => blockingRule(domain, start + index));
    if (rulesMatch(owned, addRules)) return addRules.length > 0;
    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    }
    return addRules.length > 0;
  }

  function reconcile(settings) {
    return queueNetwork(() => writeRules(settings));
  }

  const product = Object.freeze({
    id: FEATURE_IDS.ACCESS_CONTROL,
    state(settings) { return { ...settings.accessControl, active: settings.accessControl?.enabled === true }; },
    sync() { return false; },
    async handleMessage(message, context) {
      const settingsUrl = chrome.runtime.getURL('settings/');
      if (!String(context?.sender?.url || '').startsWith(settingsUrl)) {
        throw new Error('Access Control can be changed only from Settings.');
      }
      if (message.type === 'UI_SET_ENABLED') {
        const settings = await platform.mutateSettings(current => ({
          ...current,
          accessControl: { ...current.accessControl, enabled: message.enabled === true }
        }));
        void reconcile(settings).catch(() => false);
        return settings.accessControl;
      }
      if (message.type === 'UI_ALPHABETIZE_RULES' && message.listName === 'blockedDomains') {
        const settings = await platform.mutateSettings(current => ({
          ...current,
          accessControl: {
            ...current.accessControl,
            blockedDomains: [...(current.accessControl.blockedDomains || [])]
              .sort((a, b) => a.localeCompare(b))
          }
        }));
        void reconcile(settings).catch(() => false);
        return settings.accessControl;
      }
      if (!['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type) || message.listName !== 'blockedDomains') {
        throw new Error('Access Control does not support this command.');
      }
      const domain = normalizeAccessControlDomain(message.rule || '');
      const settings = await platform.mutateSettings(current => {
        const domains = current.accessControl.blockedDomains || [];
        if (message.type === 'UI_ADD_RULE' && domains.length >= RULE_LIMIT && !domains.includes(domain)) {
          throw new Error('Access Control has reached its domain limit.');
        }
        return {
          ...current,
          accessControl: {
            ...current.accessControl,
            blockedDomains: message.type === 'UI_ADD_RULE'
              ? addDomain(domains, domain)
              : domains.filter(item => item !== domain)
          }
        };
      });
      void reconcile(settings).catch(() => false);
      return settings.accessControl;
    },
    handleStorageChanged(changes, areaName) {
      const incognito = platform.isIncognitoContext();
      const expectedArea = incognito ? 'session' : 'local';
      const key = incognito ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
      if (areaName !== expectedArea || !changes?.[key]) return false;
      const { oldValue, newValue } = changes[key];
      if (JSON.stringify(oldValue?.accessControl) === JSON.stringify(newValue?.accessControl)) return false;
      return reconcile();
    },
    reconcile,
    reset() { return reconcile(); }
  });

  return product;
}
