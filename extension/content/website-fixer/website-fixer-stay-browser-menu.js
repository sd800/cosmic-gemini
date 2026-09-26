globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-activate')] = () => {
  const key = Symbol.for('cosmic-gemini.website-fixer.stay-menu');
  if (globalThis[key]) return;
  globalThis[key] = true;
  const prefix = 'cosmic-gemini:website-fixer:stay:';
  const activate = () => window.dispatchEvent(new CustomEvent(prefix + 'activate'));
  window.addEventListener(prefix + 'ready', activate);
  activate();
  // This runs only in the extension's isolated world. Keep it separate from
  // the MAIN-world navigation guard so Chrome injects both registrations.
  window.addEventListener('contextmenu', event => {
    if (!event.isTrusted) return;
    const urls = new Set();
    const addUrl = (value, base) => {
      if (!value || urls.size >= 8) return;
      try {
        const url = new URL(value, base);
        if (url.protocol !== 'javascript:' && url.href.length <= 2048) urls.add(url.href);
      } catch {}
    };
    const path = event.composedPath?.() || [];
    const image = path.some(node => /^(img|image)$/.test(node?.localName));
    const link = path.find(node => /^(a|area)$/.test(node?.localName)
      && (node.hasAttribute('href') || node.hasAttribute('xlink:href')));
    if (link) addUrl(link.getAttribute('href') || link.getAttribute('xlink:href'), link.baseURI);
    for (const node of path) {
      if (/^(img|video|audio|source)$/.test(node?.localName)) {
        addUrl(node.currentSrc || node.getAttribute('src'), node.baseURI);
        if (node.localName === 'video') addUrl(node.getAttribute('poster'), node.baseURI);
      } else if (node?.localName === 'image') {
        addUrl(node.getAttribute('href') || node.getAttribute('xlink:href'), node.baseURI);
      }
    }
    const selected = String(window.getSelection?.() || '').trim()
      || (document.activeElement?.selectionStart !== undefined
        ? document.activeElement.value?.slice(document.activeElement.selectionStart,
          document.activeElement.selectionEnd).trim() : '');
    if (selected) addUrl(selected);
    // A page's custom context menu is not a browser command. Wait until
    // dispatch finishes so its preventDefault() can be observed.
    setTimeout(() => {
      if (event.defaultPrevented) return;
      try {
        const sent = chrome.runtime.sendMessage({ type: 'CG_WEBSITE_FIXER_CONTEXT_MENU',
          featureId: 'websiteFixer', kind: 'browser', urls: [...urls], search: !!selected, image });
        sent?.catch?.(() => {});
      } catch {}
    }, 0);
  }, true);
};
