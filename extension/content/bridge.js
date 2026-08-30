(() => {
  const EVENTS = {
    nativeScroll: {
      ready: 'cosmic-gemini:native-scroll:bridge-ready',
      mainReady: 'cosmic-gemini:native-scroll:main-ready',
      configure: 'cosmic-gemini:native-scroll:configure',
      intervened: 'cosmic-gemini:native-scroll:suppressed'
    },
    noAutoplay: {
      ready: 'cosmic-gemini:no-autoplay:bridge-ready',
      mainReady: 'cosmic-gemini:no-autoplay:main-ready',
      configure: 'cosmic-gemini:no-autoplay:configure',
      intervened: 'cosmic-gemini:no-autoplay:intervened'
    }
  };
  const tokens = { nativeScroll: '', noAutoplay: '' };

  function dispatchConfig(featureId, config) {
    const token = tokens[featureId];
    if (!token) return;
    window.dispatchEvent(new CustomEvent(EVENTS[featureId].configure, {
      detail: JSON.stringify({ token, config })
    }));
  }

  async function requestConfig() {
    if (!tokens.nativeScroll && !tokens.noAutoplay) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE' });
      if (!response?.ok) throw new Error(response?.error || 'Unable to load Cosmic Gemini.');
      if (tokens.nativeScroll) dispatchConfig('nativeScroll', response.result.nativeScroll);
      if (tokens.noAutoplay) dispatchConfig('noAutoplay', response.result.noAutoplay);
      await Promise.allSettled(Object.keys(tokens).filter(featureId => tokens[featureId]).map(featureId =>
        chrome.runtime.sendMessage({
          type: 'CG_CONFIG_APPLIED',
          featureId,
          active: response.result[featureId].active
        })));
    } catch {}
  }

  for (const featureId of Object.keys(EVENTS)) {
    const events = EVENTS[featureId];
    window.addEventListener(events.mainReady, event => {
      if (typeof event.detail !== 'string' || !event.detail) return;
      tokens[featureId] = event.detail;
      void requestConfig();
    }, true);
    window.addEventListener(events.intervened, event => {
      if (!tokens[featureId] || event.detail !== tokens[featureId]) return;
      void chrome.runtime.sendMessage({ type: 'CG_FEATURE_INTERVENED', featureId }).catch(() => {});
    }, true);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'CG_REFRESH_CONFIG') void requestConfig();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, 'cosmicGeminiSettings')) void requestConfig();
  });

  window.dispatchEvent(new CustomEvent(EVENTS.nativeScroll.ready));
  window.dispatchEvent(new CustomEvent(EVENTS.noAutoplay.ready));
})();
