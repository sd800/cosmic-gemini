import { FEATURE_IDS, hostnameFromUrl, normalizeWhiteSofterTone, updateFeature } from '../../../core/config.js';

export function createWhiteSofterProduct(pageRuntimeHost, platform) {
  const pageStyleFiles = Object.freeze(['content/white-softer/white-softer.css']);
  const product = Object.freeze({
    id: FEATURE_IDS.WHITE_SOFTER,
    bridge: 'content/white-softer/white-softer-bridge.js',
    runtime: 'content/white-softer/white-softer-runtime.js',
    runtimeDependencies: Object.freeze(['shared/white-tones.js', 'content/shared/white-cap-layer.js']),
    pageStyleFiles,
    awaitConfiguration: true,
    preservePageStylesOnRefresh: true,
    state(settings, url) {
      const enabled = settings.whiteSofter?.enabled === true;
      const tone = normalizeWhiteSofterTone(settings.whiteSofter?.tone);
      const supported = Boolean(hostnameFromUrl(url));
      return { enabled, tone, supported, active: enabled && supported };
    },
    async sync(context, settings) {
      // One composited surface also covers visible child frames without recoloring twice.
      const active = context.frameId === 0 && product.state(settings, context.topUrl).active;
      await pageRuntimeHost.sync(product, context, active, active ? pageStyleFiles : []);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_ENABLED' && (message.type !== 'UI_SET_WHITE_SOFTER_TONE'
        || message.tone !== normalizeWhiteSofterTone(message.tone))) {
        throw new Error('White Softer does not support this setting.');
      }
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({
        ...feature,
        ...(message.type === 'UI_SET_ENABLED' ? { enabled: message.enabled === true } : { tone: message.tone })
      })));
      return settings.whiteSofter;
    }
  });
  return product;
}
