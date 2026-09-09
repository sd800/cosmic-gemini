import { FEATURE_IDS, featureState } from '../../../core/config.js';

export function createNativeScrollProduct(pageRuntimeHost) {
  const standardStylesheet = 'content/native-scroll-standard.css';
  const enhancedStylesheet = 'content/native-scroll-enhanced.css';
  const product = Object.freeze({
    id: FEATURE_IDS.NATIVE_SCROLL,
    bridge: 'content/native-scroll-bridge.js',
    runtime: 'content/runtime.js',
    pageStyleFiles: Object.freeze([standardStylesheet, enhancedStylesheet]),
    topFrameOnly: true,
    state(settings, url) { return featureState(settings, product.id, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      const hostname = (() => {
        try { return new URL(context.topUrl).hostname.toLowerCase(); }
        catch { return ''; }
      })();
      const nativeCompatibility = hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com');
      const styleFiles = !active || nativeCompatibility
        ? []
        : [state.mode === 'enhanced' ? enhancedStylesheet : standardStylesheet];
      await pageRuntimeHost.sync(product, context, active, styleFiles);
      return active;
    }
  });
  return product;
}
