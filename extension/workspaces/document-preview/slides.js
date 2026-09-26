import { safeDocumentHtml } from './sanitize.js';
import { acceptedStyles } from './format-styles.js';

// Only nearby pages/miniatures contain document DOM. All other pages retain
// their dimensions so scrolling stays continuous without expanding the deck.
export function createSlidesView({ parts, formatting, label, index = 0, zoom = 1 }, onSelect, onError) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 300 ||
      parts.some(part => typeof part?.html !== 'string') ||
      parts.reduce((size, part) => size + part.html.length, 0) > 48 * 1024 * 1024) throw Error('documentTooLarge');
  const controller = new AbortController(), { signal } = controller;
  const cache = new Map(), pageNodes = new Map(), thumbNodes = new Map(), visibleThumbs = new Set();
  const styles = acceptedStyles(formatting);
  const points = value => typeof value === 'string' && /^\d+(?:\.\d+)?pt$/.test(value) ? parseFloat(value) * 4 / 3 : 0;
  const sizes = parts.map(part => {
    // Converter-provided sizes are hints for empty placeholders only. Markup
    // still passes through the complete sanitizer before it is mounted.
    const classes = part.html.slice(0, 512).match(/^<div class="([^"]*)"/)?.[1]?.split(' ') || [];
    const style = classes.includes('cg-slide') && styles[Number(classes.find(name => /^cg-f\d+$/.test(name))?.slice(4))];
    const width = points(style?.width) || 960, height = points(style?.height) || points(style?.['min-height']) || width * .75;
    return { width, height, paperHeight: height };
  });
  const starts = [], heights = [];
  let selected = -1, closed = false, layoutFrame = 0, scrollFrame = 0, paintFrame = 0, cacheSize = 0, scale = 1;
  let nearbyPages = [], padding = 32;
  const rail = document.createElement('nav'); rail.className = 'cg-slide-rail'; rail.setAttribute('aria-label', label);
  const list = document.createElement('ol'); list.className = 'cg-slide-list'; rail.append(list);
  const viewport = document.createElement('main'); viewport.className = 'cg-slide-viewport';
  const stack = document.createElement('div'); stack.className = 'cg-slide-stack'; viewport.append(stack);
  const pages = parts.map((part, i) => {
    const page = document.createElement('section'); page.className = 'cg-slide-page';
    page.dataset.index = String(i); page.setAttribute('aria-label', `${label} ${i + 1}`); stack.append(page);
    return page;
  });
  const buttons = parts.map((part, i) => {
    const item = document.createElement('li'), button = document.createElement('button');
    const number = document.createElement('span'), preview = document.createElement('span');
    button.type = 'button'; button.className = 'cg-slide-thumbnail'; button.dataset.index = String(i); button.tabIndex = -1;
    button.setAttribute('aria-label', `${label} ${i + 1}`); button.title = String(part.name || `${label} ${i + 1}`).slice(0, 300);
    number.className = 'cg-slide-number'; number.textContent = String(i + 1);
    preview.className = 'cg-slide-miniature'; preview.setAttribute('aria-hidden', 'true'); preview.inert = true;
    preview.style.aspectRatio = `${sizes[i].width} / ${sizes[i].paperHeight}`;
    button.append(preview, number); item.append(button); list.append(item);
    return button;
  });
  document.body.replaceChildren(rail, viewport); document.body.classList.add('cg-slides');

  function template(i) {
    let entry = cache.get(i);
    if (entry) cache.delete(i);
    else {
      const html = safeDocumentHtml(parts[i].html, formatting);
      const node = document.createElement('template'); node.innerHTML = html;
      entry = { node, size: html.length }; cacheSize += entry.size;
    }
    cache.set(i, entry);
    while (cache.size > 12 || (cacheSize > 4 * 1024 * 1024 && cache.size > 1)) {
      const oldest = cache.keys().next().value; cacheSize -= cache.get(oldest).size; cache.delete(oldest);
    }
    return entry.node.content;
  }
  function fitThumbnail(i, node) {
    if (!node.offsetWidth || !node.offsetHeight) return;
    const preview = buttons[i].firstElementChild;
    preview.style.aspectRatio = `${node.offsetWidth} / ${node.offsetHeight}`;
    node.style.transform = `scale(${preview.clientWidth / node.offsetWidth})`;
  }
  function anchor() {
    const top = viewport.scrollTop;
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= top) i++;
    return { i, fraction: (top - starts[i]) / heights[i], top };
  }
  function layout(preserve = true) {
    layoutFrame = 0; if (closed) return;
    const before = starts.length && preserve ? anchor() : null;
    for (const [i, node] of pageNodes) if (node.offsetWidth && node.offsetHeight) {
      sizes[i] = {width:node.offsetWidth,height:node.offsetHeight,paperHeight:node.querySelector('.cg-slide')?.offsetHeight || node.offsetHeight};
    }
    const css = getComputedStyle(stack); padding = parseFloat(css.paddingTop);
    const width = Math.max(...sizes.map(size => size.width)), height = Math.max(...sizes.map(size => size.paperHeight));
    scale = Math.max(.01, Math.min(.9, 960 / width,
      Math.max(1, viewport.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)) / width,
      Math.max(1, viewport.clientHeight - padding - parseFloat(css.paddingBottom)) / height)) * zoom;
    let top = padding;
    pages.forEach((page, i) => {
      starts[i] = top; heights[i] = sizes[i].height * scale;
      page.style.width = sizes[i].width * scale + 'px'; page.style.height = heights[i] + 'px';
      top += heights[i] + parseFloat(css.rowGap);
    });
    for (const node of pageNodes.values()) node.style.transform = `scale(${scale})`;
    for (const [i, node] of thumbNodes) fitThumbnail(i, node);
    if (before) viewport.scrollTop = before.top === 0 ? 0 : starts[before.i] + before.fraction * heights[before.i];
    scheduleScroll();
  }
  function scheduleLayout() { if (!closed && !layoutFrame) layoutFrame = requestAnimationFrame(() => layout()); }
  const resize = new ResizeObserver(scheduleLayout); resize.observe(viewport); resize.observe(rail);
  function mount(i) {
    if (pageNodes.has(i)) return;
    const node = document.createElement('div'); node.className = 'cg-slide-content';
    node.append(template(i).cloneNode(true)); node.style.transform = `scale(${scale})`;
    pages[i].append(node); pageNodes.set(i, node); resize.observe(node);
  }
  function markCurrent(i) {
    if (i === selected) return;
    if (selected >= 0) { buttons[selected].removeAttribute('aria-current'); buttons[selected].tabIndex = -1; }
    selected = i; buttons[i].setAttribute('aria-current', 'page'); buttons[i].tabIndex = 0;
    const button = buttons[i], top = button.offsetTop, bottom = top + button.offsetHeight;
    if (top < rail.scrollTop) rail.scrollTop = top;
    else if (bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = bottom - rail.clientHeight;
    onSelect(i);
  }
  function updateScroll() {
    scrollFrame = 0; if (closed || document.hidden) return;
    const top = viewport.scrollTop, height = viewport.clientHeight, bottom = top + height, middle = (top + bottom) / 2;
    let current = selected < 0 ? 0 : selected, largest = 0;
    nearbyPages = [];
    for (let i = 0; i < pages.length; i++) {
      const end = starts[i] + heights[i], overlap = Math.min(bottom, end) - Math.max(top, starts[i]);
      if (overlap > largest + .5) { largest = overlap; current = i; }
      if (end >= top - height && starts[i] <= bottom + height) nearbyPages.push(i);
    }
    nearbyPages.sort((a, b) => Math.abs(starts[a] + heights[a] / 2 - middle) - Math.abs(starts[b] + heights[b] / 2 - middle));
    nearbyPages = nearbyPages.slice(0, 12);
    for (const [i, node] of pageNodes) if (!nearbyPages.includes(i) && !node.contains(document.activeElement)) {
      resize.unobserve(node); node.remove(); pageNodes.delete(i);
    }
    markCurrent(current); schedulePaint();
  }
  function scheduleScroll() { if (!closed && !scrollFrame && !document.hidden) scrollFrame = requestAnimationFrame(updateScroll); }
  function paint() {
    paintFrame = 0; if (closed || document.hidden) return;
    const next = nearbyPages.find(i => !pageNodes.has(i));
    if (next !== undefined) {
      try { mount(next); } catch { nearbyPages = nearbyPages.filter(i => i !== next); onError(); }
      schedulePaint(); return;
    }
    const middle = rail.getBoundingClientRect().top + rail.clientHeight / 2;
    const near = [...visibleThumbs].sort((a, b) => Math.abs(buttons[a].getBoundingClientRect().top - middle) - Math.abs(buttons[b].getBoundingClientRect().top - middle)).slice(0, 12);
    for (const i of thumbNodes.keys()) if (!near.includes(i)) { buttons[i].firstElementChild.replaceChildren(); thumbNodes.delete(i); }
    const i = near.find(value => !thumbNodes.has(value)); if (i === undefined) return;
    try {
      const node = template(i).querySelector('.cg-slide')?.cloneNode(true);
      if (node) {
        node.classList.add('cg-slide-miniature-content'); buttons[i].firstElementChild.append(node);
        thumbNodes.set(i, node); fitThumbnail(i, node);
      } else visibleThumbs.delete(i);
    } catch { visibleThumbs.delete(i); onError(); }
    schedulePaint();
  }
  function schedulePaint() { if (!closed && !paintFrame && !document.hidden) paintFrame = requestAnimationFrame(paint); }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const i = Number(entry.target.dataset.index);
      if (entry.isIntersecting) visibleThumbs.add(i); else visibleThumbs.delete(i);
    }
    schedulePaint();
  }, {root:rail,rootMargin:'120px 0px'});
  buttons.forEach(button => observer.observe(button));
  function select(i) {
    if (closed || !Number.isInteger(i) || i < 0 || i >= parts.length) return;
    try {
      mount(i); layout(); viewport.scrollTop = Math.max(0, starts[i] - padding);
      markCurrent(i); scheduleScroll();
    } catch { onError(); }
  }
  rail.addEventListener('click', event => {
    const button = event.target.closest('.cg-slide-thumbnail'); if (button) select(Number(button.dataset.index));
  }, {signal});
  rail.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = {ArrowDown:selected + 1,ArrowRight:selected + 1,ArrowUp:selected - 1,ArrowLeft:selected - 1,Home:0,End:parts.length - 1}[event.key];
    if (next === undefined) return;
    event.preventDefault(); select(Math.max(0, Math.min(parts.length - 1, next))); buttons[selected].focus({preventScroll:true});
  }, {signal});
  viewport.addEventListener('scroll', scheduleScroll, {passive:true,signal});
  document.addEventListener('visibilitychange', () => { scheduleScroll(); schedulePaint(); }, {signal});
  layout(false); select(Math.max(0, Math.min(parts.length - 1, index)));
  return {
    select,
    setZoom(value) { if (Number.isFinite(value)) { zoom = Math.max(.5, Math.min(2, value)); scheduleLayout(); } },
    destroy() {
      closed = true; controller.abort(); observer.disconnect(); resize.disconnect();
      cancelAnimationFrame(layoutFrame); cancelAnimationFrame(scrollFrame); cancelAnimationFrame(paintFrame);
      cache.clear(); pageNodes.clear(); thumbNodes.clear(); visibleThumbs.clear();
      document.body.classList.remove('cg-slides');
    }
  };
}
