import {
  FEATURE_IDS,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  isIpAddress,
  normalizeAccessControlDomain
} from '../../../core/config.js';

const RULE_LIMIT = 1_000;
const REGULAR_RULE_ID_START = 920_001;
const INCOGNITO_RULE_ID_START = 922_001;
const REGULAR_VISIT_RULE_ID_START = 924_001;
const INCOGNITO_VISIT_RULE_ID_START = 926_001;

function ruleIdStart(incognito) {
  return incognito ? INCOGNITO_RULE_ID_START : REGULAR_RULE_ID_START;
}

function isOwnedRule(rule, incognito) {
  const start = ruleIdStart(incognito);
  return Number.isInteger(rule?.id) && rule.id >= start && rule.id < start + RULE_LIMIT;
}

function visitRuleIdStart(incognito) {
  return incognito ? INCOGNITO_VISIT_RULE_ID_START : REGULAR_VISIT_RULE_ID_START;
}

function isVisitRule(rule, incognito) {
  const start = visitRuleIdStart(incognito);
  return Number.isInteger(rule?.id) && rule.id >= start && rule.id < start + RULE_LIMIT;
}

function navigationCondition(domain, tabIds = undefined) {
  const ipAddress = isIpAddress(domain);
  const escapedHost = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    ...(ipAddress
      ? { regexFilter: `^https?://(?:[^/@]*@)?${escapedHost}(?::\\d+)?(?:[/?#]|$)` }
      : { urlFilter: `||${domain}^` }),
    ...(tabIds ? { tabIds } : {}),
    resourceTypes: ['main_frame', 'sub_frame']
  };
}

function blockingRule(domain, id) {
  return {
    id,
    priority: 100,
    action: { type: 'block' },
    condition: navigationCondition(domain)
  };
}

function visitRule(domain, id, tabId) {
  return {
    id,
    priority: 200,
    action: { type: 'allow' },
    condition: navigationCondition(domain, [tabId])
  };
}

function hostnameMatchesDomain(hostname, domain) {
  if (!hostname || !domain) return false;
  if (isIpAddress(domain)) {
    try { return normalizeAccessControlDomain(hostname) === domain; } catch { return false; }
  }
  return hostname === domain || hostname.endsWith('.' + domain);
}

function matchingBlockedDomain(settings, url) {
  if (settings.accessControl?.enabled !== true) return '';
  let hostname = '';
  try { hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; }
  return (settings.accessControl.blockedDomains || []).find(domain => hostnameMatchesDomain(hostname, domain)) || '';
}

function sameCondition(left, right) {
  return left?.urlFilter === right?.urlFilter
    && left?.regexFilter === right?.regexFilter
    && JSON.stringify(left?.tabIds || []) === JSON.stringify(right?.tabIds || [])
    && JSON.stringify(left?.resourceTypes || []) === JSON.stringify(right?.resourceTypes || []);
}

