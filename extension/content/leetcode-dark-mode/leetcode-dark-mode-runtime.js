(() => {
  const KEY = Symbol.for('cosmic-gemini.leetcode-dark-mode.runtime');
  const PREFIX = 'cosmic-gemini:leetcode-dark-mode:';
  const ATTRIBUTE = 'data-cg-leetcode-dark';
  const palette = globalThis[Symbol.for('cosmic-gemini.white-tones')];
  if (globalThis[KEY]) { globalThis[KEY].announce(); return; }
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  let configured = false, disposed = false, themeObserver = null, headObserver = null, lock = null;
  let observedRoot = null, observedHead = null, localRoot = null, tone = 'warm';
  const layer = window === top ? new (globalThis[Symbol.for('cosmic-gemini.white-cap-layer')])('data-cg-leetcode-white-cap') : null;
  const rootObserver = new MutationObserver(update);
  const documentObserver = new MutationObserver(update);
  documentObserver.observe(document, { childList: true });
  let navigationWindow = window;
  try { if (top.location.origin === location.origin) navigationWindow = top; } catch {}
  const navigation = navigationWindow.navigation;
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
    const ownRoot = document.documentElement;
    if (ownRoot !== localRoot) {
      rootObserver.disconnect(); localRoot = ownRoot;
      if (ownRoot) rootObserver.observe(ownRoot, { attributes: true,
        attributeFilter: [ATTRIBUTE, 'data-cg-leetcode-tone'], childList: true });
    }
    // React may reconcile root attributes or replace a document shell on re-entry.
    // Idempotent writes also let the observer repair markers without a mutation loop.
    if (dark && ownRoot) {
      if (!ownRoot.hasAttribute(ATTRIBUTE)) ownRoot.setAttribute(ATTRIBUTE, '');
      if (ownRoot.getAttribute('data-cg-leetcode-tone') !== tone) ownRoot.setAttribute('data-cg-leetcode-tone', tone);
    } else {
      ownRoot?.removeAttribute(ATTRIBUTE);
      ownRoot?.removeAttribute('data-cg-leetcode-tone');
    }
    const textColor = dark && tone !== 'off' ? `rgb(${palette.get(tone).rgb})` : '';
    if (ownRoot && ownRoot.style.getPropertyValue('--cg-lc-tone-text') !== textColor) {
      if (textColor) ownRoot.style.setProperty('--cg-lc-tone-text', textColor, 'important');
      else ownRoot.style.removeProperty('--cg-lc-tone-text');
    }
    if (dark && tone !== 'off') layer?.enable(tone);
    else layer?.disable();
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
    tone = palette.normalize(message.config?.tone, true);
    update();
  }
  function dispose(event) {
    if (event?.detail !== token) return;
    configured = false; update(); disposed = true;
    themeObserver?.disconnect(); headObserver?.disconnect(); rootObserver.disconnect(); documentObserver.disconnect();
    window.removeEventListener(PREFIX + 'bridge-ready', announce);
    window.removeEventListener(PREFIX + 'configure', configure);
    window.removeEventListener(PREFIX + 'dispose', dispose);
    window.removeEventListener('pageshow', update);
    window.removeEventListener('pagehide', onPageHide);
    navigationWindow.removeEventListener('popstate', update);
    navigation?.removeEventListener('navigatesuccess', update);
    document.removeEventListener('DOMContentLoaded', update);
    delete globalThis[KEY];
  }
  function onPageHide(event) {
    // Child frames register on the top document: release those references when the
    // frame is replaced, but keep a bfcache document ready for its pageshow event.
    if (!event.persisted) dispose({ detail: token });
  }
  window.addEventListener(PREFIX + 'bridge-ready', announce);
  window.addEventListener(PREFIX + 'configure', configure);
  window.addEventListener(PREFIX + 'dispose', dispose);
  window.addEventListener('pageshow', update);
  window.addEventListener('pagehide', onPageHide);
  navigationWindow.addEventListener('popstate', update);
  navigation?.addEventListener('navigatesuccess', update);
  document.addEventListener('DOMContentLoaded', update);
  Object.defineProperty(globalThis, KEY, { value: { announce, token }, configurable: true });
  announce();
})();
