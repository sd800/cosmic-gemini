import { FEATURE_IDS, anyCopyEnhancedState, hostnameFromUrl } from '../../../core/config.js';
import { createKeyedTaskQueue } from '../../../core/keyed-task-queue.js';

const SESSION_PREFIX = 'anyCopyEnhancedTab:';

export function createAnyCopyEnhancedProduct(pageRuntimeHost, platform) {
  const tabUpdates = createKeyedTaskQueue();
  const key = tabId => SESSION_PREFIX + tabId;
  const product = Object.freeze({
    id: FEATURE_IDS.ANY_COPY_ENHANCED,
    bridge: 'content/any-copy-enhanced-bridge.js',
    runtime: 'content/any-copy-enhanced-runtime.js',
    async isActive(tabId) {
      if (!Number.isInteger(tabId)) return false;
      return (await chrome.storage.session.get(key(tabId)))[key(tabId)]?.active === true;
    },
    async setActive(tabId, active) {
      if (active) await chrome.storage.session.set({ [key(tabId)]: { active: true } });
      else await chrome.storage.session.remove(key(tabId));
    },
    async state(_settings, url, tabId) {
      return anyCopyEnhancedState(url, await product.isActive(tabId));
    },
    async sync(context, settings) {
      const state = await product.state(settings, context.topUrl, context.tabId);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_TOGGLE_TAB_FEATURE') throw new Error('Any Copy Enhanced does not support this command.');
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) throw new Error('The current tab is unavailable.');
      return tabUpdates.run(tabId, async () => {
        const tab = await chrome.tabs.get(tabId);
        if (!hostnameFromUrl(tab.url || '')) throw new Error('This page is unavailable.');
        const active = !(await product.isActive(tabId));
        await product.setActive(tabId, active);
        // The saved tab choice must survive failures in optional activity bookkeeping.
        if (!active) {
          try { await platform.setFeatureActivity(tabId, product.id, false); } catch {}
        }
        void platform.refreshTabPage(tabId).catch(() => {});
        return anyCopyEnhancedState(tab.url || '', active);
      });
    },
    async removeTab(tabId) {
      await tabUpdates.run(tabId, () => chrome.storage.session.remove(key(tabId)));
    },
    async cleanupOrphans() {
      const [values, tabs] = await Promise.all([chrome.storage.session.get(null), chrome.tabs.query({})]);
      const liveTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger));
      const keys = Object.keys(values).filter(value => {
        if (!value.startsWith(SESSION_PREFIX)) return false;
        const tabId = Number(value.slice(SESSION_PREFIX.length));
        return !Number.isInteger(tabId) || !liveTabIds.has(tabId);
      });
      if (keys.length) await chrome.storage.session.remove(keys);
    }
  });
  return product;
}
