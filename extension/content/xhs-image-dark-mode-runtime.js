(() => {
  const READY = 'cosmic-gemini:xhs-image-dark-mode:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:xhs-image-dark-mode:main-ready';
  const CONFIGURE = 'cosmic-gemini:xhs-image-dark-mode:configure';
  const STATUS = 'cosmic-gemini:xhs-image-dark-mode:status';
  const DISPOSE = 'cosmic-gemini:xhs-image-dark-mode:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.xhs-image-dark-mode.runtime');
  const MAX_SAMPLE_PIXELS = 32 * 32;
  const COLOR_BUCKETS = 8;
  const CACHE_LIMIT = 240;
  const CONTROL_SIZE = 27;
  const FRACTION_SLOT_WIDTH = 64;
  const CONTROL_GAP = 8;
  const COPY = Object.freeze({
    'en-US': Object.freeze({ showLight: 'Show light image', showDark: 'Show dark image' }),
    'zh-CN': Object.freeze({ showLight: '显示浅色图片', showDark: '显示深色图片' })
  });
  const LIGHT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const DARK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z"/></svg>';

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function parseColor(value) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = part => part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part);
    const alpha = part => part?.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part ?? '1');
    const color = {
      r: clamp(channel(parts[0]), 0, 255),
      g: clamp(channel(parts[1]), 0, 255),
      b: clamp(channel(parts[2]), 0, 255),
      a: clamp(alpha(parts[3]), 0, 1)
    };
    return Object.values(color).every(Number.isFinite) ? color : null;
  }

  function compositeColor(foreground, background) {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (!alpha) return { r: 255, g: 255, b: 255, a: 1 };
    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      a: alpha
    };
  }

  function luminance(color) {
    if (!color) return null;
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  }

  function filterInvertsSurface(value) {
    const filter = String(value || '').toLowerCase();
    if (!filter || filter === 'none') return false;
    if (/url\([^)]*(?:dark-reader-filter|darkreader)[^)]*\)/i.test(filter)) return true;
    const match = filter.match(/invert\(([^)]+)\)/i);
    if (!match) return false;
    const amount = match[1].trim().endsWith('%')
      ? Number.parseFloat(match[1]) / 100
      : Number.parseFloat(match[1]);
    return Number.isFinite(amount) && amount >= 0.5;
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class XhsImageDarkModeRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.processing = false;
      this.darkModeDetected = false;
      this.locale = 'en-US';
      this.overrideDarkMode = false;
      this.showImageControl = true;
      this.controlOpacity = 0.5;
      this.imageBrightness = 1;
      this.openingPostId = '';
      this.records = new Map();
      this.cache = new Map();
      this.queue = [];
      this.queued = new Set();
      this.running = 0;
      this.pumpHandle = 0;
      this.themeTimer = 0;
      this.themeCheckTimers = [];
      this.positionFrame = 0;
      this.cleanupTimer = 0;
      this.style = null;
      this.themeObserver = null;
      this.themeHead = null;
      this.themeRoots = new Set();
      this.themeMedia = null;
      this.pageObserver = null;
      this.viewerObserver = null;
      this.viewerRoot = null;
      this.intersectionObserver = null;
      this.resizeObserver = null;
      this.controlHost = null;
      this.controlLayer = null;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onThemeChange = this.onThemeChange.bind(this);
      this.onPageMutations = this.onPageMutations.bind(this);
      this.onViewerMutations = this.onViewerMutations.bind(this);
      this.onPostActivation = this.onPostActivation.bind(this);
      this.onIntersections = this.onIntersections.bind(this);
      this.onViewportChange = this.onViewportChange.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
      window.addEventListener(READY, this.onBridgeReady, true);
    }

    announce() { window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token })); }
    onBridgeReady() { this.announce(); }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      const config = message.config || {};
      const nextActive = config.active === true && location.hostname === 'www.xiaohongshu.com';
      this.locale = config.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
      this.overrideDarkMode = config.overrideDarkMode === true;
      this.showImageControl = config.showImageControl !== false;
      this.controlOpacity = clamp(config.controlOpacity || 0.5, 0.2, 0.9);
      if (nextActive && !this.active) this.enable();
      else if (!nextActive && this.active) this.disable();
      else if (nextActive) {
        this.updateControls();
        this.evaluateTheme(true);
      }
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      try { delete globalThis[RUNTIME_KEY]; } catch {}
    }

    enable() {
      if (this.active) return;
      this.active = true;
      this.installThemeObserver();
      this.evaluateTheme(true);
      this.scheduleInitialThemeChecks();
    }

    disable() {
      if (!this.active && !this.processing) return;
      this.active = false;
      if (this.themeTimer) clearTimeout(this.themeTimer);
      this.themeTimer = 0;
      this.themeCheckTimers.forEach(clearTimeout);
      this.themeCheckTimers = [];
      this.themeObserver?.disconnect();
      this.themeObserver = null;
      this.themeHead = null;
      this.themeRoots.clear();
      this.themeMedia?.removeEventListener?.('change', this.onThemeChange);
      this.themeMedia = null;
      document.removeEventListener?.('visibilitychange', this.onThemeChange, true);
      window.removeEventListener('pageshow', this.onThemeChange, true);
      window.removeEventListener('load', this.onThemeChange, true);
      this.stopProcessing();
      this.reportStatus();
    }

    installThemeObserver() {
      this.themeObserver?.disconnect();
      this.themeObserver = new MutationObserver(this.onThemeChange);
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-darkreader-mode', 'data-darkreader-scheme'],
        childList: true
      });
      this.observeThemeHead();
      this.observeThemeRoots();
      this.themeMedia = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
      this.themeMedia?.addEventListener?.('change', this.onThemeChange);
      document.addEventListener?.('visibilitychange', this.onThemeChange, true);
      window.addEventListener('pageshow', this.onThemeChange, true);
      window.addEventListener('load', this.onThemeChange, true);
    }

    observeThemeHead() {
      if (!document.head || this.themeHead === document.head) return;
      this.themeObserver?.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'content', 'disabled', 'media', 'name']
      });
      this.themeHead = document.head;
    }

    scheduleInitialThemeChecks() {
      this.themeCheckTimers.forEach(clearTimeout);
      this.themeCheckTimers = [180, 700, 1_800, 4_000].map(delay => {
        const timer = setTimeout(() => {
          this.themeCheckTimers = this.themeCheckTimers.filter(item => item !== timer);
          if (this.active) this.evaluateTheme();
        }, delay);
        return timer;
      });
    }

    observeThemeRoots() {
      const roots = [
        document.body,
        document.querySelector?.('#app'),
        document.querySelector?.('main'),
        document.querySelector?.('[class*="layout"]')
      ].filter(Boolean);
      for (const root of roots) {
        if (this.themeRoots.has(root)) continue;
        this.themeObserver?.observe(root, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-dark-mode']
        });
        this.themeRoots.add(root);
      }
    }

    onThemeChange() {
      if (!this.active || this.themeTimer) return;
      this.observeThemeHead();
      this.observeThemeRoots();
      this.themeTimer = setTimeout(() => {
        this.themeTimer = 0;
        this.evaluateTheme();
      }, 90);
    }

    effectiveBackground(element) {
      const layers = [];
      let current = element;
      while (current) {
        const value = parseColor(getComputedStyle(current).backgroundColor);
        if (value?.a > 0) layers.push(value);
        if (value?.a >= 0.995) break;
        current = current.parentElement;
      }
      if (!layers.length) return null;
      let result = { r: 255, g: 255, b: 255, a: 1 };
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        result = compositeColor(layers[index], result);
      }
      return result;
    }

    pageWideFilterDarkMode() {
      if (typeof getComputedStyle !== 'function') return false;
      const roots = [document.documentElement, document.body].filter(Boolean);
      for (const root of roots) {
        let style;
        try { style = getComputedStyle(root); } catch { continue; }
        if (filterInvertsSurface(style.filter) || filterInvertsSurface(style.webkitFilter)) return true;
      }
      return false;
    }

    surfaceLuminanceAtPoint(x, y) {
      const stack = document.elementsFromPoint?.(x, y) || [];
      for (const element of stack) {
        if (!element || element === this.controlHost || this.controlHost?.contains?.(element)) continue;
        if (element.matches?.('img, picture, video, canvas, svg')) continue;
        const value = luminance(this.effectiveBackground(element));
        if (value !== null) return value;
      }
      return null;
    }

    renderedPageWideDarkMode() {
      if (this.pageWideFilterDarkMode()) return true;
      if (typeof document.elementsFromPoint !== 'function') return null;
      const width = Math.max(1, Number(innerWidth) || 1);
      const height = Math.max(1, Number(innerHeight) || 1);
      const points = [
        [.04, .08], [.25, .08], [.5, .08], [.75, .08], [.96, .08],
        [.04, .35], [.25, .35], [.5, .35], [.75, .35], [.96, .35],
        [.04, .68], [.25, .68], [.5, .68], [.75, .68], [.96, .68],
        [.04, .92], [.25, .92], [.5, .92], [.75, .92], [.96, .92]
      ];
      const samples = points
        .map(([x, y]) => this.surfaceLuminanceAtPoint(width * x, height * y))
        .filter(value => value !== null);
      if (samples.length < 4) return null;
      const darkShare = samples.filter(value => value <= 0.38).length / samples.length;
      const veryDarkShare = samples.filter(value => value <= 0.22).length / samples.length;
      const lightShare = samples.filter(value => value >= 0.68).length / samples.length;
      if (darkShare >= 0.5 || veryDarkShare >= 0.35) return true;
      if (lightShare >= 0.55) return false;
      return null;
    }

    explicitDarkMode() {
      const root = document.documentElement;
      if (!root) return null;
      const mode = String(root.getAttribute?.('data-darkreader-mode') || '').toLowerCase();
      const scheme = String(root?.getAttribute?.('data-darkreader-scheme') || '').toLowerCase();
      if (scheme === 'dark') return true;
      if (scheme === 'dimmed' || scheme === 'light') return false;

      const darkReaderMarker = document.querySelector?.('meta[name="darkreader"]');
      const darkReaderStyles = [...(document.querySelectorAll?.('#dark-reader-style.darkreader, style.darkreader, link.darkreader') || [])]
        .some(style => style.disabled !== true && !/(?:^|\s)not\s+all(?:\s|$)/i.test(String(style.media || '')));
      if (darkReaderMarker || darkReaderStyles || mode === 'dynamic' || mode === 'filter' || mode === 'static') return true;

      const roots = [root, document.body, document.querySelector?.('#app')].filter(Boolean);
      for (const element of roots) {
        const signals = [
          element.getAttribute?.('data-theme'),
          element.getAttribute?.('data-color-mode'),
          element.getAttribute?.('data-dark-mode'),
          element.className
        ].map(value => String(value || '').toLowerCase());
        if (signals.some(value => /(?:^|[\s_-])dark(?:$|[\s_-])/.test(value))) return true;
      }
      return null;
    }

    colorSchemeSuggestsDark() {
      const root = document.documentElement;
      if (!root) return false;
      const declared = [
        getComputedStyle(root).colorScheme,
        root.style?.colorScheme,
        document.querySelector?.('meta[name="color-scheme"]')?.content
      ].map(value => String(value || '').trim().toLowerCase());
      return declared.some(value => value === 'dark' || value.startsWith('dark '));
    }

    renderedThemeRoots() {
      const roots = [
        document.documentElement,
        document.body,
        document.querySelector?.('#app'),
        document.querySelector?.('main'),
        document.querySelector?.('[class*="layout"]')
      ].filter(Boolean);
      if (typeof document.elementsFromPoint !== 'function') return roots;
      const width = Math.max(1, Number(innerWidth) || 1);
      const height = Math.max(1, Number(innerHeight) || 1);
      const points = [
        [.08, .12], [.5, .12], [.92, .12],
        [.08, .5], [.5, .5], [.92, .5],
        [.08, .88], [.5, .88], [.92, .88]
      ];
      for (const [x, y] of points) {
        const elements = document.elementsFromPoint(width * x, height * y);
        const surface = elements?.find(element => !element.matches?.('img, video, canvas, svg'));
        if (surface) roots.push(surface);
      }
      return [...new Set(roots)];
    }

    detectDarkMode() {
      const rendered = this.renderedPageWideDarkMode();
      if (rendered === true) return true;
      const explicit = this.explicitDarkMode();
      if (explicit !== null) return explicit;
      if (rendered === false) return false;
      const roots = this.renderedThemeRoots();
      const backgrounds = roots.map(root => luminance(this.effectiveBackground(root))).filter(value => value !== null);
      if (!backgrounds.length) return false;
      backgrounds.sort((a, b) => a - b);
      const background = backgrounds[Math.floor(backgrounds.length / 2)];
      const darkShare = backgrounds.filter(value => value < 0.4).length / backgrounds.length;
      const lightShare = backgrounds.filter(value => value > 0.68).length / backgrounds.length;
      if (darkShare >= 0.6 && background < 0.4) return true;
      if (lightShare >= 0.6 && background > 0.62) return false;
      return this.colorSchemeSuggestsDark() && darkShare >= 0.45 && background < 0.48;
    }

    evaluateTheme(force = false) {
      if (!this.active) return;
      const detected = this.detectDarkMode();
      const nextProcessing = this.overrideDarkMode || detected;
      const changed = detected !== this.darkModeDetected || nextProcessing !== this.processing;
      this.darkModeDetected = detected;
      if (nextProcessing && !this.processing) this.startProcessing();
      else if (!nextProcessing && this.processing) this.stopProcessing();
      else if (nextProcessing) this.updateControls();
      if (changed || force) this.reportStatus();
    }

    reportStatus() {
      window.dispatchEvent(new CustomEvent(STATUS, {
        detail: JSON.stringify({
          token: this.token,
          status: {
            darkModeDetected: this.darkModeDetected,
            processing: this.active && this.processing
          }
        })
      }));
    }

    startProcessing() {
      if (this.processing) return;
      this.processing = true;
      this.installStyle();
      this.installControlLayer();
      this.intersectionObserver = new IntersectionObserver(this.onIntersections, {
        rootMargin: '150% 0px 700% 0px',
        threshold: 0
      });
      this.resizeObserver = new ResizeObserver(() => this.scheduleControlPositions());
      this.pageObserver = new MutationObserver(this.onPageMutations);
      this.pageObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset']
      });
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      document.addEventListener('click', this.onPostActivation, true);
      this.collectImages(document);
      this.scheduleCleanup();
    }

    stopProcessing() {
      if (!this.processing && !this.records.size) return;
      this.processing = false;
      this.pageObserver?.disconnect();
      this.pageObserver = null;
      this.viewerObserver?.disconnect();
      this.viewerObserver = null;
      this.viewerRoot = null;
      this.intersectionObserver?.disconnect();
      this.intersectionObserver = null;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      window.removeEventListener('scroll', this.onViewportChange, true);
      window.removeEventListener('resize', this.onViewportChange, false);
      document.removeEventListener('click', this.onPostActivation, true);
      this.openingPostId = '';
      if (this.positionFrame) cancelAnimationFrame(this.positionFrame);
      this.positionFrame = 0;
      if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
      this.cleanupTimer = 0;
      if (this.pumpHandle) {
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.pumpHandle);
        else clearTimeout(this.pumpHandle);
      }
      this.pumpHandle = 0;
      this.queue.length = 0;
      this.queued.clear();
      for (const record of this.records.values()) this.clearRecord(record);
      this.records.clear();
      this.controlHost?.remove();
      this.controlHost = null;
      this.controlLayer = null;
      this.style?.remove();
      this.style = null;
    }

    installStyle() {
      if (this.style?.isConnected) return;
      const style = document.createElement('style');
      style.dataset.cosmicGeminiXhsImageDarkMode = '';
      style.textContent = `
        html .cg-xhs-image-dark-mode { filter: invert(1) hue-rotate(180deg) brightness(var(--cg-xhs-image-brightness, 1)) contrast(.92) saturate(.88) !important; }
        html .cg-xhs-image-dark-mode-gray { filter: brightness(var(--cg-xhs-image-brightness, 1)) contrast(6) saturate(.9) !important; }
        html img.avatar-item, html img[src*="sns-avatar"] { filter: brightness(.72) saturate(.9) !important; }
        html .note-detail-follow-btn .follow-button, html button.follow-button.primary { filter: brightness(.76) saturate(.88) !important; }
      `;
      (document.head || document.documentElement).append(style);
      this.style = style;
    }

    installControlLayer() {
      if (this.controlHost?.isConnected) return;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:layout style;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .layer { position: fixed; inset: 0; pointer-events: none; }
        button { position: absolute; display: grid; width: 27px; height: 27px; padding: 0; place-items: center; border: 1px solid rgba(255,255,255,.34); border-radius: 8px; background: rgba(18,20,24,.82); color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.24); cursor: pointer; pointer-events: auto; transition: opacity 120ms ease, background-color 120ms ease; }
        button:hover, button:focus-visible { opacity: 1 !important; background: rgba(20,24,30,.96); }
        button[hidden] { display: none !important; }
        button:focus-visible { outline: 2px solid #4f8df0; outline-offset: 2px; }
        svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      `;
      const layer = document.createElement('div');
      layer.className = 'layer';
      shadow.append(style, layer);
      document.documentElement.append(host);
      this.controlHost = host;
      this.controlLayer = layer;
    }

    isAvatar(image) {
      return image.matches?.('.avatar-item, [class*="avatar"]')
        || image.closest?.('[class*="avatar"], a[href^="/user/profile/"]')
        || /sns-avatar/i.test(image.currentSrc || image.src || '');
    }

    isContentImage(image) {
      if (!(image instanceof HTMLImageElement) || this.isAvatar(image)) return false;
      const source = image.currentSrc || image.src || '';
      if (!source || /(?:logo|icon|emoji)/i.test(source)) return false;
      if (image.closest('#noteContainer .media-container, .note-slider, .swiper-slide')) return true;
      const width = image.clientWidth || image.naturalWidth;
      const height = image.clientHeight || image.naturalHeight;
      if (width < 140 || height < 140) return false;
      return /xhscdn\.com/i.test(source)
        && !!image.closest('a[href^="/explore/"], [class*="note-item"], [class*="cover"], section');
    }

    collectImages(root) {
      if (!this.processing) return;
      const images = root instanceof HTMLImageElement ? [root] : root.querySelectorAll?.('img') || [];
      for (const image of images) this.observeImage(image);
      const modal = root.matches?.('#noteContainer, .note-container')
        ? root
        : root.querySelector?.('#noteContainer, .note-container');
      if (modal) this.prioritizeModal(modal);
    }

    observeImage(image) {
      if (!this.isContentImage(image)) return;
      let record = this.records.get(image);
      if (!record) {
        record = { image, source: '', button: null, darkened: true, result: null };
        this.records.set(image, record);
        this.intersectionObserver?.observe(image);
        this.resizeObserver?.observe(image);
      }
      if (this.applyCachedResult(record)) return;
      if (image.complete && image.naturalWidth) return;
      image.addEventListener('load', () => this.queueImage(image, 0), { once: true });
    }

    prioritizeModal(modal) {
      this.observeViewer(modal);
      const images = [...modal.querySelectorAll('img')].filter(image => this.isContentImage(image));
      for (const image of images) {
        this.observeImage(image);
        const record = this.records.get(image);
        if (record?.result) {
          this.createControl(record);
          this.updateRecordVisual(record);
        }
        const slide = image.closest('.swiper-slide');
        const priority = slide?.classList.contains('swiper-slide-active') ? -20
          : slide?.classList.contains('swiper-slide-next') || slide?.classList.contains('swiper-slide-prev') ? -10 : 5;
        this.queueImage(image, priority);
      }
      this.scheduleControlPositions();
    }

    observeViewer(modal) {
      const root = modal?.querySelector?.('.xhs-slider-container, .note-slider') || null;
      if (!root || root === this.viewerRoot) return;
      this.viewerObserver?.disconnect();
      this.viewerObserver = new MutationObserver(this.onViewerMutations);
      this.viewerObserver.observe(root, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
        characterData: true
      });
      this.viewerRoot = root;
    }

    onViewerMutations() {
      if (!this.processing) return;
      const modal = this.viewerRoot?.closest?.('#noteContainer, .note-container');
      if (modal) this.prioritizeModal(modal);
      else this.scheduleControlPositions();
    }

    onPostActivation(event) {
      const anchor = event.composedPath?.().find(node => node?.matches?.(
        'a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"]'
      ));
      const id = this.noteId(anchor?.href || anchor?.getAttribute?.('href'));
      if (id) this.openingPostId = id;
    }

    onIntersections(entries) {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const distance = Math.abs(entry.boundingClientRect.top);
        this.queueImage(entry.target, distance < innerHeight ? -15 : Math.round(distance / Math.max(innerHeight, 1)));
      }
    }

    onPageMutations(mutations) {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const image = mutation.target;
          const record = this.records.get(image);
          if (record && record.source !== (image.currentSrc || image.src || '')) {
            this.clearRecord(record);
            record.source = '';
            record.darkened = true;
            if (!this.applyCachedResult(record)) this.queueImage(image, -10);
          }
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) this.collectImages(node);
        }
      }
      this.scheduleControlPositions();
      this.scheduleCleanup();
    }

    queueImage(image, priority = 0) {
      if (!this.processing || !this.isContentImage(image) || this.queued.has(image)) return;
      const record = this.records.get(image);
      const source = image.currentSrc || image.src || '';
      if (!record || (record.source === source && record.result)) return;
      this.queued.add(image);
      this.queue.push({ image, priority, order: performance.now() });
      this.queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
      this.schedulePump(priority < 0);
    }

    schedulePump(urgent = false) {
      if (this.pumpHandle || this.running >= 2 || !this.queue.length) return;
      const run = () => {
        this.pumpHandle = 0;
        this.pump();
      };
      if (urgent) this.pumpHandle = setTimeout(run, 0);
      else if (typeof requestIdleCallback === 'function') this.pumpHandle = requestIdleCallback(run, { timeout: 450 });
      else this.pumpHandle = setTimeout(run, 35);
    }

    pump() {
      while (this.processing && this.running < 2 && this.queue.length) {
        const task = this.queue.shift();
        this.queued.delete(task.image);
        if (!task.image.isConnected || !this.isContentImage(task.image)) continue;
        this.running += 1;
        void this.analyze(task.image).finally(() => {
          this.running -= 1;
          this.schedulePump(true);
        });
      }
    }

    cacheKey(source) {
      const value = String(source || '');
      if (!value) return '';
      try {
        const url = new URL(value, location.href);
        if (/xhscdn\.com$/i.test(url.hostname)) {
          const filename = url.pathname.split('/').filter(Boolean).at(-1) || '';
          const identity = filename.split('!')[0];
          if (identity) return `xhs:${identity}`;
        }
        return url.href;
      } catch {
        return value;
      }
    }

    noteId(value) {
      try {
        return new URL(value, location.href).pathname.match(/^\/explore\/([^/]+)/)?.[1] || '';
      } catch {
        return '';
      }
    }

    noteCacheKey(image) {
      const slide = image?.closest?.('.swiper-slide');
      if (slide) {
        const id = this.noteId(location.href) || this.openingPostId;
        const index = slide.getAttribute?.('data-swiper-slide-index') ?? slide.dataset?.swiperSlideIndex;
        return id && index !== undefined && index !== null ? `note:${id}:${index}` : '';
      }
      const anchor = image?.closest?.('a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"]');
      const id = this.noteId(anchor?.href || anchor?.getAttribute?.('href'));
      return id ? `note:${id}:0` : '';
    }

    cacheKeys(image, source) {
      return [...new Set([this.cacheKey(source), this.noteCacheKey(image)].filter(Boolean))];
    }

    cachedResult(image, source) {
      for (const key of this.cacheKeys(image, source)) {
        const result = this.cache.get(key);
        if (result) return result;
      }
      return null;
    }

    cacheResult(source, result, image = null) {
      if (!source || !result) return;
      for (const key of this.cacheKeys(image, source)) {
        if (this.cache.has(key)) this.cache.delete(key);
        this.cache.set(key, result);
        while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
      }
    }

    applyCachedResult(record) {
      const source = record?.image?.currentSrc || record?.image?.src || '';
      if (!source) return false;
      if (record.source === source && record.result) return true;
      const cached = this.cachedResult(record.image, source);
      if (!cached) return false;
      record.source = source;
      record.result = cached;
      this.applyResult(record);
      return true;
    }

    async analyze(image) {
      const record = this.records.get(image);
      if (!record || !this.processing) return;
      const source = image.currentSrc || image.src || '';
      if (!source) return;
      const cached = this.cachedResult(image, source);
      if (cached) {
        record.source = source;
        record.result = cached;
        this.applyResult(record);
        return;
      }
      try { await image.decode?.(); } catch {}
      if (!this.processing || !image.isConnected || source !== (image.currentSrc || image.src || '')) return;
      const sample = await this.sampleImage(image);
      if (!this.processing || !image.isConnected || source !== (image.currentSrc || image.src || '')) return;
      if (!sample) return;
      const result = this.classifySample(sample.data, sample.width, sample.height);
      this.cacheResult(source, result, image);
      record.source = source;
      record.result = result;
      this.applyResult(record);
    }

    drawSample(image, width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      try {
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height);
      } catch { return null; }
    }

    loadCorsImage(source, reference) {
      if (!source || !/^https?:/i.test(source) || typeof Image !== 'function') return Promise.resolve(null);
      return new Promise(resolve => {
        const image = new Image();
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          image.onload = null;
          image.onerror = null;
          resolve(value);
        };
        const timer = setTimeout(() => {
          finish(null);
          try { image.src = ''; } catch {}
        }, 5_000);
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.referrerPolicy = reference?.referrerPolicy || 'strict-origin-when-cross-origin';
        image.onload = () => finish(image.naturalWidth > 0 ? image : null);
        image.onerror = () => finish(null);
        image.src = source;
      });
    }

    async sampleImage(image) {
      const sourceWidth = Math.max(1, image.naturalWidth || image.clientWidth || 1);
      const sourceHeight = Math.max(1, image.naturalHeight || image.clientHeight || 1);
      const scale = Math.min(1, Math.sqrt(MAX_SAMPLE_PIXELS / (sourceWidth * sourceHeight)));
      const width = Math.max(1, Math.ceil(sourceWidth * scale));
      const height = Math.max(1, Math.ceil(sourceHeight * scale));
      const direct = this.drawSample(image, width, height);
      if (direct) return direct;
      const source = image.currentSrc || image.src || '';
      const corsImage = await this.loadCorsImage(source, image);
      return corsImage ? this.drawSample(corsImage, width, height) : null;
    }

    classifySample(data, width, height) {
      const pixelCount = Math.min(width * height, Math.floor(data.length / 4));
      if (!pixelCount) return { kind: 'photo' };
      const buckets = new Map();
      const edgeBuckets = new Map();
      const edgeBand = Math.max(1, Math.round(Math.min(width, height) * 0.08));
      let opaque = 0;
      let edgeOpaque = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        if (data[offset + 3] < 24) continue;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const key = (Math.min(COLOR_BUCKETS - 1, r >> 5) << 6)
          | (Math.min(COLOR_BUCKETS - 1, g >> 5) << 3)
          | Math.min(COLOR_BUCKETS - 1, b >> 5);
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
        opaque += 1;
        if (x < edgeBand || x >= width - edgeBand || y < edgeBand || y >= height - edgeBand) {
          edgeBuckets.set(key, (edgeBuckets.get(key) || 0) + 1);
          edgeOpaque += 1;
        }
      }
      if (opaque / pixelCount < 0.9 || !buckets.size) return { kind: 'photo' };
      const colors = [...buckets.entries()]
        .map(bucket => {
          const [key, value] = bucket;
          const color = {
            r: value.r / value.count,
            g: value.g / value.count,
            b: value.b / value.count
          };
          return {
            key,
            ...color,
            count: value.count,
            share: value.count / opaque,
            value: luminance(color),
            chroma: (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) / 255
          };
        });
      const colorsByShare = [...colors].sort((a, b) => b.count - a.count);
      const lightSurfaces = colorsByShare
        .filter(color => color.share >= 0.02 && color.value >= 0.64 && color.chroma <= 0.42)
        .slice(0, 4);
      const lightBackground = lightSurfaces.find(color => color.share >= 0.12
        && color.value >= 0.72 && color.chroma <= 0.32);
      const grayBackground = colorsByShare.find(color => color.share >= 0.48
        && color.value >= 0.3 && color.value <= 0.68 && color.chroma <= 0.14);
      const background = lightBackground || grayBackground;
      if (!background) return { kind: 'photo' };
      const grayCard = !lightBackground && background === grayBackground;
      const backgroundLuminance = luminance(background);
      let frame = null;
      if (edgeOpaque) {
        let edgeDominantKey = null;
        let edgeDominantCount = 0;
        for (const [key, count] of edgeBuckets) {
          if (count > edgeDominantCount) {
            edgeDominantKey = key;
            edgeDominantCount = count;
          }
        }
        const candidate = colors.find(color => color.key === edgeDominantKey);
        if (candidate) {
          const dr = (candidate.r - background.r) / 255;
          const dg = (candidate.g - background.g) / 255;
          const db = (candidate.b - background.b) / 255;
          const distance = dr * dr + dg * dg + db * db;
          const edgeShare = edgeDominantCount / edgeOpaque;
          if (edgeShare >= 0.42 && candidate.share >= 0.025 && distance >= 0.025) {
            frame = { ...candidate, edgeShare };
          }
        }
      }
      const surfacePalette = grayCard
        ? colorsByShare.filter(color => color.share >= 0.02
          && color.chroma <= 0.18 && Math.abs(color.value - backgroundLuminance) <= 0.16).slice(0, 4)
        : [...lightSurfaces];
      if (frame && !surfacePalette.some(surface => surface.key === frame.key)) surfacePalette.push(frame);
      const foregroundMask = new Uint8Array(pixelCount);
      let surfaceCount = 0;
      let lightCount = 0;
      let contrastForegroundCount = 0;
      let foregroundCount = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        if (data[offset + 3] < 24) {
          continue;
        }
        const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
        const value = luminance(color);
        if (value >= 0.64) lightCount += 1;
        const nearSurface = surfacePalette.some(surface => {
          const dr = (color.r - surface.r) / 255;
          const dg = (color.g - surface.g) / 255;
          const db = (color.b - surface.b) / 255;
          return dr * dr + dg * dg + db * db <= 0.045
            && Math.abs(value - surface.value) <= 0.18;
        });
        if (nearSurface) {
          surfaceCount += 1;
        } else {
          foregroundMask[pixel] = 1;
          foregroundCount += 1;
          if (grayCard ? value >= backgroundLuminance + 0.22 : value <= backgroundLuminance - 0.22) {
            contrastForegroundCount += 1;
          }
        }
      }
      const surfaceShare = surfaceCount / opaque;
      const foregroundShare = foregroundCount / opaque;
      const lightShare = lightCount / opaque;
      const contrastForegroundShare = contrastForegroundCount / opaque;
      const largestForegroundShare = this.largestComponentShare(foregroundMask, width, height, opaque);
      const uniformLightSurface = !grayCard && surfacePalette.length > 0
        && surfaceShare >= 0.72
        && lightShare >= (frame ? 0.5 : 0.72);
      const uniformGraySurface = grayCard
        && surfacePalette.length > 0
        && surfaceShare >= 0.72;
      const textLikeForeground = foregroundShare >= 0.008
        && foregroundShare <= 0.32
        && contrastForegroundShare >= 0.006
        && largestForegroundShare <= 0.16;
      return {
        kind: textLikeForeground && (uniformLightSurface || uniformGraySurface)
          ? grayCard ? 'gray-theme' : 'light-theme'
          : 'photo',
        backgroundShare: surfaceShare,
        surfaceCount: surfacePalette.length,
        frameDetected: frame !== null,
        frameEdgeShare: frame?.edgeShare || 0,
        foregroundShare,
        backgroundLuminance,
        largestForegroundShare
      };
    }

    largestComponentShare(mask, width, height, opaque) {
      const visited = new Uint8Array(mask.length);
      const stack = [];
      let largest = 0;
      for (let start = 0; start < mask.length; start += 1) {
        if (!mask[start] || visited[start]) continue;
        visited[start] = 1;
        stack.push(start);
        let size = 0;
        while (stack.length) {
          const pixel = stack.pop();
          size += 1;
          const x = pixel % width;
          const left = pixel - 1;
          const right = pixel + 1;
          const up = pixel - width;
          const down = pixel + width;
          if (x > 0 && mask[left] && !visited[left]) { visited[left] = 1; stack.push(left); }
          if (x + 1 < width && mask[right] && !visited[right]) { visited[right] = 1; stack.push(right); }
          if (up >= 0 && mask[up] && !visited[up]) { visited[up] = 1; stack.push(up); }
          if (down < mask.length && mask[down] && !visited[down]) { visited[down] = 1; stack.push(down); }
        }
        largest = Math.max(largest, size);
      }
      return largest / Math.max(opaque, 1);
    }

    applyResult(record) {
      if (!this.processing || !record.image.isConnected || !record.result) return;
      this.clearVisual(record);
      record.darkened = record.result.kind === 'light-theme';
      if (this.viewerForImage(record.image)) this.createControl(record);
      this.updateRecordVisual(record);
      this.scheduleControlPositions();
    }

    createControl(record) {
      if (!this.controlLayer || record.button || !this.viewerForImage(record.image)) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        record.darkened = !record.darkened;
        this.updateRecordVisual(record);
      });
      this.controlLayer.append(button);
      record.button = button;
      this.updateControl(record);
    }

    updateRecordVisual(record) {
      const grayTheme = record.result?.kind === 'gray-theme';
      const target = this.visualTarget(record.image);
      if (record.visualTarget && record.visualTarget !== target) {
        record.visualTarget.classList?.remove('cg-xhs-image-dark-mode', 'cg-xhs-image-dark-mode-gray');
      }
      if (target !== record.image) {
        record.image.classList?.remove('cg-xhs-image-dark-mode', 'cg-xhs-image-dark-mode-gray');
      }
      target?.style?.setProperty?.('--cg-xhs-image-brightness', String(this.imageBrightness));
      target?.classList?.toggle('cg-xhs-image-dark-mode', record.darkened && !grayTheme);
      target?.classList?.toggle('cg-xhs-image-dark-mode-gray', record.darkened && grayTheme);
      record.visualTarget = target;
      this.updateControl(record);
    }

    updateControl(record) {
      if (!record.button) return;
      record.button.hidden = !this.showImageControl;
      record.button.style.opacity = String(this.controlOpacity);
      const copy = COPY[this.locale];
      const label = record.darkened ? copy.showLight : copy.showDark;
      record.button.innerHTML = record.darkened ? LIGHT_ICON : DARK_ICON;
      record.button.title = label;
      record.button.setAttribute('aria-label', label);
    }

    updateControls() {
      for (const record of this.records.values()) this.updateControl(record);
      this.scheduleControlPositions();
    }

    onViewportChange() { this.scheduleControlPositions(); }

    viewerForImage(image) {
      const viewer = image?.closest?.('#noteContainer');
      return viewer?.querySelector?.('.note-slider, .media-container') ? viewer : null;
    }

    visualTarget(image) {
      if (!this.viewerForImage(image)) return image;
      return image.closest?.('.swiper-slide') || image;
    }

    controlPlacement(record) {
      const viewer = this.viewerForImage(record.image);
      if (!viewer) return null;
      const slide = record.image.closest?.('.swiper-slide');
      if (slide && !slide.classList?.contains('swiper-slide-active')) return null;
      const rect = record.image.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      if (!visible) return null;
      const fraction = viewer.querySelector?.('.fraction');
      const fractionRect = fraction?.getBoundingClientRect?.();
      if (fractionRect?.width > 0 && fractionRect?.height > 0) {
        return {
          left: Math.max(4, Math.min(innerWidth - CONTROL_SIZE - 4,
            fractionRect.right - FRACTION_SLOT_WIDTH - CONTROL_GAP - CONTROL_SIZE)),
          top: Math.max(4, Math.min(innerHeight - CONTROL_SIZE - 4,
            fractionRect.top + (fractionRect.height - CONTROL_SIZE) / 2))
        };
      }
      return {
        left: Math.max(4, Math.min(innerWidth - CONTROL_SIZE - 4, rect.right - CONTROL_SIZE - 6)),
        top: Math.max(4, Math.min(innerHeight - CONTROL_SIZE - 4, rect.top + 7))
      };
    }

    scheduleControlPositions() {
      if (this.positionFrame || !this.processing) return;
      this.positionFrame = requestAnimationFrame(() => {
        this.positionFrame = 0;
        for (const record of this.records.values()) {
          if (!record.button || !record.image.isConnected) continue;
          const placement = this.showImageControl ? this.controlPlacement(record) : null;
          record.button.style.display = placement ? 'grid' : 'none';
          if (!placement) continue;
          record.button.style.left = `${placement.left}px`;
          record.button.style.top = `${placement.top}px`;
        }
      });
    }

    clearVisual(record) {
      record.image?.classList?.remove('cg-xhs-image-dark-mode');
      record.image?.classList?.remove('cg-xhs-image-dark-mode-gray');
      record.visualTarget?.classList?.remove('cg-xhs-image-dark-mode', 'cg-xhs-image-dark-mode-gray');
      record.visualTarget?.style?.removeProperty?.('--cg-xhs-image-brightness');
      record.visualTarget = null;
    }

    clearRecord(record) {
      this.clearVisual(record);
      record.button?.remove();
      record.button = null;
      record.result = null;
      record.darkened = true;
    }

    scheduleCleanup() {
      if (this.cleanupTimer || !this.processing) return;
      this.cleanupTimer = setTimeout(() => {
        this.cleanupTimer = 0;
        for (const [image, record] of this.records) {
          if (image.isConnected) continue;
          this.clearRecord(record);
          this.records.delete(image);
          this.queued.delete(image);
        }
        if (this.viewerRoot && !this.viewerRoot.isConnected) {
          this.viewerObserver?.disconnect();
          this.viewerObserver = null;
          this.viewerRoot = null;
        }
      }, 1_500);
    }
  }

  const runtime = new XhsImageDarkModeRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
