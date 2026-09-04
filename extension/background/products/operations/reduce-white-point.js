import {
  FEATURE_IDS,
  reduceWhitePointState,
  updateFeature
} from '../../../core/config.js';

export function createReduceWhitePointProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.REDUCE_WHITE_POINT,
    bridge: 'content/reduce-white-point-bridge.js',
    runtime: 'content/reduce-white-point-runtime.js',
    awaitConfiguration: true,
    state(settings, url) { return reduceWhitePointState(settings, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type === 'UI_SET_ENABLED') {
        const settings = await platform.mutateSettings(current => updateFeature(
          current,
          FEATURE_IDS.REDUCE_WHITE_POINT,
          feature => ({ ...feature, enabled: message.enabled === true })
        ));
        return settings.reduceWhitePoint;
      }
      if (message.type === 'UI_SET_REDUCE_WHITE_POINT_SETTING' && message.name === 'reduction') {
        const raw = Number(message.value);
        const reduction = Number.isFinite(raw) ? Math.min(0.8, Math.max(0.1, raw)) : 0.25;
        const settings = await platform.mutateSettings(current => updateFeature(
          current,
          FEATURE_IDS.REDUCE_WHITE_POINT,
          feature => ({ ...feature, reduction })
        ));
        return settings.reduceWhitePoint;
      }
      throw new Error('Reduce White Point does not support this command.');
    }
  });

  return product;
}
