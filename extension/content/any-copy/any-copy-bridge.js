(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.any-copy.bridge');
  if (globalThis[BRIDGE_KEY]) return;
  const READY = 'cosmic-gemini:any-copy:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:any-copy:main-ready';
  const CONFIGURE = 'cosmic-gemini:any-copy:configure';
  const DISPOSE = 'cosmic-gemini:any-copy:dispose';
  const INTERVENED = 'cosmic-gemini:any-copy:intervened';
  let token = '';
  let disposed = false;
  let configFailures = 0;
  let configRequest = 0;
  let configRetry = 0;

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
    if (configRetry) clearTimeout(configRetry);
    dispatchConfig({ active: false });
    if (token) window.dispatchEvent(new CustomEvent(DISPOSE, { detail: token }));
    window.removeEventListener(MAIN_READY, onMainReady, true);
    window.removeEventListener(INTERVENED, onIntervened, true);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const requestConfig = async () => {
    if (disposed) return;
    const request = ++configRequest;
    try {
      const response = await sendRuntimeMessage({ type: 'CG_PAGE_STATE', featureId: 'anyCopy' });
      if (disposed || request !== configRequest) return;
      const config = response?.result?.anyCopy;
      if (!response?.ok) throw new Error(response?.error || 'Configuration is temporarily unavailable.');
      if (!config?.active) { dispose(); return; }
      if (configRetry) clearTimeout(configRetry);
      configRetry = 0;
      configFailures = 0;
      dispatchConfig(config);
      if (window === top) void sendRuntimeMessage({ type: 'CG_CONFIG_APPLIED', featureId: 'anyCopy', active: true }).catch(() => {});
    } catch {
      if (disposed || request !== configRequest) return;
      configFailures += 1;
      if (configFailures >= 4) { dispose(); return; }
      if (!configRetry) configRetry = setTimeout(() => {
        configRetry = 0;
        void requestConfig();
      }, [80, 240, 800][configFailures - 1]);
    }
  };
  function onMainReady(event) {
    if (typeof event.detail !== 'string' || !event.detail) return;
    token = event.detail;
    void requestConfig();
  }
  function onIntervened(event) {
    if (!token || event.detail !== token || window !== top) return;
    void sendRuntimeMessage({ type: 'CG_FEATURE_INTERVENED', featureId: 'anyCopy', pageUrl: location.href }).catch(() => {});
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'anyCopy') {
      dispose();
      sendResponse({ disposed: true });
    }
    else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'anyCopy') void requestConfig();
  }

  window.addEventListener(MAIN_READY, onMainReady, true);
  window.addEventListener(INTERVENED, onIntervened, true);
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose }, configurable: true });
  window.dispatchEvent(new CustomEvent(READY));
})();
