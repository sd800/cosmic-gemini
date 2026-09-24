(() => {
  const KEY = Symbol.for('cosmic-gemini.leetcode-dark-mode.runtime');
  const PREFIX = 'cosmic-gemini:leetcode-dark-mode:';
  const ATTRIBUTE = 'data-cg-leetcode-dark';
  if (globalThis[KEY]) { globalThis[KEY].announce(); return; }
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  let configured = false, disposed = false, themeObserver = null, headObserver = null, lock = null;
  let observedRoot = null, observedHead = null;
  const announce = () => window.dispatchEvent(new CustomEvent(PREFIX + 'main-ready', { detail: token }));
  function source() {
    try {
      const url = new URL(top.location.href), frame = new URL(location.href);
      if (url.origin !== 'https://leetcode.com' || !/^\/explore\/[^/]+/.test(url.pathname)
        || frame.origin !== url.origin || !/^\/(?:explore|playground)\/[^/]+/.test(frame.pathname)) return null;
      return top.document.documentElement;
    } catch { return null; }
  }
  function update() {
    if (disposed) return;
    const root = source();
    if (root !== observedRoot) {
      themeObserver?.disconnect(); observedRoot = root;
      if (root) {
        themeObserver = new MutationObserver(update);
        themeObserver.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
      }
    }
    // Do not infer native appearance from system preferences or third-party CSS.
    const scheme = root?.style.colorScheme?.trim();
    const dark = configured && !!root && scheme !== 'light' && !root.classList.contains('light')
      && (scheme === 'dark' || root.classList.contains('dark'));
    if (dark) document.documentElement?.setAttribute(ATTRIBUTE, '');
    else document.documentElement?.removeAttribute(ATTRIBUTE);
    const head = dark ? document.head : null;
    if (head !== observedHead) {
      headObserver?.disconnect(); observedHead = head;
      if (head) {
        headObserver = new MutationObserver(update);
        headObserver.observe(head, { childList: true });
      }
    }
    if (!dark) { lock?.remove(); lock = null; }
    else if (head && !head.querySelector('meta[name="darkreader-lock"]')) {
      lock = document.createElement('meta'); lock.name = 'darkreader-lock'; head.append(lock);
    }
  }
  function configure(event) {
    let message; try { message = JSON.parse(event.detail); } catch { return; }
    if (message?.token !== token) return;
    configured = message.config?.active === true;
    update();
  }
  function dispose(event) {
    if (event?.detail !== token) return;
    configured = false; update(); disposed = true;
    themeObserver?.disconnect(); headObserver?.disconnect();
    window.removeEventListener(PREFIX + 'bridge-ready', announce);
    window.removeEventListener(PREFIX + 'configure', configure);
    window.removeEventListener(PREFIX + 'dispose', dispose);
    window.removeEventListener('pageshow', update);
    window.removeEventListener('popstate', update);
    document.removeEventListener('DOMContentLoaded', update);
    delete globalThis[KEY];
  }
  window.addEventListener(PREFIX + 'bridge-ready', announce);
  window.addEventListener(PREFIX + 'configure', configure);
  window.addEventListener(PREFIX + 'dispose', dispose);
  window.addEventListener('pageshow', update);
  window.addEventListener('popstate', update);
  document.addEventListener('DOMContentLoaded', update);
  Object.defineProperty(globalThis, KEY, { value: { announce, token }, configurable: true });
  announce();
})();
