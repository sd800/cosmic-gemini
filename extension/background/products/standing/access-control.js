import {
  FEATURE_IDS,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  isIpAddress,
  normalizeAccessControlDomain
} from '../../../core/config.js';
import { createKeyedTaskQueue } from '../../../core/keyed-task-queue.js';

const RULE_LIMIT = 1_000;
const REGULAR_RULE_ID_START = 920_001;
const INCOGNITO_RULE_ID_START = 922_001;
const REGULAR_VISIT_RULE_ID_START = 924_001;
const INCOGNITO_VISIT_RULE_ID_START = 926_001;
const POPUP_PATH = 'popup/index.html';
const PENDING_VISIT_PREFIX = 'accessControlPendingVisit:';
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

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
  return stable(left) === stable(right);
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
      && stable(saved.action) === stable(rule.action)
      && stable(saved.condition) === stable(rule.condition);
  });
}

export function createAccessControlProduct(platform) {
  let networkQueue = Promise.resolve();
  const actionQueue = createKeyedTaskQueue();
  const pendingKey = tabId => PENDING_VISIT_PREFIX + tabId;

  function observeBlockedNavigation(details) {
    if (!Number.isInteger(details?.tabId) || details.tabId < 0
      || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
    void actionQueue.run(details.tabId, async () => {
      const settings = await platform.readSettings();
      const domain = matchingBlockedDomain(settings, details.url);
      if (settings.accessControl?.allowTemporaryVisits !== true || !domain
        || await hasVisitRule(details.tabId, domain)) return;
      const tab = await chrome.tabs.get(details.tabId).catch(() => null);
      if (!tab || !!tab.incognito !== platform.isIncognitoContext()) return;
      // A blocked navigation can leave the tab on a Chrome error page with no
      // readable URL. Keep only this tab's last failed destination for retry.
      await chrome.storage.session.set({ [pendingKey(tab.id)]: details.url });
      await setActionPopup(tab.id, true);
    }).catch(() => {});
  }

  // MV3 listeners must be registered synchronously so a sleeping worker can
  // wake for the blocked navigation. Only failed main-frame loads reach this.
  chrome.webRequest?.onErrorOccurred?.addListener(observeBlockedNavigation,
    { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });

  async function setActionPopup(tabId, blocked) {
    if (!chrome.action?.getPopup || !chrome.action?.setPopup) return false;
    const current = await chrome.action.getPopup({ tabId });
    const standard = current === POPUP_PATH || current === chrome.runtime.getURL(POPUP_PATH);
    if ((blocked && current === '') || (!blocked && standard)) return false;
    await chrome.action.setPopup({ tabId, popup: blocked ? '' : POPUP_PATH });
    return true;
  }

  function syncTabAction(tabId, changedUrl = '') {
    if (!Number.isInteger(tabId) || !chrome.action?.setPopup) return Promise.resolve(false);
    return actionQueue.run(tabId, async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab || !!tab.incognito !== platform.isIncognitoContext()) return false;
      const settings = await platform.readSettings();
      let pending = (await chrome.storage.session.get(pendingKey(tabId)))[pendingKey(tabId)] || '';
      if (changedUrl && changedUrl !== pending && !changedUrl.startsWith('chrome-error:')) {
        if (pending) await chrome.storage.session.remove(pendingKey(tabId));
        pending = '';
      }
      if (settings.accessControl?.enabled !== true || settings.accessControl?.allowTemporaryVisits !== true) {
        if (pending) await chrome.storage.session.remove(pendingKey(tabId));
        return setActionPopup(tabId, false);
      }
      // The current URL may be a page that loaded successfully before a
      // temporary rule was removed. Only a recorded failed navigation should
      // replace the normal popup with the one-time-visit action.
      const domain = matchingBlockedDomain(settings, pending);
      const blocked = !!pending && !!domain && !(await hasVisitRule(tabId, domain));
      return setActionPopup(tabId, blocked);
    });
  }

  async function syncOpenTabs() {
    if (!chrome.action?.setPopup) return;
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)
      && !!tab.incognito === platform.isIncognitoContext()).map(tab => syncTabAction(tab.id)));
  }

  function queueNetwork(task) {
    const operation = networkQueue.then(task);
    networkQueue = operation.catch(() => undefined);
    return operation;
  }

  async function writeRules(providedSettings) {
    if (!chrome.declarativeNetRequest?.getSessionRules || !chrome.declarativeNetRequest?.updateSessionRules) {
      throw new Error('Access Control network rules are unavailable.');
    }
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
      const installed = (await chrome.declarativeNetRequest.getSessionRules())
        .filter(rule => isOwnedRule(rule, incognito));
      if (!rulesMatch(installed, addRules)) {
        throw new Error('Access Control could not verify its blocking rules.');
      }
    }
    return addRules.length > 0;
  }

  async function ensureRules(settings) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await writeRules(settings); }
      catch (error) {
        failure = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw failure;
  }

  function reconcile(settings) {
    return queueNetwork(async () => {
      const current = settings || await platform.readSettings();
      const result = await ensureRules(current);
      return result;
    }).then(async result => { await syncOpenTabs().catch(() => {}); return result; });
  }

  async function changeSettings(revise) {
    try {
      const settings = await platform.mutateSettings(async current => {
        const next = { ...current, accessControl: revise(current.accessControl) };
        // Install the browser rule before the saved list can claim protection.
        await queueNetwork(() => ensureRules(next));
        return next;
      });
      await syncOpenTabs().catch(() => {});
      return settings.accessControl;
    } catch (error) {
      // Storage can fail after a successful rule update. Restore the rules
      // from the last saved settings without replacing the original error.
      await reconcile().catch(() => {});
      throw error;
    }
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
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (error) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
      throw error;
    }
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
      if (!String(context?.sender?.url || '').startsWith(settingsUrl)) {
        throw new Error('Access Control can be changed only from Settings.');
      }
      if (message.type === 'UI_SET_ENABLED') {
        return changeSettings(feature => ({ ...feature, enabled: message.enabled === true }));
      }
      if (message.type === 'UI_SET_ACCESS_CONTROL_TEMPORARY_VISITS') {
        return changeSettings(feature => ({ ...feature, allowTemporaryVisits: message.enabled === true }));
      }
      if (['UI_ALPHABETIZE_RULES', 'UI_CLEAR_RULES'].includes(message.type)
        && message.listName === 'blockedDomains') {
        return changeSettings(feature => ({ ...feature,
          blockedDomains: message.type === 'UI_CLEAR_RULES'
            ? [] : [...(feature.blockedDomains || [])].sort((a, b) => a.localeCompare(b))
        }));
      }
      if (!['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type) || message.listName !== 'blockedDomains') {
        throw new Error('Access Control does not support this command.');
      }
      const domain = normalizeAccessControlDomain(message.rule || '');
      return changeSettings(feature => {
        const domains = feature.blockedDomains || [];
        if (message.type === 'UI_ADD_RULE' && domains.length >= RULE_LIMIT && !domains.includes(domain)) {
          throw new Error('Access Control has reached its domain limit.');
        }
        return { ...feature,
          blockedDomains: message.type === 'UI_ADD_RULE'
            ? addDomain(domains, domain) : domains.filter(item => item !== domain)
        };
      });
    },
    handleStorageChanged(changes, areaName) {
      const incognito = platform.isIncognitoContext();
      const expectedArea = incognito ? 'session' : 'local';
      const key = incognito ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
      if (areaName !== expectedArea || !changes?.[key]) return false;
      const { oldValue, newValue } = changes[key];
      if (JSON.stringify(oldValue?.accessControl) === JSON.stringify(newValue?.accessControl)
        && JSON.stringify(oldValue?.websiteFixer) === JSON.stringify(newValue?.websiteFixer)) return false;
      return reconcile();
    },
    handleTabCreated(tab) { return syncTabAction(tab?.id); },
    handleTabUpdated(tabId, change, tab) {
      if (!change?.url && change?.status !== 'complete') return false;
      const cleanup = change?.url ? queueNetwork(async () => {
        const settings = await platform.readSettings();
        return removeVisitRules(tabId, matchingBlockedDomain(settings, tab?.url || change.url));
      }) : Promise.resolve(false);
      return cleanup.then(() => syncTabAction(tabId, change?.url || ''));
    },
    handleTabRemoved(tabId) {
      return Promise.allSettled([
        queueNetwork(() => removeVisitRules(tabId)),
        actionQueue.run(tabId, () => chrome.storage.session.remove(pendingKey(tabId)))
      ]);
    },
    handleActionClicked(tab) {
      const tabId = tab?.id;
      if (!Number.isInteger(tabId)) return Promise.resolve(false);
      return actionQueue.run(tabId, async () => {
        const current = await chrome.tabs.get(tabId).catch(() => null);
        if (!current?.active || current.windowId !== tab.windowId
          || !!current.incognito !== platform.isIncognitoContext()) return false;
        const settings = await platform.readSettings();
        const pending = (await chrome.storage.session.get(pendingKey(tabId)))[pendingKey(tabId)] || '';
        // Never derive a retry destination from the currently loaded URL.
        // A blocked navigation is explicitly recorded by onErrorOccurred.
        const destination = pending;
        const domain = matchingBlockedDomain(settings, destination);
        if (settings.accessControl?.allowTemporaryVisits !== true || !domain
          || await hasVisitRule(tabId, domain)) {
          await setActionPopup(tabId, false);
          return false;
        }
        const result = await queueNetwork(() => allowVisit(tabId, destination));
        await chrome.storage.session.remove(pendingKey(tabId));
        await setActionPopup(tabId, false);
        return result;
      });
    },
    reconcile,
    reset() { return reconcile(); }
  });

  return product;
}
