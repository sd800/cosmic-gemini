(() => {
  const KEY = Symbol.for('cosmic-gemini.white-cap-layer');
  if (globalThis[KEY]) return;
  // Neutral display primitive. Each caller owns its host, styles and lifecycle.
  class WhiteCapLayer {
    constructor(attribute) {
      this.attribute = attribute;
      this.host = null;
      this.rootObserver = null;
      this.observedRoot = null;
      this.pendingTone = null;
      this.pendingPromotion = null;
      this.beforeToggleTargets = new WeakSet();
      this.mount = this.mount.bind(this);
      this.onBeforeToggle = this.onBeforeToggle.bind(this);
      this.onToggle = this.onToggle.bind(this);
      this.onDocumentReady = this.onDocumentReady.bind(this);
      this.promote = this.promote.bind(this);
    }
    enable(tone = 'warm') {
      // Inserting SVG while raw XML is parsing suppresses Chrome's native XML
      // viewer. Wait for that viewer (or an authored XHTML view) to exist first.
      if (document.contentType !== 'text/html') {
        if (document.readyState !== 'complete') {
          this.pendingTone = tone;
          document.addEventListener('readystatechange', this.onDocumentReady);
          return;
        }
        if (!this.hasHtmlSurface()) return;
      }
      this.pendingTone = null;
      document.removeEventListener('readystatechange', this.onDocumentReady);
      if (!this.host) {
        // createElement() produces an unstyled generic Element in XML documents.
        const host = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        for (const [name, value] of [[this.attribute, ''], ['data-cg-white-cap', ''],
          ['popover', 'manual'], ['aria-hidden', 'true'], ['inert', ''], ['hidden', '']]) {
          host.setAttribute(name, value);
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
        filter.append(transfer); svg.append(filter); host.append(svg);
        host.style.setProperty('--cg-white-cap-filter', `url("#${id}")`, 'important');
        this.host = host;
      }
      const selected = globalThis[Symbol.for('cosmic-gemini.white-tones')].get(tone);
      if (this.host.getAttribute('data-tone') !== selected.id) {
        this.host.setAttribute('data-tone', selected.id);
        selected.rgb.split(' ').map(Number).forEach((cap, index) => {
          // A hard cap turns distinct near-white surfaces and borders into the
          // same color. Compress only the bright shoulder, with a continuous,
          // monotone curve that reaches the selected tone at pure white.
          const shoulder = Math.max(0, cap - 32);
          const span = 255 - shoulder;
          this.channels[index].setAttribute('tableValues', Array.from({length:256}, (_, value) => {
            if (value <= shoulder) return (value + .01) / 255;
            const progress = (value - shoulder) / span;
            const smooth = progress * progress * (3 - 2 * progress);
            // The sub-code-value epsilon avoids Skia rounding one level low.
            return (value - (255 - cap) * smooth + .01) / 255;
          }).join(' '));
        });
      }
      this.mount();
    }
    hasHtmlSurface() {
      const root = document.documentElement;
      return root?.namespaceURI === 'http://www.w3.org/1999/xhtml' && root.localName === 'html';
    }
    onDocumentReady() {
      if (document.readyState !== 'complete') return;
      document.removeEventListener('readystatechange', this.onDocumentReady);
      const tone = this.pendingTone;
      this.pendingTone = null;
      if (tone !== null) this.enable(tone);
    }
    mount() {
      if (!this.host) return;
      if (document.contentType !== 'text/html' && !this.hasHtmlSurface()) return;
      // document.open() clears Document listeners; root mutation remounts and
      // reattaches these same bound handlers without creating duplicates.
      document.addEventListener('fullscreenchange', this.promote, true);
      document.addEventListener('beforetoggle', this.onBeforeToggle, true);
      document.addEventListener('toggle', this.onToggle, true);
      // Observe the document and direct HTML shell only, never the content tree.
      // Repair root/shell replacement or removal of the owned surface.
      if (!this.rootObserver) {
        this.rootObserver = new MutationObserver(this.mount);
        this.rootObserver.observe(document, { childList: true });
      }
      const target = document.documentElement;
      if (target !== this.observedRoot) {
        this.rootObserver.disconnect();
        this.rootObserver.observe(document, { childList: true });
        if (target) this.rootObserver.observe(target, { childList: true });
        this.observedRoot = target;
      }
      if (!target) return;
      // Children of fullscreen img/video/canvas/iframe elements are not rendered.
      // Keep the surface on HTML and raise it above the fullscreen top layer.
      if (this.host.parentNode !== target) target.append(this.host);
      // Top-layer filtering caps final pixels, including white text and child frames,
      // without changing layout, taking focus or tinting already dark pixels.
      if (!this.host.matches(':popover-open')) {
        try { this.host.showPopover(); }
        catch {
          if (document.readyState !== 'complete') document.addEventListener('readystatechange', this.mount, { once: true });
        }
      }
    }
    isOpenTopLayer(target) {
      try { return target?.matches(':popover-open, :modal') === true; }
      catch { return false; }
    }
    onBeforeToggle(event) {
      const target = event.target;
      if (!this.host || event.newState !== 'open' || target?.hasAttribute?.('data-cg-white-cap')) return;
      // Details and non-modal disclosure widgets also emit toggle events. They
      // are ordinary page content and must never rebuild the composited cap.
      try { if (!target?.matches('[popover], dialog')) return; }
      catch { return; }
      this.beforeToggleTargets.add(target);
      if (this.pendingPromotion?.host === this.host) {
        this.pendingPromotion.alreadyOpen ||= this.isOpenTopLayer(this.pendingPromotion.target);
        this.pendingPromotion.target = target;
        return;
      }
      const pending = { host: this.host, target, alreadyOpen: false };
      this.pendingPromotion = pending;
      // beforetoggle runs before the target enters the top layer. Raise our
      // existing surface after showPopover/showModal returns, but before paint;
      // the later toggle task can otherwise expose an unfiltered white frame.
      queueMicrotask(() => {
        if (this.pendingPromotion !== pending) return;
        this.pendingPromotion = null;
        if (this.host === pending.host && (pending.alreadyOpen || this.isOpenTopLayer(pending.target))) this.promote();
      });
    }
    onToggle(event) {
      const target = event.target;
      if (!this.host || target?.hasAttribute?.('data-cg-white-cap')) return;
      const handledBeforePaint = this.beforeToggleTargets.delete(target);
      if (event.newState !== 'open' || handledBeforePaint || !this.isOpenTopLayer(target)) return;
      // Fallback for engines that do not send beforetoggle for native dialogs.
      // Independent caps must not repeatedly raise one another through events.
      this.promote();
    }
    promote() {
      if (!this.host) return;
      if (this.host.matches(':popover-open')) this.host.hidePopover();
      this.mount();
    }
    disable() {
      this.pendingTone = null;
      this.pendingPromotion = null;
      this.beforeToggleTargets = new WeakSet();
      document.removeEventListener('readystatechange', this.onDocumentReady);
      document.removeEventListener('readystatechange', this.mount);
      this.rootObserver?.disconnect();
      this.rootObserver = null;
      this.observedRoot = null;
      document.removeEventListener('fullscreenchange', this.promote, true);
      document.removeEventListener('beforetoggle', this.onBeforeToggle, true);
      document.removeEventListener('toggle', this.onToggle, true);
      this.host?.remove();
      this.host = null;
      this.channels = null;
    }
  }
  Object.defineProperty(globalThis, KEY, { value: WhiteCapLayer });
})();
