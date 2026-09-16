import { FEATURE_IDS, updateFeature,
  validateWebsiteKnowledgeValue, websiteKnowledgeControlState } from '../../../core/config.js';
import {
  ALL_REQUEST_RESOURCE_TYPES,
  createRequestLanguageRules
} from '../../features/request-language-rules.js';

export function createWebsiteKnowledgeControlProduct(host, platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const sessionKey = `websiteKnowledgeControlAppliedLanguages:${incognito ? 'incognito' : 'regular'}`;
  const ruleIds = start => Array.from({ length: 32 }, (_, index) => start + index);
  const languageRules = createRequestLanguageRules(platform, {
    regularIds: ruleIds(910_001), incognitoIds: ruleIds(910_101), priority: 10,
    conditions: [{ regexFilter: '^https?://', resourceTypes: [...ALL_REQUEST_RESOURCE_TYPES] }]
  });
  let appliedLanguages;
  let appliedQueue = Promise.resolve();

  const serializeApplied = task => {
    const operation = appliedQueue.then(task);
    appliedQueue = operation.catch(() => undefined);
    return operation;
  };
  const selectedLanguage = settings => {
    const feature = settings.websiteKnowledgeControl;
    return feature?.enabled === true && feature.languages.enabled === true ? feature.languages.value : '';
  };
  const isWebTab = tab => /^https?:/i.test(String(tab?.url || ''));
  const contextTab = tab => Number.isInteger(tab?.id) && tab.id >= 0 && Boolean(tab.incognito) === incognito;

  async function persistApplied() {
    if (!globalThis.chrome?.storage?.session) return;
    const tabs = Object.fromEntries([...appliedLanguages].map(([tabId, value]) => [tabId, value]));
    try { await chrome.storage.session.set({ [sessionKey]: { version: 1, tabs } }); } catch {}
  }

  async function loadApplied(settings) {
    if (appliedLanguages) return appliedLanguages;
    let stored;
    try { stored = (await chrome.storage.session?.get(sessionKey))?.[sessionKey]; } catch {}
    const tabs = (await chrome.tabs.query({})).filter(contextTab);
    const openIds = new Set(tabs.map(tab => tab.id));
    appliedLanguages = new Map();
    if (stored?.version === 1 && stored.tabs && typeof stored.tabs === 'object') {
      for (const [rawId, rawValue] of Object.entries(stored.tabs)) {
        const tabId = Number(rawId);
        if (!openIds.has(tabId)) continue;
        try { appliedLanguages.set(tabId, validateWebsiteKnowledgeValue('languages', rawValue)); } catch {}
      }
    }
    const current = selectedLanguage(settings);
    for (const tab of tabs) {
      if (!appliedLanguages.has(tab.id) && current && isWebTab(tab)) appliedLanguages.set(tab.id, current);
    }
    await persistApplied();
    return appliedLanguages;
  }

  async function syncApplied() {
    const groups = new Map();
    for (const [tabId, value] of appliedLanguages) {
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(tabId);
    }
    const targets = [...groups].map(([value, tabIds]) => ({ value, tabIds }));
    return languageRules.sync(targets.length > 0, { targets });
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
    const current = selectedLanguage(settings);
    if (current && isWebTab(tab)) appliedLanguages.set(tabId, current);
    else appliedLanguages.delete(tabId);
    await persistApplied();
    return syncApplied();
  });

  const removeTab = tabId => serializeApplied(async () => {
    if (!appliedLanguages) return false;
    appliedLanguages.delete(tabId);
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
        if (!['languages', 'locale', 'timeZone'].includes(category)) throw new Error('Unknown browser information category.');
        patch = { [category]: {
          ...(typeof message.enabled === 'boolean' ? { enabled: message.enabled } : {}),
          ...(message.value !== undefined ? { value: validateWebsiteKnowledgeValue(category, message.value) } : {})
        } };
      } else throw new Error('Unsupported Website Knowledge Control command.');
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({
        ...feature, ...patch,
        ...Object.fromEntries(['languages', 'locale', 'timeZone'].map(category => [category, { ...feature[category], ...patch[category] }]))
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
    reset: () => languageRules.sync(false)
  });
  return product;
}