function isVisitRuleFor(rule, domain, tabId) {
  return rule?.priority === 200 && rule?.action?.type === 'allow'
    && sameCondition(rule.condition, navigationCondition(domain, [tabId]));
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
      && saved.condition?.regexFilter === rule.condition.regexFilter
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
    const visits = existing.filter(rule => isVisitRule(rule, incognito));
    const domains = settings.accessControl?.enabled === true
      ? (settings.accessControl.blockedDomains || []).slice(0, RULE_LIMIT)
      : [];
    const visitDomains = settings.accessControl?.allowTemporaryVisits === true ? domains : [];
    const staleVisits = visits.filter(rule => !visitDomains.some(domain => {
      const [tabId] = rule.condition?.tabIds || [];
      return Number.isInteger(tabId) && isVisitRuleFor(rule, domain, tabId);
    }));
    const removeRuleIds = [...owned, ...staleVisits].map(rule => rule.id);
    const start = ruleIdStart(incognito);
    const addRules = domains.map((domain, index) => blockingRule(domain, start + index));
    if (rulesMatch(owned, addRules) && !staleVisits.length) return addRules.length > 0;
    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    }
    return addRules.length > 0;
  }

  function reconcile(settings) {
    return queueNetwork(() => writeRules(settings));
  }

  async function visitRules() {
    if (!chrome.declarativeNetRequest?.getSessionRules) return [];
    const incognito = platform.isIncognitoContext();
    return (await chrome.declarativeNetRequest.getSessionRules()).filter(rule => isVisitRule(rule, incognito));
  }

  async function hasVisitRule(tabId, domain) {
    if (!Number.isInteger(tabId) || !domain) return false;
    return (await visitRules()).some(rule => isVisitRuleFor(rule, domain, tabId));
  }

  async function removeVisitRules(tabId, keepDomain = '') {
    if (!Number.isInteger(tabId) || !chrome.declarativeNetRequest?.updateSessionRules) return false;
    const rules = await visitRules();
    const removeRuleIds = rules
      .filter(rule => rule.condition?.tabIds?.includes(tabId) && (!keepDomain || !isVisitRuleFor(rule, keepDomain, tabId)))
      .map(rule => rule.id);
    if (removeRuleIds.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    return removeRuleIds.length > 0;
  }

  async function allowVisit(tabId, url) {
    if (!chrome.declarativeNetRequest?.updateSessionRules) throw new Error('Access Control is unavailable.');
    const settings = await platform.readSettings();
    if (settings.accessControl?.allowTemporaryVisits !== true) {
      throw new Error('Temporary Access Control visits are disabled.');
    }
    const domain = matchingBlockedDomain(settings, url);
    if (!domain) throw new Error('The current page is not blocked by Access Control.');
    const incognito = platform.isIncognitoContext();
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const visits = rules.filter(rule => isVisitRule(rule, incognito));
    const removeRuleIds = visits.filter(rule => rule.condition?.tabIds?.includes(tabId)).map(rule => rule.id);
    const occupied = new Set(rules.filter(rule => !removeRuleIds.includes(rule.id)).map(rule => rule.id));
    const start = visitRuleIdStart(incognito);
    let id = start;
    while (id < start + RULE_LIMIT && occupied.has(id)) id += 1;
    if (id >= start + RULE_LIMIT) throw new Error('Access Control has reached its temporary visit limit.');
    await chrome.declarativeNetRequest.updateSessionRules({
      ...(removeRuleIds.length ? { removeRuleIds } : {}),
      addRules: [visitRule(domain, id, tabId)]
    });
    await chrome.tabs.reload(tabId);
    return { allowed: true, domain };
  }

  const product = Object.freeze({
    id: FEATURE_IDS.ACCESS_CONTROL,
    async state(settings, url, tabId) {
      const matchedRule = matchingBlockedDomain(settings, url);
      const temporarilyAllowed = settings.accessControl?.allowTemporaryVisits === true
        && !!matchedRule && await hasVisitRule(tabId, matchedRule);
      return {
        ...settings.accessControl,
        active: settings.accessControl?.enabled === true,
        supported: !!matchedRule,
        matchedRule,
        blocked: !!matchedRule && !temporarilyAllowed,
        temporarilyAllowed
      };
    },
    sync() { return false; },
    async handleMessage(message, context) {
      const settingsUrl = chrome.runtime.getURL('settings/');
      const popupUrl = chrome.runtime.getURL('popup/');
      if (message.type === 'UI_ACCESS_CONTROL_ALLOW_VISIT') {
        if (!String(context?.sender?.url || '').startsWith(popupUrl)) {
          throw new Error('A temporary visit can be allowed only from the popup.');
        }
        const tabId = Number(message.tabId);
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!Number.isInteger(tabId) || tab?.id !== tabId) throw new Error('The active page changed before it could be allowed.');
        return queueNetwork(() => allowVisit(tabId, tab.pendingUrl || tab.url || ''));
      }
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
      if (message.type === 'UI_SET_ACCESS_CONTROL_TEMPORARY_VISITS') {
        const settings = await platform.mutateSettings(current => ({
          ...current,
          accessControl: {
            ...current.accessControl,
            allowTemporaryVisits: message.enabled === true
          }
        }));
        void reconcile(settings).catch(() => false);
        return settings.accessControl;
      }
      if (['UI_ALPHABETIZE_RULES', 'UI_CLEAR_RULES'].includes(message.type)
        && message.listName === 'blockedDomains') {
        const settings = await platform.mutateSettings(current => ({
          ...current,
          accessControl: {
            ...current.accessControl,
            blockedDomains: message.type === 'UI_CLEAR_RULES'
              ? []
              : [...(current.accessControl.blockedDomains || [])].sort((a, b) => a.localeCompare(b))
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
    handleTabUpdated(tabId, change, tab) {
      if (!change?.url) return false;
      return queueNetwork(async () => {
        const settings = await platform.readSettings();
        return removeVisitRules(tabId, matchingBlockedDomain(settings, tab?.url || change.url));
      });
    },
    handleTabRemoved(tabId) { return queueNetwork(() => removeVisitRules(tabId)); },
    reconcile,
    reset() { return reconcile(); }
  });

  return product;
}
