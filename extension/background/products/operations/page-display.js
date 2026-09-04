import {
  FEATURE_IDS,
  pageDisplayState,
  updateFeature
} from '../../../core/config.js';

const SETTING_NAMES = Object.freeze(new Set([
  'reduceWhitePointEnabled',
  'reduction',
  'greyscaleEnabled'
]));

function updatePageDisplaySetting(feature, name, value) {
  if (name === 'reduceWhitePointEnabled') {
    return {
      ...feature,
      reduceWhitePoint: { ...feature.reduceWhitePoint, enabled: value === true }
    };
  }
  if (name === 'greyscaleEnabled') {
    return {
      ...feature,
      greyscale: { ...feature.greyscale, enabled: value === true }
    };
  }
  const raw = Number(value);
  const reduction = Number.isFinite(raw) ? Math.min(0.8, Math.max(0.1, raw)) : 0.25;
  return {
    ...feature,
    reduceWhitePoint: { ...feature.reduceWhitePoint, reduction }
  };
}

export function createPageDisplayProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.PAGE_DISPLAY,
    bridge: 'content/page-display-bridge.js',
    runtime: 'content/page-display-runtime.js',
    awaitConfiguration: true,
    state(settings, url) { return pageDisplayState(settings, url); },
    async sync(context, settings) {
      const state = product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_PAGE_DISPLAY_SETTING' || !SETTING_NAMES.has(message.name)) {
        throw new Error('Page Display does not support this command.');
      }
      const settings = await platform.mutateSettings(current => updateFeature(
        current,
        FEATURE_IDS.PAGE_DISPLAY,
        feature => updatePageDisplaySetting(feature, message.name, message.value)
      ), false);
      await platform.refreshOpenPages();
      return settings.pageDisplay;
    }
  });

  return product;
}
