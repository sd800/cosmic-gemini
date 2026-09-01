(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.ad-marshal.bridge');
  if (globalThis[BRIDGE_KEY]) return;
  const READY = 'cosmic-gemini:ad-marshal:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:ad-marshal:main-ready';
  const CONFIGURE = 'cosmic-gemini:ad-marshal:configure';
  const DISPOSE = 'cosmic-gemini:ad-marshal:dispose';
  let token = '';
  let disposed = false;
  let configFailures = 0;
  let retryTimer = 0;

  const dispatchConfig = config => {
    if (token) window.dispatchEvent(new CustomEvent(CONFIGURE, { detail: JSON.stringify({ token, config }) }));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    dispatchConfig({ active: false });
    if (token) window.dispatchEvent(new CustomEvent(DISPOSE, { detail: token }));
    window.removeEventListener(MAIN_READY, onMainReady, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const requestConfig = async () => {
    if (disposed) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE', featureId: 'adMarshal' });
      const config = response?.result?.adMarshal;
      if (!response?.ok) throw new Error(response?.error || 'Configuration is temporarily unavailable.');
      if (!config?.active) { dispose(); return; }
      configFailures = 0;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = 0;
      dispatchConfig(config);
    } catch {
      if (disposed) return;
      configFailures += 1;
      if (configFailures >= 4 || retryTimer) { if (configFailures >= 4) dispose(); return; }
      retryTimer = setTimeout(() => {
        retryTimer = 0;
        void requestConfig();
      }, [80, 240, 800][configFailures - 1]);
    }
  };
  function onMainReady(event) {
    if (typeof event.detail !== 'string' || !event.detail) return;
    token = event.detail;
    void requestConfig();
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'adMarshal') {
      dispose();
      sendResponse({ disposed: true });
    } else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'adMarshal') {
      void requestConfig();
    }
  }

  window.addEventListener(MAIN_READY, onMainReady, true);
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose }, configurable: true });
  window.dispatchEvent(new CustomEvent(READY));
})();
