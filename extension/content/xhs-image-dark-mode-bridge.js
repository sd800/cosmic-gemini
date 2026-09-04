(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.xhs-image-dark-mode.bridge');
  if (globalThis[BRIDGE_KEY]) return;
  const READY = 'cosmic-gemini:xhs-image-dark-mode:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:xhs-image-dark-mode:main-ready';
  const CONFIGURE = 'cosmic-gemini:xhs-image-dark-mode:configure';
  const STATUS = 'cosmic-gemini:xhs-image-dark-mode:status';
  const DISPOSE = 'cosmic-gemini:xhs-image-dark-mode:dispose';
  let token = '';
  let disposed = false;
  let configFailures = 0;
  let retryTimer = 0;
  let configRequest = 0;

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
    if (disposed) return false;
    const request = ++configRequest;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CG_PAGE_STATE',
        featureId: 'xhsImageDarkMode'
      });
      if (disposed || request !== configRequest) return false;
      const config = response?.result?.xhsImageDarkMode;
      if (!response?.ok) throw new Error(response?.error || 'Configuration is temporarily unavailable.');
      if (!config?.active) { dispose(); return false; }
      configFailures = 0;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = 0;
      dispatchConfig(config);
      return true;
    } catch {
      if (disposed || request !== configRequest) return false;
      configFailures += 1;
      if (configFailures >= 4 || retryTimer) { if (configFailures >= 4) dispose(); return false; }
      retryTimer = setTimeout(() => {
        retryTimer = 0;
        void requestConfig();
      }, [80, 240, 800][configFailures - 1]);
      return false;
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
      type: 'CG_XHS_IMAGE_DARK_MODE_STATUS',
      featureId: 'xhsImageDarkMode',
      status: message.status
    }).catch(() => {});
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'xhsImageDarkMode') {
      dispose();
      sendResponse({ disposed: true });
    } else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'xhsImageDarkMode') {
      void requestConfig().then(configured => sendResponse({ configured }));
      return true;
    }
    return false;
  }

  window.addEventListener(MAIN_READY, onMainReady, true);
  window.addEventListener(STATUS, onStatus, true);
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose }, configurable: true });
  window.dispatchEvent(new CustomEvent(READY));
})();
