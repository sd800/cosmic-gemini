(() => {
  const KEY = Symbol.for('cosmic-gemini.white-cap-layer');
  if (globalThis[KEY]) return;
  // Neutral display primitive. Each caller owns its host, styles and lifecycle.
  class WhiteCapLayer {
    constructor(attribute) {
      this.attribute = attribute;
      this.host = null;
      this.mount = this.mount.bind(this);
      this.onToggle = this.onToggle.bind(this);
    }
    enable(tone = 'warm') {
      if (!this.host) {
        this.host = document.createElement('div');
        for (const [name, value] of [[this.attribute, ''], ['data-cg-white-cap', ''],
          ['popover', 'manual'], ['aria-hidden', 'true'], ['inert', ''], ['hidden', '']]) {
          this.host.setAttribute(name, value);
        }
        document.addEventListener('fullscreenchange', this.mount, true);
        document.addEventListener('toggle', this.onToggle, true);
      }
      const selected = globalThis[Symbol.for('cosmic-gemini.white-tones')].get(tone);
      if (this.host.getAttribute('data-tone') !== selected.id) {
        this.host.setAttribute('data-tone', selected.id);
        this.host.style.setProperty('--cg-white-cap-color', `rgb(${selected.rgb})`, 'important');
      }
      this.mount();
    }
    mount() {
      if (!this.host) return;
      const target = document.fullscreenElement || document.documentElement;
      if (!target) {
        document.addEventListener('readystatechange', this.mount, { once: true });
        return;
      }
      if (this.host.parentNode !== target) target.append(this.host);
      // Top-layer blending caps final pixels, including white text and child frames,
      // without changing layout, taking focus or tinting already dark pixels.
      if (!this.host.matches(':popover-open')) this.host.showPopover();
    }
    onToggle(event) {
      if (!this.host || event.newState !== 'open' || event.target?.hasAttribute('data-cg-white-cap')) return;
      // Independent caps must not repeatedly raise one another through toggle events.
      if (this.host.matches(':popover-open')) this.host.hidePopover();
      this.mount();
    }
    disable() {
      document.removeEventListener('readystatechange', this.mount);
      document.removeEventListener('fullscreenchange', this.mount, true);
      document.removeEventListener('toggle', this.onToggle, true);
      this.host?.remove();
      this.host = null;
    }
  }
  Object.defineProperty(globalThis, KEY, { value: WhiteCapLayer });
})();
