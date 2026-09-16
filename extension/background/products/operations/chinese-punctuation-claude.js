import {
  FEATURE_IDS,
  chinesePunctuationClaudeState,
  updateFeature
} from '../../../core/config.js';

export function createChinesePunctuationClaudeProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.CHINESE_PUNCTUATION_CLAUDE,
    bridge: 'content/chinese-punctuation-claude-bridge.js',
    runtime: 'content/chinese-punctuation-claude-runtime.js',
    awaitConfiguration: true,
    state(settings, url) { return chinesePunctuationClaudeState(settings, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_ENABLED' || message.featureId !== FEATURE_IDS.CHINESE_PUNCTUATION_CLAUDE) {
        throw new Error('Chinese Punctuation Marks Display Optimization for Claude does not support this command.');
      }
      const settings = await platform.mutateSettings(current => updateFeature(
        current,
        FEATURE_IDS.CHINESE_PUNCTUATION_CLAUDE,
        feature => ({ ...feature, enabled: message.enabled === true })
      ), false);
      await platform.refreshOpenPages();
      return settings.chinesePunctuationClaude;
    }
  });

  return product;
}
