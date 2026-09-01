(() => {
  const READY = 'cosmic-gemini:ad-marshal:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:ad-marshal:main-ready';
  const CONFIGURE = 'cosmic-gemini:ad-marshal:configure';
  const DISPOSE = 'cosmic-gemini:ad-marshal:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.ad-marshal.runtime');
  const NEWS_QQ_AD_CONTAINER_SELECTOR = [
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
  const SITE_CONFIGS = Object.freeze({
    newsQqCom: Object.freeze({
      hosts: new Set(['news.qq.com']),
      trackingHosts: new Set([
        'h.trace.qq.com',
        'btrace.qq.com',
        'otheve.beacon.qq.com',
        'beacon.cdn.qq.com',
        'beaconcdn.qq.com',
        'snowflake.qq.com',
        'oth.str.beacon.qq.com',
        'htrace.wetvinfo.com',
        'svibeacon.onezapp.com',
        'news.ssp.qq.com',
        'op.ssp.qq.com'
      ]),
      scriptPaths: Object.freeze([
        'universal-report.min.js',
        '/news-plugin/sdk/emonitor_',
        '/qqindex2021/advertisement/'
      ]),
      style: `${NEWS_QQ_AD_CONTAINER_SELECTOR}{display:none!important;visibility:hidden!important;}`,
      localProbe: true
    }),
    douyinCom: Object.freeze({
      hosts: new Set(['douyin.com', 'www.douyin.com']),
      trackingHosts: new Set([
        'mon.zijieapi.com',
        'mcs.zijieapi.com',
        'log.zijieapi.com',
        'applog.zijieapi.com',
        'log.snssdk.com',
        'log.byteoversea.com',
        'mon.byteoversea.com',
        'monsetting.toutiao.com',
        'monsetting.toutiaocloud.com'
      ]),
      scriptPaths: Object.freeze([
        '/obj/applog-sdk-static/log-sdk/collect/',
        '/slardar/fe/sdk-web/browser.cn.js'
      ]),
      style: '',
      localProbe: false
    })
  });
  const TRANSPARENT_IMAGE_URL = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E';

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

  function siteIdForLocation() {
    const hostname = location.hostname.toLowerCase();
    return Object.keys(SITE_CONFIGS).find(siteId => SITE_CONFIGS[siteId].hosts.has(hostname)) || '';
  }

  function shouldNeutralize(value, siteId) {
    const config = SITE_CONFIGS[siteId];
    const raw = urlString(value);
    if (!config || !raw) return false;
    const normalized = raw.toLowerCase();
    if (config.scriptPaths.some(fragment => normalized.includes(fragment))) return true;
    try {
      const url = new URL(normalized, location.href);
      if (config.localProbe && url.hostname === '127.0.0.1' && url.port === '11601' && url.pathname === '/check') return true;
      return config.trackingHosts.has(url.hostname.toLowerCase());
    }
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
      this.siteId = '';
      this.originalFetch = globalThis.fetch;
      this.originalXhrOpen = XMLHttpRequest.prototype.open;
      this.originalSendBeacon = Navigator.prototype.sendBeacon;
      this.imageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      this.imageSetAttributeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'setAttribute');
      this.originalImageSetAttribute = HTMLImageElement.prototype.setAttribute;
      this.imageSources = new WeakMap();
      this.emptyResponseUrl = '';
      this.fetchWrapper = null;
      this.xhrOpenWrapper = null;
      this.sendBeaconWrapper = null;
      this.imageSrcGetter = null;
      this.imageSrcSetter = null;
      this.imageSetAttributeWrapper = null;
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
      if (message.config?.active === true) this.enable(message.config.siteId || siteIdForLocation());
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

    enable(siteId) {
      const config = SITE_CONFIGS[siteId];
      if (!config?.hosts.has(location.hostname.toLowerCase())) return;
      if (this.active && this.siteId === siteId) return;
      if (this.active) this.disable();
      this.active = true;
      this.siteId = siteId;
      this.emptyResponseUrl = URL.createObjectURL(new Blob(['{}'], { type: 'application/json' }));
      const runtime = this;
      this.fetchWrapper = function adMarshalFetch(resource, options) {
        if (runtime.active && shouldNeutralize(resource, runtime.siteId)) {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' }
          }));
        }
        return Reflect.apply(runtime.originalFetch, this, [resource, options]);
      };
      this.xhrOpenWrapper = function adMarshalXhrOpen(method, url, async = true, ...rest) {
        if (runtime.active && shouldNeutralize(url, runtime.siteId)) {
          return Reflect.apply(runtime.originalXhrOpen, this, ['GET', runtime.emptyResponseUrl, async !== false]);
        }
        return Reflect.apply(runtime.originalXhrOpen, this, [method, url, async, ...rest]);
      };
      this.sendBeaconWrapper = function adMarshalSendBeacon(url, data) {
        if (runtime.active && shouldNeutralize(url, runtime.siteId)) return true;
        return Reflect.apply(runtime.originalSendBeacon, this, [url, data]);
      };
      this.imageSrcGetter = function adMarshalImageSrcGet() {
        return runtime.imageSources.get(this) || Reflect.apply(runtime.imageSrcDescriptor.get, this, []);
      };
      this.imageSrcSetter = function adMarshalImageSrcSet(value) {
        if (runtime.active && shouldNeutralize(value, runtime.siteId)) {
          runtime.imageSources.set(this, String(value));
          Reflect.apply(runtime.imageSrcDescriptor.set, this, [TRANSPARENT_IMAGE_URL]);
          return;
        }
        Reflect.apply(runtime.imageSrcDescriptor.set, this, [value]);
      };
      this.imageSetAttributeWrapper = function adMarshalImageSetAttribute(name, value) {
        if (runtime.active && String(name).toLowerCase() === 'src' && shouldNeutralize(value, runtime.siteId)) {
          runtime.imageSources.set(this, String(value));
          return Reflect.apply(runtime.originalImageSetAttribute, this, [name, TRANSPARENT_IMAGE_URL]);
        }
        return Reflect.apply(runtime.originalImageSetAttribute, this, [name, value]);
      };
      globalThis.fetch = this.fetchWrapper;
      XMLHttpRequest.prototype.open = this.xhrOpenWrapper;
      Navigator.prototype.sendBeacon = this.sendBeaconWrapper;
      if (this.imageSrcDescriptor?.configurable && this.imageSrcDescriptor.get && this.imageSrcDescriptor.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          ...this.imageSrcDescriptor,
          get: this.imageSrcGetter,
          set: this.imageSrcSetter
        });
      }
      HTMLImageElement.prototype.setAttribute = this.imageSetAttributeWrapper;
      this.ensureStyle();
    }

    ensureStyle() {
      const style = SITE_CONFIGS[this.siteId]?.style || '';
      if (!this.active || !style || this.styleElement?.isConnected) return;
      const parent = document.head || document.documentElement;
      if (!parent) {
        document.addEventListener('readystatechange', this.ensureStyle, { once: true });
        return;
      }
      this.styleElement = document.createElement('style');
      this.styleElement.textContent = style;
      parent.appendChild(this.styleElement);
    }

    disable() {
      if (!this.active) return;
      this.active = false;
      if (globalThis.fetch === this.fetchWrapper) globalThis.fetch = this.originalFetch;
      if (XMLHttpRequest.prototype.open === this.xhrOpenWrapper) XMLHttpRequest.prototype.open = this.originalXhrOpen;
      if (Navigator.prototype.sendBeacon === this.sendBeaconWrapper) Navigator.prototype.sendBeacon = this.originalSendBeacon;
      const currentImageDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (currentImageDescriptor?.get === this.imageSrcGetter && currentImageDescriptor?.set === this.imageSrcSetter) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', this.imageSrcDescriptor);
      }
      if (HTMLImageElement.prototype.setAttribute === this.imageSetAttributeWrapper) {
        if (this.imageSetAttributeDescriptor) {
          Object.defineProperty(HTMLImageElement.prototype, 'setAttribute', this.imageSetAttributeDescriptor);
        } else {
          delete HTMLImageElement.prototype.setAttribute;
        }
      }
      if (this.emptyResponseUrl) URL.revokeObjectURL(this.emptyResponseUrl);
      this.emptyResponseUrl = '';
      this.siteId = '';
      document.removeEventListener('readystatechange', this.ensureStyle);
      this.styleElement?.remove();
      this.styleElement = null;
    }
  }

  const runtime = new AdMarshalRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
