(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.mailto-capture.bridge');
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.mailto-capture.runtime');
  if (globalThis[BRIDGE_KEY]) { globalThis[BRIDGE_KEY].reconnect?.(); return; }
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

  const finishRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = 0;
    const resolve = retryResolve;
    retryResolve = null;
    resolve?.();
  };
  const dispose = (confirmed = false) => {
    if (confirmed) { try { chrome.runtime.onMessage.removeListener(onMessage); } catch {} }
    if (disposed) return;
    disposed = true;
    configRevision += 1;
    finishRetry();
    globalThis[RUNTIME_KEY]?.dispose();
    try { delete globalThis[BRIDGE_KEY]; } catch {}
  };
  const route = () => {
    try { return `${window.top.location.href}\n${location.href}`; } catch { return location.href; }
  };
  const readConfig = async () => {
    let failures = 0;
    while (!disposed) {
      const revision = configRevision, requestedRoute = route();
      try {
        const response = await sendRuntimeMessage({ type: 'CG_PAGE_STATE', featureId: 'mailtoCapture' });
        if (disposed) return false;
        if (revision !== configRevision || requestedRoute !== route()) { if (response?.ok) failures = 0; continue; }
        const config = response?.result?.mailtoCapture;
        if (!response?.ok) throw new Error(response?.error || 'Configuration is temporarily unavailable.');
        if (!config?.active) { dispose(); return false; }
        return globalThis[RUNTIME_KEY]?.configure(config) === true;
      } catch {
        if (disposed) return false;
        if (revision !== configRevision || requestedRoute !== route()) continue;
        failures += 1;
        if (failures >= 4) break;
        await new Promise(resolve => {
          retryResolve = resolve;
          retryTimer = setTimeout(finishRetry, [80, 240, 800][failures - 1]);
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
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'mailtoCapture') {
      dispose(true);
      sendResponse({ disposed: true });
    } else if (!disposed && message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'mailtoCapture') {
      configRevision += 1;
      finishRetry();
      void requestConfig().then(configured => sendResponse({ configured }));
      return true;
    }
    return false;
  }

  function reconnect() {
    if (!disposed && globalThis[RUNTIME_KEY]) void requestConfig();
  }
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose, reconnect }, configurable: true });
  reconnect();
})();
