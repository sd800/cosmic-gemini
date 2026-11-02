(() => {
  const state = globalThis[Symbol.for('cosmic-gemini.crash-page-warden.static')];
  const tones = globalThis[Symbol.for('cosmic-gemini.white-tones')];
  const WhiteCapLayer = globalThis[Symbol.for('cosmic-gemini.white-cap-layer')];
  if (!state || state.whiteSofter) return;
  const privateContext = chrome.extension.inIncognitoContext === true;
  const area = privateContext ? 'session' : 'local';
  const settingsKey = privateContext ? 'cosmicGeminiIncognitoSettings' : 'cosmicGeminiSettings';
  const printMedia = matchMedia('print');
  let preference, layer, revision = 0, suspended = false, listening = false;

  function render() {
    if (!state.started || suspended || !preference) return;
    const root = document.documentElement;
    // Keep text/paper native, and cap remaining white pixels (including images)
    // with the same primitive as White Softer. No extra transition guard is
    // needed: this reader owns its startup background and theme.
    if (state.ready && preference.enabled && !printMedia.matches) {
      layer ||= new WhiteCapLayer('data-cg-warden-white-softer');
      layer.enable(preference.tone);
    } else layer?.disable();
    if (preference.enabled) {
      const rgb = tones.get(preference.tone).rgb;
      // The composited curve is not idempotent. Feed it white once, rather
      // than feeding already-softened text/paper through it a second time.
      const base = layer?.host?.matches(':popover-open') ? '255 255 255' : rgb;
      if (root.style.getPropertyValue('--cg-warden-white') !== rgb) root.style.setProperty('--cg-warden-white', rgb);
      if (root.style.getPropertyValue('--cg-warden-render-white') !== base) root.style.setProperty('--cg-warden-render-white', base);
    } else {
      root.style.removeProperty('--cg-warden-white'); root.style.removeProperty('--cg-warden-render-white');
    }
  }
  function configure(feature) {
    if (!feature) return;
    revision += 1;
    preference = { enabled: feature.enabled === true, tone: tones.normalizeWhiteSofter(feature.tone) };
    render();
  }
  async function refresh() {
    const current = ++revision;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE', featureId: 'whiteSofter' });
      if (!suspended && current === revision && response?.ok && response.result?.whiteSofter) configure(response.result.whiteSofter);
    } catch { /* Retain the last confirmed palette if the extension is reloading. */ }
  }
  function onStorage(changes, changedArea) {
    if (suspended || changedArea !== area || !changes[settingsKey]) return;
    const change = changes[settingsKey];
    if (JSON.stringify(change.oldValue?.whiteSofter) !== JSON.stringify(change.newValue?.whiteSofter)) {
      configure(change.newValue?.whiteSofter || { enabled: false });
    }
  }
  function listen() {
    if (!listening) {
      chrome.storage.onChanged.addListener(onStorage); chrome.runtime.onMessage.addListener(onMessage); listening = true;
    }
  }
  function onMessage(message) {
    if (message?.featureId === 'whiteSofter' && ['CG_REFRESH_FEATURE_CONFIG', 'CG_STOP_CENTRAL_FEATURE'].includes(message.type)) void refresh();
    return false;
  }
  state.whiteSofter = {
    configure, render, ready: null,
    start() {
      // Retire our ordinary-page layer before the reader takes ownership.
      globalThis[Symbol.for('cosmic-gemini.white-softer.bridge')]?.dispose?.();
      window.dispatchEvent(new CustomEvent('cosmic-gemini:white-softer:prepaint-check', { detail: JSON.stringify({ active: false }) }));
      listen();
      this.ready = refresh();
      document.addEventListener('visibilitychange', render);
      document.addEventListener('readystatechange', render);
      printMedia.addEventListener('change', render);
      addEventListener('pagehide', () => {
        suspended = true; revision += 1;
        if (listening) {
          chrome.storage.onChanged.removeListener(onStorage); chrome.runtime.onMessage.removeListener(onMessage);
        }
        listening = false;
        // Keep the last painted surface until the browser leaves the document.
      });
      addEventListener('pageshow', event => {
        if (!event.persisted) return;
        suspended = false; listen(); render(); void refresh();
      });
    }
  };
})();
