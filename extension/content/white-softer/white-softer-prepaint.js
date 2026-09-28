(() => {
  const KEY = Symbol.for('cosmic-gemini.white-softer.prepaint');
  // Immediate runtime injection may beat this registered document-start script.
  // The configured runtime already owns the layer and its newer preference.
  if (globalThis[KEY] || globalThis[Symbol.for('cosmic-gemini.white-softer.runtime')]) return;
  const CHECK = 'cosmic-gemini:white-softer:prepaint-check';
  const READY = 'cosmic-gemini:white-softer:prepaint-ready';
  const tone = globalThis[Symbol.for('cosmic-gemini.white-softer.prepaint-tone')] || 'warm-minus-1';
  const layer = new (globalThis[Symbol.for('cosmic-gemini.white-cap-layer')])('data-cosmic-gemini-white-softer');
  const release = () => {
    window.removeEventListener(CHECK, onCheck, true);
    delete globalThis[KEY];
  };
  function onCheck(event) {
    let config;
    try { config = JSON.parse(event.detail); } catch { return; }
    if (config?.active !== true) { layer.disable(); release(); }
    else layer.enable(config.tone);
  }
  const prepaint = Object.freeze({
    handoff() { release(); return layer; }
  });
  Object.defineProperty(globalThis, KEY, { value: prepaint, configurable: true });
  window.addEventListener(CHECK, onCheck, true);
  layer.enable(tone);
  window.dispatchEvent(new CustomEvent(READY));
})();
