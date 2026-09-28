(() => {
  const BRIDGE_KEY = Symbol.for('cosmic-gemini.website-knowledge-control.bridge');
  if (globalThis[BRIDGE_KEY]) { globalThis[BRIDGE_KEY].reconnect?.(); return; }
  const READY = 'cosmic-gemini:website-knowledge-control:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:website-knowledge-control:main-ready';
  const CONFIGURE = 'cosmic-gemini:website-knowledge-control:configure';
  const DISPOSE = 'cosmic-gemini:website-knowledge-control:dispose';
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
  const route = () => {
    try { return `${window.top.location.href}\n${location.href}`; } catch { return location.href; }
  };
  const readConfig = async () => {
    let failures = 0;
    while (!disposed) {
      const revision = configRevision, requestedRoute = route();
      try {
        const response = await sendRuntimeMessage({ type: 'CG_PAGE_STATE', featureId: 'websiteKnowledgeControl' });
        if (disposed) return false;
        if (revision !== configRevision || requestedRoute !== route()) { if (response?.ok) failures = 0; continue; }
        const config = response?.result?.websiteKnowledgeControl;
        if (!response?.ok) throw new Error(response?.error || 'Configuration is temporarily unavailable.');
        if (!config?.active) { dispose(); return false; }
        dispatchConfig(config);
        return true;
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
  function onMainReady(event) {
    if (typeof event.detail !== 'string' || !event.detail) return;
    if (token && token !== event.detail) configRevision += 1;
    token = event.detail;
    void requestConfig();
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'CG_STOP_CENTRAL_FEATURE' && message.featureId === 'websiteKnowledgeControl') {
      dispose();
      sendResponse({ disposed: true });
    } else if (message?.type === 'CG_REFRESH_FEATURE_CONFIG' && message.featureId === 'websiteKnowledgeControl') {
      configRevision += 1;
      finishRetry();
      void requestConfig().then(configured => sendResponse({ configured }));
      return true;
    }
    return false;
  }

  function reconnect() {
    if (disposed) return;
    window.addEventListener(MAIN_READY, onMainReady, true);
    window.dispatchEvent(new CustomEvent(READY));
  }
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, BRIDGE_KEY, { value: { dispose, reconnect }, configurable: true });
  reconnect();
})();
