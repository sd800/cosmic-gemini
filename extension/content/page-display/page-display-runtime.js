(() => {
  const READY = 'cosmic-gemini:page-display:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:page-display:main-ready';
  const CONFIGURE = 'cosmic-gemini:page-display:configure';
  const DISPOSE = 'cosmic-gemini:page-display:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.page-display.runtime');
  const REPLACED_FULLSCREEN = new Set(['canvas', 'img', 'video', 'iframe', 'object', 'embed']);
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const OVERLAY_ATTRIBUTE = 'data-cosmic-gemini-page-display';

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

  function reductionStep(value) {
    return String(Math.round(normalizedReduction(value) * 20) * 5);
  }

  function invertSlope(filter) {
    let slope = 1;
    const expression = /invert\(\s*([^)]*)\)/gi;
    for (const match of String(filter || '').matchAll(expression)) {
      const raw = match[1].trim();
      let amount = raw === '' ? 1 : Number.parseFloat(raw);
      if (!Number.isFinite(amount)) continue;
      if (raw.endsWith('%')) amount /= 100;
      amount = Math.min(1, Math.max(0, amount));
      slope *= 1 - (2 * amount);
    }
    return slope;
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class PageDisplayRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.reduction = '0';
      this.greyscale = false;
      this.host = null;
      this.appearanceObserver = null;
      this.surfaceObserver = null;
      this.observedRoot = null;
      this.promotedFullscreen = null;
      this.appearanceTargets = new WeakSet();
      this.appearanceRefreshQueued = false;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.mount = this.mount.bind(this);
      this.scheduleAppearanceRefresh = this.scheduleAppearanceRefresh.bind(this);
      this.refreshShadeColor = this.refreshShadeColor.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
      window.addEventListener(READY, this.onBridgeReady, true);
    }

    announce() {
      // document.open can erase Window listeners while this runtime survives.
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      if (this.active) {
        document.addEventListener('fullscreenchange', this.mount, true);
        document.addEventListener('readystatechange', this.mount, true);
        this.mount();
      }
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }
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
      const host = document.createElementNS(HTML_NS, 'div');
      host.setAttribute('aria-hidden', 'true');
      host.setAttribute(OVERLAY_ATTRIBUTE, '');
      host.setAttribute('data-greyscale', 'false');
      host.setAttribute('data-reduction', '0');
      host.setAttribute('data-shade', 'dark');
      this.host = host;
    }

    shadeIsInsideInversion() {
      // A top-layer popover is composited outside ancestor page filters.
      if (this.promotedFullscreen) return false;
      let slope = 1;
      for (let node = this.host?.parentElement; node; node = node.parentElement) {
        try { slope *= invertSlope(getComputedStyle(node).filter); } catch {}
      }
      return slope < 0;
    }

    refreshShadeColor() {
      this.appearanceRefreshQueued = false;
      if (!this.active || !this.host) return;
      this.host.setAttribute('data-shade', this.shadeIsInsideInversion() ? 'light' : 'dark');
    }

    scheduleAppearanceRefresh() {
      if (!this.active || this.appearanceRefreshQueued) return;
      this.appearanceRefreshQueued = true;
      queueMicrotask(this.refreshShadeColor);
    }

    observeAppearanceTarget(target, options) {
      if (!target || this.appearanceTargets.has(target)) return;
      this.appearanceObserver.observe(target, options);
      this.appearanceTargets.add(target);
    }

    observeAppearanceTargets() {
      if (!this.appearanceObserver) return;
      this.observeAppearanceTarget(document.documentElement, {
        attributes: true,
        childList: true,
        attributeFilter: ['class', 'style', 'data-darkreader-mode', 'data-darkreader-scheme']
      });
      this.observeAppearanceTarget(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-darkreader-mode', 'data-darkreader-scheme']
      });
      this.observeAppearanceTarget(document.head, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'id', 'media', 'disabled']
      });
    }

    startAppearanceTracking() {
      document.addEventListener('readystatechange', this.scheduleAppearanceRefresh, true);
      document.addEventListener('__darkreader__updateSheet', this.scheduleAppearanceRefresh, true);
      window.addEventListener('load', this.scheduleAppearanceRefresh, true);
      window.addEventListener('pageshow', this.scheduleAppearanceRefresh, true);
      if (this.appearanceObserver) { this.observeAppearanceTargets(); return; }
      this.appearanceTargets = new WeakSet();
      this.appearanceObserver = new MutationObserver(() => {
        this.observeAppearanceTargets();
        this.scheduleAppearanceRefresh();
      });
      this.observeAppearanceTargets();
    }

    stopAppearanceTracking() {
      this.appearanceObserver?.disconnect();
      this.appearanceObserver = null;
      this.appearanceTargets = new WeakSet();
      document.removeEventListener('readystatechange', this.scheduleAppearanceRefresh, true);
      document.removeEventListener('__darkreader__updateSheet', this.scheduleAppearanceRefresh, true);
      window.removeEventListener('load', this.scheduleAppearanceRefresh, true);
      window.removeEventListener('pageshow', this.scheduleAppearanceRefresh, true);
      this.appearanceRefreshQueued = false;
    }

    observeSurface() {
      if (!this.surfaceObserver) {
        this.surfaceObserver = new MutationObserver(() => {
          this.mount();
          this.observeAppearanceTargets();
        });
        this.surfaceObserver.observe(document, { childList: true });
      }
      const root = document.documentElement;
      if (root && root !== this.observedRoot) {
        this.surfaceObserver.disconnect();
        this.surfaceObserver.observe(document, { childList: true });
        this.surfaceObserver.observe(root, { childList: true });
        this.observedRoot = root;
      }
    }

    mount() {
      if (!this.active) return;
      this.observeSurface();
      const root = document.documentElement;
      // Do not mutate a raw XML/SVG tree before Chrome builds its native view.
      if (!root || root.namespaceURI !== HTML_NS || root.localName !== 'html'
        || (document.contentType !== 'text/html' && document.readyState !== 'complete')) return;
      this.createOverlay();
      this.host.setAttribute('data-greyscale', String(this.greyscale));
      this.host.setAttribute('data-reduction', this.reduction);
      const fullscreen = document.fullscreenElement;
      const replaced = fullscreen && REPLACED_FULLSCREEN.has(fullscreen.localName);
      const target = replaced ? root : fullscreen || root;
      if (!replaced && this.promotedFullscreen) {
        try { this.host.hidePopover(); } catch {}
        this.host.removeAttribute('popover');
        this.promotedFullscreen = null;
      }
      if (this.host.parentNode !== target) target.append(this.host);
      // Replaced elements do not paint children. Promote this same passive layer
      // after the fullscreen surface instead of appending an invisible overlay.
      if (replaced && (this.promotedFullscreen !== fullscreen || !this.host.matches(':popover-open'))) {
        this.host.setAttribute('popover', 'manual');
        try {
          this.host.hidePopover();
          this.host.showPopover();
          this.promotedFullscreen = fullscreen;
        } catch {}
      }
      this.refreshShadeColor();
    }

    enable(config) {
      const reduceWhitePoint = config.reduceWhitePoint?.enabled === true;
      const greyscale = config.greyscale?.enabled === true;
      if (!reduceWhitePoint && !greyscale) { this.disable(); return; }
      this.reduction = reduceWhitePoint ? reductionStep(config.reduceWhitePoint?.reduction) : '0';
      this.greyscale = greyscale;
      this.active = true;
      this.mount();
      if (reduceWhitePoint) this.startAppearanceTracking();
      else this.stopAppearanceTracking();
      this.refreshShadeColor();
      document.addEventListener('fullscreenchange', this.mount, true);
      document.addEventListener('readystatechange', this.mount, true);
    }

    disable() {
      if (!this.active && !this.host) return;
      this.active = false;
      document.removeEventListener('readystatechange', this.mount, true);
      this.surfaceObserver?.disconnect();
      this.surfaceObserver = null;
      this.observedRoot = null;
      document.removeEventListener('fullscreenchange', this.mount, true);
      this.stopAppearanceTracking();
      if (this.promotedFullscreen) { try { this.host?.hidePopover(); } catch {} }
      this.promotedFullscreen = null;
      this.host?.remove();
      this.host = null;
    }
  }

  const runtime = new PageDisplayRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
