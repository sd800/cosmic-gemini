import { FEATURE_IDS, anyCopyState, hostnameFromUrl, normalizeRule, updateFeature } from '../../../core/config.js';
import { createKeyedTaskQueue } from '../../../core/keyed-task-queue.js';

const COORDINATED_PAUSE_PREFIX = 'anyCopyCoordinatedPauseTab:';

export function createAnyCopyProduct(pageRuntimeHost, platform) {
  const tabUpdates = createKeyedTaskQueue();
  const pauseKey = tabId => COORDINATED_PAUSE_PREFIX + tabId;
  const product = Object.freeze({
    id: FEATURE_IDS.ANY_COPY,
    bridge: 'content/any-copy-bridge.js',
    runtime: 'content/any-copy-runtime.js',
    async isCoordinatedPaused(tabId) {
      if (!Number.isInteger(tabId)) return false;
      try {
        return (await chrome.storage.session.get(pauseKey(tabId)))[pauseKey(tabId)]?.paused === true;
      } catch { return false; }
    },
    async setCoordinatedPaused(tabId, paused) {
      if (paused) await chrome.storage.session.set({ [pauseKey(tabId)]: { paused: true } });
      else await chrome.storage.session.remove(pauseKey(tabId));
    },
    async state(settings, url, tabId, directives = {}) {
      const base = anyCopyState(settings, url);
      const directive = directives[product.id];
      const persistent = directive?.persistent === true;
      const tabPaused = persistent && await product.isCoordinatedPaused(tabId);
      return {
        ...base,
        active: persistent ? !tabPaused : base.active,
        enabled: persistent ? !tabPaused : base.enabled,
        coordinated: persistent,
        coordinationSource: persistent ? String(directive.source || '') : '',
        tabPaused
      };
    },
    async sync(context, settings) {
      const state = await product.state(settings, context.topUrl, context.tabId, context.directives);
      await pageRuntimeHost.sync(product, context, state.active);
      return state.active;
    },
    async handleMessage(message, context = {}) {
      if (message.type === 'UI_TOGGLE_COORDINATED_TAB_FEATURE') {
        const tabId = Number(message.tabId);
        if (!Number.isInteger(tabId)) throw new Error('The current tab is unavailable.');
        return tabUpdates.run(tabId, async () => {
          const tab = await chrome.tabs.get(tabId);
          const currentHostname = hostnameFromUrl(tab.url || '');
          if (!currentHostname || currentHostname !== normalizeRule(message.expectedHostname || '')) {
            throw new Error('The page changed before the action completed.');
          }
          const directives = await context.resolvePageDirectives?.(tab.url || '');
          if (directives?.[product.id]?.persistent !== true) {
            throw new Error('The coordinated Any Copy policy is no longer active.');
          }
          const paused = !(await product.isCoordinatedPaused(tabId));
          await product.setCoordinatedPaused(tabId, paused);
          if (paused) {
            try { await platform.setFeatureActivity(tabId, product.id, false); } catch {}
          }
          void platform.refreshTabPage(tabId).catch(() => {});
          return product.state(await platform.readSettings(), tab.url || '', tabId, directives);
        });
      }
      if (message.type === 'UI_ALPHABETIZE_RULES' || message.type === 'UI_CLEAR_RULES') {
        if (message.listName !== 'siteRules'
          || !String(context.sender?.url || '').startsWith(chrome.runtime.getURL('settings/'))) {
          throw new Error('Any Copy rules can be managed only from Settings.');
        }
        const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({
          ...feature,
          siteRules: message.type === 'UI_CLEAR_RULES'
            ? []
            : [...feature.siteRules].sort((a, b) => a.localeCompare(b))
        })));
        return settings[product.id];
      }
      let hostname = normalizeRule(message.rule || message.hostname || '');
      if (message.type === 'UI_TOGGLE_SITE_FEATURE' || message.expectedHostname) {
        const tabId = Number(message.tabId);
        if (!Number.isInteger(tabId)) throw new Error('The current tab is unavailable.');
        const tab = await chrome.tabs.get(tabId);
        const currentHostname = hostnameFromUrl(tab.url || '');
        if (!currentHostname || currentHostname !== normalizeRule(message.expectedHostname || message.hostname || '')) {
          throw new Error('The page changed before the action completed.');
        }
        if (message.type === 'UI_TOGGLE_SITE_FEATURE') hostname = currentHostname;
      }
      if (message.type === 'UI_TOGGLE_SITE_FEATURE' && hostname.startsWith('*.')) {
        throw new Error('The current-site action requires an exact hostname.');
      }
      if (!['UI_TOGGLE_SITE_FEATURE', 'UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type)
        || (message.type !== 'UI_TOGGLE_SITE_FEATURE' && message.listName !== 'siteRules')) {
        throw new Error('Any Copy does not support this command.');
      }
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({
        ...feature,
        siteRules: message.type === 'UI_DELETE_RULE'
          ? feature.siteRules.filter(rule => rule !== hostname)
          : message.type === 'UI_ADD_RULE'
            ? (feature.siteRules.includes(hostname) ? feature.siteRules : [...feature.siteRules, hostname])
            : feature.siteRules.includes(hostname)
              ? feature.siteRules.filter(rule => rule !== hostname)
              : [...feature.siteRules, hostname]
      })));
      return settings[product.id];
    },
    async removeTab(tabId) {
      await tabUpdates.run(tabId, () => chrome.storage.session.remove(pauseKey(tabId)));
    },
    async cleanupOrphans() {
      const [values, tabs] = await Promise.all([chrome.storage.session.get(null), chrome.tabs.query({})]);
      const liveTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger));
      const keys = Object.keys(values).filter(value => {
        if (!value.startsWith(COORDINATED_PAUSE_PREFIX)) return false;
        const tabId = Number(value.slice(COORDINATED_PAUSE_PREFIX.length));
        return !Number.isInteger(tabId) || !liveTabIds.has(tabId);
      });
      if (keys.length) await chrome.storage.session.remove(keys);
    }
  });
  return product;
}
