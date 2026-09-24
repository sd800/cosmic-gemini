(() => {
  const key = Symbol.for('cosmic-gemini.website-fixer.stay');
  if (globalThis[key]) return;
  const siteKey = globalThis[Symbol.for('cosmic-gemini.stay-site-key')];
  const source = location.origin === 'null' ? document.referrer : location.origin;
  const site = siteKey(source);
  if (!site) return;
  globalThis[key] = true;
  const NativeURL = URL;
  const nativeApply = Reflect.apply;
  const listen = EventTarget.prototype.addEventListener;

  function permitted(value, base = location.href) {
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
      if (target.navigation) nativeApply(listen, target.navigation, ['navigate', event => {
        if (event.cancelable && !permitted(event.destination.url)) stop(event);
      }, true]);
    } catch {}
  }
  guardNavigation(window);
  function guardLink(event) {
    const link = event.composedPath().find(node => /^(a|area)$/.test(node?.localName)
      && (node.hasAttribute('href') || node.hasAttribute('xlink:href')));
    if (link && !permitted(link.getAttribute('href') || link.getAttribute('xlink:href'), link.baseURI)) stop(event);
  }
  for (const type of ['click', 'auxclick']) nativeApply(listen, window, [type, guardLink, true]);
  const formUrl = (form, submitter) => submitter?.hasAttribute('formaction') ? submitter.formAction : form.action;
  nativeApply(listen, window, ['submit', event => {
    if (!permitted(formUrl(event.target, event.submitter))) stop(event);
  }, true]);

  // MAIN-world wrappers close target=_blank and programmatic submission gaps;
  // the separately registered ISOLATED copy keeps native event guards independent.
  function wrap(owner, name, handler) {
    const original = owner?.[name];
    if (typeof original !== 'function') return;
    try { owner[name] = function (...args) { return handler(original, this, args); }; } catch {}
  }
  wrap(window, 'open', (original, receiver, args) => {
    if (!permitted(args[0] || 'about:blank', document.baseURI)) return null;
    const child = nativeApply(original, receiver == null ? window : receiver, args);
    if (child) {
      guardNavigation(child);
      try { child.open = window.open.bind(child); } catch {}
    }
    return child;
  });
  for (const method of ['submit', 'requestSubmit']) wrap(HTMLFormElement.prototype, method, (original, form, args) => {
    if (!permitted(formUrl(form, method === 'requestSubmit' ? args[0] : null))) return undefined;
    return nativeApply(original, form, args);
  });
  for (const method of ['back', 'forward', 'go']) wrap(History.prototype, method, (original, receiver, args) => {
    const delta = method === 'back' ? -1 : method === 'forward' ? 1 : Number(args[0] || 0);
    if (delta !== 0) {
      // Only script-driven traversal is wrapped. Chrome's own Back/Forward
      // controls remain available; unknown cross-document entries fail closed.
      const current = navigation.currentEntry;
      const target = navigation.entries().find(entry => entry.index === current?.index + Math.trunc(delta));
      if (!target || !permitted(target.url)) return undefined;
    }
    return nativeApply(original, receiver, args);
  });
  // Meta refreshes also dispatch navigate; no DOM scanning or polling needed.
})();
