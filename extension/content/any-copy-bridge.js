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
  let configRetry = 0;

  const dispatchConfig = config => {
    if (token) window.dispatchEvent(new CustomEvent(CONFIGURE, { detail: JSON.stringify({ token, config }) }));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (configRetry) clearTimeout(configRetry);
    dispatchConfig({ active: false });
    if (token) window.dispatchEvent(new CustomEvent(DISPOSE, { detail: token }));
    window.removeEventListener(MAIN_READY, onMainReady, true);
    window.removeEventListener(INTERVENED, onIntervened, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const requestConfig = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE', featureId: 'anyCopy' });
      const config = response?.result?.anyCopy;
      if (!response?.ok) throw new Error(response?.error || 'Configuration is temporarily unavailable.');
      if (!config?.active) { dispose(); return; }
      if (configRetry) clearTimeout(configRetry);
      configRetry = 0;
      configFailures = 0;
      dispatchConfig(config);
      if (window === top) void chrome.runtime.sendMessage({ type: 'CG_CONFIG_APPLIED', featureId: 'anyCopy', active: true }).catch(() => {});
    } catch {
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
    void chrome.runtime.sendMessage({ type: 'CG_FEATURE_INTERVENED', featureId: 'anyCopy' }).catch(() => {});
  }
  function onMessage(message) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'anyCopy') dispose();
    else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'anyCopy') void requestConfig();
  }

  window.addEventListener(MAIN_READY, onMainReady, true);
  window.addEventListener(INTERVENED, onIntervened, true);
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose }, configurable: true });
  window.dispatchEvent(new CustomEvent(READY));
})();
