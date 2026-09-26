import { FEATURE_IDS, featureState } from '../../../core/config.js';

export function createNoAutoplayProduct(pageRuntimeHost) {
  const product = Object.freeze({
    id: FEATURE_IDS.NO_AUTOPLAY,
    bridge: 'content/no-autoplay/no-autoplay-bridge.js',
    runtime: 'content/no-autoplay/no-autoplay-runtime.js',
    state(settings, url) { return featureState(settings, product.id, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    }
  });
  return product;
}
