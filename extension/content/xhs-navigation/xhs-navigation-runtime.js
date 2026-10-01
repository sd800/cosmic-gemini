(() => {
  const CONFIGURE = 'cosmic-gemini:xhs-navigation:configure';
  const DISPOSE = 'cosmic-gemini:xhs-navigation:dispose';
  const READY = 'cosmic-gemini:xhs-navigation:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:xhs-navigation:main-ready';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.xhs-navigation.runtime');
  if (globalThis[RUNTIME_KEY]) { globalThis[RUNTIME_KEY].announce(); return; }
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

  const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
  const ARROWS = Object.freeze({
    up: Object.freeze({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }),
    down: Object.freeze({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }),
    left: Object.freeze({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }),
    right: Object.freeze({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 })
  });

  function visible(element) {
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
    try {
      if (typeof element.checkVisibility === 'function'
        && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } catch {}
    const rect = element.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth;
  }

  function scrollable(element, axis) {
    if (!element || element === document.documentElement || element === document.body) return false;
    const style = getComputedStyle(element);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    if (!/(?:auto|scroll|overlay)/.test(overflow)) return false;
    return axis === 'x'
      ? element.scrollWidth > element.clientWidth + 2
      : element.scrollHeight > element.clientHeight + 2;
  }

  class XhsKeyboardNavigationRuntime {
    constructor() {
      this.token = token;
      this.enabled = false;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
      window.addEventListener(READY, this.onBridgeReady, true);
    }

    announce() { window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token })); }
    onBridgeReady() { this.announce(); }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (typeof message?.token !== 'string' || !message.token) return;
      if (message.token !== this.token) return;
      const enabled = message.config?.active === true
        && location.hostname === 'www.xiaohongshu.com';
      if (enabled === this.enabled) return;
      this.enabled = enabled;
      if (enabled) document.addEventListener('keydown', this.onKeyDown, true);
      else document.removeEventListener('keydown', this.onKeyDown, true);
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.destroy();
    }

    destroy() {
      this.enabled = false;
      document.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      try { delete globalThis[RUNTIME_KEY]; } catch {}
    }

    keyDirection(event) {
      const code = String(event.code || '');
      if (code === 'KeyW') return 'up';
      if (code === 'KeyS') return 'down';
      if (code === 'KeyA') return 'left';
      if (code === 'KeyD') return 'right';
      const key = String(event.key || '').toLowerCase();
      return ({ w: 'up', s: 'down', a: 'left', d: 'right' })[key] || '';
    }

    editing(event) {
      return (event.composedPath?.() || [event.target]).some(node =>
        node?.isContentEditable || node?.matches?.(EDITABLE_SELECTOR));
    }

    scope() {
      const candidates = [...document.querySelectorAll?.(
        '#noteContainer, .note-container, [role="dialog"], [class*="preview" i][class*="modal" i]'
      ) || []];
      return candidates.reverse().find(visible) || document;
    }

    scrollTarget(axis, direction) {
      const delta = direction === 'up' || direction === 'left' ? -1 : 1;
      const canMove = element => axis === 'x'
        ? delta < 0 ? element.scrollLeft > 1 : element.scrollLeft + element.clientWidth < element.scrollWidth - 1
        : delta < 0 ? element.scrollTop > 1 : element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      let current = document.activeElement;
      while (current && current !== document.body) {
        if (scrollable(current, axis) && canMove(current)) return current;
        current = current.parentElement;
      }
      const scope = this.scope();
      const candidates = scope === document ? [] : [...scope.querySelectorAll?.(
        '.note-scroller, .interaction-container, [class*="scroll" i], [style*="overflow"]'
      ) || []];
      return candidates.filter(element => visible(element) && scrollable(element, axis) && canMove(element))
        .sort((left, right) => {
          const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
          return b.width * b.height - a.width * a.height;
        })[0] || null;
    }

    defaultArrowAction(direction) {
      const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
      const target = this.scrollTarget(axis, direction);
      const amount = 40 * (direction === 'up' || direction === 'left' ? -1 : 1);
      if (target) {
        target.scrollBy(axis === 'x'
          ? { left: amount, behavior: 'smooth' }
          : { top: amount, behavior: 'smooth' });
        return true;
      }
      const root = document.scrollingElement || document.documentElement;
      const before = axis === 'x'
        ? Number(root?.scrollLeft) || Number(window.scrollX) || 0
        : Number(root?.scrollTop) || Number(window.scrollY) || 0;
      const maximum = axis === 'x'
        ? Math.max(0, (Number(root?.scrollWidth) || 0) - (Number(root?.clientWidth) || innerWidth))
        : Math.max(0, (Number(root?.scrollHeight) || 0) - (Number(root?.clientHeight) || innerHeight));
      if ((amount < 0 && before <= 0) || (amount > 0 && before >= maximum)) return false;
      window.scrollBy(axis === 'x'
        ? { left: amount, behavior: 'smooth' }
        : { top: amount, behavior: 'smooth' });
      return true;
    }

    dispatchArrow(direction, sourceEvent) {
      const arrow = ARROWS[direction];
      const target = sourceEvent.target?.dispatchEvent
        ? sourceEvent.target : document.activeElement?.dispatchEvent ? document.activeElement : document;
      const translated = new KeyboardEvent('keydown', {
        key: arrow.key,
        code: arrow.code,
        keyCode: arrow.keyCode,
        which: arrow.keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        repeat: sourceEvent.repeat === true
      });
      // Chromium ignores legacy numeric fields in the constructor, while
      // some older site handlers still read them.
      try {
        Object.defineProperties(translated, {
          keyCode: { configurable: true, get: () => arrow.keyCode },
          which: { configurable: true, get: () => arrow.keyCode }
        });
      } catch {}
      const accepted = target.dispatchEvent(translated);
      if (accepted && !translated.defaultPrevented) this.defaultArrowAction(direction);
    }

    onKeyDown(event) {
      if (!this.enabled || event.defaultPrevented || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || this.editing(event)) return;
      const direction = this.keyDirection(event);
      if (!direction) return;
      // The site's ArrowUp/ArrowDown handlers may scroll instantly. W/S own
      // vertical scrolling so the same short movement remains smooth.
      if (direction === 'up' || direction === 'down') this.defaultArrowAction(direction);
      else this.dispatchArrow(direction, event);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  const runtime = new XhsKeyboardNavigationRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
