(() => {
  const READY = 'cosmic-gemini:page-display:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:page-display:main-ready';
  const CONFIGURE = 'cosmic-gemini:page-display:configure';
  const DISPOSE = 'cosmic-gemini:page-display:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.page-display.runtime');

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function normalizedReduction(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(0.8, Math.max(0.1, number)) : 0.25;
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class PageDisplayRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.host = null;
      this.shade = null;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.mount = this.mount.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
      window.addEventListener(READY, this.onBridgeReady, true);
    }

    announce() { window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token })); }
    onBridgeReady() { this.announce(); }
    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      if (message.config?.active === true) this.enable(message.config);
      else this.disable();
    }
    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      try { delete globalThis[RUNTIME_KEY]; } catch {}
    }

    createOverlay() {
      if (this.host) return;
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = [
        'all:initial',
        'display:block',
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'pointer-events:none',
        'background:transparent'
      ].join(';');
      const shadow = host.attachShadow({ mode: 'closed' });
      const shade = document.createElement('div');
      shade.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none';
      shadow.append(shade);
      this.host = host;
      this.shade = shade;
    }

    mount() {
      if (!this.active) return;
      this.createOverlay();
      const target = document.fullscreenElement || document.documentElement;
      if (!target) {
        document.addEventListener('readystatechange', this.mount, { once: true });
        return;
      }
      if (this.host.parentNode !== target) target.append(this.host);
    }

    enable(config) {
      const reduceWhitePoint = config.reduceWhitePoint?.enabled === true;
      const greyscale = config.greyscale?.enabled === true;
      if (!reduceWhitePoint && !greyscale) { this.disable(); return; }
      this.active = true;
      this.mount();
      if (this.host) {
        const value = greyscale ? 'grayscale(1)' : 'none';
        this.host.style.backdropFilter = value;
        this.host.style.webkitBackdropFilter = value;
      }
      if (this.shade) {
        this.shade.style.opacity = reduceWhitePoint
          ? String(normalizedReduction(config.reduceWhitePoint?.reduction))
          : '0';
      }
      document.addEventListener('fullscreenchange', this.mount, true);
    }

    disable() {
      if (!this.active && !this.host) return;
      this.active = false;
      document.removeEventListener('readystatechange', this.mount);
      document.removeEventListener('fullscreenchange', this.mount, true);
      this.host?.remove();
      this.host = null;
      this.shade = null;
    }
  }

  const runtime = new PageDisplayRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
