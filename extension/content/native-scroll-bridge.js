(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.native-scroll.bridge');
  if (globalThis[BRIDGE_KEY]) return;
  const READY = 'cosmic-gemini:native-scroll:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:native-scroll:main-ready';
  const CONFIGURE = 'cosmic-gemini:native-scroll:configure';
  const DISPOSE = 'cosmic-gemini:native-scroll:dispose';
  const INTERVENED = 'cosmic-gemini:native-scroll:suppressed';
  let token = '';
  let disposed = false;

  const dispatchConfig = config => {
    if (!token) return;
    window.dispatchEvent(new CustomEvent(CONFIGURE, { detail: JSON.stringify({ token, config }) }));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    dispatchConfig({ active: false });
    if (token) window.dispatchEvent(new CustomEvent(DISPOSE, { detail: token }));
    window.removeEventListener(MAIN_READY, onMainReady, true);
    window.removeEventListener(INTERVENED, onIntervened, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const requestConfig = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE', featureId: 'nativeScroll' });
      const config = response?.result?.nativeScroll;
      if (!response?.ok || !config?.active) { dispose(); return; }
      dispatchConfig(config);
      await chrome.runtime.sendMessage({ type: 'CG_CONFIG_APPLIED', featureId: 'nativeScroll', active: true });
    } catch { dispose(); }
  };
  function onMainReady(event) {
    if (typeof event.detail !== 'string' || !event.detail) return;
    token = event.detail;
    void requestConfig();
  }
  function onIntervened(event) {
    if (!token || event.detail !== token) return;
    void chrome.runtime.sendMessage({ type: 'CG_FEATURE_INTERVENED', featureId: 'nativeScroll' }).catch(() => {});
  }
  function onMessage(message) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'nativeScroll') dispose();
    else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'nativeScroll') void requestConfig();
  }

  window.addEventListener(MAIN_READY, onMainReady, true);
  window.addEventListener(INTERVENED, onIntervened, true);
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose }, configurable: true });
  window.dispatchEvent(new CustomEvent(READY));
})();
