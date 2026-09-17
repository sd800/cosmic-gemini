import { FEATURE_IDS, updateFeature,
  validateWebsiteKnowledgeValue, websiteKnowledgeControlState } from '../../../core/config.js';
import {
  ALL_REQUEST_RESOURCE_TYPES,
  createRequestIdentityRules
} from '../../features/request-identity-rules.js';

export function createWebsiteKnowledgeControlProduct(host, platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const sessionKey = `websiteKnowledgeControlAppliedRequestProfiles:${incognito ? 'incognito' : 'regular'}`;
  const ruleIds = start => Array.from({ length: 32 }, (_, index) => start + index);
  const requestRules = createRequestIdentityRules(platform, {
    regularIds: ruleIds(910_001), incognitoIds: ruleIds(910_101), priority: 10,
    conditions: [{ regexFilter: '^https?://', resourceTypes: [...ALL_REQUEST_RESOURCE_TYPES] }]
  });
  let appliedProfiles;
  let appliedQueue = Promise.resolve();

  const serializeApplied = task => {
    const operation = appliedQueue.then(task);
    appliedQueue = operation.catch(() => undefined);
    return operation;
  };
  const selectedProfile = settings => {
    const feature = settings.websiteKnowledgeControl;
    if (feature?.enabled !== true) return null;
    const language = feature.languages.enabled === true ? feature.languages.value : '';
    const globalPrivacyControl = feature.globalPrivacyControl?.enabled === true;
    return language || globalPrivacyControl ? { language, globalPrivacyControl } : null;
  };
  const isWebTab = tab => /^https?:/i.test(String(tab?.url || ''));
  const contextTab = tab => Number.isInteger(tab?.id) && tab.id >= 0 && Boolean(tab.incognito) === incognito;

  async function persistApplied() {
    if (!globalThis.chrome?.storage?.session) return;
    const tabs = Object.fromEntries([...appliedProfiles].map(([tabId, value]) => [tabId, value]));
    try { await chrome.storage.session.set({ [sessionKey]: { version: 2, tabs } }); } catch {}
  }

  async function loadApplied(settings) {
    if (appliedProfiles) return appliedProfiles;
    let stored;
    try { stored = (await chrome.storage.session?.get(sessionKey))?.[sessionKey]; } catch {}
    const tabs = (await chrome.tabs.query({})).filter(contextTab);
    const openIds = new Set(tabs.map(tab => tab.id));
    appliedProfiles = new Map();
    if (stored?.version === 2 && stored.tabs && typeof stored.tabs === 'object') {
      for (const [rawId, rawValue] of Object.entries(stored.tabs)) {
        const tabId = Number(rawId);
        if (!openIds.has(tabId)) continue;
        if (!rawValue || typeof rawValue !== 'object') continue;
        let language = '';
        try { if (rawValue.language) language = validateWebsiteKnowledgeValue('languages', rawValue.language); } catch { continue; }
        const globalPrivacyControl = rawValue.globalPrivacyControl === true;
        if (language || globalPrivacyControl) appliedProfiles.set(tabId, { language, globalPrivacyControl });
      }
    }
    const current = selectedProfile(settings);
    for (const tab of tabs) {
      if (!appliedProfiles.has(tab.id) && current && isWebTab(tab)) appliedProfiles.set(tab.id, current);
    }
    await persistApplied();
    return appliedProfiles;
  }

  async function syncApplied() {
    const groups = new Map();
    for (const [tabId, profile] of appliedProfiles) {
      const key = JSON.stringify(profile);
      if (!groups.has(key)) groups.set(key, { ...profile, tabIds: [] });
      groups.get(key).tabIds.push(tabId);
    }
    const targets = [...groups.values()];
    return requestRules.sync(targets.length > 0, { targets });
  }

  const initializeApplied = () => serializeApplied(async () => {
    const settings = await platform.readSettings();
    await loadApplied(settings);
    return syncApplied();
  });

  const applyCurrentToTab = (tabId, tab) => serializeApplied(async () => {
    if (!contextTab({ id: tabId, incognito: tab?.incognito })) return false;
    const settings = await platform.readSettings();
    await loadApplied(settings);
    const current = selectedProfile(settings);
    if (current && isWebTab(tab)) appliedProfiles.set(tabId, current);
    else appliedProfiles.delete(tabId);
    await persistApplied();
    return syncApplied();
  });

  const removeTab = tabId => serializeApplied(async () => {
    if (!appliedProfiles) return false;
    appliedProfiles.delete(tabId);
    await persistApplied();
    return syncApplied();
  });
  const product = Object.freeze({
    id: FEATURE_IDS.WEBSITE_KNOWLEDGE_CONTROL,
    bridge: 'content/website-knowledge-control-bridge.js',
    runtime: 'content/website-knowledge-control-runtime.js',
    runtimeDependencies: ['content/browser-identity.js'],
    awaitConfiguration: true,
    state: websiteKnowledgeControlState,
    async sync(context, settings) {
      const state = product.state(settings, context.frameUrl || context.topUrl);
      await host.sync(product, context, state.active);
      return state.active;
    },
    async handleMessage(message) {
      let patch;
      if (message.type === 'UI_SET_ENABLED') patch = { enabled: message.enabled === true };
      else if (message.type === 'UI_SET_WEBSITE_KNOWLEDGE_SETTING') {
        const { category } = message;
        if (!['languages', 'timeZone', 'globalPrivacyControl'].includes(category)) throw new Error('Unknown browser information category.');
        if (category === 'globalPrivacyControl' && message.value !== undefined) throw new Error('Global Privacy Control does not accept a value.');
        patch = { [category]: {
          ...(typeof message.enabled === 'boolean' ? { enabled: message.enabled } : {}),
          ...(message.value !== undefined ? { value: validateWebsiteKnowledgeValue(category, message.value) } : {})
        } };
      } else throw new Error('Unsupported Website Knowledge Control command.');
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({
        ...feature, ...patch,
        ...Object.fromEntries(['languages', 'timeZone', 'globalPrivacyControl']
          .map(category => [category, { ...feature[category], ...patch[category] }]))
      })), false);
      // The current document keeps the values it received when it loaded. The
      // saved preference becomes authoritative for each tab on its next load.
      return settings.websiteKnowledgeControl;
    },
    initialize: initializeApplied,
    handleTabCreated(tab) { return applyCurrentToTab(tab?.id, tab); },
    handleTabUpdated(tabId, change, tab) {
      if (change.url || change.status === 'loading') return applyCurrentToTab(tabId, tab);
    },
    handleTabRemoved: removeTab,
    handleStorageChanged() {},
    reset: () => requestRules.sync(false)
  });
  return product;
}
