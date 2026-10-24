import { FEATURE_IDS, updateFeature,
  validateWebsiteKnowledgeValue, websiteKnowledgeControlState } from '../../../core/config.js';
import {
  ALL_REQUEST_RESOURCE_TYPES,
  createRequestIdentityRules
} from '../../features/request-identity-rules.js';

export function createWebsiteKnowledgeControlProduct(host, platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const sessionKey = `websiteKnowledgeControlAppliedRequestProfiles:${incognito ? 'incognito' : 'regular'}`;
  // Retained tabs may hold every language with/without GPC, plus GPC alone.
  // Keep capacity above the complete Settings menu without crossing contexts.
  const ruleIds = start => Array.from({ length: 64 }, (_, index) => start + index);
  const requestRules = createRequestIdentityRules(platform, {
    regularIds: ruleIds(910_001), incognitoIds: ruleIds(910_101), priority: 10,
    conditions: [{ regexFilter: '^https?://', resourceTypes: ALL_REQUEST_RESOURCE_TYPES.filter(type => type !== 'main_frame') }]
  });
  // Prepare the next navigation at save time. A loading event is too late to
  // change the request that has already started, while current page requests
  // must keep their retained profile until that new document loads.
  const navigationRules = createRequestIdentityRules(platform, {
    regularIds: [910_065], incognitoIds: [910_165], priority: 10,
    conditions: [{ regexFilter: '^https?://', resourceTypes: ['main_frame'] }]
  });
  let appliedProfiles;
  const appliedDocuments = new Map();
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
    const timeZone = feature.timeZone?.enabled === true ? feature.timeZone.value : '';
    return language || globalPrivacyControl || timeZone
      ? { language, globalPrivacyControl, ...(timeZone ? { timeZone } : {}) } : null;
  };
  const isWebTab = tab => /^https?:/i.test(String(tab?.pendingUrl || tab?.url || ''));
  const contextTab = tab => Number.isInteger(tab?.id) && tab.id >= 0 && Boolean(tab.incognito) === incognito;

  async function persistApplied() {
    if (!globalThis.chrome?.storage?.session) return;
    const tabs = Object.fromEntries([...appliedProfiles].map(([tabId, value]) => [tabId, value]));
    try { await chrome.storage.session.set({ [sessionKey]: { version: 2, tabs,
      documents: Object.fromEntries(appliedDocuments) } }); } catch {}
  }

  async function loadApplied(settings) {
    if (appliedProfiles) return appliedProfiles;
    const stored = (await chrome.storage?.session?.get(sessionKey))?.[sessionKey];
    const tabs = (await chrome.tabs.query({})).filter(contextTab);
    const openIds = new Set(tabs.map(tab => tab.id));
    appliedProfiles = new Map();
    if (stored?.version === 2 && stored.tabs && typeof stored.tabs === 'object') {
      for (const [rawId, rawValue] of Object.entries(stored.tabs)) {
        const tabId = Number(rawId);
        if (!openIds.has(tabId)) continue;
        if (rawValue === null) { appliedProfiles.set(tabId, null); continue; }
        if (!rawValue || typeof rawValue !== 'object') continue;
        let language = '';
        try { if (rawValue.language) language = validateWebsiteKnowledgeValue('languages', rawValue.language); } catch { continue; }
        let timeZone = '';
        try { if (rawValue.timeZone) timeZone = validateWebsiteKnowledgeValue('timeZone', rawValue.timeZone); } catch { continue; }
        const globalPrivacyControl = rawValue.globalPrivacyControl === true;
        if (language || globalPrivacyControl || timeZone) appliedProfiles.set(tabId,
          { language, globalPrivacyControl, ...(timeZone ? { timeZone } : {}) });
      }
      for (const [rawId, documentId] of Object.entries(stored.documents || {})) {
        const tabId = Number(rawId);
        if (openIds.has(tabId) && typeof documentId === 'string' && documentId.length <= 100) {
          appliedDocuments.set(tabId, documentId);
        }
      }
    }
    const current = selectedProfile(settings);
    for (const tab of tabs) {
      if (!appliedProfiles.has(tab.id)) appliedProfiles.set(tab.id, isWebTab(tab) ? current : null);
    }
    await persistApplied();
    return appliedProfiles;
  }

  async function syncApplied() {
    await syncNavigation();
    const groups = new Map();
    for (const [tabId, profile] of appliedProfiles) {
      if (!profile || (!profile.language && !profile.globalPrivacyControl)) continue;
      const { language, globalPrivacyControl } = profile;
      const key = JSON.stringify({ language, globalPrivacyControl });
      if (!groups.has(key)) groups.set(key, { language, globalPrivacyControl, tabIds: [] });
      groups.get(key).tabIds.push(tabId);
    }
    const targets = [...groups.values()];
    return requestRules.sync(targets.length > 0, { targets });
  }

  async function syncNavigation() {
    const profile = selectedProfile(await platform.readSettings());
    if (!profile?.language && !profile?.globalPrivacyControl) return navigationRules.sync(false);
    const tabIds = (await chrome.tabs.query({})).filter(contextTab).map(tab => tab.id);
    return navigationRules.sync(Boolean(profile), { targets: profile ? [{ ...profile, tabIds }] : [] });
  }

  const initializeApplied = () => serializeApplied(async () => {
    const settings = await platform.readSettings();
    await loadApplied(settings);
    return syncApplied();
  });

  const applyCurrentToTab = (tabId, tab, documentId = '') => serializeApplied(async () => {
    if (!contextTab({ id: tabId, incognito: tab?.incognito })) return false;
    const settings = await platform.readSettings();
    await loadApplied(settings);
    // A queued create/update event may finish after the tab has closed or
    // navigated. Use the live tab, not its event-time snapshot, for DNR scope.
    const liveTab = chrome.tabs.get ? await chrome.tabs.get(tabId).catch(() => null) : tab;
    if (!liveTab || !contextTab(liveTab)) {
      appliedProfiles.delete(tabId);
      appliedDocuments.delete(tabId);
      await persistApplied();
      return syncApplied();
    }
    if (documentId && appliedDocuments.get(tabId) === documentId) return true;
    if (!documentId && appliedDocuments.has(tabId)) return syncNavigation();
    const current = selectedProfile(settings);
    if (!current && !appliedProfiles.get(tabId)) {
      // Remember an inactive document without executing any page inspection.
      // Enabling later must still wait for a genuinely new document.
      if (documentId) {
        appliedDocuments.set(tabId, documentId);
        await persistApplied();
      }
      return true;
    }
    if (documentId && chrome.scripting?.executeScript) {
      const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] },
        world: 'ISOLATED', injectImmediately: true, func: () => true });
      if (results[0]?.documentId !== documentId) return false;
    }
    if (current && isWebTab(liveTab)) appliedProfiles.set(tabId, current);
    else appliedProfiles.set(tabId, null);
    if (documentId) appliedDocuments.set(tabId, documentId);
    await persistApplied();
    return syncApplied();
  });

  const removeTab = tabId => serializeApplied(async () => {
    if (!appliedProfiles) return false;
    appliedProfiles.delete(tabId);
    appliedDocuments.delete(tabId);
    await persistApplied();
    return syncApplied();
  });
  const product = Object.freeze({
    id: FEATURE_IDS.WEBSITE_KNOWLEDGE_CONTROL,
    bridge: 'content/website-knowledge-control/website-knowledge-control-bridge.js',
    runtime: 'content/website-knowledge-control/website-knowledge-control-runtime.js',
    runtimeDependencies: ['content/shared/browser-identity.js'],
    awaitConfiguration: true,
    async state(settings, url, tabId) {
      const state = websiteKnowledgeControlState(settings, url);
      if (!Number.isInteger(tabId)) return state;
      const profile = await serializeApplied(async () => (await loadApplied(settings)).get(tabId));
      // Newly created child frames use the same retained policy as their tab,
      // rather than mixing current Settings with the tab's older request headers.
      return { ...state, enabled: !!profile, active: state.supported && !!profile,
        languages: { ...state.languages, enabled: !!profile?.language, ...(profile?.language ? { value: profile.language } : {}) },
        timeZone: { ...state.timeZone, enabled: !!profile?.timeZone, ...(profile?.timeZone ? { value: profile.timeZone } : {}) },
        globalPrivacyControl: { enabled: profile?.globalPrivacyControl === true } };
    },
    async sync(context, settings) {
      if (Number.isInteger(context.tabId) && context.documentId) {
        let topDocumentId = context.frameId === 0 ? context.documentId : '';
        if (context.frameId !== 0 && chrome.scripting?.executeScript) {
          const retained = await serializeApplied(async () => (await loadApplied(settings)).get(context.tabId));
          if (selectedProfile(settings) || retained) {
            const results = await chrome.scripting.executeScript({ target: { tabId: context.tabId, frameIds: [0] },
              world: 'ISOLATED', injectImmediately: true, func: () => true });
            topDocumentId = results[0]?.documentId || '';
          }
        }
        if (topDocumentId) await applyCurrentToTab(context.tabId,
          { id: context.tabId, incognito }, topDocumentId);
      }
      const state = await product.state(settings, context.frameUrl || context.topUrl, context.tabId);
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
      // Preparing only main-frame rules does not mutate that document's profile.
      await serializeApplied(() => syncNavigation()).catch(() => {});
      return settings.websiteKnowledgeControl;
    },
    initialize: initializeApplied,
    handleTabCreated(tab) { return applyCurrentToTab(tab?.id, tab); },
    handleTabUpdated(tabId, change, tab) {
      // Tab loading also fires for child frames. Only a confirmed top-document
      // ID from Central may adopt a new page profile; URL events never do so.
      if (change.status === 'loading') return serializeApplied(() => syncNavigation());
    },
    handleTabRemoved: removeTab,
    handleStorageChanged() {},
    reset: () => serializeApplied(async () => {
      // A known inactive tab must remain inactive after worker restart, even
      // if a different preference is saved before that tab next navigates.
      appliedProfiles = new Map((await chrome.tabs.query({})).filter(contextTab).map(tab => [tab.id, null]));
      appliedDocuments.clear();
      await persistApplied();
      await navigationRules.sync(false);
      return requestRules.sync(false);
    })
  });
  return product;
}
