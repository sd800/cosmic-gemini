import { FEATURE_IDS, updateFeature } from '../../../core/config.js';
import { isLeetCodeExploreFrame, leetcodeDarkModeState } from '../../../core/leetcode-dark-mode.js';

export function createLeetcodeDarkModeProduct(pageRuntimeHost, platform) {
  const pageStyleFiles = Object.freeze(['content/leetcode-dark-mode.css']);
  const product = Object.freeze({
    id: FEATURE_IDS.LEETCODE_DARK_MODE,
    bridge: 'content/leetcode-dark-mode-bridge.js',
    runtime: 'content/leetcode-dark-mode-runtime.js',
    pageStyleFiles,
    awaitConfiguration: true,
    state: leetcodeDarkModeState,
    async sync(context, settings) {
      const active = product.state(settings, context.topUrl).active
        && isLeetCodeExploreFrame(context.topUrl, context.frameUrl || context.topUrl);
      await pageRuntimeHost.sync(product, context, active, active ? pageStyleFiles : []);
      return active;
    },
    async handleTabUpdated(tabId, change) {
      // Next.js navigation may reuse the top document without reinjection.
      if (!change.url || !/^https:\/\/leetcode\.com\//.test(change.url)) return;
      if ((await platform.readSettings()).leetcodeDarkMode.enabled) await platform.refreshTabPage(tabId);
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_ENABLED' || message.featureId !== product.id) {
        throw new Error('Dark Mode for LeetCode Explore does not support this command.');
      }
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id,
        feature => ({ ...feature, enabled: message.enabled === true })), false);
      await platform.refreshOpenPages();
      return settings.leetcodeDarkMode;
    }
  });
  return product;
}
