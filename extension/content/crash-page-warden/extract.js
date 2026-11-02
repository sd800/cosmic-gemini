(() => {
  const KEY = Symbol.for('cosmic-gemini.crash-page-warden.extract');
  if (globalThis[KEY]) return;
  const DROP = new Set('script style iframe frame object embed form input button select textarea nav header footer aside dialog canvas svg audio video link meta noscript template'.split(' '));
  const ALLOWED = new Set('p h1 h2 h3 h4 h5 h6 strong b em i u s del sub sup br hr ul ol li blockquote pre code figure figcaption table colgroup col thead tbody tfoot tr th td span div dl dt dd ruby rt rp a img details summary time address'.split(' '));
  function address(value, base, image = false) {
    if (typeof value !== 'string' || !value.trim() || value.length > (image ? 2_800_000 : 16_384)) return '';
    try {
      const url = new URL(value.trim(), base);
      if (url.username || url.password) return '';
      if (/^https?:$/.test(url.protocol)) return url.href;
      if (image && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
      if (!image && /^(?:mailto|tel|sms):$/.test(url.protocol)) return url.href;
    } catch {}
    return '';
  }
  function imageSource(node, base) {
    const candidates = ['data-src', 'data-original', 'data-lazy-src', 'data-original-src', 'src'].map(name => node.getAttribute(name) || '');
    const set = node.getAttribute('data-srcset') || node.getAttribute('srcset') || '';
    if (set.length < 32_768 && !set.startsWith('data:')) {
      const variants = set.split(',').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]);
      const pixels = item => (parseFloat(item[1]) || 1) * (/x$/.test(item[1] || '') ? 800 : 1);
      variants.sort((a, b) => pixels(a) - pixels(b));
      const preferred = variants.find(item => pixels(item) >= 1200) || variants.at(-1);
      if (preferred) candidates.unshift(preferred[0]);
    }
    return candidates.map(value => address(value, base, true)).find(Boolean) || '';
  }
  function structuredBody(doc) {
    for (const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0, 16)) {
      if (script.textContent.length > 256_000) continue;
      try {
        const queue = [JSON.parse(script.textContent)];
        for (let n = 0; queue.length && n < 200; n++) {
          const item = queue.shift();
          if (!item || typeof item !== 'object') continue;
          if (typeof item.articleBody === 'string' && item.articleBody.trim().length > 200) return item.articleBody.slice(0, 1_500_000);
          for (const value of Object.values(item)) if (value && typeof value === 'object') queue.push(...(Array.isArray(value) ? value.slice(0, 100) : [value]));
        }
      } catch {}
    }
    return '';
  }
  function extract(original) {
    const base = original.baseURI || location.href;
    const count = original.getElementsByTagName('*').length;
    let source, article = null;
    if (count <= 35_000 && original.documentElement.textContent.length <= 4_000_000) {
      const clone = original.cloneNode(true);
      for (const hidden of clone.querySelectorAll('article [hidden],main [hidden],article [aria-hidden="true"],main [aria-hidden="true"]')) {
        hidden.removeAttribute('hidden'); hidden.removeAttribute('aria-hidden');
      }
      // Resolve lazy-image locations before Readability removes presentation.
      for (const img of clone.querySelectorAll('img')) {
        const src = imageSource(img, base);
        if (src) img.setAttribute('src', src);
        img.removeAttribute('srcset');
      }
      try { article = new Readability(clone, { maxElemsToParse: 35_000, charThreshold: 150,
        serializer: element => element, allowedVideoRegex: /a^/ }).parse(); } catch {}
    }
    let fallback = false;
    source = article?.content;
    if (!source?.textContent?.trim()) {
      const body = structuredBody(original);
      if (body) {
        source = original.createElement('div');
        for (const text of body.split(/\n\s*\n|\r?\n/).slice(0, 4000)) {
          const p = original.createElement('p'); p.textContent = text; source.append(p);
        }
      } else {
        fallback = true;
        const candidates = [...original.querySelectorAll('article,main,[role="main"]')].slice(0, 40);
        source = candidates.sort((a, b) => b.textContent.length - a.textContent.length)[0] || original.body || original.documentElement;
      }
    }
    const title = (article?.title || original.querySelector('meta[property="og:title"]')?.content || original.title || new URL(base).hostname).slice(0, 1500);
    const byline = (article?.byline || original.querySelector('meta[name="author"]')?.content || '').slice(0, 500);
    const published = (article?.publishedTime || original.querySelector('meta[property="article:published_time"]')?.content || '').slice(0, 100);
    return { source, title, byline, published, base, fallback, lang: article?.lang || original.documentElement.lang,
      dir: ['rtl', 'ltr'].includes(article?.dir) ? article.dir : original.documentElement.dir };
  }
  function rebuild(article, targetDocument) {
    const root = targetDocument.createElement('div'); root.id = 'cg-warden-content';
    const ids = new Map(); let nodes = 0, characters = 0, images = 0;
    let requested = ''; try { requested = decodeURIComponent(new URL(article.base).hash.slice(1)); } catch {}
    const cleanTitle = value => value.replace(/\s+/g, ' ').trim().toLowerCase();
    const idFor = value => { if (!ids.has(value)) ids.set(value, 'cg-warden-section-' + (ids.size + 1)); return ids.get(value); };
    function children(source, parent, depth) {
      for (const child of source.childNodes) {
        if (nodes >= 15_000 || characters >= 1_500_000) break;
        copy(child, parent, depth);
      }
    }
    function copy(source, parent, depth = 0) {
      if (depth > 80 || nodes++ > 15_000 || characters >= 1_500_000) return;
      if (source.nodeType === 3) {
        const text = (source.nodeValue || '').slice(0, 1_500_000 - characters);
        characters += text.length; parent.append(targetDocument.createTextNode(text)); return;
      }
      if (source.nodeType !== 1) return;
      const tag = source.localName;
      if (DROP.has(tag)) return;
      if (tag === 'h1' && cleanTitle(source.textContent) === cleanTitle(article.title)) return;
      if (!ALLOWED.has(tag)) { children(source, parent, depth + 1); return; }
      const node = targetDocument.createElement(tag);
      const originalId = source.getAttribute('id');
      if (originalId && originalId.length <= 160 && ids.size < 4096) {
        node.id = idFor(originalId);
        if (originalId === requested) node.dataset.cgWardenAnchor = 'current';
      }
      if (['rtl', 'ltr', 'auto'].includes(source.getAttribute('dir'))) node.dir = source.getAttribute('dir');
      if (tag === 'a') {
        const href = address(source.getAttribute('href') || '', article.base);
        if (href) {
          const url = new URL(href), own = new URL(article.base);
          if (url.origin === own.origin && url.pathname === own.pathname && url.search === own.search && url.hash) {
            try {
              const fragment = decodeURIComponent(url.hash.slice(1));
              node.dataset.cgWardenTarget = idFor(fragment); node.dataset.cgWardenFragment = fragment;
              node.href = '#' + node.dataset.cgWardenTarget;
            } catch {}
          } else node.href = href;
        }
        node.rel = 'noopener noreferrer';
      } else if (tag === 'img') {
        const src = imageSource(source, article.base);
        if (!src || images++ >= 80) return;
        node.loading = 'lazy'; node.decoding = 'async'; node.src = src;
        node.alt = (source.getAttribute('alt') || '').slice(0, 2000);
        for (const name of ['width', 'height']) {
          const value = Number(source.getAttribute(name));
          if (Number.isInteger(value) && value > 0 && value <= 16_384) node.setAttribute(name, String(value));
        }
      } else if (tag === 'td' || tag === 'th') {
        for (const name of ['colspan', 'rowspan']) {
          const value = Number(source.getAttribute(name));
          if (Number.isInteger(value) && value >= 1 && value <= 100) node.setAttribute(name, String(value));
        }
      } else if (tag === 'details') node.open = true;
      children(source, node, depth + 1);
      parent.append(node);
    }
    children(article.source, root, 0);
    return root;
  }
  Object.defineProperty(globalThis, KEY, { value: Object.freeze({ extract, rebuild, address }) });
})();
