(() => {
  const READY = 'cosmic-gemini:any-copy-enhanced:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:any-copy-enhanced:main-ready';
  const CONFIGURE = 'cosmic-gemini:any-copy-enhanced:configure';
  const INTERVENED = 'cosmic-gemini:any-copy-enhanced:intervened';
  let token = '';

  function dispatchConfig(config) {
    if (!token) return;
    window.dispatchEvent(new CustomEvent(CONFIGURE, { detail: JSON.stringify({ token, config }) }));
  }

  async function requestConfig() {
    if (!token) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE' });
      if (!response?.ok) return;
      dispatchConfig(response.result.anyCopyEnhanced);
      if (window === top) {
        await chrome.runtime.sendMessage({
          type: 'CG_CONFIG_APPLIED', featureId: 'anyCopyEnhanced', active: response.result.anyCopyEnhanced?.active === true
        });
      }
    } catch {}
  }

  window.addEventListener(MAIN_READY, event => {
    if (typeof event.detail !== 'string' || !event.detail) return;
    token = event.detail;
    void requestConfig();
  }, true);
  window.addEventListener(INTERVENED, event => {
    if (!token || event.detail !== token) return;
    void chrome.runtime.sendMessage({ type: 'CG_FEATURE_INTERVENED', featureId: 'anyCopyEnhanced' }).catch(() => {});
  }, true);
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'CG_REFRESH_CONFIG') void requestConfig();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, 'cosmicGeminiSettings')) void requestConfig();
  });

  window.dispatchEvent(new CustomEvent(READY));
})();
