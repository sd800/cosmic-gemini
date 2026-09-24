(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.leetcode-dark-mode.bridge');
  if (globalThis[BRIDGE_KEY]) return;
  const READY = 'cosmic-gemini:leetcode-dark-mode:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:leetcode-dark-mode:main-ready';
  const CONFIGURE = 'cosmic-gemini:leetcode-dark-mode:configure';
  const DISPOSE = 'cosmic-gemini:leetcode-dark-mode:dispose';
  let token = '';
  let disposed = false;
  let configFailures = 0;
  let retryTimer = 0;
  let configRequest = 0;

  const sendRuntimeMessage = message => {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const dispatchConfig = config => {
    if (token) window.dispatchEvent(new CustomEvent(CONFIGURE, { detail: JSON.stringify({ token, config }) }));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    configRequest += 1;
    if (retryTimer) clearTimeout(retryTimer);
    dispatchConfig({ active: false });
    if (token) window.dispatchEvent(new CustomEvent(DISPOSE, { detail: token }));
    window.removeEventListener(MAIN_READY, onMainReady, true);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const requestConfig = async () => {
    if (disposed) return false;
    const request = ++configRequest;
    try {
      const response = await sendRuntimeMessage({
        type: 'CG_PAGE_STATE',
        featureId: 'leetcodeDarkMode'
      });
      if (disposed || request !== configRequest) return false;
      const config = response?.result?.leetcodeDarkMode;
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
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'leetcodeDarkMode') {
      dispose();
      sendResponse({ disposed: true });
    } else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'leetcodeDarkMode') {
      void requestConfig().then(configured => sendResponse({ configured }));
      return true;
    }
    return false;
  }

  window.addEventListener(MAIN_READY, onMainReady, true);
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose }, configurable: true });
  window.dispatchEvent(new CustomEvent(READY));
})();
