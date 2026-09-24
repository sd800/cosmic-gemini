(() => {
  const KEY = Symbol.for('cosmic-gemini.website-fixer.translate');
  if (globalThis[KEY]) return;
  globalThis[KEY] = true;

  const withoutOptOut = value => String(value || '').split(/[\s,;]+/)
    .filter(token => token && token.toLowerCase() !== 'notranslate').join(', ');

  const clearOptOuts = () => {
    for (const meta of document.head?.querySelectorAll('meta[name]') || []) {
      if (meta.getAttribute('name')?.trim().toLowerCase() !== 'google') continue;
      let changed = false;
      for (const attribute of ['content', 'value']) {
        const before = meta.getAttribute(attribute);
        if (!before || !before.split(/[\s,;]+/).some(token => token.toLowerCase() === 'notranslate')) continue;
        const after = withoutOptOut(before);
        if (after) meta.setAttribute(attribute, after);
        else meta.removeAttribute(attribute);
        changed = true;
      }
      if (changed && !meta.hasAttribute('content') && !meta.hasAttribute('value')) meta.remove();
    }
  };

  let headObserver = null;
  const rootObserver = new MutationObserver(() => attachHead());
  function attachHead() {
    const head = document.head;
    if (!head || headObserver) return;
    rootObserver.disconnect();
    headObserver = new MutationObserver(clearOptOuts);
    headObserver.observe(head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['name', 'content', 'value']
    });
    clearOptOuts();
  }

  rootObserver.observe(document, { childList: true, subtree: true });
  attachHead();
  const timeout = setTimeout(stop, 15_000);
  function stop() {
    clearOptOuts();
    rootObserver.disconnect();
    headObserver?.disconnect();
    clearTimeout(timeout);
  }
  if (document.readyState !== 'complete') {
    window.addEventListener('load', stop, { once: true });
  } else stop();
})();
