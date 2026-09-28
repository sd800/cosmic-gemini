(() => {
  const KEY = Symbol.for('cosmic-gemini.white-softer.prepaint-check');
  if (globalThis[KEY] || globalThis[Symbol.for('cosmic-gemini.white-softer.bridge')]) return;
  const CHECK = 'cosmic-gemini:white-softer:prepaint-check';
  const READY = 'cosmic-gemini:white-softer:prepaint-ready';
  const incognito = chrome.extension?.inIncognitoContext === true;
  const storageKey = incognito ? 'cosmicGeminiIncognitoSettings' : 'cosmicGeminiSettings';
  const area = incognito ? 'session' : 'local';
  let revision = 0;
  let disposed = false;
  let prepaintReady = false;
  const announce = feature => {
    window.dispatchEvent(new CustomEvent(CHECK, { detail: JSON.stringify({
      active: feature?.enabled === true, tone: feature?.tone || 'warm-minus-1'
    }) }));
    // A disabled early read can precede MAIN script injection. Keep listening
    // until its ready signal so that a late stale layer is actually removed.
    if (prepaintReady && feature?.enabled !== true) dispose();
  };
  function onReady() { prepaintReady = true; void read(); }
  window.addEventListener(READY, onReady, true);
  function read() {
    if (disposed) return Promise.resolve();
    const current = ++revision;
    // Extension invalidation can make these APIs throw before returning a
    // promise. Treat that as a failed read, never as an inactive preference.
    const request = Promise.resolve().then(() => incognito
      ? chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE', featureId: 'whiteSofter' })
        .then(response => response?.ok ? response.result?.whiteSofter : null)
      : chrome.storage.local.get(storageKey).then(result => result[storageKey]?.whiteSofter));
    return request.then(feature => {
      if (disposed || current !== revision || feature === null) return;
      announce(feature);
    }).catch(() => {});
  }
  function onStorageChanged(changes, changedArea) {
    if (disposed) return;
    if (changedArea !== area || !changes[storageKey]) return;
    revision += 1;
    announce(changes[storageKey].newValue?.whiteSofter);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; revision += 1;
    window.removeEventListener(READY, onReady, true);
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch {}
    try { delete globalThis[KEY]; } catch {}
  }
  chrome.storage.onChanged.addListener(onStorageChanged);
  Object.defineProperty(globalThis, KEY, { value: Object.freeze({ dispose }), configurable: true });
  void read();
})();
