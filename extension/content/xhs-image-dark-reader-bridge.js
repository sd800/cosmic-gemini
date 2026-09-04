(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.xhs-image-dark-reader.bridge');
  if (globalThis[BRIDGE_KEY]) return;
  const READY = 'cosmic-gemini:xhs-image-dark-reader:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:xhs-image-dark-reader:main-ready';
  const CONFIGURE = 'cosmic-gemini:xhs-image-dark-reader:configure';
  const STATUS = 'cosmic-gemini:xhs-image-dark-reader:status';
  const DISPOSE = 'cosmic-gemini:xhs-image-dark-reader:dispose';
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
    window.removeEventListener(STATUS, onStatus, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const requestConfig = async () => {
    if (disposed) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CG_PAGE_STATE',
        featureId: 'xhsImageDarkReader'
      });
      if (disposed) return;
      const config = response?.result?.xhsImageDarkReader;
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
  function onStatus(event) {
    let message;
    try { message = JSON.parse(event.detail); } catch { return; }
    if (message?.token !== token) return;
    void chrome.runtime.sendMessage({
      type: 'CG_XHS_IMAGE_DARK_READER_STATUS',
      featureId: 'xhsImageDarkReader',
      status: message.status
    }).catch(() => {});
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'xhsImageDarkReader') {
      dispose();
      sendResponse({ disposed: true });
    } else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'xhsImageDarkReader') {
      void requestConfig();
    }
  }

  window.addEventListener(MAIN_READY, onMainReady, true);
  window.addEventListener(STATUS, onStatus, true);
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose }, configurable: true });
  window.dispatchEvent(new CustomEvent(READY));
})();
