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
      this.active = false;
      this.host = null;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.announce = this.announce.bind(this);
      this.mount = this.mount.bind(this);
      this.onToggle = this.onToggle.bind(this);
      window.addEventListener(PREFIX + 'configure', this.onConfigure, true);
      window.addEventListener(PREFIX + 'dispose', this.onDispose, true);
      window.addEventListener(PREFIX + 'bridge-ready', this.announce, true);
    }
    announce() { window.dispatchEvent(new CustomEvent(PREFIX + 'main-ready', { detail: this.token })); }
    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      if (message.config?.active !== true) { this.disable(); return; }
      this.active = true;
      if (!this.host) {
        this.host = document.createElement('div');
        this.host.setAttribute('data-cosmic-gemini-white-softer', '');
        this.host.setAttribute('popover', 'manual');
        this.host.setAttribute('aria-hidden', 'true');
        this.host.setAttribute('inert', '');
        // Stay invisible until the USER stylesheet has arrived, even if CSP blocks inline styles.
        this.host.setAttribute('hidden', '');
      }
      this.host.setAttribute('data-tone', ['warm-minus-1', 'warm-plus-1', 'warm-plus-2', 'cool'].includes(message.config.tone) ? message.config.tone : 'warm');
      this.mount();
      document.addEventListener('fullscreenchange', this.mount, true);
      document.addEventListener('toggle', this.onToggle, true);
    }
    mount() {
      if (!this.active || !this.host) return;
      const target = document.fullscreenElement || document.documentElement;
      if (!target) {
        document.addEventListener('readystatechange', this.mount, { once: true });
        return;
      }
      if (this.host.parentNode !== target) target.append(this.host);
      // A manual top-layer popover blends against the final page, outside ancestor
      // filters/stacking contexts. It neither takes focus nor dismisses page popovers.
      if (!this.host.matches(':popover-open')) this.host.showPopover();
    }
    onToggle(event) {
      if (!this.active || event.target === this.host || event.newState !== 'open') return;
      // Keep newly opened dialogs/popovers covered, using only their native lifecycle event.
      if (this.host.matches(':popover-open')) this.host.hidePopover();
      this.mount();
    }
    disable() {
      this.active = false;
      document.removeEventListener('readystatechange', this.mount);
      document.removeEventListener('fullscreenchange', this.mount, true);
      document.removeEventListener('toggle', this.onToggle, true);
      this.host?.remove();
      this.host = null;
    }
    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
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
