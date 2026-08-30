(() => {
  const READY = 'cosmic-gemini:any-copy:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:any-copy:main-ready';
  const CONFIGURE = 'cosmic-gemini:any-copy:configure';
  const INTERVENED = 'cosmic-gemini:any-copy:intervened';
  const ALLOWED = new Set([
    'article', 'main', 'section', 'div', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i',
    'u', 's', 'mark', 'small', 'sub', 'sup', 'br', 'hr', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'details', 'summary'
  ]);
  const SKIP = new Set([
    'script', 'style', 'link', 'noscript', 'template', 'iframe', 'object', 'embed', 'video',
    'audio', 'canvas', 'svg', 'form', 'input', 'textarea', 'select', 'button', 'dialog', 'nav', 'aside'
  ]);
  const NOISE = /(?:^|[\s_-])(ad|ads|advert|advertisement|banner|cookie|consent|modal|overlay|popup|promo|share|social|subscribe|toolbar)(?:$|[\s_-])/i;

  let token = '';
  let currentState = null;
  let readerHost = null;
  let readerObserver = null;
  let originalOverflow = null;

  function dispatchConfig(config) {
    if (!token) return;
    window.dispatchEvent(new CustomEvent(CONFIGURE, {
      detail: JSON.stringify({ token, config })
    }));
  }

  function reportIntervention() {
    void chrome.runtime.sendMessage({ type: 'CG_FEATURE_INTERVENED', featureId: 'anyCopy' }).catch(() => {});
  }

  function isNoise(element) {
    if (!(element instanceof Element)) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
    const marker = `${element.id || ''} ${element.className || ''}`;
    return NOISE.test(marker);
  }

  function absoluteUrl(value) {
    try { return new URL(value, document.baseURI).href; } catch { return ''; }
  }

  function copyText(node, target) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(child.nodeValue || ''));
        continue;
      }
      if (!(child instanceof Element)) continue;
      const tag = child.localName;
      if (SKIP.has(tag) || isNoise(child)) continue;
      if (!ALLOWED.has(tag)) {
        copyText(child, target);
        continue;
      }
      const clone = document.createElement(tag);
      if (tag === 'a') {
        const href = absoluteUrl(child.getAttribute('href') || '');
        if (href) clone.setAttribute('href', href);
      } else if (tag === 'img') {
        const source = child.currentSrc || child.getAttribute('src') || child.getAttribute('data-src') ||
          child.getAttribute('data-original') || child.getAttribute('data-lazy-src') || '';
        const src = absoluteUrl(source);
        if (!src) continue;
        clone.setAttribute('src', src);
        if (child.getAttribute('alt')) clone.setAttribute('alt', child.getAttribute('alt'));
        clone.setAttribute('loading', 'lazy');
      } else if (tag === 'th' || tag === 'td') {
        for (const name of ['colspan', 'rowspan']) {
          const value = child.getAttribute(name);
          if (value && /^\d+$/.test(value)) clone.setAttribute(name, value);
        }
      }
      copyText(child, clone);
      if (tag === 'img' || clone.textContent?.trim() || clone.querySelector('img,hr,br')) target.append(clone);
    }
  }

  function contentRoot() {
    const candidates = [...document.querySelectorAll('article,main,[role="main"]')]
      .filter(element => !isNoise(element));
    candidates.push(document.body || document.documentElement);
    return candidates.reduce((best, candidate) => {
      const length = candidate?.innerText?.trim().length || 0;
      const bestLength = best?.innerText?.trim().length || 0;
      return length > bestLength ? candidate : best;
    }, candidates[0]);
  }

  function readerCopy(event) {
    const selection = window.getSelection();
    const text = selection?.toString() || '';
    if (!text || !event.clipboardData) return;
    event.stopPropagation();
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
  }

  function showReader() {
    if (window !== top || readerHost?.isConnected || !document.documentElement) return;
    const source = contentRoot();
    if (!source) return;
    readerHost = document.createElement('div');
    readerHost.setAttribute('data-cosmic-gemini-any-copy-reader', '');
    const shadow = readerHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;overflow:auto!important;color-scheme:light dark;background:#f7f8fa;font-family:ui-serif,Georgia,Cambria,"Times New Roman",serif;letter-spacing:normal;user-select:text!important}
      *{box-sizing:border-box;user-select:text!important}
      article{width:min(780px,calc(100% - 40px));min-height:100%;margin:0 auto;padding:54px 0 80px;color:#202124;font:17px/1.72 ui-serif,Georgia,Cambria,"Times New Roman",serif}
      h1,h2,h3,h4,h5,h6{margin:1.5em 0 .55em;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.25;color:#17191c}
      h1{margin-top:0;font-size:2.1em} h2{font-size:1.55em} h3{font-size:1.25em}
      p,blockquote,pre,figure,table,ul,ol,dl{margin:0 0 1.15em} a{color:#0b57d0;text-decoration-thickness:1px;text-underline-offset:2px}
      img{display:block;max-width:100%;height:auto;margin:1.2em auto;border-radius:8px;position:relative!important;z-index:0!important}
      figure{margin-inline:0} figcaption{margin-top:-.65em;color:#5f6368;font:13px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center}
      blockquote{margin-left:0;padding-left:1.1em;border-left:3px solid #aab4c3;color:#4d5156}
      pre{overflow:auto;padding:16px;border-radius:10px;background:#eef1f5;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
      code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace} table{display:block;width:100%;overflow:auto;border-collapse:collapse}
      th,td{padding:8px 10px;border:1px solid #d8dde4;text-align:left;vertical-align:top} hr{border:0;border-top:1px solid #d8dde4;margin:2em 0}
      @media(prefers-color-scheme:dark){:host{background:#191a1c}article{color:#e8eaed}h1,h2,h3,h4,h5,h6{color:#f1f3f4}a{color:#8ab4f8}figcaption,blockquote{color:#bdc1c6}pre{background:#25272b}th,td{border-color:#3c4043}hr{border-color:#3c4043}}
      @media(max-width:600px){article{width:min(100% - 28px,780px);padding-top:30px;font-size:16px}}
    `;
    const article = document.createElement('article');
    const hasHeading = source.querySelector?.('h1');
    if (!hasHeading && document.title) {
      const heading = document.createElement('h1');
      heading.textContent = document.title;
      article.append(heading);
    }
    copyText(source, article);
    if (!article.textContent?.trim() && !article.querySelector('img')) {
      readerHost = null;
      return;
    }
    article.addEventListener('copy', readerCopy, true);
    shadow.append(style, article);
    originalOverflow = document.documentElement.style.getPropertyValue('overflow');
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    document.documentElement.append(readerHost);
    readerObserver = new MutationObserver(() => {
      if (currentState?.active && currentState.mode === 'enhanced' && readerHost && !readerHost.isConnected) {
        document.documentElement.append(readerHost);
      }
    });
    readerObserver.observe(document.documentElement, { childList: true });
    reportIntervention();
  }

  function hideReader() {
    readerObserver?.disconnect();
    readerObserver = null;
    readerHost?.remove();
    readerHost = null;
    if (originalOverflow === null) return;
    if (originalOverflow) document.documentElement.style.setProperty('overflow', originalOverflow);
    else document.documentElement.style.removeProperty('overflow');
    originalOverflow = null;
  }

  function applyState(state) {
    currentState = state;
    dispatchConfig(state);
    if (window === top && state?.active && state.mode === 'enhanced') showReader();
    else if (window === top) hideReader();
    void chrome.runtime.sendMessage({
      type: 'CG_CONFIG_APPLIED', featureId: 'anyCopy', active: state?.active === true
    }).catch(() => {});
  }

  async function requestConfig() {
    if (!token) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE' });
      if (response?.ok) applyState(response.result.anyCopy);
    } catch {}
  }

  window.addEventListener(MAIN_READY, event => {
    if (typeof event.detail !== 'string' || !event.detail) return;
    token = event.detail;
    void requestConfig();
  }, true);
  window.addEventListener(INTERVENED, event => {
    if (token && event.detail === token) reportIntervention();
  }, true);
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'CG_REFRESH_CONFIG') void requestConfig();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, 'cosmicGeminiSettings')) void requestConfig();
  });

  window.dispatchEvent(new CustomEvent(READY));
})();
