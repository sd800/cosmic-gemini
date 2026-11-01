(() => {
  const KEY = Symbol.for('cosmic-gemini.dark-transition-guard');
  if (globalThis[KEY]) return;
  const now = () => performance.now();
  const rgba = value => {
    const parts = String(value).match(/[\d.]+/g)?.map(Number);
    return parts?.length >= 3 && (parts[3] ?? 1) >= .98 ? parts.slice(0, 3) : null;
  };
  const brightness = rgb => rgb ? (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) : null;
  class DarkTransitionGuard {
    constructor(surface) {
      this.surface = surface; this.active = false; this.root = null; this.dark = false;
      this.frame = 0; this.until = 0; this.maximum = 0; this.mask = '';
      this.sample = this.sample.bind(this);
      this.onLifecycle = this.onLifecycle.bind(this);
    }
    enable() {
      const starting = !this.active;
      this.active = true;
      globalThis.addEventListener('pageshow', this.onLifecycle, true);
      globalThis.addEventListener('load', this.onLifecycle, true);
      globalThis.addEventListener('popstate', this.onLifecycle, true);
      globalThis.navigation?.addEventListener('navigatesuccess', this.onLifecycle);
      document.addEventListener('visibilitychange', this.onLifecycle, true);
      document.addEventListener('readystatechange', this.onLifecycle, true);
      if (this.root !== document.documentElement) this.setRoot(document.documentElement);
      else if (starting) this.arm();
    }
    setRoot(root) {
      if (root === this.root) return;
      this.observer?.disconnect(); this.root = root;
      this.dark = root?.getAttribute('data-darkreader-scheme') === 'dark';
      if (root && this.active) {
        this.observer = new MutationObserver(() => {
          const dark = root.getAttribute('data-darkreader-scheme') === 'dark';
          if (dark !== this.dark) { this.dark = dark; this.arm(); }
        });
        this.observer.observe(root, { attributes: true, attributeFilter: ['data-darkreader-scheme'] });
      }
      if (this.active) this.arm();
    }
    onLifecycle(event) {
      if (event.isTrusted !== true) return;
      if (event.type === 'readystatechange' && document.readyState !== 'complete') return;
      // Resource loads also reach a capturing Window listener. Lazy images
      // must not repeatedly arm whole-page transition checks during scrolling.
      if (event.type === 'load' && event.target !== document && event.target !== globalThis) return;
      this.arm();
    }
    clearMask() {
      if (!this.mask) return;
      this.surface.style.removeProperty('background-color'); this.mask = '';
    }
    stopFrames() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0; this.clearMask();
    }
    arm() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      if (!this.active || !this.dark || document.visibilityState === 'hidden') { this.clearMask(); return; }
      this.until = now() + 350;
      this.maximum = now() + 2000;
      this.sample();
    }
    sample() {
      this.frame = 0;
      if (!this.active || !this.dark || document.visibilityState === 'hidden') { this.clearMask(); return; }
      const rootColor = this.root ? getComputedStyle(this.root).backgroundColor : '';
      const root = rgba(rootColor), body = document.body ? rgba(getComputedStyle(document.body).backgroundColor) : null;
      // Only a confirmed dark root paired with a temporarily bright body may
      // shield the transition. Never infer dark mode from OS preferences.
      const mismatch = root && body && brightness(root) <= 70 && brightness(body) >= 210;
      if (mismatch) {
        if (this.mask !== rootColor) {
          this.surface.style.setProperty('background-color', rootColor, 'important'); this.mask = rootColor;
        }
      } else this.clearMask();
      const time = now();
      if (time < this.until || (document.readyState !== 'complete' && time < this.maximum)) {
        this.frame = requestAnimationFrame(this.sample);
      } else this.clearMask();
    }
    disable() {
      this.active = false; this.stopFrames();
      this.observer?.disconnect(); this.observer = null; this.root = null; this.dark = false;
      globalThis.removeEventListener('pageshow', this.onLifecycle, true);
      globalThis.removeEventListener('load', this.onLifecycle, true);
      globalThis.removeEventListener('popstate', this.onLifecycle, true);
      globalThis.navigation?.removeEventListener('navigatesuccess', this.onLifecycle);
      document.removeEventListener('visibilitychange', this.onLifecycle, true);
      document.removeEventListener('readystatechange', this.onLifecycle, true);
    }
  }
  Object.defineProperty(globalThis, KEY, { value: DarkTransitionGuard });
})();
