(() => {
  const READY = 'cosmic-gemini:ad-marshal:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:ad-marshal:main-ready';
  const CONFIGURE = 'cosmic-gemini:ad-marshal:configure';
  const DISPOSE = 'cosmic-gemini:ad-marshal:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.ad-marshal.runtime');
  const TRACKING_HOSTS = new Set([
    'h.trace.qq.com',
    'btrace.qq.com',
    'otheve.beacon.qq.com',
    'beacon.cdn.qq.com',
    'beaconcdn.qq.com',
    'snowflake.qq.com',
    'oth.str.beacon.qq.com',
    'htrace.wetvinfo.com',
    'svibeacon.onezapp.com'
  ]);
  const SCRIPT_PATHS = [
    'universal-report.min.js',
    '/news-plugin/sdk/emonitor_',
    '/qqindex2021/advertisement/'
  ];
  const AD_CONTAINER_SELECTOR = [
    '.tonglan-ad-channel.ad-news',
    '.rectangle-ad-channel.ad-news',
    '.adbox',
    '[class^="adbox_"]',
    '.ad-brandArea',
    '.ad-click-wrapper',
    '.ad-header-image',
    '.c2s-ad-message-tips',
    '.c2s-ad-title',
    '[class*="qqchannel-ad"]',
    '[id*="qqchannel-ad"]'
  ].join(',');
  const AD_STYLE = `${AD_CONTAINER_SELECTOR}{display:none!important;visibility:hidden!important;}`;

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function urlString(value) {
    if (value instanceof Request) return value.url;
    if (value instanceof URL) return value.href;
    return String(value || '');
  }

  function shouldNeutralize(value) {
    const raw = urlString(value);
    if (!raw) return false;
    const normalized = raw.toLowerCase();
    if (SCRIPT_PATHS.some(fragment => normalized.includes(fragment))) return true;
    if (!normalized.includes('qq.com')
      && !normalized.includes('wetvinfo.com')
      && !normalized.includes('onezapp.com')) return false;
    try { return TRACKING_HOSTS.has(new URL(normalized, location.href).hostname.toLowerCase()); }
    catch { return false; }
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class AdMarshalRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.originalFetch = globalThis.fetch;
      this.originalXhrOpen = XMLHttpRequest.prototype.open;
      this.originalSendBeacon = Navigator.prototype.sendBeacon;
      this.emptyResponseUrl = '';
      this.fetchWrapper = null;
      this.xhrOpenWrapper = null;
      this.sendBeaconWrapper = null;
      this.styleElement = null;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.ensureStyle = this.ensureStyle.bind(this);
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
      if (message.config?.active === true) this.enable();
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

    enable() {
      if (this.active || location.hostname.toLowerCase() !== 'news.qq.com') return;
      this.active = true;
      this.emptyResponseUrl = URL.createObjectURL(new Blob(['{}'], { type: 'application/json' }));
      const runtime = this;
      this.fetchWrapper = function adMarshalFetch(resource, options) {
        if (runtime.active && shouldNeutralize(resource)) {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' }
          }));
        }
        return Reflect.apply(runtime.originalFetch, this, [resource, options]);
      };
      this.xhrOpenWrapper = function adMarshalXhrOpen(method, url, async = true, ...rest) {
        if (runtime.active && shouldNeutralize(url)) {
          return Reflect.apply(runtime.originalXhrOpen, this, ['GET', runtime.emptyResponseUrl, async !== false]);
        }
        return Reflect.apply(runtime.originalXhrOpen, this, [method, url, async, ...rest]);
      };
      this.sendBeaconWrapper = function adMarshalSendBeacon(url, data) {
        if (runtime.active && shouldNeutralize(url)) return true;
        return Reflect.apply(runtime.originalSendBeacon, this, [url, data]);
      };
      globalThis.fetch = this.fetchWrapper;
      XMLHttpRequest.prototype.open = this.xhrOpenWrapper;
      Navigator.prototype.sendBeacon = this.sendBeaconWrapper;
      this.ensureStyle();
    }

    ensureStyle() {
      if (!this.active || this.styleElement?.isConnected) return;
      const parent = document.head || document.documentElement;
      if (!parent) {
        document.addEventListener('readystatechange', this.ensureStyle, { once: true });
        return;
      }
      this.styleElement = document.createElement('style');
      this.styleElement.textContent = AD_STYLE;
      parent.appendChild(this.styleElement);
    }

    disable() {
      if (!this.active) return;
      this.active = false;
      if (globalThis.fetch === this.fetchWrapper) globalThis.fetch = this.originalFetch;
      if (XMLHttpRequest.prototype.open === this.xhrOpenWrapper) XMLHttpRequest.prototype.open = this.originalXhrOpen;
      if (Navigator.prototype.sendBeacon === this.sendBeaconWrapper) Navigator.prototype.sendBeacon = this.originalSendBeacon;
      if (this.emptyResponseUrl) URL.revokeObjectURL(this.emptyResponseUrl);
      this.emptyResponseUrl = '';
      document.removeEventListener('readystatechange', this.ensureStyle);
      this.styleElement?.remove();
      this.styleElement = null;
    }
  }

  const runtime = new AdMarshalRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
