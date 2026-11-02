(() => {
  const state = globalThis[Symbol.for('cosmic-gemini.crash-page-warden.static')];
  if (!state || state.lockDarkReader) return;
  let head, body, headObserver, bodyObserver, rootObserver, queued = false;
  const STYLE_SELECTOR = 'style.darkreader,link.darkreader,style#dark-reader-style';
  function disableStyles(parent) {
    if (!parent) return;
    for (const style of parent.querySelectorAll(STYLE_SELECTOR)) {
      // Retain the node so a legacy filter's position watcher does not keep
      // reinserting it. Dynamic mode also stops through its supported lock.
      if (style.media !== 'not all') style.media = 'not all';
      try { if (style.sheet) style.sheet.disabled = true; } catch {}
    }
  }
  function sweep() {
    queued = false;
    if (!state.started || !document.documentElement) return;
    const root = document.documentElement, currentHead = document.head;
    if (!currentHead) return;
    const lock = state.lock || document.createElement('meta');
    state.lock = lock; lock.name = 'darkreader-lock';
    if (lock.parentNode !== currentHead) currentHead.prepend(lock);
    const marked = root.hasAttribute('data-darkreader-mode') || root.hasAttribute('data-darkreader-scheme');
    for (const attribute of [...root.attributes]) if (attribute.name.startsWith('data-darkreader-')) root.removeAttribute(attribute.name);
    for (const property of [...root.style]) if (property.startsWith('--darkreader-')) root.style.removeProperty(property);
    disableStyles(currentHead);
    for (const child of root.children) {
      if (child.matches?.(STYLE_SELECTOR)) { child.media = 'not all'; try { if (child.sheet) child.sheet.disabled = true; } catch {} }
    }
    const container = document.body?.querySelector('.darkreader-style-container');
    if (container) disableStyles(container);
    if (marked) document.dispatchEvent(new CustomEvent('__darkreader__cleanUp'));
    if (head !== currentHead) {
      headObserver?.disconnect(); head = currentHead;
      headObserver = new MutationObserver(schedule); headObserver.observe(head, { childList: true, subtree: true });
    }
    if (body !== document.body) {
      bodyObserver?.disconnect(); body = document.body;
      if (body) { bodyObserver = new MutationObserver(schedule); bodyObserver.observe(body, { childList: true }); }
    }
  }
  function schedule() {
    if (!queued) { queued = true; queueMicrotask(sweep); }
  }
  state.lockDarkReader = () => {
    sweep();
    if (!rootObserver) {
      rootObserver = new MutationObserver(schedule);
      rootObserver.observe(document.documentElement, { childList: true, attributes: true });
    }
  };
  addEventListener('pagehide', () => {
    headObserver?.disconnect(); bodyObserver?.disconnect(); rootObserver?.disconnect(); rootObserver = null; head = body = null;
  });
  addEventListener('pageshow', event => { if (event.persisted) state.lockDarkReader(); });
})();
