export async function imagePageDiscovery(options = {}) {
  const deep = options?.deep === true && window === window.top;
  const MAX_RESULTS = 1200;
  const MAX_INLINE_LENGTH = 1_500_000;
  const originalScroll = { x: window.scrollX, y: window.scrollY };

  if (deep) {
    const pageHeight = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0);
    const steps = Math.min(14, Math.max(1, Math.ceil(pageHeight / Math.max(1, window.innerHeight))));
    for (let step = 0; step <= steps; step += 1) {
      window.scrollTo({ left: originalScroll.x, top: Math.min(pageHeight, step * window.innerHeight), behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 160));
      if (document.images.length >= 800) break;
    }
    window.scrollTo({ left: originalScroll.x, top: originalScroll.y, behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  const records = new Map();
  const frameUrl = location.href;
  const absolute = value => {
    const raw = String(value || '').trim().replace(/^['"]|['"]$/g, '');
    if (!raw || raw === 'none') return '';
    if (/^data:image\//i.test(raw)) return raw.length <= MAX_INLINE_LENGTH ? raw : '';
    if (/^blob:https?:/i.test(raw)) return raw;
    try {
      const url = new URL(raw, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.hash = '';
      return url.href;
    } catch { return ''; }
  };
  const family = (kind, index) => `${location.origin}${location.pathname}|${kind}|${index}`.slice(0, 400);
  const add = (value, meta = {}) => {
    if (records.size >= MAX_RESULTS) return;
    const url = absolute(value);
    if (!url) return;
    const current = records.get(url) || {};
    records.set(url, {
      ...current,
      ...meta,
      url,
      width: Math.max(Number(current.width) || 0, Number(meta.width) || 0),
      height: Math.max(Number(current.height) || 0, Number(meta.height) || 0),
      displayWidth: Math.max(Number(current.displayWidth) || 0, Number(meta.displayWidth) || 0),
      displayHeight: Math.max(Number(current.displayHeight) || 0, Number(meta.displayHeight) || 0),
      descriptorWidth: Math.max(Number(current.descriptorWidth) || 0, Number(meta.descriptorWidth) || 0),
      originalHint: Math.max(Number(current.originalHint) || 0, Number(meta.originalHint) || 0),
      familyKey: meta.familyKey || current.familyKey,
      alt: meta.alt || current.alt || '',
      title: meta.title || current.title || '',
      frameUrl,
      discoveredAt: Date.now()
    });
  };
  const parseSrcset = (value, meta) => {
    for (const item of String(value || '').split(',')) {
      const part = item.trim();
      if (!part) continue;
      const match = part.match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/);
      if (!match) continue;
      const descriptor = Number(match[2]) || 0;
      add(match[1], {
        ...meta,
        source: meta.source || 'srcset',
        descriptorWidth: match[3] === 'w' ? descriptor : 0,
        originalHint: Math.max(meta.originalHint || 0, match[3] === 'w' && descriptor >= 1600 ? 3 : 1)
      });
    }
  };
  const addKnownOriginals = (value, meta) => {
    const source = absolute(value);
    if (!source || !source.startsWith('http')) return;
    try {
      const url = new URL(source);
      const hostname = url.hostname.toLowerCase();
      const alternatives = [];
      if (hostname === 'pbs.twimg.com') {
        const original = new URL(url);
        original.searchParams.set('name', 'orig');
        alternatives.push(original.href);
      }
      if (hostname.endsWith('images.unsplash.com')) {
        const original = new URL(url);
        for (const key of ['w', 'h', 'fit', 'crop', 'q', 'fm']) original.searchParams.delete(key);
        alternatives.push(original.href);
      }
      if (hostname.endsWith('.hdslb.com') && url.pathname.includes('@')) {
        const original = new URL(url);
        original.pathname = original.pathname.slice(0, original.pathname.indexOf('@'));
        alternatives.push(original.href);
      }
      if (hostname.endsWith('googleusercontent.com') && /=s?\d+(?:-[a-z0-9-]+)?$/i.test(url.pathname)) {
        const original = new URL(url);
        original.pathname = original.pathname.replace(/=s?\d+(?:-[a-z0-9-]+)?$/i, '=s0');
        alternatives.push(original.href);
      }
      const wordpressPath = url.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z0-9]{2,5}$)/i, '');
      if (wordpressPath !== url.pathname) {
        const original = new URL(url);
        original.pathname = wordpressPath;
        alternatives.push(original.href);
      }
      const wikiMatch = url.pathname.match(/^\/([^/]+)\/thumb\/(.+)\/\d+px-[^/]+$/);
      if (hostname.endsWith('wikimedia.org') && wikiMatch) {
        const original = new URL(url);
        original.pathname = `/${wikiMatch[1]}/${wikiMatch[2]}`;
        alternatives.push(original.href);
      }
      for (const alternative of alternatives) {
        if (alternative !== source) add(alternative, { ...meta, source: 'original-attribute', originalHint: 7 });
      }
    } catch {}
  };
  const cssUrls = value => {
    const urls = [];
    const text = String(value || '');
    for (const match of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) urls.push(match[2]);
    return urls;
  };
  const roots = [document];
  const allElements = [];
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    let elements = [];
    try { elements = [...roots[rootIndex].querySelectorAll('*')]; } catch {}
    for (const element of elements) {
      allElements.push(element);
      if (element.shadowRoot && roots.length < 80) roots.push(element.shadowRoot);
      if (allElements.length >= 18000) break;
    }
    if (allElements.length >= 18000) break;
  }

  const originalAttributes = [
    'data-original', 'data-original-src', 'data-full', 'data-full-src', 'data-fullsize',
    'data-hi-res', 'data-high-res', 'data-large', 'data-large-image', 'data-zoom-image',
    'data-download', 'data-image-url'
  ];
  const lazyAttributes = ['data-src', 'data-lazy-src', 'data-url', 'data-image', 'data-thumb'];

  let imageIndex = 0;
  for (const img of allElements.filter(element => element instanceof HTMLImageElement)) {
    const key = family('img', imageIndex++);
    const meta = {
      familyKey: key,
      width: img.naturalWidth,
      height: img.naturalHeight,
      displayWidth: img.clientWidth,
      displayHeight: img.clientHeight,
      alt: img.alt,
      title: img.title
    };
    add(img.currentSrc, { ...meta, source: 'current-src', originalHint: 2 });
    add(img.src, { ...meta, source: 'image', originalHint: 1 });
    addKnownOriginals(img.currentSrc || img.src, meta);
    parseSrcset(img.srcset, { ...meta, source: 'srcset' });
    for (const attr of originalAttributes) add(img.getAttribute(attr), { ...meta, source: 'original-attribute', originalHint: 8 });
    for (const attr of lazyAttributes) add(img.getAttribute(attr), { ...meta, source: 'image', originalHint: 2 });
    parseSrcset(img.getAttribute('data-srcset'), { ...meta, source: 'srcset', originalHint: 3 });
    const picture = img.closest('picture');
    if (picture) for (const source of picture.querySelectorAll('source')) {
      parseSrcset(source.srcset || source.getAttribute('data-srcset'), { ...meta, source: 'picture', originalHint: 3 });
    }
    const anchor = img.closest('a[href]');
    if (anchor) add(anchor.href, { ...meta, source: 'linked-image', originalHint: 7 });
  }

  let elementIndex = 0;
  for (const element of allElements) {
    const key = family('element', elementIndex++);
    if (element instanceof HTMLInputElement && element.type === 'image') {
      add(element.src, { familyKey: key, source: 'image', width: element.width, height: element.height });
    }
    if (element instanceof HTMLAnchorElement && element.href && /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i.test(element.href)) {
      add(element.href, { familyKey: key, source: 'linked-image', originalHint: 5, title: element.textContent });
    }
    for (const attr of originalAttributes) add(element.getAttribute?.(attr), { familyKey: key, source: 'original-attribute', originalHint: 7 });
    for (const attr of lazyAttributes) add(element.getAttribute?.(attr), { familyKey: key, source: 'image', originalHint: 2 });
    parseSrcset(element.getAttribute?.('srcset') || element.getAttribute?.('data-srcset'), { familyKey: key, source: 'srcset' });
    try {
      const style = getComputedStyle(element);
      for (const value of [style.backgroundImage, style.borderImageSource, style.listStyleImage, style.content]) {
        for (const url of cssUrls(value)) add(url, { familyKey: key, source: 'css', width: element.clientWidth, height: element.clientHeight });
      }
      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = getComputedStyle(element, pseudo);
        for (const value of [pseudoStyle.backgroundImage, pseudoStyle.content]) {
          for (const url of cssUrls(value)) add(url, { familyKey: key, source: 'css', width: element.clientWidth, height: element.clientHeight });
        }
      }
    } catch {}
  }

  let svgIndex = 0;
  for (const svg of allElements.filter(element => element instanceof SVGSVGElement).slice(0, 250)) {
    try {
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const text = new XMLSerializer().serializeToString(clone);
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
      if (url.length <= MAX_INLINE_LENGTH) {
        const rect = svg.getBoundingClientRect();
        add(url, { familyKey: family('svg', svgIndex++), source: 'inline-svg', width: rect.width, height: rect.height, originalHint: 4 });
      }
    } catch {}
  }
  let canvasIndex = 0;
  for (const canvas of allElements.filter(element => element instanceof HTMLCanvasElement).slice(0, 80)) {
    try {
      const url = canvas.toDataURL('image/png');
      if (url.length <= MAX_INLINE_LENGTH) add(url, { familyKey: family('canvas', canvasIndex++), source: 'canvas', width: canvas.width, height: canvas.height, originalHint: 3 });
    } catch {}
  }

  for (const meta of document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[itemprop="image"]')) {
    add(meta.content, { familyKey: family('metadata', meta.getAttribute('property') || meta.getAttribute('name') || meta.getAttribute('itemprop')), source: 'structured-data', originalHint: 7 });
  }
  for (const link of document.querySelectorAll('link[rel="image_src"], link[rel="preload"][as="image"]')) {
    add(link.href, { familyKey: family('metadata', link.href), source: 'structured-data', originalHint: 6 });
    parseSrcset(link.getAttribute('imagesrcset'), { familyKey: family('metadata', link.href), source: 'srcset', originalHint: 5 });
  }
  const visitStructured = (value, depth = 0) => {
    if (depth > 8 || records.size >= MAX_RESULTS) return;
    if (typeof value === 'string') {
      if (/^(?:https?:|data:image\/)/i.test(value) && /(?:image|photo|logo|thumbnail|\.(?:avif|gif|jpe?g|png|svg|webp))/i.test(value)) {
        add(value, { familyKey: family('structured', value.slice(0, 120)), source: 'structured-data', originalHint: 6 });
      }
      return;
    }
    if (Array.isArray(value)) return value.slice(0, 200).forEach(item => visitStructured(item, depth + 1));
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      if (/image|photo|thumbnail|logo|contenturl/i.test(key)) visitStructured(item, depth + 1);
      else if (depth < 3 && ['@graph', 'mainEntity', 'itemListElement'].includes(key)) visitStructured(item, depth + 1);
    }
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visitStructured(JSON.parse(script.textContent)); } catch {}
  }
  try {
    for (const entry of performance.getEntriesByType('resource')) {
      if (['img', 'css'].includes(entry.initiatorType) || /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(entry.name)) {
        add(entry.name, { familyKey: family('resource', entry.name), source: 'page-resource' });
      }
    }
  } catch {}

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    frameUrl,
    candidates: [...records.values()]
  };
}
