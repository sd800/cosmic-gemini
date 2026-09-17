(() => {
  const KEY = Symbol.for('cosmic-gemini.website-knowledge-control.runtime');
  const PREFIX = 'cosmic-gemini:website-knowledge-control:';
  const identity = globalThis[Symbol.for('cosmic-gemini.browser-identity')];
  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  if (globalThis[KEY]) { globalThis[KEY].announce(); return; }
  const token = randomToken();
  let configured = false;
  const announce = () => window.dispatchEvent(new CustomEvent(PREFIX + 'main-ready', { detail: token }));
  function configure(event) {
    let message;
    try { message = JSON.parse(event.detail); } catch { return; }
    if (message?.token !== token) return;
    const config = message.config;
    // A document keeps the browser information it received at load time. Later
    // settings changes are picked up only by the next document.
    if (!config?.active || configured) return;
    configured = true;
    identity.set('website-knowledge-control', {
      language: config.languages?.enabled ? config.languages.value : '',
      locale: config.languages?.enabled ? config.languages.value : '',
      timeZone: config.timeZone?.enabled ? config.timeZone.value : '',
      globalPrivacyControl: config.globalPrivacyControl?.enabled === true
    }, 10);
  }
  function dispose(event) {
    if (event?.detail !== token) return;
    window.removeEventListener(PREFIX + 'configure', configure, true);
    window.removeEventListener(PREFIX + 'dispose', dispose, true);
    window.removeEventListener(PREFIX + 'bridge-ready', announce, true);
  }
  Object.defineProperty(globalThis, KEY, { configurable: true, value: { token, announce } });
  window.addEventListener(PREFIX + 'configure', configure, true);
  window.addEventListener(PREFIX + 'dispose', dispose, true);
  window.addEventListener(PREFIX + 'bridge-ready', announce, true);
  announce();
})();
