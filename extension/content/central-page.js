(() => {
  const CENTRAL_KEY = Symbol.for('cosmic-gemini.central');
  if (globalThis[CENTRAL_KEY]) return;

  let pending = null;
  let syncQueued = false;
  let syncFailures = 0;
  let syncRetry = 0;
  const synchronizeOnce = () => chrome.runtime.sendMessage({ type: 'CG_SYNC_CENTRAL', url: location.href })
      .then(response => {
        if (!response?.ok) throw new Error(response?.error || 'Central is temporarily unavailable.');
        syncFailures = 0;
        if (syncRetry) clearTimeout(syncRetry);
        syncRetry = 0;
      })
      .catch(() => {
        syncFailures += 1;
        if (syncFailures >= 4 || syncRetry) return;
        syncRetry = setTimeout(() => {
          syncRetry = 0;
          void sync();
        }, [80, 240, 800][syncFailures - 1]);
      });
  const sync = () => {
    syncQueued = true;
    if (pending) return pending;
    pending = (async () => {
      while (syncQueued) {
        syncQueued = false;
        await synchronizeOnce();
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  const onMessage = message => {
    if (message?.type !== 'CG_REFRESH_CONFIG') return;
    syncFailures = 0;
    if (syncRetry) clearTimeout(syncRetry);
    syncRetry = 0;
    void sync();
  };

  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, CENTRAL_KEY, { value: { sync }, configurable: false });
  void sync();
})();
