import { FEATURE_IDS, featureState } from '../../../core/config.js';

export function createNoAutoplayProduct(pageRuntimeHost) {
  const product = Object.freeze({
    id: FEATURE_IDS.NO_AUTOPLAY,
    bridge: 'content/no-autoplay-bridge.js',
    runtime: 'content/no-autoplay-runtime.js',
    topFrameOnly: true,
    state(settings, url) { return featureState(settings, product.id, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    }
  });
  return product;
}
