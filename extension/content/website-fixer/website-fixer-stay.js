(() => {
  const bootstrap = Symbol.for('cosmic-gemini.website-fixer.stay-bootstrap');
  if (globalThis[bootstrap]) { globalThis[bootstrap].reconnect?.(); return; }
  const state = { enabled: false, generation: 0 };
  const listeners = [], patches = [];
  const nativeApply = Reflect.apply;
  const listen = EventTarget.prototype.addEventListener;
  const unlisten = EventTarget.prototype.removeEventListener;
  function on(target, type, handler) {
    nativeApply(listen, target, [type, handler, true]);
    listeners.push({ target: new WeakRef(target), type, handler });
  }
  function patch(owner, name, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    try {
      Object.defineProperty(owner, name, descriptor ? { ...descriptor, value: wrapper }
        : { configurable: true, writable: true, enumerable: true, value: wrapper });
      patches.push({ owner: new WeakRef(owner), name, descriptor, wrapper });
    } catch {}
  }
  function deactivate() {
    state.enabled = false;
    state.generation += 1;
    window.removeEventListener(prefix + 'activate', activate);
    window.removeEventListener(prefix + 'deactivate', deactivate);
    for (const { target, type, handler } of listeners) {
      const value = target.deref();
      if (value) nativeApply(unlisten, value, [type, handler, true]);
    }
    listeners.length = 0;
    for (const { owner, name, descriptor, wrapper } of patches.reverse()) {
      const value = owner.deref();
      if (!value || Object.getOwnPropertyDescriptor(value, name)?.value !== wrapper) continue;
      try { if (descriptor) Object.defineProperty(value, name, descriptor); else delete value[name]; } catch {}
    }
    patches.length = 0;
    delete globalThis[Symbol.for('cosmic-gemini.website-fixer.stay')];
  }
  globalThis[bootstrap] = state;
  const prefix = 'cosmic-gemini:website-fixer:stay:';
  state.deactivate = deactivate;
  state.reconnect = () => {
    const restart = state.enabled && state.root !== document.documentElement;
    if (restart) deactivate();
    window.addEventListener(prefix + 'activate', activate);
    window.addEventListener(prefix + 'deactivate', deactivate);
    if (restart) activate();
    window.dispatchEvent(new CustomEvent(prefix + 'ready'));
  };
  state.reconnect();
  function activate() {
    if (state.enabled) return;
    const key = Symbol.for('cosmic-gemini.website-fixer.stay');
    if (globalThis[key]) return;
    const siteKey = globalThis[Symbol.for('cosmic-gemini.stay-site-key')];
    const source = location.origin === 'null' ? document.referrer : location.origin;
    const site = siteKey(source);
    if (!site) return;
    state.enabled = true;
    state.root = document.documentElement;
    const generation = state.generation;
    const live = () => state.enabled && state.generation === generation;
    globalThis[key] = true;
    const NativeURL = URL;
    function permitted(value, base = location.href) {
      if (!live()) return true;
      try {
        const url = new NativeURL(String(value), base);
        // Blank child windows inherit this guard; opaque/external protocols do not.
        if (url.href === 'about:blank') return true;
        if (url.protocol === 'javascript:') return true; // any resulting navigation is guarded
        if (url.protocol === 'blob:') return siteKey(url.origin) === site;
        return /^https?:$/.test(url.protocol) && siteKey(url.href) === site;
      } catch { return false; }
    }
    function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function guardNavigation(target) {
      try {
        if (target.navigation) on(target.navigation, 'navigate', event => {
          if (live() && event.cancelable && !permitted(event.destination.url)) stop(event);
        });
      } catch {}
    }
    guardNavigation(window);
    function guardLink(event) {
      if (!live()) return;
      const link = event.composedPath().find(node => /^(a|area)$/.test(node?.localName)
        && (node.hasAttribute('href') || node.hasAttribute('xlink:href')));
      if (link && !permitted(link.getAttribute('href') || link.getAttribute('xlink:href'), link.baseURI)) stop(event);
    }
    for (const type of ['click', 'auxclick']) on(window, type, guardLink);
    const formAction = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'action').get;
    const localName = Object.getOwnPropertyDescriptor(Element.prototype, 'localName').get;
    const getAttribute = Element.prototype.getAttribute;
    const submitterActions = {
      button: Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'formAction').get,
      input: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'formAction').get
    };
    function formUrl(form, submitter) {
      try {
        if (submitter != null && nativeApply(getAttribute, submitter, ['formaction']) !== null) {
          return nativeApply(submitterActions[nativeApply(localName, submitter, [])], submitter, []);
        }
        return nativeApply(formAction, form, []);
      } catch { return null; } // Let the native method validate invalid receivers or submitters.
    }
    on(window, 'submit', event => {
      if (!live()) return;
      const url = formUrl(event.target, event.submitter);
      if (url !== null && !permitted(url)) stop(event);
    });

    // MAIN-world wrappers close target=_blank and programmatic submission gaps;
    // the separate ISOLATED script reports native browser context-menu targets.
    function wrap(owner, name, handler) {
      const original = owner?.[name];
      if (typeof original !== 'function') return;
      patch(owner, name, function (...args) {
        if (!live()) return nativeApply(original, this, args);
        return handler(original, this, args);
      });
    }
    wrap(window, 'open', (original, receiver, args) => {
      if (!live()) return nativeApply(original, receiver == null ? window : receiver, args);
      const url = args[0] === undefined ? '' : `${args[0]}`;
      if (!permitted(url || 'about:blank', document.baseURI)) return null;
      if (args.length) args[0] = url;
      const child = nativeApply(original, receiver ?? window, args);
      if (child) {
        guardNavigation(child);
        try { patch(child, 'open', window.open.bind(child)); } catch {}
      }
      return child;
    });
    for (const method of ['submit', 'requestSubmit']) wrap(HTMLFormElement.prototype, method, (original, form, args) => {
      const url = formUrl(form, method === 'requestSubmit' ? args[0] : null);
      if (url !== null && !permitted(url)) return undefined;
      return nativeApply(original, form, args);
    });
    for (const method of ['back', 'forward', 'go']) wrap(History.prototype, method, (original, receiver, args) => {
      if (!live()) return nativeApply(original, receiver, args);
      const delta = method === 'back' ? -1 : method === 'forward' ? 1 : args[0] >> 0;
      if (method === 'go' && args.length) args[0] = delta;
      if (delta !== 0) {
        // Only script-driven traversal is wrapped. Chrome's own Back/Forward
        // controls remain available; unknown cross-document entries fail closed.
        const current = navigation.currentEntry;
        const target = navigation.entries().find(entry => entry.index === current?.index + delta);
        if (!target || !permitted(target.url)) return undefined;
      }
      return nativeApply(original, receiver, args);
    });
    // Meta refreshes also dispatch navigate; no DOM scanning or polling needed.
  }
})();
