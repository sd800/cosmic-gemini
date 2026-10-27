import { FEATURE_IDS, SETTINGS_KEY, INCOGNITO_SETTINGS_KEY, updateFeature } from '../../../core/config.js';
import { URL_TRACKING_RULE_IDS, urlTrackingCleanerRules, urlTrackingCleanerState } from '../../../core/url-tracking-cleaner.js';

const signature = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function createUrlTrackingCleanerProduct(platform, pageRuntimeHost) {
  const incognito = platform.isIncognitoContext?.() === true;
  const ruleIds = new Set([URL_TRACKING_RULE_IDS[incognito ? 'incognito' : 'regular'], URL_TRACKING_RULE_IDS[incognito ? 'bilibiliIncognito' : 'bilibiliRegular']]);
  const ownedRules = rules => rules.filter(rule => ruleIds.has(rule.id)).sort((a,b)=>a.id-b.id);
  let queue = Promise.resolve();
  function serialize(task) {
    const operation = queue.then(task);
    queue = operation.catch(() => undefined);
    return operation;
  }
  async function apply(settings) {
    const preference = settings.urlTrackingCleaner;
    const active = preference?.enabled === true && (preference.utmParameters !== false || preference.bilibiliParameters === true);
    let next = [];
    if (active) {
      const tabs = await chrome.tabs.query({});
      next = urlTrackingCleanerRules(tabs.filter(tab => !!tab.incognito === incognito).map(tab => tab.id), incognito, preference);
    }
    const existing = ownedRules(await chrome.declarativeNetRequest.getSessionRules());
    if (signature(existing) === signature(next)) return;
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map(rule => rule.id), addRules: next });
    const installed = ownedRules(await chrome.declarativeNetRequest.getSessionRules());
    if (signature(installed) !== signature(next)) throw new Error('URL Tracking Cleaner rules could not be applied.');
  }
  async function ensureApplied(settings) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await apply(settings); } catch (error) {
        failure = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw failure;
  }
  const reconcile = () => serialize(async () => ensureApplied(await platform.readSettings()));
  const product = Object.freeze({
    id: FEATURE_IDS.URL_TRACKING_CLEANER,
    bridge: 'content/url-tracking-cleaner/url-tracking-cleaner-bridge.js',
    runtime: 'content/url-tracking-cleaner/url-tracking-cleaner-runtime.js',
    runtimeDependencies: ['core/url-tracking-parameters.js'],
    awaitConfiguration: true,
    state: urlTrackingCleanerState,
    sync(context, settings) {
      return pageRuntimeHost.sync(product, context, urlTrackingCleanerState(settings, context.frameUrl).active);
    },
    handleMessage(message) {
      return serialize(async () => {
        const master = message.type === 'UI_SET_ENABLED';
        if ((!master && (message.type !== 'UI_SET_URL_TRACKING_SETTING' || !['utmParameters', 'bilibiliParameters'].includes(message.name)))
          || typeof (master ? message.enabled : message.value) !== 'boolean') throw new Error('Unsupported URL Tracking Cleaner setting.');
        let previous;
        try {
          const settings = await platform.mutateSettings(async current => {
            previous = current;
            const next = updateFeature(current, product.id, feature => ({ ...feature,
              [master ? 'enabled' : message.name]: master ? message.enabled : message.value }));
            await ensureApplied(next);
            return next;
          });
          return settings.urlTrackingCleaner;
        } catch (error) {
          if (previous) await ensureApplied(previous).catch(() => {});
          throw error;
        }
      });
    },
    initialize: reconcile,
    handleTabCreated(tab) {
      if (!!tab.incognito !== incognito) return;
      return reconcile();
    },
    handleTabRemoved: reconcile,
    handleStorageChanged(changes, areaName) {
      if (areaName !== (incognito ? 'session' : 'local')) return;
      const change = changes[incognito ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY];
      if (!change || signature(change.oldValue?.urlTrackingCleaner) === signature(change.newValue?.urlTrackingCleaner)) return;
      return reconcile();
    },
    reset: () => serialize(async () => {
      const owned = ownedRules(await chrome.declarativeNetRequest.getSessionRules());
      if (owned.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: owned.map(rule => rule.id) });
    })
  });
  return product;
}
