(() => {
  const KEY = Symbol.for('cosmic-gemini.website-fixer.translate');
  if (globalThis[KEY]) return;
  globalThis[KEY] = true;

  const withoutOptOut = value => String(value || '').split(/[\s,;]+/)
    .filter(token => token && token.toLowerCase() !== 'notranslate').join(', ');

  function clearOptOut(element) {
    if (element.localName === 'meta' && element.getAttribute('name')?.trim().toLowerCase() === 'google') {
      let changed = false;
      for (const attribute of ['content', 'value']) {
        const before = element.getAttribute(attribute);
        if (!before || !before.split(/[\s,;]+/).some(token => token.toLowerCase() === 'notranslate')) continue;
        const after = withoutOptOut(before);
        if (after) element.setAttribute(attribute, after);
        else element.removeAttribute(attribute);
        changed = true;
      }
      if (changed && !element.hasAttribute('content') && !element.hasAttribute('value')) element.remove();
      return;
    }

    if (element.getAttribute('translate')?.trim().toLowerCase() === 'no') {
      element.removeAttribute('translate');
    }
    const classes = element.getAttribute('class');
    if (!classes) return;
    const tokens = classes.split(/\s+/).filter(Boolean);
    if (!tokens.some(token => token.toLowerCase() === 'notranslate')) return;
    const kept = tokens.filter(token => token.toLowerCase() !== 'notranslate').join(' ');
    if (kept) element.setAttribute('class', kept);
    else element.removeAttribute('class');
  }

  function clearTree(node) {
    if (!node || node.nodeType !== 1) return;
    clearOptOut(node);
    for (const element of node.querySelectorAll('meta[name], [translate], .notranslate')) clearOptOut(element);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') clearOptOut(record.target);
      else for (const node of record.addedNodes) clearTree(node);
    }
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['name', 'content', 'value', 'translate', 'class']
  });
  clearTree(document.documentElement);

  // Cover parser-created nodes and delayed page rewrites, then release the
  // broad DOM watch rather than retaining it while users browse.
  setTimeout(() => observer.disconnect(), 15_000);
})();
