(() => {
  const KEY = Symbol.for('cosmic-gemini.white-softer.prepaint-check');
  if (globalThis[KEY]) return;
  const CHECK = 'cosmic-gemini:white-softer:prepaint-check';
  const READY = 'cosmic-gemini:white-softer:prepaint-ready';
  const incognito = chrome.extension?.inIncognitoContext === true;
  const storageKey = incognito ? 'cosmicGeminiIncognitoSettings' : 'cosmicGeminiSettings';
  const area = incognito ? 'session' : 'local';
  let revision = 0;
  const announce = feature => window.dispatchEvent(new CustomEvent(CHECK, { detail: JSON.stringify({
    active: feature?.enabled === true, tone: feature?.tone || 'warm'
  }) }));
  window.addEventListener(READY, () => { void read(); }, true);
  function read() {
    const current = ++revision;
    const request = incognito
      ? chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE', featureId: 'whiteSofter' })
        .then(response => response?.ok ? response.result?.whiteSofter : null)
      : chrome.storage.local.get(storageKey).then(result => result[storageKey]?.whiteSofter);
    return request.then(feature => {
      if (current !== revision || feature === null) return;
      announce(feature);
    }).catch(() => {});
  }
  chrome.storage.onChanged.addListener((changes, changedArea) => {
    if (changedArea !== area || !changes[storageKey]) return;
    revision += 1;
    announce(changes[storageKey].newValue?.whiteSofter);
  });
  Object.defineProperty(globalThis, KEY, { value: true });
  void read();
})();
