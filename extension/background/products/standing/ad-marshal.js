import {
  FEATURE_IDS,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  adMarshalState,
  hostnameFromUrl
} from '../../../core/config.js';

const RULE_ID_START = 1_600_000_000;
const RULE_ID_GROUPS = 20_000_000;
const RULES_PER_TAB = 12;
const SITE_POLICIES = Object.freeze({
  newsQqCom: Object.freeze({
    matches: Object.freeze([
      'http://news.qq.com/*',
      'https://news.qq.com/*',
      'http://view.inews.qq.com/*',
      'https://view.inews.qq.com/*'
    ])
  }),
  wwwQqCom: Object.freeze({
    matches: Object.freeze([
      'http://www.qq.com/*',
      'https://www.qq.com/*'
    ])
  }),
  douyinCom: Object.freeze({
    matches: Object.freeze([
      'http://douyin.com/*',
      'https://douyin.com/*',
      'http://www.douyin.com/*',
      'https://www.douyin.com/*',
      'http://live.douyin.com/*',
      'https://live.douyin.com/*'
    ])
  }),
  zhihuCom: Object.freeze({
    matches: Object.freeze([
      'http://zhihu.com/*',
      'https://zhihu.com/*',
      'http://*.zhihu.com/*',
      'https://*.zhihu.com/*'
    ])
  }),
  gmailCom: Object.freeze({
    matches: Object.freeze([
      'http://mail.google.com/*',
      'https://mail.google.com/*'
    ])
  })
});
const GMAIL_RUNTIME_FRAME_HOSTS = new Set([
  'mail.google.com',
  'chat.google.com',
  'ogs.google.com'
]);
const TENCENT_QQ_TRACKING_DOMAINS = Object.freeze([
  'h.trace.qq.com',
  'btrace.qq.com',
  'otheve.beacon.qq.com',
  'beacon.cdn.qq.com',
  'beaconcdn.qq.com',
  'snowflake.qq.com',
  'oth.str.beacon.qq.com',
  'htrace.wetvinfo.com',
  'svibeacon.onezapp.com',
  'news.ssp.qq.com',
  'op.ssp.qq.com',
  'n.ssp.qq.com'
]);
const WWW_QQ_TRACKING_DOMAINS = Object.freeze([
  ...TENCENT_QQ_TRACKING_DOMAINS,
  'h5.ssp.qq.com'
]);
const DOUYIN_TELEMETRY_DOMAINS = Object.freeze([
  'mon.zijieapi.com',
  'mcs.zijieapi.com',
  'log.zijieapi.com',
  'applog.zijieapi.com',
  'log.snssdk.com',
  'log.byteoversea.com',
  'mon.byteoversea.com',
  'monsetting.toutiao.com',
  'monsetting.toutiaocloud.com'
]);
const ZHIHU_TELEMETRY_DOMAINS = Object.freeze([
  'zhihu-web-analytics.zhihu.com',
  'apm.zhihu.com',
  'datahub.zhihu.com',
  'crash2.zhihu.com',
  'hm.baidu.com'
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

function scriptRedirectRule(id, tabId, urlFilter) {
  return {
    id,
    priority: 100,
    action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.js' } },
    condition: { tabIds: [tabId], urlFilter, resourceTypes: ['script'] }
  };
}

function domainRedirectRule(id, tabId, requestDomains, resourceTypes, extensionPath) {
  return {
    id,
    priority: 100,
    action: { type: 'redirect', redirect: { extensionPath } },
    condition: { tabIds: [tabId], requestDomains, resourceTypes }
  };
}

function newsQqRules(tabId, base) {
  return [
    scriptRedirectRule(base, tabId, 'universal-report.min.js'),
    scriptRedirectRule(base + 1, tabId, '/news-plugin/sdk/emonitor_'),
    scriptRedirectRule(base + 2, tabId, '/qqindex2021/advertisement/'),
    domainRedirectRule(base + 3, tabId, TENCENT_QQ_TRACKING_DOMAINS, ['script'], '/assets/ad-marshal-empty.js'),
    domainRedirectRule(base + 4, tabId, TENCENT_QQ_TRACKING_DOMAINS, ['xmlhttprequest', 'ping', 'other'], '/assets/ad-marshal-empty.json'),
    domainRedirectRule(base + 5, tabId, TENCENT_QQ_TRACKING_DOMAINS, ['sub_frame'], '/assets/ad-marshal-empty.html'),
    domainRedirectRule(base + 6, tabId, TENCENT_QQ_TRACKING_DOMAINS, ['image'], '/assets/ad-marshal-transparent.svg'),
    {
      id: base + 7,
      priority: 100,
      action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.json' } },
      condition: {
        tabIds: [tabId],
        urlFilter: '|http://127.0.0.1:11601/check|',
        resourceTypes: ['xmlhttprequest', 'other']
      }
    },
    {
      id: base + 8,
      priority: 110,
      action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-qq-emonitor.js' } },
      condition: {
        tabIds: [tabId],
        urlFilter: '/qqcdn/news-share/js/custom_',
        resourceTypes: ['script']
      }
    }
  ];
}

function wwwQqRules(tabId, base) {
  return [
    scriptRedirectRule(base, tabId, '/www/js/emonitor/'),
    scriptRedirectRule(base + 1, tabId, 'universal-report.min.js'),
    scriptRedirectRule(base + 2, tabId, '/qqindex2021/advertisement/'),
    domainRedirectRule(base + 3, tabId, WWW_QQ_TRACKING_DOMAINS, ['script'], '/assets/ad-marshal-empty.js'),
    domainRedirectRule(base + 4, tabId, WWW_QQ_TRACKING_DOMAINS, ['xmlhttprequest', 'ping', 'other'], '/assets/ad-marshal-empty.json'),
    domainRedirectRule(base + 5, tabId, WWW_QQ_TRACKING_DOMAINS, ['sub_frame'], '/assets/ad-marshal-empty.html'),
    domainRedirectRule(base + 6, tabId, WWW_QQ_TRACKING_DOMAINS, ['image'], '/assets/ad-marshal-transparent.svg'),
    {
      id: base + 7,
      priority: 100,
      action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.json' } },
      condition: {
        tabIds: [tabId],
        urlFilter: '|http://127.0.0.1:11601/check|',
        resourceTypes: ['xmlhttprequest', 'other']
      }
    }
  ];
}

function douyinRules(tabId, base) {
  return [
    scriptRedirectRule(base, tabId, '/obj/applog-sdk-static/log-sdk/collect/'),
    scriptRedirectRule(base + 1, tabId, '/slardar/fe/sdk-web/browser.cn.js'),
    domainRedirectRule(base + 2, tabId, DOUYIN_TELEMETRY_DOMAINS, ['script'], '/assets/ad-marshal-empty.js'),
    domainRedirectRule(base + 3, tabId, DOUYIN_TELEMETRY_DOMAINS, ['xmlhttprequest', 'ping', 'other'], '/assets/ad-marshal-empty.json'),
    domainRedirectRule(base + 4, tabId, DOUYIN_TELEMETRY_DOMAINS, ['sub_frame'], '/assets/ad-marshal-empty.html'),
    domainRedirectRule(base + 5, tabId, DOUYIN_TELEMETRY_DOMAINS, ['image'], '/assets/ad-marshal-transparent.svg')
  ];
}

function zhihuRules(tabId, base) {
  return [
    scriptRedirectRule(base, tabId, '/@cfe/sentry-script@'),
    scriptRedirectRule(base + 1, tabId, '/za-js-sdk@'),
    domainRedirectRule(base + 2, tabId, ZHIHU_TELEMETRY_DOMAINS, ['script'], '/assets/ad-marshal-empty.js'),
    domainRedirectRule(base + 3, tabId, ZHIHU_TELEMETRY_DOMAINS, ['xmlhttprequest', 'ping', 'other'], '/assets/ad-marshal-empty.json'),
    domainRedirectRule(base + 4, tabId, ZHIHU_TELEMETRY_DOMAINS, ['sub_frame'], '/assets/ad-marshal-empty.html'),
    domainRedirectRule(base + 5, tabId, ZHIHU_TELEMETRY_DOMAINS, ['image'], '/assets/ad-marshal-transparent.svg')
  ];
}

function gmailRules(tabId, base) {
  return [{
    id: base,
    priority: 100,
    action: { type: 'redirect', redirect: { extensionPath: '/assets/ad-marshal-empty.json' } },
    condition: {
      tabIds: [tabId],
      regexFilter: '^https://play\\.google\\.com/log(?:\\?.*)?$',
      resourceTypes: ['xmlhttprequest', 'ping', 'other']
    }
  }];
}

function rulesForTab(tabId, base, siteId) {
  if (siteId === 'newsQqCom') return newsQqRules(tabId, base);
  if (siteId === 'wwwQqCom') return wwwQqRules(tabId, base);
  if (siteId === 'douyinCom') return douyinRules(tabId, base);
  if (siteId === 'zhihuCom') return zhihuRules(tabId, base);
  if (siteId === 'gmailCom') return gmailRules(tabId, base);
  return [];
}

export function createAdMarshalProduct(pageRuntimeHost, platform) {
  let networkQueue = Promise.resolve();
  const activeTabs = new Map();
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
      const gmailFrame = state.siteId === 'gmailCom'
        && GMAIL_RUNTIME_FRAME_HOSTS.has(hostnameFromUrl(context.frameUrl));
      const active = state.active && (context.frameId === 0 || gmailFrame);
      if (context.frameId === 0) await syncTabRules(context.tabId, state.active ? state.siteId : '');
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_AD_MARSHAL_ENABLED') {
        throw new Error('Ad Marshal does not support this command.');
      }
      const settings = await platform.mutateSettings(current => ({
        ...current,
        adMarshal: { enabled: message.enabled === true }
      }));
      void reconcile(settings).catch(() => false);
      return settings.adMarshal;
    },
    async handleTabUpdated(tabId, change, tab) {
      if (!change.url && change.status !== 'loading') return;
      const settings = await platform.readSettings();
      const state = product.state(settings, tab?.url || change.url || '');
      await syncTabRules(tabId, state.active ? state.siteId : '');
    },
    handleTabRemoved(tabId) { return syncTabRules(tabId, ''); },
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

  function syncTabRules(tabId, siteId) {
    const nextSiteId = SITE_POLICIES[siteId] ? siteId : '';
    if (activeTabs.get(tabId) === nextSiteId) return Promise.resolve(!!nextSiteId);
    if (!nextSiteId && !activeTabs.has(tabId)) return Promise.resolve(false);
    return queueNetwork(() => writeTabRules(tabId, nextSiteId));
  }

  async function writeTabRules(tabId, siteId) {
    if (!Number.isInteger(tabId) || !chrome.declarativeNetRequest?.updateSessionRules) return false;
    const existing = await ownedRules();
    const removeRuleIds = existing
      .filter(rule => rule.condition?.tabIds?.includes(tabId))
      .map(rule => rule.id);
    const remainingIds = new Set(existing.filter(rule => !removeRuleIds.includes(rule.id)).map(rule => rule.id));
    const addRules = siteId ? rulesForTab(tabId, ruleGroupForTab(tabId, remainingIds), siteId) : [];
    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    }
    if (siteId) activeTabs.set(tabId, siteId);
    else activeTabs.delete(tabId);
    return !!siteId;
  }

  function reconcile(providedSettings) {
    return queueNetwork(() => writeAllRules(providedSettings));
  }

  async function writeAllRules(providedSettings) {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return false;
    const settings = providedSettings || await platform.readSettings();
    const existing = await ownedRules();
    const removeRuleIds = existing.map(rule => rule.id);
    const enabledPolicies = settings.adMarshal.enabled === true
      ? Object.entries(SITE_POLICIES)
      : [];
    const queryResults = await Promise.all(enabledPolicies.map(async ([siteId, policy]) => ({
      siteId,
      tabs: await chrome.tabs.query({ url: [...policy.matches] })
    })));
    const tabs = new Map();
    for (const result of queryResults) {
      for (const tab of result.tabs) {
        if (Number.isInteger(tab.id)) tabs.set(tab.id, result.siteId);
      }
    }
    const occupied = new Set();
    const addRules = [];
    for (const [tabId, siteId] of tabs) {
      const base = ruleGroupForTab(tabId, occupied);
      const rules = rulesForTab(tabId, base, siteId);
      rules.forEach(rule => occupied.add(rule.id));
      addRules.push(...rules);
    }
    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    }
    activeTabs.clear();
    for (const [tabId, siteId] of tabs) activeTabs.set(tabId, siteId);
    return addRules.length > 0;
  }

  return product;
}
