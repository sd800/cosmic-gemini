(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.white-softer.bridge');
  if (globalThis[BRIDGE_KEY]) return;
  const READY = 'cosmic-gemini:white-softer:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:white-softer:main-ready';
  const CONFIGURE = 'cosmic-gemini:white-softer:configure';
  const DISPOSE = 'cosmic-gemini:white-softer:dispose';
  let token = '';
  let disposed = false;
  let retryTimer = 0;
  let retryResolve = null;
  let pendingConfig = null;
  let configRevision = 0;

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
  const finishRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = 0;
    const resolve = retryResolve;
    retryResolve = null;
    resolve?.();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    configRevision += 1;
    finishRetry();
    dispatchConfig({ active: false });
    if (token) window.dispatchEvent(new CustomEvent(DISPOSE, { detail: token }));
    window.removeEventListener(MAIN_READY, onMainReady, true);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const readConfig = async () => {
    for (let attempt = 0; attempt < 4 && !disposed; attempt += 1) {
      const revision = configRevision;
      try {
        const response = await sendRuntimeMessage({ type: 'CG_PAGE_STATE', featureId: 'whiteSofter' });
        if (disposed) return false;
        if (revision !== configRevision) continue;
        const config = response?.result?.whiteSofter;
        if (!response?.ok) throw new Error(response?.error || 'Configuration is temporarily unavailable.');
        if (!config?.active) { dispose(); return false; }
        dispatchConfig(config);
        return true;
      } catch {
        if (disposed) return false;
        if (attempt < 3) await new Promise(resolve => {
          retryResolve = resolve;
          retryTimer = setTimeout(finishRetry, [80, 240, 800][attempt]);
        });
      }
    }
    dispose();
    return false;
  };
  const requestConfig = () => {
    if (disposed) return Promise.resolve(false);
    // Readiness and host refreshes overlap. All waiters must receive the final
    // result; a transient failure must not tear down styles before retrying.
    if (!pendingConfig) pendingConfig = readConfig().finally(() => { pendingConfig = null; });
    return pendingConfig;
  };
  function onMainReady(event) {
    if (typeof event.detail !== 'string' || !event.detail) return;
    if (token && token !== event.detail) configRevision += 1;
    token = event.detail;
    void requestConfig();
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'whiteSofter') {
      dispose();
      sendResponse({ disposed: true });
    } else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'whiteSofter') {
      configRevision += 1;
      finishRetry();
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
