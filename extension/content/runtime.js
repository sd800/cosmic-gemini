(() => {
  const READY = 'cosmic-gemini:native-scroll:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:native-scroll:main-ready';
  const CONFIGURE = 'cosmic-gemini:native-scroll:configure';
  const DISPOSE = 'cosmic-gemini:native-scroll:dispose';
  const SUPPRESSED = 'cosmic-gemini:native-scroll:suppressed';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.native-scroll.runtime');
  const RETAINED_LISTENERS_KEY = Symbol.for('cosmic-gemini.native-scroll.retained-listeners');

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  if (window[RUNTIME_KEY]) {
    window[RUNTIME_KEY].announce();
    return;
  }

  const SAFE_SELECTOR = [
    'input', 'textarea', 'select', 'button', 'a[href]', 'summary',
    '[contenteditable="true"]', '[role="application"]', '[role="slider"]',
    '[role="dialog"]', '[aria-modal="true"]', 'iframe', 'canvas', 'video', 'audio',
    '.monaco-editor', '.CodeMirror', '.mapboxgl-map', '.leaflet-container',
    '[data-native-scroll-allow]'
  ].join(',');
  const ROOTS = () => [document.documentElement, document.body].filter(Boolean);
  const PATCH_FLAG = Symbol('native-scroll-patched');

  class NativeScrollRuntime {
    constructor() {
      this.token = randomToken();
      this.hostname = String(globalThis.location?.hostname || '').toLowerCase();
      this.active = false;
      this.mode = 'standard';
      this.reported = false;
      this.gestureUntil = 0;
      this.touchY = null;
      this.observer = null;
      this.rootObservers = [];
      this.observedNodes = [];
      this.frame = 0;
      this.style = null;
      this.savedStyles = new Map();
      this.normalizedWrappers = new Set();
      this.originalMethods = [];
      const retainedListeners = window[RETAINED_LISTENERS_KEY];
      this.listenerRegistry = retainedListeners instanceof WeakMap ? retainedListeners : new WeakMap();
      try { delete window[RETAINED_LISTENERS_KEY]; } catch {}
      this.originalAddEventListener = EventTarget.prototype.addEventListener;
      this.originalRemoveEventListener = EventTarget.prototype.removeEventListener;
      this.patchedAddEventListener = null;
      this.patchedRemoveEventListener = null;
      this.listenerMethodsPatched = false;
      this.onWheel = this.onWheel.bind(this);
      this.onTouchStart = this.onTouchStart.bind(this);
      this.onTouchMove = this.onTouchMove.bind(this);
      this.onMutation = this.onMutation.bind(this);
      this.onConfigure = this.onConfigure.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onDispose = this.onDispose.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
    }

    announce() {
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }

    onBridgeReady() {
      this.announce();
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      try { delete window[RUNTIME_KEY]; } catch {}
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      const config = message.config || {};
      const shouldRun = config.active === true;
      const mode = config.mode === 'enhanced' ? 'enhanced' : 'standard';
      if (!shouldRun) {
        this.disable();
        return;
      }
      if (!this.active) this.enable(mode);
      else if (this.mode !== mode) {
        this.mode = mode;
        this.applyStyles();
        this.scheduleInspection();
      }
    }

    enable(mode) {
      this.active = true;
      this.mode = mode;
      this.reported = false;
      if (this.usesNativeInteractionCompatibility()) return;
      if (!this.listenerMethodsPatched) this.patchListenerMethods();
      if (!this.originalMethods.length) this.patchScrollMethods();
      this.originalAddEventListener.call(window, 'wheel', this.onWheel, { capture: true, passive: true });
      this.originalAddEventListener.call(window, 'mousewheel', this.onWheel, { capture: true, passive: true });
      this.originalAddEventListener.call(window, 'touchstart', this.onTouchStart, { capture: true, passive: true });
      this.originalAddEventListener.call(window, 'touchmove', this.onTouchMove, { capture: true, passive: true });
      this.observeDocument();
      this.applyStyles();
    }

    disable() {
      if (!this.active && !this.style && this.savedStyles.size === 0 && this.originalMethods.length === 0 && !this.listenerMethodsPatched) return;
      this.active = false;
      this.reported = false;
      this.touchY = null;
      this.gestureUntil = 0;
      this.originalRemoveEventListener.call(window, 'wheel', this.onWheel, true);
      this.originalRemoveEventListener.call(window, 'mousewheel', this.onWheel, true);
      this.originalRemoveEventListener.call(window, 'touchstart', this.onTouchStart, true);
      this.originalRemoveEventListener.call(window, 'touchmove', this.onTouchMove, true);
      this.observer?.disconnect();
      this.observer = null;
      for (const observer of this.rootObservers) observer.disconnect();
      this.rootObservers = [];
      this.observedNodes = [];
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.style?.remove();
      this.style = null;
      this.restoreStyles();
      this.normalizedWrappers.clear();
      this.restoreScrollMethods();
      this.retainListenerRegistry();
      this.restoreListenerMethods();
    }

    retainListenerRegistry() {
      if (!this.listenerMethodsPatched) return;
      try {
        Object.defineProperty(window, RETAINED_LISTENERS_KEY, {
          value: this.listenerRegistry,
          configurable: true
        });
      } catch {}
    }

    observeDocument() {
      this.observer?.disconnect();
      this.observer = new MutationObserver(this.onMutation);
      this.observer.observe(document.documentElement, { childList: true });
      this.syncRootObservers();
    }

    syncRootObservers() {
      const nodes = [document.head, document.documentElement, document.body].filter(Boolean);
      if (nodes.length === this.observedNodes.length && nodes.every((node, index) => node === this.observedNodes[index])) return;
      for (const observer of this.rootObservers) observer.disconnect();
      this.rootObservers = [];
      this.observedNodes = nodes;
      for (const element of nodes) {
        const observer = new MutationObserver(this.onMutation);
        const options = element === document.head
          ? { childList: true }
          : { attributes: true, attributeFilter: ['class', 'style'], childList: element === document.body };
        observer.observe(element, options);
        this.rootObservers.push(observer);
      }
    }

    onMutation() {
      if (!this.active) return;
      this.syncRootObservers();
      this.scheduleInspection();
    }

    scheduleInspection() {
      if (this.frame || !this.active) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.applyStyles();
      });
    }

    applyStyles() {
      if (!this.active || !document.documentElement || this.usesNativeInteractionCompatibility()) return;
      this.syncRootObservers();
      this.restoreDetachedStyles();
      const applyEnhancedPageStyles = this.mode === 'enhanced';
      if (!this.style?.isConnected) {
        this.style = document.createElement('style');
        this.style.dataset.nativeScroll = 'runtime';
        (document.head || document.documentElement).append(this.style);
      }
      const stylesheet = applyEnhancedPageStyles
        ? ':root,body,*{scroll-behavior:auto!important;scroll-snap-type:none!important}:root,body{height:auto!important;overflow-y:auto!important;overscroll-behavior:auto!important}'
        : ':root,body{scroll-behavior:auto!important;scroll-snap-type:none!important;overscroll-behavior:auto!important}';
      if (this.style.textContent !== stylesheet) this.style.textContent = stylesheet;

      for (const root of ROOTS()) {
        const computed = getComputedStyle(root);
        if (computed.scrollBehavior === 'smooth' || (computed.scrollSnapType && computed.scrollSnapType !== 'none')) {
          this.reportSuppression();
        }
        this.setStyle(root, 'scroll-behavior', 'auto');
        this.setStyle(root, 'scroll-snap-type', 'none');
        this.setStyle(root, 'overscroll-behavior', 'auto');
        if (applyEnhancedPageStyles) {
          if (['hidden', 'clip'].includes(computed.overflowY)) this.reportSuppression();
          this.setStyle(root, 'height', 'auto');
          this.setStyle(root, 'overflow-y', 'auto');
        } else {
          this.restoreStyle(root, 'height');
          this.restoreStyle(root, 'overflow-y');
        }
      }
      if (applyEnhancedPageStyles) this.normalizeTransformScroller();
      else this.restoreNormalizedWrappers();
    }

    setStyle(element, property, value) {
      let saved = this.savedStyles.get(element);
      if (!saved) {
        saved = new Map();
        this.savedStyles.set(element, saved);
      }
      if (!saved.has(property)) {
        saved.set(property, {
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property)
        });
      }
      if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') {
        element.style.setProperty(property, value, 'important');
      }
    }

    restoreStyle(element, property) {
      const saved = this.savedStyles.get(element);
      const original = saved?.get(property);
      if (!original) return;
      if (original.value) element.style.setProperty(property, original.value, original.priority);
      else element.style.removeProperty(property);
      saved.delete(property);
      if (!saved.size) this.savedStyles.delete(element);
    }

    restoreElementStyles(element, properties) {
      if (!(element instanceof Element)) return;
      for (const [property, original] of properties) {
        if (original.value) element.style.setProperty(property, original.value, original.priority);
        else element.style.removeProperty(property);
      }
      element.removeAttribute('data-native-scroll-normalized');
    }

    restoreDetachedStyles() {
      for (const [element, properties] of this.savedStyles) {
        if (element.isConnected || element === document.documentElement || element === document.body) continue;
        this.restoreElementStyles(element, properties);
        this.savedStyles.delete(element);
        this.normalizedWrappers.delete(element);
      }
    }

    restoreStyles() {
      for (const [element, properties] of this.savedStyles) this.restoreElementStyles(element, properties);
      this.savedStyles.clear();
    }

    restoreNormalizedWrappers() {
      for (const element of this.normalizedWrappers) {
        const properties = this.savedStyles.get(element);
        if (properties) {
          this.restoreElementStyles(element, properties);
          this.savedStyles.delete(element);
        }
      }
      this.normalizedWrappers.clear();
    }

    normalizeTransformScroller() {
      const body = document.body;
      if (!body || body.children.length > 30) return;
      const viewportArea = Math.max(1, innerWidth * innerHeight);
      for (const element of body.children) {
        if (this.isSafeElement(element)) continue;
        const style = getComputedStyle(element);
        if (!['fixed', 'absolute'].includes(style.position) || style.transform === 'none') continue;
        const rect = element.getBoundingClientRect();
        if (Math.max(0, rect.width) * Math.max(0, rect.height) < viewportArea * 0.75) continue;
        this.setStyle(element, 'transform', 'none');
        this.setStyle(element, 'position', 'relative');
        this.setStyle(element, 'inset', 'auto');
        element.dataset.nativeScrollNormalized = 'true';
        this.normalizedWrappers.add(element);
        this.reportSuppression();
      }
    }

    patchListenerMethods() {
      if (this.listenerMethodsPatched) return;
      const runtime = this;
      const originalAdd = this.originalAddEventListener;
      const originalRemove = this.originalRemoveEventListener;
      this.patchedAddEventListener = function trackedAdd(type, listener, options) {
        if (runtime.active && runtime.isDisallowedUnload(type)) return undefined;
        const result = Reflect.apply(originalAdd, this, [type, listener, options]);
        if (runtime.active) runtime.recordListener(this, type, listener, options);
        return result;
      };
      this.patchedRemoveEventListener = function trackedRemove(type, listener, options) {
        const result = Reflect.apply(originalRemove, this, [type, listener, options]);
        if (runtime.active) runtime.forgetListener(this, type, listener, options);
        return result;
      };
      EventTarget.prototype.addEventListener = this.patchedAddEventListener;
      EventTarget.prototype.removeEventListener = this.patchedRemoveEventListener;
      this.listenerMethodsPatched = true;
    }

    restoreListenerMethods() {
      if (!this.listenerMethodsPatched) return;
      try {
        if (EventTarget.prototype.addEventListener === this.patchedAddEventListener) {
          EventTarget.prototype.addEventListener = this.originalAddEventListener;
        }
        if (EventTarget.prototype.removeEventListener === this.patchedRemoveEventListener) {
          EventTarget.prototype.removeEventListener = this.originalRemoveEventListener;
        }
      } catch {}
      this.patchedAddEventListener = null;
      this.patchedRemoveEventListener = null;
      this.listenerMethodsPatched = false;
      this.listenerRegistry = new WeakMap();
    }

    isDisallowedUnload(type) {
      if (String(type).toLowerCase() !== 'unload') return false;
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (typeof policy?.allowsFeature !== 'function') return false;
      try { return policy.allowsFeature('unload') === false; }
      catch { return false; }
    }

    recordListener(target, type, listener, options) {
      const normalizedType = String(type).toLowerCase();
      if (!['wheel', 'mousewheel', 'touchmove'].includes(normalizedType) || !listener) return;
      const capture = typeof options === 'boolean' ? options : options?.capture === true;
      let byType = this.listenerRegistry.get(target);
      if (!byType) {
        byType = new Map();
        this.listenerRegistry.set(target, byType);
      }
      const records = (byType.get(normalizedType) || []).filter(record => record.listener.deref());
      if (!records.some(record => record.listener.deref() === listener && record.capture === capture)) {
        records.push({ listener: new WeakRef(listener), capture });
      }
      byType.set(normalizedType, records);
    }

    forgetListener(target, type, listener, options) {
      const normalizedType = String(type).toLowerCase();
      const capture = typeof options === 'boolean' ? options : options?.capture === true;
      const byType = this.listenerRegistry.get(target);
      const records = byType?.get(normalizedType);
      if (!records) return;
      const next = records.filter(record => {
        const current = record.listener.deref();
        return current && (current !== listener || record.capture !== capture);
      });
      if (next.length) byType.set(normalizedType, next);
      else byType.delete(normalizedType);
    }

    hasHijackListener(event, type) {
      const eventTypes = type === 'wheel' ? ['wheel', 'mousewheel'] : [type];
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      const targets = new Set([window, document, document.documentElement, document.body, ...path].filter(Boolean));
      for (const target of targets) {
        const byType = this.listenerRegistry.get(target);
        for (const eventType of eventTypes) {
          const records = byType?.get(eventType);
          if (!records) continue;
          const live = records.filter(record => record.listener.deref());
          if (live.length !== records.length) {
            if (live.length) byType.set(eventType, live);
            else byType.delete(eventType);
          }
          if (live.length) return true;
        }
        try {
          if (type === 'wheel' && (typeof target.onwheel === 'function' || typeof target.onmousewheel === 'function')) return true;
          if (type === 'touchmove' && typeof target.ontouchmove === 'function') return true;
        } catch {}
      }
      return false;
    }

    onWheel(event) {
      if (!this.shouldHandleWheel(event)) return;
      this.beginGesture();
      event.stopImmediatePropagation();
      this.reportSuppression();
    }

    onTouchStart(event) {
      if (!this.active || event.touches?.length !== 1) {
        this.touchY = null;
        return;
      }
      this.touchY = event.touches[0].clientY;
    }

    onTouchMove(event) {
      if (!this.active || this.touchY === null || event.touches?.length !== 1 || this.isSafeEvent(event) || !this.hasHijackListener(event, 'touchmove')) return;
      const nextY = event.touches[0].clientY;
      const deltaY = this.touchY - nextY;
      this.touchY = nextY;
      if (Math.abs(deltaY) < 1 || (this.mode === 'standard' && this.hasScrollableAncestor(event, deltaY))) return;
      this.beginGesture();
      event.stopImmediatePropagation();
      this.reportSuppression();
    }

    shouldHandleWheel(event) {
      if (!this.active || !event.isTrusted || event.defaultPrevented || event.ctrlKey || event.metaKey) return false;
      const deltaX = Number(event.deltaX || 0);
      const deltaY = Number(event.deltaY || 0);
      if (Math.abs(deltaY) < 0.5 || Math.abs(deltaX) > Math.abs(deltaY)) return false;
      if (this.isSafeEvent(event)) return false;
      if (this.mode === 'standard' && this.hasScrollableAncestor(event, deltaY)) return false;
      if (!this.hasHijackListener(event, 'wheel')) return false;
      return true;
    }

    isSafeEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      return path.some(node => node instanceof Element && this.isSafeElement(node));
    }

    isSafeElement(element) {
      try { return element.matches(SAFE_SELECTOR) || !!element.closest(SAFE_SELECTOR); }
      catch { return false; }
    }

    isXhsHost() {
      return this.hostname === 'xiaohongshu.com' || this.hostname.endsWith('.xiaohongshu.com');
    }

    usesNativeInteractionCompatibility() {
      return this.isXhsHost();
    }

    hasScrollableAncestor(event, deltaY) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      for (const node of path) {
        if (!(node instanceof Element) || node === document.body || node === document.documentElement) continue;
        const style = getComputedStyle(node);
        if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
        if (node.scrollHeight <= node.clientHeight + 1) continue;
        if (deltaY < 0 && node.scrollTop > 0) return true;
        if (deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      }
      return false;
    }

    beginGesture() {
      this.gestureUntil = performance.now() + 450;
      this.applyStyles();
    }

    reportSuppression() {
      if (this.reported) return;
      this.reported = true;
      window.dispatchEvent(new CustomEvent(SUPPRESSED, { detail: this.token }));
    }

    patchScrollMethods() {
      const specs = [
        [window, 'scroll'], [window, 'scrollTo'], [window, 'scrollBy'],
        [Element.prototype, 'scroll'], [Element.prototype, 'scrollTo'],
        [Element.prototype, 'scrollBy'], [Element.prototype, 'scrollIntoView']
      ];
      for (const [owner, name] of specs) {
        const original = owner[name];
        if (typeof original !== 'function' || original[PATCH_FLAG]) continue;
        const runtime = this;
        function guardedScroll(...args) {
          if (runtime.shouldBlockScriptedScroll(this, name, args)) {
            runtime.reportSuppression();
            return undefined;
          }
          return Reflect.apply(original, this, args);
        }
        Object.defineProperty(guardedScroll, PATCH_FLAG, { value: true });
        try {
          owner[name] = guardedScroll;
          this.originalMethods.push([owner, name, original, guardedScroll]);
        } catch {}
      }
    }

    restoreScrollMethods() {
      for (const [owner, name, original, guarded] of this.originalMethods) {
        try {
          if (owner[name] === guarded) owner[name] = original;
        } catch {}
      }
      this.originalMethods = [];
    }

    shouldBlockScriptedScroll(receiver, name, args) {
      if (!this.active || performance.now() > this.gestureUntil) return false;
      if (receiver === window) return true;
      if (!(receiver instanceof Element) || this.isSafeElement(receiver)) return false;
      if (this.mode === 'enhanced') return true;
      if (receiver === document.documentElement || receiver === document.body) return true;
      if (name === 'scrollIntoView') return true;
      const style = getComputedStyle(receiver);
      return !/(auto|scroll|overlay)/.test(style.overflowY);
    }
  }

  const runtime = new NativeScrollRuntime();
  Object.defineProperty(window, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
