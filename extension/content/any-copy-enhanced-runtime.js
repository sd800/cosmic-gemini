(() => {
  const READY = 'cosmic-gemini:any-copy-enhanced:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:any-copy-enhanced:main-ready';
  const CONFIGURE = 'cosmic-gemini:any-copy-enhanced:configure';
  const DISPOSE = 'cosmic-gemini:any-copy-enhanced:dispose';
  const INTERVENED = 'cosmic-gemini:any-copy-enhanced:intervened';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.any-copy-enhanced.runtime');
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

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  if (window[RUNTIME_KEY]) {
    window[RUNTIME_KEY].announce();
    return;
  }

  class AnyCopyEnhancedRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.reported = false;
      this.readerHost = null;
      this.readerObserver = null;
      this.waitObserver = null;
      this.originalOverflow = null;
      this.onConfigure = this.onConfigure.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onDispose = this.onDispose.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
    }

    announce() {
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }

    onBridgeReady() {
      this.announce();
      if (this.reported) window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.active = false;
      this.hideReader();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      try { delete window[RUNTIME_KEY]; } catch {}
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      this.active = message.config?.active === true;
      if (window !== top) return;
      if (this.active) this.showReader();
      else this.hideReader();
    }

    isNoise(element) {
      if (!(element instanceof Element)) return false;
      if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
      return NOISE.test(`${element.id || ''} ${element.className || ''}`);
    }

    absoluteUrl(value) {
      try { return new URL(value, document.baseURI).href; } catch { return ''; }
    }

    copyText(node, target) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          target.append(document.createTextNode(child.nodeValue || ''));
          continue;
        }
        if (!(child instanceof Element)) continue;
        const tag = child.localName;
        if (SKIP.has(tag) || this.isNoise(child)) continue;
        if (!ALLOWED.has(tag)) {
          this.copyText(child, target);
          continue;
        }
        const clone = document.createElement(tag);
        if (tag === 'a') {
          const href = this.absoluteUrl(child.getAttribute('href') || '');
          if (href) clone.setAttribute('href', href);
        } else if (tag === 'img') {
          const source = child.currentSrc || child.getAttribute('src') || child.getAttribute('data-src') ||
            child.getAttribute('data-original') || child.getAttribute('data-lazy-src') || '';
          const src = this.absoluteUrl(source);
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
        this.copyText(child, clone);
        if (tag === 'img' || clone.textContent?.trim() || clone.querySelector('img,hr,br')) target.append(clone);
      }
    }

    contentRoot() {
      const candidates = [...document.querySelectorAll('article,main,[role="main"]')]
        .filter(element => !this.isNoise(element));
      candidates.push(document.body || document.documentElement);
      return candidates.reduce((best, candidate) => {
        const length = candidate?.innerText?.trim().length || 0;
        const bestLength = best?.innerText?.trim().length || 0;
        return length > bestLength ? candidate : best;
      }, candidates[0]);
    }

    onReaderCopy(event) {
      const text = window.getSelection()?.toString() || '';
      if (!text || !event.clipboardData) return;
      event.stopPropagation();
      event.preventDefault();
      event.clipboardData.setData('text/plain', text);
    }

    waitForContent() {
      if (this.waitObserver || !document.documentElement) return;
      this.waitObserver = new MutationObserver(() => {
        if (!this.active) return;
        const source = this.contentRoot();
        if (!source || (!source.innerText?.trim() && !source.querySelector?.('img'))) return;
        this.waitObserver.disconnect();
        this.waitObserver = null;
        this.showReader();
      });
      this.waitObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    showReader() {
      if (!this.active || window !== top || this.readerHost?.isConnected || !document.documentElement) return;
      const source = this.contentRoot();
      if (!source || (!source.innerText?.trim() && !source.querySelector?.('img'))) {
        this.waitForContent();
        return;
      }
      this.waitObserver?.disconnect();
      this.waitObserver = null;
      const host = document.createElement('div');
      host.setAttribute('data-cosmic-gemini-any-copy-enhanced', '');
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host{all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;overflow:auto!important;color-scheme:light dark;background:#f7f8fa;font-family:ui-serif,Georgia,Cambria,"Times New Roman",serif;letter-spacing:normal;user-select:text!important}
        *{box-sizing:border-box;user-select:text!important}article{width:min(780px,calc(100% - 40px));min-height:100%;margin:0 auto;padding:54px 0 80px;color:#202124;font:17px/1.72 ui-serif,Georgia,Cambria,"Times New Roman",serif}
        h1,h2,h3,h4,h5,h6{margin:1.5em 0 .55em;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.25;color:#17191c}h1{margin-top:0;font-size:2.1em}h2{font-size:1.55em}h3{font-size:1.25em}
        p,blockquote,pre,figure,table,ul,ol,dl{margin:0 0 1.15em}a{color:#0b57d0;text-decoration-thickness:1px;text-underline-offset:2px}img{display:block;max-width:100%;height:auto;margin:1.2em auto;border-radius:8px;position:relative!important;z-index:0!important}
        figure{margin-inline:0}figcaption{margin-top:-.65em;color:#5f6368;font:13px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center}blockquote{margin-left:0;padding-left:1.1em;border-left:3px solid #aab4c3;color:#4d5156}
        pre{overflow:auto;padding:16px;border-radius:10px;background:#eef1f5;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}table{display:block;width:100%;overflow:auto;border-collapse:collapse}
        th,td{padding:8px 10px;border:1px solid #d8dde4;text-align:left;vertical-align:top}hr{border:0;border-top:1px solid #d8dde4;margin:2em 0}
        @media(prefers-color-scheme:dark){:host{background:#191a1c}article{color:#e8eaed}h1,h2,h3,h4,h5,h6{color:#f1f3f4}a{color:#8ab4f8}figcaption,blockquote{color:#bdc1c6}pre{background:#25272b}th,td{border-color:#3c4043}hr{border-color:#3c4043}}
        @media(max-width:600px){article{width:min(100% - 28px,780px);padding-top:30px;font-size:16px}}
      `;
      const article = document.createElement('article');
      if (!source.querySelector?.('h1') && document.title) {
        const heading = document.createElement('h1');
        heading.textContent = document.title;
        article.append(heading);
      }
      this.copyText(source, article);
      if (!article.textContent?.trim() && !article.querySelector('img')) {
        this.waitForContent();
        return;
      }
      article.addEventListener('copy', event => this.onReaderCopy(event), true);
      shadow.append(style, article);
      this.readerHost = host;
      this.originalOverflow = document.documentElement.style.getPropertyValue('overflow');
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      document.documentElement.append(host);
      this.readerObserver = new MutationObserver(() => {
        if (this.active && this.readerHost && !this.readerHost.isConnected) document.documentElement.append(this.readerHost);
      });
      this.readerObserver.observe(document.documentElement, { childList: true });
      this.reportIntervention();
    }

    hideReader() {
      this.waitObserver?.disconnect();
      this.waitObserver = null;
      this.readerObserver?.disconnect();
      this.readerObserver = null;
      this.readerHost?.remove();
      this.readerHost = null;
      if (this.originalOverflow !== null) {
        if (this.originalOverflow) document.documentElement.style.setProperty('overflow', this.originalOverflow);
        else document.documentElement.style.removeProperty('overflow');
      }
      this.originalOverflow = null;
      this.reported = false;
    }

    reportIntervention() {
      if (this.reported) return;
      this.reported = true;
      window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }
  }

  const runtime = new AnyCopyEnhancedRuntime();
  Object.defineProperty(window, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
