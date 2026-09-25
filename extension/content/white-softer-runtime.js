(() => {
  const KEY = Symbol.for('cosmic-gemini.white-softer.runtime');
  const PREFIX = 'cosmic-gemini:white-softer:';
  if (globalThis[KEY]) { globalThis[KEY].announce(); return; }

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  class WhiteSofterRuntime {
    constructor() {
      this.token = randomToken();
      this.layer = new (globalThis[Symbol.for('cosmic-gemini.white-cap-layer')])('data-cosmic-gemini-white-softer');
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.announce = this.announce.bind(this);
      window.addEventListener(PREFIX + 'configure', this.onConfigure, true);
      window.addEventListener(PREFIX + 'dispose', this.onDispose, true);
      window.addEventListener(PREFIX + 'bridge-ready', this.announce, true);
    }
    announce() { window.dispatchEvent(new CustomEvent(PREFIX + 'main-ready', { detail: this.token })); }
    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      if (message.config?.active !== true) { this.layer.disable(); return; }
      this.layer.enable(message.config.tone);
    }
    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.layer.disable();
      window.removeEventListener(PREFIX + 'configure', this.onConfigure, true);
      window.removeEventListener(PREFIX + 'dispose', this.onDispose, true);
      window.removeEventListener(PREFIX + 'bridge-ready', this.announce, true);
      try { delete globalThis[KEY]; } catch {}
    }
  }
  const runtime = new WhiteSofterRuntime();
  Object.defineProperty(globalThis, KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
