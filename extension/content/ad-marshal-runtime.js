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
    '[data-ad-id]',
    '[data-advertisement]',
    '[data-ad-component]',
    '.tonglan-ad-channel',
    '.rectangle-ad-channel',
    '.ad-news',
    '.adbox',
    '[class^="adbox_"]',
    '.ad-brandArea',
    '.ad-click-wrapper',
    '.ad-header-image',
    '.c2s-ad-message-tips',
    '.c2s-ad-title',
    '[class*="qqchannel-ad"]',
    '[id*="qqchannel-ad"]',
    '[class~="advertisement"]',
    '[class^="advertisement-"]',
    '[class*=" advertisement-"]',
    '[id^="advertisement-"]'
  ].join(',');
  const RESOURCE_SELECTOR = 'script[src],link[href],iframe[src],img[src],source[src]';
  const BEACON_ATTRIBUTE_SELECTOR = '[data-beacon-expo],[data-beacon-click]';
  const BEACON_ATTRIBUTES = new Set(['data-beacon-expo', 'data-beacon-click']);
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
      this.originalSetAttribute = Element.prototype.setAttribute;
      this.originalRemoveAttribute = Element.prototype.removeAttribute;
      this.originalRemoveChild = Node.prototype.removeChild;
      this.scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      this.scriptSetAttributeDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'setAttribute');
      this.originalScriptSetAttribute = HTMLScriptElement.prototype.setAttribute;
      this.imageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      this.scriptSources = new WeakMap();
      this.imageSources = new WeakMap();
      this.removedBeaconAttributes = new Map();
      this.emptyResponseUrl = '';
      this.fetchWrapper = null;
      this.xhrOpenWrapper = null;
      this.sendBeaconWrapper = null;
      this.scriptSrcGetter = null;
      this.scriptSrcSetter = null;
      this.scriptSetAttributeWrapper = null;
      this.imageSrcGetter = null;
      this.imageSrcSetter = null;
      this.observer = null;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.startObservation = this.startObservation.bind(this);
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
      this.scriptSrcGetter = function adMarshalScriptSrcGet() {
        return runtime.scriptSources.get(this) || Reflect.apply(runtime.scriptSrcDescriptor.get, this, []);
      };
      this.scriptSrcSetter = function adMarshalScriptSrcSet(value) {
        if (runtime.active && shouldNeutralize(value)) {
          runtime.scriptSources.set(this, String(value));
          this.removeAttribute('src');
          queueMicrotask(() => this.dispatchEvent(new Event('load')));
          return;
        }
        Reflect.apply(runtime.scriptSrcDescriptor.set, this, [value]);
      };
      this.scriptSetAttributeWrapper = function adMarshalScriptSetAttribute(name, value) {
        if (runtime.active && String(name).toLowerCase() === 'src' && shouldNeutralize(value)) {
          runtime.scriptSources.set(this, String(value));
          Reflect.apply(runtime.originalRemoveAttribute, this, ['src']);
          queueMicrotask(() => this.dispatchEvent(new Event('load')));
          return;
        }
        return Reflect.apply(runtime.originalScriptSetAttribute, this, [name, value]);
      };
      this.imageSrcGetter = function adMarshalImageSrcGet() {
        return runtime.imageSources.get(this) || Reflect.apply(runtime.imageSrcDescriptor.get, this, []);
      };
      this.imageSrcSetter = function adMarshalImageSrcSet(value) {
        if (runtime.active && shouldNeutralize(value)) {
          runtime.imageSources.set(this, String(value));
          Reflect.apply(runtime.imageSrcDescriptor.set, this, [TRANSPARENT_IMAGE_URL]);
          return;
        }
        Reflect.apply(runtime.imageSrcDescriptor.set, this, [value]);
      };
      globalThis.fetch = this.fetchWrapper;
      XMLHttpRequest.prototype.open = this.xhrOpenWrapper;
      Navigator.prototype.sendBeacon = this.sendBeaconWrapper;
      if (this.scriptSrcDescriptor?.configurable && this.scriptSrcDescriptor.get && this.scriptSrcDescriptor.set) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
          ...this.scriptSrcDescriptor,
          get: this.scriptSrcGetter,
          set: this.scriptSrcSetter
        });
      }
      HTMLScriptElement.prototype.setAttribute = this.scriptSetAttributeWrapper;
      if (this.imageSrcDescriptor?.configurable && this.imageSrcDescriptor.get && this.imageSrcDescriptor.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          ...this.imageSrcDescriptor,
          get: this.imageSrcGetter,
          set: this.imageSrcSetter
        });
      }
      this.cleanTree(document);
      this.startObservation();
    }

    startObservation() {
      if (!this.active || this.observer) return;
      if (!document.documentElement) {
        document.addEventListener('DOMContentLoaded', this.startObservation, { once: true });
        return;
      }
      this.observer = new MutationObserver(records => {
        if (!this.active) return;
        const roots = new Set();
        for (const record of records) {
          if (record.type === 'attributes') this.stripBeaconAttributes(record.target);
          for (const node of record.addedNodes) roots.add(node);
        }
        for (const root of roots) this.cleanTree(root);
      });
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [...BEACON_ATTRIBUTES],
        childList: true,
        subtree: true
      });
    }

    blockedElement(element) {
      if (!(element instanceof Element)) return false;
      if (element.matches(AD_CONTAINER_SELECTOR)) return true;
      if (!element.matches(RESOURCE_SELECTOR)) return false;
      return shouldNeutralize(element.getAttribute('src') || element.getAttribute('href') || '');
    }

    signalLocalSuccess(element) {
      if (!(element instanceof Element)) return;
      queueMicrotask(() => element.dispatchEvent(new Event('load')));
    }

    rememberBeaconAttribute(element, name, value) {
      if (!(element instanceof Element)) return;
      let attributes = this.removedBeaconAttributes.get(element);
      if (!attributes) {
        attributes = new Map();
        this.removedBeaconAttributes.set(element, attributes);
      }
      attributes.set(name, value);
    }

    stripBeaconAttributes(element) {
      if (!(element instanceof Element)) return;
      for (const name of BEACON_ATTRIBUTES) {
        if (!element.hasAttribute(name)) continue;
        this.rememberBeaconAttribute(element, name, element.getAttribute(name) || '');
        Reflect.apply(this.originalRemoveAttribute, element, [name]);
      }
    }

    cleanTree(root) {
      if (!(root instanceof Node)) return;
      const blocked = [];
      if (root instanceof Element) {
        this.stripBeaconAttributes(root);
        if (this.blockedElement(root)) blocked.push(root);
      }
      if (typeof root.querySelectorAll === 'function') {
        for (const element of root.querySelectorAll(BEACON_ATTRIBUTE_SELECTOR)) {
          this.stripBeaconAttributes(element);
        }
        for (const element of root.querySelectorAll(`${AD_CONTAINER_SELECTOR},${RESOURCE_SELECTOR}`)) {
          if (this.blockedElement(element)) blocked.push(element);
        }
      }
      for (const element of blocked) {
        this.signalLocalSuccess(element);
        if (element.parentNode) Reflect.apply(this.originalRemoveChild, element.parentNode, [element]);
      }
    }

    disable() {
      if (!this.active) return;
      this.active = false;
      if (globalThis.fetch === this.fetchWrapper) globalThis.fetch = this.originalFetch;
      if (XMLHttpRequest.prototype.open === this.xhrOpenWrapper) XMLHttpRequest.prototype.open = this.originalXhrOpen;
      if (Navigator.prototype.sendBeacon === this.sendBeaconWrapper) Navigator.prototype.sendBeacon = this.originalSendBeacon;
      const currentScriptDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      if (currentScriptDescriptor?.get === this.scriptSrcGetter && currentScriptDescriptor?.set === this.scriptSrcSetter) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', this.scriptSrcDescriptor);
      }
      if (HTMLScriptElement.prototype.setAttribute === this.scriptSetAttributeWrapper) {
        if (this.scriptSetAttributeDescriptor) {
          Object.defineProperty(HTMLScriptElement.prototype, 'setAttribute', this.scriptSetAttributeDescriptor);
        } else {
          delete HTMLScriptElement.prototype.setAttribute;
        }
      }
      const currentImageDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (currentImageDescriptor?.get === this.imageSrcGetter && currentImageDescriptor?.set === this.imageSrcSetter) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', this.imageSrcDescriptor);
      }
      if (this.emptyResponseUrl) URL.revokeObjectURL(this.emptyResponseUrl);
      this.emptyResponseUrl = '';
      document.removeEventListener('DOMContentLoaded', this.startObservation);
      this.observer?.disconnect();
      this.observer = null;
      for (const [element, attributes] of this.removedBeaconAttributes) {
        if (!element.isConnected) continue;
        for (const [name, value] of attributes) {
          if (!element.hasAttribute(name)) Reflect.apply(this.originalSetAttribute, element, [name, value]);
        }
      }
      this.removedBeaconAttributes.clear();
    }
  }

  const runtime = new AdMarshalRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
