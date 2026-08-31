import { FEATURE_IDS, anyCopyState, normalizeRule, updateFeature } from '../../../core/config.js';

export function createAnyCopyProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.ANY_COPY,
    bridge: 'content/any-copy-bridge.js',
    runtime: 'content/any-copy-runtime.js',
    state(settings, url) { return anyCopyState(settings, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      await pageRuntimeHost.sync(product, context, state.active);
      return state.active;
    },
    async handleMessage(message) {
      const hostname = normalizeRule(message.hostname || '');
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
            ? [...new Set([...feature.siteRules, hostname])].sort()
            : feature.siteRules.includes(hostname)
              ? feature.siteRules.filter(rule => rule !== hostname)
              : [...feature.siteRules, hostname]
      })));
      return settings[product.id];
    }
  });
  return product;
}
