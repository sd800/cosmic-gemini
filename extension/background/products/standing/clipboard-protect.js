import { FEATURE_IDS, clipboardProtectState, updateFeature } from '../../../core/config.js';

export function createClipboardProtectProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.CLIPBOARD_PROTECT,
    bridge: 'content/clipboard-protect-bridge.js',
    runtime: 'content/clipboard-protect-runtime.js',
    state: clipboardProtectState,
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      await pageRuntimeHost.sync(product, context, state.active);
      return state.active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_ENABLED') throw new Error('Clipboard Protect does not support this command.');
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({
        ...feature, enabled: message.enabled === true
      })));
      return settings[product.id];
    }
  });
  return product;
}
