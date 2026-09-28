(() => {
  const CENTRAL_KEY = Symbol.for('cosmic-gemini.central');
  if (globalThis[CENTRAL_KEY]) return;

  let pending = null;
  let suspended = false;
  let syncQueued = false;
  let syncFailures = 0;
  let syncRetry = 0;
  let syncGeneration = 0;
  const sendRuntimeMessage = message => {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const synchronizeOnce = generation => sendRuntimeMessage({ type: 'CG_SYNC_CENTRAL', url: location.href })
      .then(response => {
        if (generation !== syncGeneration) return;
        if (!response?.ok) throw new Error(response?.error || 'Central is temporarily unavailable.');
        syncFailures = 0;
        if (syncRetry) clearTimeout(syncRetry);
        syncRetry = 0;
      })
      .catch(() => {
        if (generation !== syncGeneration) return;
        syncFailures += 1;
        if (suspended || syncFailures >= 4 || syncRetry) return;
        syncRetry = setTimeout(() => {
          syncRetry = 0;
          void sync();
        }, [80, 240, 800][syncFailures - 1]);
      });
  const sync = () => {
    if (suspended) return Promise.resolve();
    syncQueued = true;
    if (pending) return pending;
    const generation = syncGeneration;
    const current = (async () => {
      while (syncQueued && !suspended && generation === syncGeneration) {
        syncQueued = false;
        await synchronizeOnce(generation);
      }
    })().finally(() => { if (pending === current) pending = null; });
    pending = current;
    return current;
  };
  const onMessage = (message, _sender, sendResponse) => {
    if (message?.type === 'CG_PAGE_ALIVE') {
      sendResponse({ url: location.href });
      return;
    }
    if (message?.type !== 'CG_REFRESH_CONFIG') return;
    syncFailures = 0;
    if (syncRetry) clearTimeout(syncRetry);
    syncRetry = 0;
    void sync();
  };

  // BFCache documents do not rerun content scripts. Refresh current policy on
  // return, including changes made while this document could not receive messages.
  window.addEventListener('pagehide', () => {
    suspended = true; syncQueued = false;
    // A channel frozen by BFCache may never settle in the restored context.
    // Retire its promise; return must be able to request current policy afresh.
    syncGeneration += 1; pending = null;
    if (syncRetry) clearTimeout(syncRetry);
    syncRetry = 0;
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    suspended = false; syncFailures = 0;
    void sync();
  });
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, CENTRAL_KEY, { value: { sync }, configurable: false });
  void sync();
})();
