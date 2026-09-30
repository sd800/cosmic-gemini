import { FEATURE_IDS, updateFeature, xhsNavigationState } from '../../../core/config.js';

export function createXhsNavigationProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.XHS_NAVIGATION,
    bridge: 'content/xhs-navigation/xhs-navigation-bridge.js',
    runtime: 'content/xhs-navigation/xhs-navigation-runtime.js',
    awaitConfiguration: true,
    state: xhsNavigationState,
    async sync(context, settings) {
      const active = context.frameId === 0 && product.state(settings, context.topUrl).active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.featureId !== product.id || message.type !== 'UI_SET_ENABLED') {
        throw new Error('XHS Keyboard Navigation does not support this command.');
      }
      const settings = await platform.mutateSettings(current => updateFeature(
        current,
        product.id,
        feature => ({ ...feature, enabled: message.enabled === true })
      ), false);
      await platform.refreshOpenPages();
      return settings.xhsNavigation;
    }
  });
  return product;
}
