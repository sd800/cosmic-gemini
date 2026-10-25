globalThis[Symbol.for('cosmic-gemini.website-fixer.translate-activate')] = () => {
  const KEY = Symbol.for('cosmic-gemini.website-fixer.translate');
  if (globalThis[KEY]) return;
  let active = true;
  let timer;
  const restorers = [];
  const afterParsing = () => {
    if (!active) return;
    for (const element of document.querySelectorAll('symbol[id="google"]')) clearOptOut(element);
  };
  globalThis[KEY] = { dispose() {
    if (!active) return;
    active = false;
    observer.disconnect();
    clearTimeout(timer);
    document.removeEventListener('DOMContentLoaded', afterParsing);
    for (const restore of restorers.reverse()) restore();
    restorers.length = 0;
    delete globalThis[KEY];
  } };

  function reviseAttribute(element, name, value) {
    const before = element.getAttribute(name);
    if (before === value) return;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
    const reference = new WeakRef(element);
    restorers.push(() => {
      const element = reference.deref();
      // Do not overwrite a later website edit when the session tool is disabled.
      if (!element || element.getAttribute(name) !== value) return;
      if (before === null) element.removeAttribute(name);
      else element.setAttribute(name, before);
    });
  }

  const withoutOptOut = value => String(value || '').split(/[\s,;]+/)
    .filter(token => token && token.toLowerCase() !== 'notranslate').join(', ');

  function repairSymbolNamespace(element) {
    // A symbol parsed outside <svg> is an HTMLElement. If named "google",
    // its boolean .translate property swallows Chrome's translation namespace.
    // Restore the SVG type, retaining the ID, attributes, children, and references.
    if (element.localName !== 'symbol' || element.id !== 'google' ||
        element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return element;
    // Replacing an element still on the HTML parser's stack would strand its
    // remaining children on the detached old node. Wait for parsing to finish.
    if (document.readyState === 'loading') return element;
    const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    for (const attribute of element.attributes) {
      const name = attribute.name === 'viewbox' ? 'viewBox' :
        attribute.name === 'preserveaspectratio' ? 'preserveAspectRatio' : attribute.name;
      if (attribute.namespaceURI) symbol.setAttributeNS(attribute.namespaceURI, name, attribute.value);
      else symbol.setAttribute(name, attribute.value);
    }
    while (element.firstChild) symbol.appendChild(element.firstChild);
    element.replaceWith(symbol);
    const signature = () => JSON.stringify([...symbol.attributes].map(attribute => [attribute.name, attribute.value]));
    const attributes = signature();
    restorers.push(() => {
      if (!symbol.isConnected || signature() !== attributes) return;
      while (symbol.firstChild) element.appendChild(symbol.firstChild);
      symbol.replaceWith(element);
    });
    return symbol;
  }

  function clearOptOut(element) {
    element = repairSymbolNamespace(element);
    if (element.localName === 'meta' && element.getAttribute('name')?.trim().toLowerCase() === 'google') {
      let changed = false;
      for (const attribute of ['content', 'value']) {
        const before = element.getAttribute(attribute);
        if (!before || !before.split(/[\s,;]+/).some(token => token.toLowerCase() === 'notranslate')) continue;
        const after = withoutOptOut(before);
        reviseAttribute(element, attribute, after || null);
        changed = true;
      }
      if (changed && !element.hasAttribute('content') && !element.hasAttribute('value')) {
        const parent = element.parentNode, next = element.nextSibling;
        element.remove();
        if (parent) restorers.push(() => {
          if (!element.isConnected && parent.isConnected && (!next || next.parentNode === parent)) parent.insertBefore(element, next);
        });
      }
      return;
    }

    if (element.getAttribute('translate')?.trim().toLowerCase() === 'no') {
      reviseAttribute(element, 'translate', null);
    }
    const classes = element.getAttribute('class');
    if (!classes) return;
    const tokens = classes.split(/\s+/).filter(Boolean);
    if (!tokens.some(token => token.toLowerCase() === 'notranslate')) return;
    const kept = tokens.filter(token => token.toLowerCase() !== 'notranslate').join(' ');
    reviseAttribute(element, 'class', kept || null);
  }

  function clearTree(node) {
    if (!node || node.nodeType !== 1) return;
    clearOptOut(node);
    for (const element of node.querySelectorAll('meta[name], [translate], .notranslate, symbol[id="google"]')) clearOptOut(element);
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
    attributeFilter: ['name', 'content', 'value', 'translate', 'class', 'id']
  });
  clearTree(document.documentElement);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', afterParsing, { once: true });
  }

  // Cover parser-created nodes and delayed page rewrites, then release the
  // broad DOM watch rather than retaining it while users browse.
  timer = setTimeout(() => observer.disconnect(), 15_000);
};
