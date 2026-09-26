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
        // Filter existing pixels, rather than paint an opaque blend layer. A
        // fixed blend surface exposes its light fill over Chrome's elastic
        // overscroll area, where the page backdrop is temporarily absent.
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg'), filter = document.createElementNS(ns, 'filter');
        const transfer = document.createElementNS(ns, 'feComponentTransfer');
        const id = 'cg-white-cap-' + Math.random().toString(36).slice(2);
        svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
        svg.style.setProperty('display', 'block', 'important');
        svg.style.setProperty('width', '0', 'important'); svg.style.setProperty('height', '0', 'important');
        filter.id = id; filter.setAttribute('color-interpolation-filters', 'sRGB');
        filter.style.setProperty('color-interpolation-filters', 'sRGB', 'important');
        this.channels = ['R', 'G', 'B'].map(channel => {
          const fn = document.createElementNS(ns, 'feFunc' + channel);
          fn.setAttribute('type', 'table'); transfer.append(fn); return fn;
        });
        filter.append(transfer); svg.append(filter); this.host.append(svg);
        this.host.style.setProperty('--cg-white-cap-filter', `url("#${id}")`, 'important');
        document.addEventListener('fullscreenchange', this.mount, true);
        document.addEventListener('toggle', this.onToggle, true);
      }
      const selected = globalThis[Symbol.for('cosmic-gemini.white-tones')].get(tone);
      if (this.host.getAttribute('data-tone') !== selected.id) {
        this.host.setAttribute('data-tone', selected.id);
        selected.rgb.split(' ').map(Number).forEach((cap, index) => {
          // One small sRGB lookup table, exact at all 8-bit input levels. The
          // sub-code-value epsilon avoids floating-point truncation by Skia.
          this.channels[index].setAttribute('tableValues', Array.from({length:256}, (_,value) =>
            (Math.min(value, cap) + .01) / 255).join(' '));
        });
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
      // Top-layer filtering caps final pixels, including white text and child frames,
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
      this.channels = null;
    }
  }
  Object.defineProperty(globalThis, KEY, { value: WhiteCapLayer });
})();
