import {
  FEATURE_IDS,
  INCOGNITO_LOCALE_KEY,
  mailtoCaptureState
} from '../../../core/config.js';

export function createMailtoCaptureProduct(pageRuntimeHost, platform) {
  let localePromise = null;

  function locale() {
    if (!localePromise) localePromise = platform.getLocale().catch(() => 'en-US');
    return localePromise;
  }

  const product = Object.freeze({
    id: FEATURE_IDS.MAILTO_CAPTURE,
    bridge: 'content/mailto-capture-bridge.js',
    runtime: 'content/mailto-capture-runtime.js',
    async state(settings, url) {
      const state = mailtoCaptureState(settings, url);
      return state.active ? { ...state, locale: await locale() } : state;
    },
    async sync(context, settings) {
      const state = await product.state(settings, context.topUrl);
      await pageRuntimeHost.sync(product, context, state.active);
      return state.active;
    },
    handleStorageChanged(changes, areaName) {
      const key = platform.isIncognitoContext() ? INCOGNITO_LOCALE_KEY : 'interfaceLocale';
      const expectedArea = platform.isIncognitoContext() ? 'session' : 'local';
      if (areaName === expectedArea && changes?.[key]) localePromise = null;
      return false;
    }
  });

  return product;
}
