(() => {
  const CENTRAL_KEY = Symbol.for('cosmic-gemini.central');
  if (globalThis[CENTRAL_KEY]) return;

  let pending = null;
  const sync = () => {
    if (pending) return pending;
    pending = chrome.runtime.sendMessage({ type: 'CG_SYNC_CENTRAL', url: location.href })
      .catch(() => {})
      .finally(() => { pending = null; });
    return pending;
  };
  const onMessage = message => {
    if (message?.type === 'CG_REFRESH_CONFIG') void sync();
  };

  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, CENTRAL_KEY, { value: { sync }, configurable: false });
  void sync();
})();
