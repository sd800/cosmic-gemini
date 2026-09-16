import {
  FEATURE_IDS,
  chineseResponseClaudeState,
  updateFeature
} from '../../../core/config.js';

export function createChineseResponseClaudeProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.CHINESE_RESPONSE_CLAUDE,
    bridge: 'content/chinese-response-claude-bridge.js',
    runtime: 'content/chinese-response-claude-runtime.js',
    awaitConfiguration: true,
    state(settings, url) { return chineseResponseClaudeState(settings, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_ENABLED' || message.featureId !== FEATURE_IDS.CHINESE_RESPONSE_CLAUDE) {
        throw new Error('Chinese Response Display Optimization for Claude does not support this command.');
      }
      const settings = await platform.mutateSettings(current => updateFeature(
        current,
        FEATURE_IDS.CHINESE_RESPONSE_CLAUDE,
        feature => ({ ...feature, enabled: message.enabled === true })
      ), false);
      await platform.refreshOpenPages();
      return settings.chineseResponseClaude;
    }
  });

  return product;
}
