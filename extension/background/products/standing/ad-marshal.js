import {
  FEATURE_IDS,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  adMarshalState
} from '../../../core/config.js';

const NEWS_QQ_SITE_ID = 'newsQqCom';
const NEWS_QQ_HOST = 'news.qq.com';
const RULE_ID_START = 1_600_000_000;
const RULE_ID_GROUPS = 20_000_000;
const RULES_PER_TAB = 7;
const TRACKING_DOMAINS = Object.freeze([
  'h.trace.qq.com',
  'btrace.qq.com',
  'otheve.beacon.qq.com',
  'beacon.cdn.qq.com',
  'beaconcdn.qq.com',
  'snowflake.qq.com',
  'oth.str.beacon.qq.com',
  'htrace.wetvinfo.com',
  'svibeacon.onezapp.com'
]);

function isOwnedRule(rule) {
  return Number.isInteger(rule?.id)
    && rule.id >= RULE_ID_START
    && rule.id < RULE_ID_START + RULE_ID_GROUPS * RULES_PER_TAB;
}

function ruleGroupForTab(tabId, occupied) {
  let group = Math.abs(tabId) % RULE_ID_GROUPS;
  for (let attempt = 0; attempt < RULE_ID_GROUPS; attempt += 1) {
    const base = RULE_ID_START + group * RULES_PER_TAB;
    if (!Array.from({ length: RULES_PER_TAB }, (_, index) => base + index).some(id => occupied.has(id))) return base;
    group = (group + 1) % RULE_ID_GROUPS;
  }
  throw new Error('Ad Marshal could not allocate its temporary network rules.');
}

function redirectRule(id, tabId, urlFilter, resourceTypes) {
  return {
    id,
    priority: 100,
    action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.js' } },
    condition: { tabIds: [tabId], urlFilter, resourceTypes }
  };
}

function rulesForTab(tabId, base) {
  return [
    redirectRule(base, tabId, 'universal-report.min.js', ['script']),
    redirectRule(base + 1, tabId, '/news-plugin/sdk/emonitor_', ['script']),
    redirectRule(base + 2, tabId, '/qqindex2021/advertisement/', ['script']),
    {
      id: base + 3,
      priority: 100,
      action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.js' } },
      condition: {
        tabIds: [tabId],
        requestDomains: TRACKING_DOMAINS,
        resourceTypes: ['script']
      }
    },
    {
      id: base + 4,
      priority: 100,
      action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.json' } },
      condition: {
        tabIds: [tabId],
        requestDomains: TRACKING_DOMAINS,
        resourceTypes: ['xmlhttprequest', 'ping', 'other']
      }
    },
    {
      id: base + 5,
      priority: 100,
      action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.html' } },
      condition: {
        tabIds: [tabId],
        requestDomains: TRACKING_DOMAINS,
        resourceTypes: ['sub_frame']
      }
    },
    {
      id: base + 6,
      priority: 100,
      action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-transparent.svg' } },
      condition: {
        tabIds: [tabId],
        requestDomains: TRACKING_DOMAINS,
        resourceTypes: ['image']
      }
    }
  ];
}

export function createAdMarshalProduct(pageRuntimeHost, platform) {
  let networkQueue = Promise.resolve();
  const activeTabs = new Set();
  function queueNetwork(task) {
    const operation = networkQueue.then(task);
    networkQueue = operation.catch(() => undefined);
    return operation;
  }

  const product = Object.freeze({
    id: FEATURE_IDS.AD_MARSHAL,
    bridge: 'content/ad-marshal-bridge.js',
    runtime: 'content/ad-marshal-runtime.js',
    state(settings, url) { return adMarshalState(settings, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      if (context.frameId === 0) await syncTabRules(context.tabId, active);
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_AD_MARSHAL_SITE' || message.siteId !== NEWS_QQ_SITE_ID) {
        throw new Error('Ad Marshal does not support this command.');
      }
      const settings = await platform.mutateSettings(current => ({
        ...current,
        adMarshal: {
          ...current.adMarshal,
          sites: {
            ...current.adMarshal.sites,
            [NEWS_QQ_SITE_ID]: message.enabled === true
          }
        }
      }));
      await reconcile(settings);
      return settings.adMarshal;
    },
    async handleTabUpdated(tabId, change, tab) {
      if (!change.url && change.status !== 'loading') return;
      const settings = await platform.readSettings();
      await syncTabRules(tabId, product.state(settings, tab?.url || change.url || '').active);
    },
    handleTabRemoved(tabId) { return syncTabRules(tabId, false); },
    handleStorageChanged(changes, areaName) {
      const incognito = platform.isIncognitoContext();
      const expectedArea = incognito ? 'session' : 'local';
      const key = incognito ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
      if (areaName !== expectedArea || !changes?.[key]) return false;
      return reconcile();
    },
    reconcile,
    reset() { return reconcile(); }
  });

  async function ownedRules() {
    if (!chrome.declarativeNetRequest?.getSessionRules) return [];
    return (await chrome.declarativeNetRequest.getSessionRules()).filter(isOwnedRule);
  }

  function syncTabRules(tabId, active) {
    if (active === true && activeTabs.has(tabId)) return Promise.resolve(true);
    if (active !== true && !activeTabs.has(tabId)) return Promise.resolve(false);
    return queueNetwork(() => writeTabRules(tabId, active));
  }

  async function writeTabRules(tabId, active) {
    if (!Number.isInteger(tabId) || !chrome.declarativeNetRequest?.updateSessionRules) return false;
    const existing = await ownedRules();
    const removeRuleIds = existing
      .filter(rule => rule.condition?.tabIds?.includes(tabId))
      .map(rule => rule.id);
    const remainingIds = new Set(existing.filter(rule => !removeRuleIds.includes(rule.id)).map(rule => rule.id));
    const addRules = active ? rulesForTab(tabId, ruleGroupForTab(tabId, remainingIds)) : [];
    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    }
    if (active) activeTabs.add(tabId);
    else activeTabs.delete(tabId);
    return active;
  }

  function reconcile(providedSettings) {
    return queueNetwork(() => writeAllRules(providedSettings));
  }

  async function writeAllRules(providedSettings) {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return false;
    const settings = providedSettings || await platform.readSettings();
    const existing = await ownedRules();
    const removeRuleIds = existing.map(rule => rule.id);
    const tabs = settings.adMarshal.sites.newsQqCom
      ? await chrome.tabs.query({ url: ['http://news.qq.com/*', 'https://news.qq.com/*'] })
      : [];
    const occupied = new Set();
    const addRules = [];
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) continue;
      const base = ruleGroupForTab(tab.id, occupied);
      const rules = rulesForTab(tab.id, base);
      rules.forEach(rule => occupied.add(rule.id));
      addRules.push(...rules);
    }
    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    }
    activeTabs.clear();
    for (const tab of tabs) {
      if (Number.isInteger(tab.id)) activeTabs.add(tab.id);
    }
    return addRules.length > 0;
  }

  return product;
}
