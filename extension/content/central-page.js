(() => {
  const CENTRAL_KEY = Symbol.for('cosmic-gemini.central');
  if (globalThis[CENTRAL_KEY]) return;

  let pending = null;
  let syncFailures = 0;
  let syncRetry = 0;
  const sync = () => {
    if (pending) return pending;
    pending = chrome.runtime.sendMessage({ type: 'CG_SYNC_CENTRAL', url: location.href })
      .then(response => {
        if (!response?.ok) throw new Error(response?.error || 'Central is temporarily unavailable.');
        syncFailures = 0;
      })
      .catch(() => {
        syncFailures += 1;
        if (syncFailures >= 4 || syncRetry) return;
        syncRetry = setTimeout(() => {
          syncRetry = 0;
          void sync();
        }, [80, 240, 800][syncFailures - 1]);
      })
      .finally(() => { pending = null; });
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
