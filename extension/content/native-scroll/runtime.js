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
    'input', 'textarea', 'select', 'button', 'summary',
    '[contenteditable="true"]', '[role="application"]', '[role="slider"]',
    '[role="dialog"]', '[aria-modal="true"]', 'iframe', 'canvas', 'video', 'audio',
    '.monaco-editor', '.CodeMirror', '.mapboxgl-map', '.leaflet-container',
    '[data-native-scroll-allow]'
  ].join(',');
  const SCROLL_API_SAFE_SELECTOR = SAFE_SELECTOR + ',a[href]';
  const PATCH_FLAG = Symbol('native-scroll-patched');
  const signalPrototype = globalThis.AbortSignal?.prototype;
  const readSignalAborted = signalPrototype && Object.getOwnPropertyDescriptor(signalPrototype, 'aborted')?.get;

  function isWeakTarget(value) {
    return typeof value === 'function' || (typeof value === 'object' && value !== null);
  }

  function isAbortedOrInvalid(signal) {
    if (signal === undefined || signal === null) return false;
    if (!isWeakTarget(signal)) return true;
    // Use the native state getter, even when an options proxy or a signal
    // exposes different properties to JavaScript after the browser adds it.
    try { return Reflect.apply(readSignalAborted, signal, []); }
    catch { return true; }
  }

  class NativeScrollRuntime {
    constructor() {
      this.token = randomToken();
      this.hostname = String(globalThis.location?.hostname || '').toLowerCase();
      this.active = false;
      this.disposed = false;
      this.mode = 'standard';
      this.reported = false;
      this.gestureUntil = 0;
      this.observedGesture = null;
      this.touchY = null;
      this.touchX = null;
      this.touchDeltas = new WeakMap();
      this.observer = null;
      this.observedDocumentRoot = null;
      this.rootObservers = [];
      this.observedNodes = [];
      this.frame = 0;
      this.normalizedWrappers = new Set();
      this.originalMethods = [];
      this.originalProperties = [];
      const retainedListeners = window[RETAINED_LISTENERS_KEY];
      this.listenerRegistry = retainedListeners instanceof WeakMap ? retainedListeners : new WeakMap();
      try { delete window[RETAINED_LISTENERS_KEY]; } catch {}
      this.originalAddEventListener = EventTarget.prototype.addEventListener;
      this.originalRemoveEventListener = EventTarget.prototype.removeEventListener;
      this.patchedAddEventListener = null;
      this.patchedRemoveEventListener = null;
      this.listenerMethodsPatched = false;
      this.onWheel = this.onWheel.bind(this);
      this.onClick = this.onClick.bind(this);
      this.onTouchStart = this.onTouchStart.bind(this);
      this.onTouchMove = this.onTouchMove.bind(this);
      this.onTouchEnd = this.onTouchEnd.bind(this);
      this.onMutation = this.onMutation.bind(this);
      this.onConfigure = this.onConfigure.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onDispose = this.onDispose.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
    }

    announce() {
      if (this.disposed) return;
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
      if (this.active) { this.attachBehaviorListeners(); this.observeDocument(); }
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }

    onBridgeReady() {
      this.announce();
    }

    onDispose(event) {
      if (event?.detail !== this.token || this.disposed) return;
      this.disposed = true;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      try { if (window[RUNTIME_KEY] === this) delete window[RUNTIME_KEY]; } catch {}
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token || this.disposed) return;
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
      if (!this.originalMethods.length) {
        this.patchScrollMethods();
        this.patchWheelCancellation();
        this.patchRootScrollPositions();
      }
      this.attachBehaviorListeners();
      this.observeDocument();
      this.applyStyles();
    }

    attachBehaviorListeners() {
      if (!this.active || this.usesNativeInteractionCompatibility()) return;
      this.originalAddEventListener.call(window, 'wheel', this.onWheel, { capture: true, passive: true });
      this.originalAddEventListener.call(window, 'mousewheel', this.onWheel, { capture: true, passive: true });
      for (const type of ['click', 'pointerdown', 'keydown']) {
        this.originalAddEventListener.call(window, type, this.onClick, { capture: true, passive: true });
      }
      this.originalAddEventListener.call(window, 'touchstart', this.onTouchStart, { capture: true, passive: true });
      this.originalAddEventListener.call(window, 'touchmove', this.onTouchMove, { capture: true, passive: true });
      for (const type of ['touchend', 'touchcancel']) {
        this.originalAddEventListener.call(window, type, this.onTouchEnd, { capture: true, passive: true });
      }
    }

    disable() {
      if (!this.active && this.normalizedWrappers.size === 0 && this.originalMethods.length === 0 && this.originalProperties.length === 0 && !this.listenerMethodsPatched) return;
      this.active = false;
      this.reported = false;
      this.onTouchEnd();
      this.clearGesture();
      this.originalRemoveEventListener.call(window, 'wheel', this.onWheel, true);
      this.originalRemoveEventListener.call(window, 'mousewheel', this.onWheel, true);
      for (const type of ['click', 'pointerdown', 'keydown']) this.originalRemoveEventListener.call(window, type, this.onClick, true);
      this.originalRemoveEventListener.call(window, 'touchstart', this.onTouchStart, true);
      this.originalRemoveEventListener.call(window, 'touchmove', this.onTouchMove, true);
      for (const type of ['touchend', 'touchcancel']) this.originalRemoveEventListener.call(window, type, this.onTouchEnd, true);
      this.observer?.disconnect();
      this.observer = null;
      this.observedDocumentRoot = null;
      for (const observer of this.rootObservers) observer.disconnect();
      this.rootObservers = [];
      this.observedNodes = [];
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.restoreNormalizedWrappers();
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
      if (!this.active || this.usesNativeInteractionCompatibility()) return;
      if (!this.observer || this.observedDocumentRoot !== document.documentElement) {
        this.observer?.disconnect();
        this.observer = new MutationObserver(this.onMutation);
        this.observer.observe(document, { childList: true });
        if (document.documentElement) this.observer.observe(document.documentElement, { childList: true });
        this.observedDocumentRoot = document.documentElement;
      }
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
      this.observeDocument();
      this.scheduleInspection();
    }

    scheduleInspection() {
      if (this.frame || !this.active) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (!this.active) return;
        this.applyStyles();
      });
    }

    applyStyles() {
      if (!this.active || !document.documentElement || this.usesNativeInteractionCompatibility()) return;
      this.syncRootObservers();
      const applyEnhancedPageStyles = this.mode === 'enhanced';
      for (const root of [document.documentElement, document.body].filter(Boolean)) {
        const computed = getComputedStyle(root);
        if (computed.scrollSnapType && computed.scrollSnapType !== 'none') {
          this.reportSuppression();
        }
        if (applyEnhancedPageStyles && ['hidden', 'clip'].includes(computed.overflowY)) this.reportSuppression();
      }
      if (applyEnhancedPageStyles) this.normalizeTransformScroller();
      else this.restoreNormalizedWrappers();
    }

    restoreNormalizedWrappers() {
      for (const element of this.normalizedWrappers) {
        if (element instanceof Element && element.dataset.nativeScrollNormalized === 'true') element.removeAttribute('data-native-scroll-normalized');
      }
      this.normalizedWrappers.clear();
    }

    normalizeTransformScroller() {
      for (const element of this.normalizedWrappers) {
        if (element.isConnected === false) {
          if (element.dataset.nativeScrollNormalized === 'true') element.removeAttribute('data-native-scroll-normalized');
          this.normalizedWrappers.delete(element);
        }
      }
      const body = document.body;
      if (!body || body.children.length > 30) return;
      const viewportArea = Math.max(1, innerWidth * innerHeight);
      for (const element of body.children) {
        if (element.dataset.nativeScrollNormalized === 'true' || this.isSafeElement(element)) continue;
        const style = getComputedStyle(element);
        if (!['fixed', 'absolute'].includes(style.position) || style.transform === 'none') continue;
        const rect = element.getBoundingClientRect();
        if (Math.max(0, rect.width) * Math.max(0, rect.height) < viewportArea * 0.75) continue;
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
        // Chrome uses Window when a detached global call has no receiver.
        if (runtime.active) runtime.recordListener(this ?? window, type, listener, options);
        return result;
      };
      this.patchedRemoveEventListener = function trackedRemove(type, listener, options) {
        const result = Reflect.apply(originalRemove, this, [type, listener, options]);
        if (runtime.active) runtime.forgetListener(this ?? window, type, listener, options);
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
      if (type !== 'unload') return false;
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (typeof policy?.allowsFeature !== 'function') return false;
      try { return policy.allowsFeature('unload') === false; }
      catch { return false; }
    }

    listenerOptions(options) {
      if (typeof options === 'boolean') return { capture: options };
      if (options == null) return {};
      if (typeof options !== 'object') return null;
      // Native add/remove already converted the dictionary. Inspect data only;
      // never invoke a website's options getters a second time for bookkeeping.
      const values = {};
      try {
        for (const name of ['capture', 'passive', 'once', 'signal']) {
          let owner = options, descriptor;
          for (let depth = 0; owner && depth < 4; depth += 1) {
            descriptor = Object.getOwnPropertyDescriptor(owner, name);
            if (descriptor) break;
            owner = Object.getPrototypeOf(owner);
          }
          if (descriptor && !('value' in descriptor)) return null;
          if (descriptor) values[name] = descriptor.value;
        }
      } catch { return null; }
      return values;
    }

    recordListener(target, type, listener, options) {
      if (!['wheel', 'mousewheel', 'touchmove'].includes(type)
        || !isWeakTarget(target) || !isWeakTarget(listener)) return;
      const values = this.listenerOptions(options);
      if (!values || isAbortedOrInvalid(values.signal)) return;
      const capture = !!values.capture;
      const passive = values.passive === undefined
        ? [window, document, document.body].includes(target)
        : !!values.passive;
      let byType = this.listenerRegistry.get(target);
      if (!byType) { byType = new Map(); this.listenerRegistry.set(target, byType); }
      const records = (byType.get(type) || []).filter(record => record.listener.deref() && !isAbortedOrInvalid(record.signal?.deref()));
      if (!records.some(record => record.listener.deref() === listener && record.capture === capture)) {
        records.push({ listener: new WeakRef(listener), capture, passive, once: !!values.once,
          signal: values.signal ? new WeakRef(values.signal) : null });
      }
      byType.set(type, records);
    }

    forgetListener(target, type, listener, options) {
      if (!['wheel', 'mousewheel', 'touchmove'].includes(type)) return;
      const values = this.listenerOptions(options);
      const capture = values ? !!values.capture : null;
      const byType = this.listenerRegistry.get(target), records = byType?.get(type);
      if (!records) return;
      const next = records.filter(record => {
        const current = record.listener.deref();
        return current && !isAbortedOrInvalid(record.signal?.deref()) && (current !== listener || capture !== null && record.capture !== capture);
      });
      if (next.length) byType.set(type, next);
      else byType.delete(type);
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
          const live = records.filter(record => record.listener.deref() && !isAbortedOrInvalid(record.signal?.deref()));
          if (live.length !== records.length) {
            if (live.length) byType.set(eventType, live);
            else byType.delete(eventType);
          }
          // Once listeners expire natively and can be retained by website code.
          // Observe their actual cancellation instead of arming a stale guard.
          if (live.some(record => !record.passive && !record.once)) return true;
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
      // Catch synchronous takeover from an eligible handler. Merely receiving
      // a wheel event must not block later layout or position updates.
      this.observedGesture = new WeakRef(event);
    }

    onTouchStart(event) {
      if (!this.active || event.isTrusted !== true || event.touches?.length !== 1) {
        if (this.active) this.onTouchEnd();
        return;
      }
      this.clearGesture();
      this.touchY = event.touches[0].clientY;
      this.touchX = event.touches[0].clientX;
    }

    onTouchEnd() {
      this.touchY = null; this.touchX = null;
      this.touchDeltas = new WeakMap();
    }

    isPageTouch(event) {
      if (!this.active || !event.isTrusted || event.defaultPrevented || event.cancelable === false || event.ctrlKey || event.metaKey) return false;
      if (event.touches?.length !== 1) { this.onTouchEnd(); return false; }
      if (this.touchY === null) return false;
      let delta = this.touchDeltas.get(event);
      if (!delta) {
        const point = event.touches[0];
        delta = { x: Number(this.touchX) - Number(point.clientX), y: Number(this.touchY) - Number(point.clientY) };
        this.touchDeltas.set(event, delta);
        this.touchX = point.clientX; this.touchY = point.clientY;
      }
      if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || Math.max(Math.abs(delta.x), Math.abs(delta.y)) < 1 || this.isSafeEvent(event)) return false;
      const horizontal = Math.abs(delta.x) > Math.abs(delta.y);
      return !this.hasScrollableAncestor(event, horizontal ? 'x' : 'y');
    }

    onTouchMove(event) {
      if (this.isPageTouch(event) && this.hasHijackListener(event, 'touchmove')) this.observedGesture = new WeakRef(event);
    }

    shouldHandleWheel(event) {
      return this.isPageWheel(event) && this.hasHijackListener(event, 'wheel');
    }

    isPageWheel(event) {
      if (!this.active || !event.isTrusted || event.defaultPrevented || event.cancelable === false || event.ctrlKey || event.metaKey) return false;
      const deltaX = Number(event.deltaX ?? -(event.wheelDeltaX || 0));
      const deltaY = Number(event.deltaY ?? -(event.wheelDeltaY || event.wheelDelta || 0));
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return false;
      const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 0.5) return false;
      if (this.isSafeEvent(event)) return false;
      // A page-wide smooth-scroll handler must not consume browser history
      // gestures. Local scroll containers own their input in both modes, even
      // at an edge where they may choose to contain the gesture.
      return !this.hasScrollableAncestor(event, horizontal ? 'x' : 'y');
    }

    isSafeEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      return path.some(node => node instanceof Element && this.isSafeElement(node, false));
    }

    isSafeElement(element, includeLinks = true) {
      // Links are ordinary wheel surfaces, but retain their explicit scripted
      // scrollIntoView behavior and remain excluded from layout normalization.
      const selector = includeLinks ? SCROLL_API_SAFE_SELECTOR : SAFE_SELECTOR;
      try { return element.matches(selector) || !!element.closest(selector); }
      catch { return false; }
    }

    isXhsHost() {
      return this.hostname === 'xiaohongshu.com' || this.hostname.endsWith('.xiaohongshu.com');
    }

    usesNativeInteractionCompatibility() {
      return this.isXhsHost();
    }

    isLocalScroller(element, axis) {
      if (!(element instanceof Element) || element === document.body || element === document.documentElement) return false;
      const style = getComputedStyle(element);
      return (axis !== 'y' && /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
        || (axis !== 'x' && /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1);
    }

    hasScrollableAncestor(event, axis) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      return path.some(node => this.isLocalScroller(node, axis));
    }

    onClick(event) {
      // A deliberate action takes precedence over the preceding scroll guard.
      if (this.active && event.isTrusted) this.clearGesture();
    }

    clearGesture() {
      this.gestureUntil = 0;
      this.observedGesture = null;
    }

    beginGesture() {
      if (!this.active) return;
      this.gestureUntil = performance.now() + 450;
      // The cancellation guard is immediate; layout inspection can share one
      // frame across wheel events and page mutations in the same gesture.
      this.scheduleInspection();
    }

    reportSuppression() {
      if (!this.active || this.reported) return;
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
          if (!runtime.active) return Reflect.apply(original, this, args);
          const receiver = owner === window ? window : this;
          if (runtime.shouldBlockScriptedScroll(receiver, name)) {
            runtime.reportSuppression();
            return undefined;
          }
          return Reflect.apply(original, receiver, args);
        }
        Object.defineProperty(guardedScroll, PATCH_FLAG, { value: true });
        try {
          owner[name] = guardedScroll;
          this.originalMethods.push([owner, name, original, guardedScroll]);
        } catch {}
      }
    }

    patchWheelCancellation() {
      const owner = Event.prototype;
      const original = owner.preventDefault;
      if (typeof original !== 'function') return;
      const runtime = this;
      const protects = event => {
        if (!(event instanceof Event) || event.isTrusted !== true) return false;
        try {
          const type = event.type;
          return type === 'touchmove' ? runtime.isPageTouch(event)
            : (type === 'wheel' || type === 'mousewheel') && runtime.isPageWheel(event);
        } catch { return false; }
      };
      const suppress = event => {
        runtime.beginGesture(); event.stopImmediatePropagation(); runtime.reportSuppression();
      };
      function guardedCancel(...args) {
        if (!runtime.active) return Reflect.apply(original, this, args);
        // Catch actual cancellation, including listeners registered before us.
        if (protects(this)) { suppress(this); return undefined; }
        return Reflect.apply(original, this, args);
      }
      try {
        owner.preventDefault = guardedCancel;
        this.originalMethods.push([owner, 'preventDefault', original, guardedCancel]);
      } catch {}
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'returnValue');
      if (descriptor?.configurable && typeof descriptor.set === 'function') {
        function guardedReturnValue(value) {
          if (!runtime.active) return Reflect.apply(descriptor.set, this, [value]);
          if (!value && protects(this)) { suppress(this); return; }
          return Reflect.apply(descriptor.set, this, [value]);
        }
        try {
          Object.defineProperty(owner, 'returnValue', { ...descriptor, set: guardedReturnValue });
          this.originalProperties.push([owner, 'returnValue', descriptor, guardedReturnValue]);
        } catch {}
      }
    }

    patchRootScrollPositions() {
      const owner = Element.prototype;
      const runtime = this;
      for (const name of ['scrollTop', 'scrollLeft']) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, name);
        if (!descriptor?.configurable || typeof descriptor.set !== 'function') continue;
        function guardedPosition(value) {
          if (!runtime.active) return Reflect.apply(descriptor.set, this, [value]);
          if ((this === document.documentElement || this === document.body)
            && runtime.shouldBlockScriptedScroll(this, name)) {
            runtime.reportSuppression();
            return;
          }
          return Reflect.apply(descriptor.set, this, [value]);
        }
        try {
          Object.defineProperty(owner, name, { ...descriptor, set: guardedPosition });
          this.originalProperties.push([owner, name, descriptor, guardedPosition]);
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
      for (const [owner, name, descriptor, guarded] of this.originalProperties) {
        try {
          if (Object.getOwnPropertyDescriptor(owner, name)?.set === guarded) Object.defineProperty(owner, name, descriptor);
        } catch {}
      }
      this.originalProperties = [];
    }

    shouldBlockScriptedScroll(receiver, name) {
      if (!this.active || !(this.gestureUntil > performance.now() || this.observedGesture?.deref()?.eventPhase > 0)) return false;
      if (receiver === window) return true;
      if (!(receiver instanceof Element) || this.isSafeElement(receiver)) return false;
      if (receiver === document.documentElement || receiver === document.body) return true;
      // scrollIntoView can target a child of a native app panel. Preserve its
      // scroll anchoring and follow-up positioning even during a root gesture.
      for (let node = receiver; node && node !== document.body && node !== document.documentElement;) {
        if (this.isLocalScroller(node)) return false;
        if (name !== 'scrollIntoView') break;
        node = node.parentElement || node.getRootNode?.().host;
      }
      return this.mode === 'enhanced' || name === 'scrollIntoView' || !/(auto|scroll|overlay)/.test(getComputedStyle(receiver).overflowY);
    }
  }

  const runtime = new NativeScrollRuntime();
  Object.defineProperty(window, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
