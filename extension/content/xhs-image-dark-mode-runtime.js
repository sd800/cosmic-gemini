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
  const LONG_PRESS_MS = 550;
  const LONG_PRESS_MOVE_TOLERANCE = 8;
  const POST_OPEN_TRANSITION_MS = 380;
  const CONTROL_RESIZE_SETTLE_MS = 140;
  const COPY = Object.freeze({
    'en-US': Object.freeze({
      clickAutomatic: 'Click to restore automatic recognition for this post',
      clickRestoreImage: 'Click to restore this image',
      clickRestoreAll: 'Click to restore every image in this post',
      clickDark: 'Click to show this image in dark mode',
      clickLight: 'Click to show this image in light mode',
      menuHint: 'Right-click for image options',
      menuTitle: 'Image display',
      imageGroup: 'Image', allGroup: 'All',
      hide: 'Hide', auto: 'Auto', dark: 'Dark', light: 'Light', original: 'Original',
      holdDark: 'Press and hold to show every image in this post in dark mode',
      holdLight: 'Press and hold to show every image in this post in light mode',
      profileEnabled: 'XHS Image Dark Mode is on for this profile. Click to turn it off for all posts',
      profileDisabled: 'XHS Image Dark Mode is off for this profile. Click to turn it on',
      separator: '. '
    }),
    'zh-CN': Object.freeze({
      clickAutomatic: '单击可恢复这篇笔记的自动识别',
      clickRestoreImage: '单击可恢复本图',
      clickRestoreAll: '单击可恢复本帖所有图片',
      clickDark: '单击可将当前图片切换为深色模式',
      clickLight: '单击可将当前图片切换为浅色模式',
      menuHint: '右键可打开图片菜单',
      menuTitle: '图片显示',
      imageGroup: '本图', allGroup: '本帖所有图片',
      hide: '关闭', auto: '自动', dark: '深色', light: '浅色', original: '原图',
      holdDark: '长按可将这篇笔记的全部图片切换为深色模式',
      holdLight: '长按可将这篇笔记的全部图片切换为浅色模式',
      profileEnabled: 'XHS Image Dark Mode 已在这个用户主页中开启，点击可暂停处理全部笔记',
      profileDisabled: 'XHS Image Dark Mode 已在这个用户主页中暂停，点击可恢复处理',
      separator: '。'
    })
  });
  const LIGHT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const DARK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z"/></svg>';
  const POST_DISABLED_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>';
  const PROFILE_ENABLED_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>';

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
      this.intervened = false;
      this.darkModeDetected = false;
      this.locale = 'en-US';
      this.overrideDarkMode = false;
      this.showImageControl = true;
      this.controlOpacity = 0.5;
      this.imageBrightness = 1;
      this.openingPostId = '';
      this.openingProfileKey = '';
      this.records = new Map();
      this.intervenedRecords = new Set();
      this.controlRecords = new Set();
      this.commentPreviewRecords = new Set();
      this.postOverrides = new Map();
      this.concealedPosts = new Set();
      this.controlMenu = null;
      this.disabledProfileKeys = new Set();
      this.commentImageKeys = new Set();
      this.commentPreviewImages = new WeakSet();
      this.commentPreviewRoot = null;
      this.commentPreviewBounds = null;
      this.commentPreviewObserver = null;
      this.commentPreviewScanFrame = 0;
      this.commentGalleryProbeTimers = new Set();
      this.pendingCommentPreview = null;
      this.commentPreviewProbeTimers = new Set();
      this.cache = new Map();
      this.queue = [];
      this.queued = new Set();
      this.inFlight = new WeakMap();
      this.running = 0;
      this.pumpHandle = 0;
      this.pumpKind = '';
      this.processingGeneration = 0;
      this.statusSequence = 0;
      this.themeTimer = 0;
      this.themeCheckTimers = [];
      this.positionFrame = 0;
      this.controlTransitionUntil = 0;
      this.controlTransitionTimer = 0;
      this.watchedControlAnimations = new WeakMap();
      this.viewerRefreshFrame = 0;
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
      this.profileControl = null;
      this.profileControlKey = '';
      this.profileControlUrl = '';
      this.controlViewportListening = false;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onThemeChange = this.onThemeChange.bind(this);
      this.onPageMutations = this.onPageMutations.bind(this);
      this.onViewerMutations = this.onViewerMutations.bind(this);
      this.onPostActivation = this.onPostActivation.bind(this);
      this.onIntersections = this.onIntersections.bind(this);
      this.onViewportChange = this.onViewportChange.bind(this);
      this.onControlResize = this.onControlResize.bind(this);
      this.onControlMotion = this.onControlMotion.bind(this);
      this.onCommentPreviewMutations = this.onCommentPreviewMutations.bind(this);
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
      this.closeControlMenu();
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
      this.postOverrides.clear();
      this.concealedPosts.clear();
      this.disabledProfileKeys.clear();
      this.reportStatus();
    }

    installThemeObserver() {
      this.themeObserver?.disconnect();
      this.themeObserver = new MutationObserver(this.onThemeChange);
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'dark', 'data-theme', 'data-darkreader-mode', 'data-darkreader-scheme'],
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
      if (root.hasAttribute?.('dark')) return true;
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
      else if (nextProcessing) {
        this.syncProfileControl();
        this.updateControls();
      }
      if (changed || force) this.reportStatus();
    }

    reportStatus() {
      this.statusSequence += 1;
      window.dispatchEvent(new CustomEvent(STATUS, {
        detail: JSON.stringify({
          token: this.token,
          status: {
            sequence: this.statusSequence,
            darkModeDetected: this.darkModeDetected,
            processing: this.active && this.processing,
            intervened: this.active && this.processing && this.intervened
          }
        })
      }));
    }

    startProcessing() {
      if (this.processing) return;
      this.processing = true;
      this.processingGeneration += 1;
      this.installStyle();
      this.installControlLayer();
      this.syncProfileControl();
      this.intersectionObserver = new IntersectionObserver(this.onIntersections, {
        rootMargin: '150% 0px 700% 0px',
        threshold: 0
      });
      this.resizeObserver = new ResizeObserver(this.onControlResize);
      this.pageObserver = new MutationObserver(this.onPageMutations);
      this.pageObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'sizes', 'media', 'type']
      });
      document.addEventListener('click', this.onPostActivation, true);
      this.collectImages(document);
    }

    stopProcessing() {
      if (!this.processing && !this.records.size) return;
      this.processing = false;
      this.processingGeneration += 1;
      this.pageObserver?.disconnect();
      this.pageObserver = null;
      this.viewerObserver?.disconnect();
      this.viewerObserver = null;
      this.viewerRoot = null;
      this.intersectionObserver?.disconnect();
      this.intersectionObserver = null;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.stopControlPositionTracking();
      this.closeControlMenu();
      document.removeEventListener('click', this.onPostActivation, true);
      this.openingPostId = '';
      this.openingProfileKey = '';
      if (this.positionFrame) cancelAnimationFrame(this.positionFrame);
      this.positionFrame = 0;
      if (this.controlTransitionTimer) clearTimeout(this.controlTransitionTimer);
      this.controlTransitionTimer = 0;
      this.controlTransitionUntil = 0;
      this.watchedControlAnimations = new WeakMap();
      if (this.viewerRefreshFrame) cancelAnimationFrame(this.viewerRefreshFrame);
      this.viewerRefreshFrame = 0;
      if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
      this.cleanupTimer = 0;
      this.cancelPump();
      this.running = 0;
      this.queue.length = 0;
      this.queued.clear();
      this.inFlight = new WeakMap();
      for (const record of this.records.values()) this.clearRecord(record);
      this.records.clear();
      this.intervenedRecords.clear();
      this.syncInterventionStatus();
      this.controlRecords.clear();
      this.commentPreviewRecords.clear();
      this.commentImageKeys.clear();
      this.commentPreviewImages = new WeakSet();
      this.clearCommentPreviewGallery();
      this.pendingCommentPreview = null;
      for (const timer of this.commentPreviewProbeTimers) clearTimeout(timer);
      this.commentPreviewProbeTimers.clear();
      this.profileControl = null;
      this.profileControlKey = '';
      this.profileControlUrl = '';
      this.controlHost?.remove();
      this.controlHost = null;
      this.controlLayer = null;
      this.style?.remove();
      this.style = null;
      this.coverFilters?.remove();
      this.coverFilters = null;
    }

    installStyle() {
      if (this.style?.isConnected) return;
      const style = document.createElement('style');
      style.dataset.cosmicGeminiXhsImageDarkMode = '';
      const darkFilter = `cg-xhs-cover-dark-${this.token}`;
      const filters = document.createElement('div');
      filters.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;';
      filters.setAttribute('aria-hidden', 'true');
      // Constant-color SVG filters stay in the image's own stacking/clip context.
      // They need no image copy, canvas, per-scroll positioning or network resource.
      filters.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><defs>
        <filter id="${darkFilter}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood flood-color="#000"/></filter>
      </defs></svg>`;
      document.documentElement.append(filters);
      this.coverFilters = filters;
      style.textContent = `
        html .cg-xhs-image-dark-mode { filter: invert(1) hue-rotate(180deg) brightness(var(--cg-xhs-image-brightness, 1)) contrast(.92) saturate(.88) !important; }
        html .cg-xhs-image-dark-mode-gray { filter: brightness(var(--cg-xhs-image-brightness, 1)) contrast(6) saturate(.9) !important; }
        html .cg-xhs-image-hidden-dark { filter: url("#${darkFilter}") !important; }
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
        button { position: absolute; z-index: 1; display: grid; width: 27px; height: 27px; padding: 0; place-items: center; border: 1px solid rgba(255,255,255,.34); border-radius: 8px; background: rgba(18,20,24,.82); color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.24); cursor: pointer; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; transition: opacity 120ms ease, background-color 120ms ease; }
        .image-menu { position: fixed; z-index: 2; box-sizing: border-box; padding: 5px; margin: 0; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; overscroll-behavior: contain; border: 1px solid #4a4c50; border-radius: 10px; background: #222428; color: #e8e6e3; box-shadow: 0 4px 18px #0006; pointer-events: auto; font: 14px/1.45 system-ui, sans-serif; outline: none; }
        .image-menu button { position: relative; display: block; width: 100%; height: auto; padding: 7px 12px; border: 0; border-radius: 5px; background: transparent; color: inherit; box-shadow: none; font: inherit; text-align: start; white-space: nowrap; opacity: 1; }
        .image-menu button:hover, .image-menu button:focus-visible { background: #383b42; }
        .menu-heading { padding: 5px 12px 3px; color: #aeb1b6; }
        .image-menu button::before { content: ''; display: inline-block; width: 18px; margin-right: 5px; }
        .image-menu button[aria-checked="true"]::before { content: '✓'; color: #8fb8ee; }
        .image-menu hr { margin: 4px 6px; border: 0; border-top: 1px solid #45474c; }
        button.profile-control { position: fixed; top: 88px; right: 24px; }
        button:hover, button:focus-visible { opacity: 1 !important; background: rgba(20,24,30,.96); }
        button[hidden] { display: none !important; }
        button:focus-visible { outline: 2px solid #4f8df0; outline-offset: 2px; }
        svg { pointer-events: none; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
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
        || image.closest?.('[class*="avatar"]')
        || /sns-avatar/i.test(image.currentSrc || image.src || '');
    }

    isXhsImageSource(image) {
      return /(?:^|\.)xhscdn\.com(?:[/:]|$)/i.test(image?.currentSrc || image?.src || '');
    }

    inlineCommentImage(image) {
      if (!this.isXhsImageSource(image)) return false;
      const commentRoot = image.closest?.('[data-comment-id], [class*="comment"], [id*="comment"]');
      const noteRoot = image.closest?.('#noteContainer, .note-container');
      if (!commentRoot || !noteRoot || this.viewerImageContext(image)) return false;
      const width = image.clientWidth || image.naturalWidth;
      const height = image.clientHeight || image.naturalHeight;
      return width >= 48 && height >= 48;
    }

    rememberCommentImage(image) {
      if (!this.inlineCommentImage(image)) return '';
      const key = this.cacheKey(image.currentSrc || image.src || '');
      if (key) {
        this.commentImageKeys.delete(key);
        this.commentImageKeys.add(key);
        while (this.commentImageKeys.size > CACHE_LIMIT) {
          this.commentImageKeys.delete(this.commentImageKeys.values().next().value);
        }
      }
      return key;
    }

    commentPreviewCandidate(image) {
      if (!image || this.isAvatar(image) || this.viewerImageContext(image)) return false;
      const source = image.currentSrc || image.src || '';
      if (!source || /(?:logo|icon|emoji)/i.test(source)) return false;
      try {
        if (typeof image.checkVisibility === 'function'
          && !image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      } catch {}
      if (image.closest?.(
        'a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"], section.note-item, a.cover'
      )) return false;
      const rect = image.getBoundingClientRect?.();
      const width = rect?.width || image.clientWidth || image.naturalWidth;
      const height = rect?.height || image.clientHeight || image.naturalHeight;
      if (width < 120 || height < 120 || width * height < 20_000) return false;
      const viewportHeight = Number(globalThis.innerHeight) || Number.POSITIVE_INFINITY;
      const viewportWidth = Number(globalThis.innerWidth) || Number.POSITIVE_INFINITY;
      return !rect || (rect.bottom > 0 && rect.top < viewportHeight
        && rect.right > 0 && rect.left < viewportWidth);
    }

    commentGalleryCandidate(image) {
      if (!image || this.isAvatar(image) || this.viewerImageContext(image)) return false;
      const source = image.currentSrc || image.src || '';
      if (!source || /(?:logo|icon|emoji)/i.test(source)) return false;
      if (image.closest?.(
        'a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"], section.note-item, a.cover'
      )) return false;
      const width = image.naturalWidth || image.clientWidth || 0;
      const height = image.naturalHeight || image.clientHeight || 0;
      return width >= 120 && height >= 120 && width * height >= 20_000;
    }

    commentPreviewContainer(image) {
      let named = null;
      let fixed = null;
      for (let node = image.parentElement, depth = 0;
        node && node !== document.body && depth < 7; node = node.parentElement, depth += 1) {
        if (node.matches?.('[role="dialog"], [class*="preview" i], [class*="viewer" i], '
          + '[class*="lightbox" i], [class*="modal" i]')) named = node;
        if (globalThis.getComputedStyle?.(node)?.position === 'fixed') fixed = node;
      }
      return fixed || named || image.parentElement?.parentElement || image.parentElement || null;
    }

    clearCommentPreviewGallery() {
      this.commentPreviewObserver?.disconnect();
      this.commentPreviewObserver = null;
      if (this.commentPreviewScanFrame) cancelAnimationFrame(this.commentPreviewScanFrame);
      this.commentPreviewScanFrame = 0;
      for (const timer of this.commentGalleryProbeTimers) clearTimeout(timer);
      this.commentGalleryProbeTimers.clear();
      this.commentPreviewRoot = null;
      this.commentPreviewBounds = null;
    }

    observeCommentPreviewGallery(image) {
      if (this.commentPreviewRoot?.contains?.(image)) return false;
      const root = this.commentPreviewContainer(image);
      if (!root) return false;
      this.clearCommentPreviewGallery();
      this.commentPreviewRoot = root;
      if (typeof MutationObserver === 'function') {
        this.commentPreviewObserver = new MutationObserver(this.onCommentPreviewMutations);
        this.commentPreviewObserver.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ['class', 'style', 'src', 'srcset', 'hidden', 'aria-hidden']
        });
      }
      return true;
    }

    onCommentPreviewMutations(mutations) {
      if (!this.processing || this.commentPreviewRoot?.isConnected === false) {
        this.clearCommentPreviewGallery();
        return;
      }
      const siteClasses = value => String(value || '').split(/\s+/)
        .filter(name => name && !name.startsWith('cg-xhs-image-')).sort().join(' ');
      const siteStyle = value => String(value || '')
        .replace(/(?:^|;)\s*--cg-xhs-image-brightness\s*:[^;]*(?:;|$)/g, '').trim();
      if (!mutations.some(mutation => mutation.type === 'childList'
        || (mutation.attributeName === 'class'
          && siteClasses(mutation.oldValue) !== siteClasses(mutation.target.getAttribute?.('class')))
        || (mutation.attributeName === 'style'
          && siteStyle(mutation.oldValue) !== siteStyle(mutation.target.getAttribute?.('style')))
        || !['class', 'style'].includes(mutation.attributeName))) return;
      this.scheduleCommentPreviewScan();
    }

    scheduleCommentPreviewScan() {
      if (!this.processing || !this.commentPreviewRoot || this.commentPreviewScanFrame) return;
      this.commentPreviewScanFrame = requestAnimationFrame(() => {
        this.commentPreviewScanFrame = 0;
        this.scanCommentPreviewGallery();
      });
    }

    probeCommentPreviewGallery() {
      for (const timer of this.commentGalleryProbeTimers) clearTimeout(timer);
      this.commentGalleryProbeTimers.clear();
      for (const delay of [0, 100, 350, 800]) {
        const timer = setTimeout(() => {
          this.commentGalleryProbeTimers.delete(timer);
          this.scheduleCommentPreviewScan();
        }, delay);
        timer?.unref?.();
        this.commentGalleryProbeTimers.add(timer);
      }
    }

    commentGalleryVisible(image) {
      if (!this.commentPreviewCandidate(image)) return false;
      const bounds = this.commentPreviewBounds;
      const rect = image.getBoundingClientRect?.();
      if (!bounds || !rect) return true;
      const overlapWidth = Math.max(0, Math.min(bounds.right, rect.right) - Math.max(bounds.left, rect.left));
      const overlapHeight = Math.max(0, Math.min(bounds.bottom, rect.bottom) - Math.max(bounds.top, rect.top));
      return overlapWidth * overlapHeight >= Math.min(
        bounds.width * bounds.height, rect.width * rect.height
      ) * 0.35;
    }

    ensureCommentGalleryImage(image, priority, allowHidden = false) {
      if (!this.commentGalleryCandidate(image)
        || (!allowHidden && !this.commentGalleryVisible(image))) return;
      this.markCommentPreview(image, allowHidden);
      this.observeImage(image);
      const record = this.records.get(image);
      if (record && !record.result) this.waitForImageLoad(record, priority);
    }

    scanCommentPreviewGallery() {
      const root = this.commentPreviewRoot;
      if (!this.processing || !root || root.isConnected === false || root.hidden
        || root.getAttribute?.('aria-hidden') === 'true'
        || globalThis.getComputedStyle?.(root)?.display === 'none') {
        this.clearCommentPreviewGallery();
        return;
      }
      const images = [...(root.querySelectorAll?.('img') || [])]
        .filter(image => this.commentGalleryCandidate(image));
      let active = null;
      for (const image of images) {
        if (!this.commentGalleryVisible(image)) continue;
        active = image;
        const record = this.records.get(image);
        if (record?.commentKind !== 'preview'
          || record.requestKey !== this.imageRequestKey(image) || !record.result) {
          this.ensureCommentGalleryImage(image, -20);
        }
      }
      if (!active) return;
      const index = images.indexOf(active);
      for (const adjacent of [images[index - 1], images[index + 1]]) {
        if (!adjacent) continue;
        const record = this.records.get(adjacent);
        if (record?.commentKind !== 'preview'
          || record.requestKey !== this.imageRequestKey(adjacent) || !record.result) {
          this.ensureCommentGalleryImage(adjacent, -10, true);
        }
      }
      this.scheduleControlPositions();
    }

    markCommentPreview(image, allowHidden = false) {
      if (allowHidden ? !this.commentGalleryCandidate(image)
        : !this.commentPreviewCandidate(image)) return false;
      if (this.commentPreviewRoot && this.commentPreviewRoot.isConnected !== false
        && !this.commentPreviewRoot.contains?.(image) && !this.pendingCommentPreview) return false;
      const newGallery = this.observeCommentPreviewGallery(image);
      this.commentPreviewImages.add(image);
      if (!allowHidden) this.commentPreviewBounds = image.getBoundingClientRect?.() || null;
      const key = this.cacheKey(image.currentSrc || image.src || '');
      if (key) {
        this.commentImageKeys.delete(key);
        this.commentImageKeys.add(key);
        while (this.commentImageKeys.size > CACHE_LIMIT) {
          this.commentImageKeys.delete(this.commentImageKeys.values().next().value);
        }
      }
      this.pendingCommentPreview = null;
      for (const timer of this.commentPreviewProbeTimers) clearTimeout(timer);
      this.commentPreviewProbeTimers.clear();
      if (newGallery) this.probeCommentPreviewGallery();
      return true;
    }

    findPendingCommentPreview() {
      const pending = this.pendingCommentPreview;
      if (!pending || Date.now() >= pending.expiresAt) {
        this.pendingCommentPreview = null;
        return null;
      }
      let best = null;
      let bestScore = -1;
      for (const image of document.querySelectorAll?.('img') || []) {
        if (!this.commentPreviewCandidate(image)) continue;
        const key = this.cacheKey(image.currentSrc || image.src || '');
        const rect = image.getBoundingClientRect?.();
        const width = rect?.width || image.clientWidth || image.naturalWidth || 0;
        const height = rect?.height || image.clientHeight || image.naturalHeight || 0;
        const sameImage = image === pending.thumbnail;
        const sameSource = !!pending.sourceKey && key === pending.sourceKey;
        const newlyAdded = !pending.knownImages.has(image);
        const expanded = width * height > pending.thumbnailArea * 2.25;
        if (sameImage && !expanded) continue;
        if (!sameImage && !sameSource && !newlyAdded && !expanded) continue;
        const score = (sameImage ? 1_000_000 : 0)
          + (sameSource ? 500_000 : 0)
          + (newlyAdded ? 250_000 : 0)
          + width * height;
        if (score > bestScore) {
          best = image;
          bestScore = score;
        }
      }
      if (!best || !this.markCommentPreview(best)) return null;
      this.observeImage(best);
      const record = this.records.get(best);
      if (record?.result) {
        this.createControl(record);
        this.updateRecordVisual(record);
      } else {
        this.waitForImageLoad(record, -20);
      }
      this.scheduleControlPositions();
      return best;
    }

    armCommentPreview(thumbnail) {
      const rect = thumbnail.getBoundingClientRect?.();
      const width = rect?.width || thumbnail.clientWidth || thumbnail.naturalWidth || 0;
      const height = rect?.height || thumbnail.clientHeight || thumbnail.naturalHeight || 0;
      this.pendingCommentPreview = {
        thumbnail,
        sourceKey: this.cacheKey(thumbnail.currentSrc || thumbnail.src || ''),
        knownImages: new WeakSet(document.querySelectorAll?.('img') || []),
        thumbnailArea: Math.max(1, width * height),
        expiresAt: Date.now() + 2_500
      };
      for (const timer of this.commentPreviewProbeTimers) clearTimeout(timer);
      this.commentPreviewProbeTimers.clear();
      for (const delay of [0, 80, 240, 600, 1_200, 2_600]) {
        const timer = setTimeout(() => {
          this.commentPreviewProbeTimers.delete(timer);
          if (this.processing) this.findPendingCommentPreview();
        }, delay);
        timer?.unref?.();
        this.commentPreviewProbeTimers.add(timer);
      }
    }

    commentImageKind(image) {
      if (this.commentPreviewImages.has(image)
        && (this.commentPreviewRoot?.contains?.(image)
          ? this.commentGalleryCandidate(image) : this.commentPreviewCandidate(image))) return 'preview';
      if (this.commentPreviewRoot?.contains?.(image) && this.commentGalleryVisible(image)) {
        if (this.markCommentPreview(image)) return 'preview';
      }
      const inlineKey = this.rememberCommentImage(image);
      if (inlineKey) return 'inline';
      if (this.pendingCommentPreview && this.commentPreviewCandidate(image)) {
        const pending = this.pendingCommentPreview;
        const key = this.cacheKey(image.currentSrc || image.src || '');
        const rect = image.getBoundingClientRect?.();
        const width = rect?.width || image.clientWidth || image.naturalWidth || 0;
        const height = rect?.height || image.clientHeight || image.naturalHeight || 0;
        const sameImageExpanded = image === pending.thumbnail
          && width * height > pending.thumbnailArea * 2.25;
        const sameSourceCopy = image !== pending.thumbnail && key === pending.sourceKey;
        if (sameImageExpanded || sameSourceCopy || !pending.knownImages.has(image)) {
          if (this.markCommentPreview(image)) return 'preview';
        }
      }
      if (!this.isXhsImageSource(image) || this.viewerImageContext(image)) return '';
      const key = this.cacheKey(image.currentSrc || image.src || '');
      if (!key || !this.commentImageKeys.has(key)) return '';
      if (image.closest?.(
        'a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"], section.note-item, a.cover'
      )) return '';
      const width = image.clientWidth || image.naturalWidth;
      const height = image.clientHeight || image.naturalHeight;
      if (width < 120 || height < 120 || width * height < 20_000) return '';
      this.commentPreviewImages.add(image);
      return 'preview';
    }

    isContentImage(image, knownCommentKind) {
      if (!(image instanceof HTMLImageElement) || this.isAvatar(image)) return false;
      const source = image.currentSrc || image.src || '';
      if (!source || /(?:logo|icon|emoji)/i.test(source)) return false;
      const commentKind = knownCommentKind === undefined
        ? this.commentImageKind(image)
        : knownCommentKind;
      if (commentKind) return true;
      if (this.viewerImageContext(image)) return true;
      // Viewer banners, badges and other overlays may also contain XHS-hosted
      // images. They are not slides and must never receive analysis or controls.
      if (image.closest?.('#noteContainer')) return false;
      const xhsSource = this.isXhsImageSource(image);
      const identifiedPostCover = image.hasAttribute?.('data-xhs-img')
        || image.getAttribute?.('elementtiming') === 'card-exposed'
        || !!image.closest?.('section.note-item, [data-note-id], a.cover');
      if (xhsSource && identifiedPostCover) return true;
      const width = image.clientWidth || image.naturalWidth;
      const height = image.clientHeight || image.naturalHeight;
      if (width < 140 || height < 140) return false;
      return xhsSource
        && !!image.closest('a[href^="/explore/"], [class*="note-item"], [class*="cover"], section');
    }

    collectImages(root) {
      if (!this.processing) return;
      const images = root instanceof HTMLImageElement ? [root] : root.querySelectorAll?.('img') || [];
      // Register inline comment sources before examining preview copies. The
      // preview can be inserted earlier in DOM order than its originating
      // thumbnail, and its classes are not a stable public interface.
      const rootInsideModal = root.matches?.('#noteContainer, .note-container')
        || root.closest?.('#noteContainer, .note-container');
      const containedModal = rootInsideModal
        ? null
        : root.querySelector?.('#noteContainer, .note-container');
      let commentImages = [];
      if (rootInsideModal) commentImages = images;
      else if (containedModal) commentImages = containedModal.querySelectorAll?.('img') || [];
      else if (Array.prototype.some.call(
        images,
        image => !!image.closest?.('#noteContainer, .note-container')
      )) commentImages = images;
      for (const image of commentImages) this.rememberCommentImage(image);
      for (const image of images) this.observeImage(image);
      const modal = root.matches?.('#noteContainer, .note-container')
        ? root
        : root.querySelector?.('#noteContainer, .note-container');
      if (modal) this.prioritizeModal(modal);
    }

    imageRequestKey(image) {
      const picture = image?.parentElement?.matches?.('picture')
        ? image.parentElement
        : image?.closest?.('picture');
      const responsiveSources = [...(picture?.querySelectorAll?.('source') || [])]
        .flatMap(source => [
          source.getAttribute?.('src') || '',
          source.getAttribute?.('srcset') || '',
          source.getAttribute?.('sizes') || '',
          source.getAttribute?.('media') || '',
          source.getAttribute?.('type') || ''
        ]);
      return [
        image?.currentSrc || '',
        image?.getAttribute?.('src') || '',
        image?.src || '',
        image?.getAttribute?.('srcset') || image?.srcset || '',
        image?.getAttribute?.('sizes') || image?.sizes || '',
        ...responsiveSources
      ].join('\n');
    }

    imageForMutation(target) {
      if (typeof HTMLImageElement !== 'undefined' && target instanceof HTMLImageElement) return target;
      if (String(target?.tagName || '').toUpperCase() === 'IMG' || 'currentSrc' in (target || {})) return target;
      if (!target?.matches?.('source')) return null;
      return target.closest?.('picture')?.querySelector?.('img') || null;
    }

    createRecord(
      image,
      commentKind = this.commentImageKind(image),
      profileKey = this.profileKeyForImage(image, commentKind)
    ) {
      const record = {
        image,
        source: '',
        button: null,
        darkened: false,
        imageMode: null,
        concealed: null,
        result: null,
        commentKind,
        profileKey,
        requestKey: this.imageRequestKey(image),
        loadSource: '',
        loadPriority: Number.POSITIVE_INFINITY,
        loadGeneration: 0,
        loadHandler: null
      };
      this.records.set(image, record);
      if (commentKind === 'preview') this.commentPreviewRecords.add(record);
      this.intersectionObserver?.observe(image);
      return record;
    }

    recordCommentKind(record) {
      if (!record) return '';
      if (typeof record.commentKind === 'string') return record.commentKind;
      const commentKind = this.commentImageKind(record.image);
      record.commentKind = commentKind;
      if (commentKind === 'preview') this.commentPreviewRecords.add(record);
      return commentKind;
    }

    observeImage(image) {
      const commentKind = this.commentImageKind(image);
      if (!this.isContentImage(image, commentKind)) return;
      let record = this.records.get(image);
      if (record) {
        record.commentKind = commentKind;
        if (commentKind === 'preview') this.commentPreviewRecords.add(record);
        else this.commentPreviewRecords.delete(record);
        if (!commentKind) record.profileKey = this.currentProfileKey() || record.profileKey;
      }
      if (!record) {
        const profileKey = this.profileKeyForImage(image, commentKind);
        if (profileKey && this.disabledProfileKeys.has(profileKey)) return;
        record = this.createRecord(image, commentKind, profileKey);
      } else if (this.profileProcessingDisabled(record)) return;
      if (commentKind === 'preview' || this.viewerForImage(image)) {
        this.createControl(record);
        this.scheduleControlPositions();
      }
      if (this.applyCachedResult(record)) return;
      record.darkened = this.resolvedDarkened(record);
      if (record.darkened || this.resolvedConcealed(record)) this.updateRecordVisual(record);
      const viewerPriority = this.viewerForImage(image) ? -20 : null;
      if (viewerPriority !== null) {
        this.waitForImageLoad(record, viewerPriority);
      } else if (!image.complete || !image.naturalWidth) {
        this.waitForImageLoad(record, 0);
      }
    }

    prioritizeModal(modal) {
      this.observeViewer(modal);
      // Only the post carousel is urgent. Comment images remain governed by
      // IntersectionObserver so a long comment thread is never scanned ahead.
      const images = [...modal.querySelectorAll('img')]
        .filter(image => this.viewerImageContext(image));
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
      for (const record of [...this.controlRecords]) {
        if (root.contains?.(record.image) || record.commentKind === 'preview') continue;
        this.removeControl(record);
        if (record.result?.kind === 'photo') {
          this.clearVisual(record);
          this.retireRecord(record);
        }
      }
      this.viewerObserver?.disconnect();
      this.viewerObserver = new MutationObserver(this.onViewerMutations);
      this.viewerObserver.observe(root, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
        childList: true,
        subtree: true
      });
      this.viewerRoot = root;
    }

    onViewerMutations(mutations) {
      if (mutations?.length && !mutations.some(mutation => {
        if (mutation.type !== 'attributes') return true;
        const siteClasses = value => String(value || '').split(/\s+/)
          .filter(name => name && !name.startsWith('cg-xhs-image-')).sort().join(' ');
        return siteClasses(mutation.oldValue) !== siteClasses(mutation.target.getAttribute?.('class'));
      })) return;
      if (!this.processing || this.viewerRefreshFrame) return;
      this.viewerRefreshFrame = requestAnimationFrame(() => {
        this.viewerRefreshFrame = 0;
        const modal = this.viewerRoot?.closest?.('#noteContainer, .note-container');
        if (modal) this.prioritizeModal(modal);
        else this.scheduleControlPositions();
      });
    }

    onPostActivation(event) {
      const path = event.composedPath?.() || [];
      if (path.includes(this.controlHost)) return;
      if (this.controlRecords.size) this.scheduleControlPositions();
      let commentImage = path.find(node => this.inlineCommentImage(node));
      if (!commentImage) {
        const x = Number(event.clientX);
        const y = Number(event.clientY);
        const hasPoint = Number.isFinite(x) && Number.isFinite(y);
        outer: for (const node of path) {
          if (!node?.matches?.('[data-comment-id], [class*="comment"], [id*="comment"]')) continue;
          for (const image of node?.querySelectorAll?.('img') || []) {
            if (!this.inlineCommentImage(image)) continue;
            const rect = image.getBoundingClientRect?.();
            if (hasPoint && rect
              && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)) continue;
            commentImage = image;
            break outer;
          }
        }
      }
      if (commentImage) this.armCommentPreview(commentImage);
      if (this.commentPreviewRoot && path.includes(this.commentPreviewRoot)) {
        this.probeCommentPreviewGallery();
      }
      const anchor = path.find(node => node?.matches?.(
        'a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"]'
      ));
      const id = this.noteId(anchor?.href || anchor?.getAttribute?.('href'));
      if (id) {
        this.openingProfileKey = this.currentProfileKey();
        this.openingPostId = id;
        this.suspendControlPositions(POST_OPEN_TRANSITION_MS);
      } else if (this.viewerRoot && path.some(node => node?.matches?.(
        'button[aria-label*="close" i], .close, [class*="close-btn"], [class*="close-icon"]'
      ) && node.closest?.('#noteContainer, .note-container'))) {
        this.suspendControlPositions(POST_OPEN_TRANSITION_MS);
      }
    }

    onIntersections(entries) {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const distance = Math.abs(entry.boundingClientRect.top);
        this.queueImage(entry.target, distance < innerHeight ? -15 : Math.round(distance / Math.max(innerHeight, 1)));
      }
    }

    onPageMutations(mutations) {
      let needsCleanup = false;
      if (this.commentPreviewRoot?.isConnected === false) this.clearCommentPreviewGallery();
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const image = this.imageForMutation(mutation.target);
          if (!image) continue;
          const commentKind = this.commentImageKind(image);
          let record = this.records.get(image);
          if (!record) {
            if (!this.isContentImage(image, commentKind)) continue;
            const profileKey = this.profileKeyForImage(image, commentKind);
            if (profileKey && this.disabledProfileKeys.has(profileKey)) continue;
            record = this.createRecord(image, commentKind, profileKey);
            const priority = this.viewerForImage(image) ? -20 : 0;
            this.waitForImageLoad(record, priority);
            continue;
          }
          record.commentKind = commentKind;
          if (commentKind === 'preview') this.commentPreviewRecords.add(record);
          else this.commentPreviewRecords.delete(record);
          if (!commentKind) {
            record.profileKey = this.currentProfileKey() || record.profileKey;
          }
          const requestKey = this.imageRequestKey(image);
          if (record && record.requestKey !== requestKey) {
            record.cancelGesture?.();
            if (this.controlMenu?.record === record) this.closeControlMenu();
            const currentSource = image.currentSrc || image.src || '';
            const displayedSourceUnchanged = !!record.source && currentSource === record.source;
            if (!displayedSourceUnchanged) this.clearRecord(record);
            record.requestKey = requestKey;
            if (!displayedSourceUnchanged) {
              record.darkened = this.resolvedDarkened(record);
              this.createControl(record);
            }
            this.intersectionObserver?.observe(image);
            const priority = this.viewerForImage(image) ? -20 : 0;
            if (displayedSourceUnchanged) {
              this.waitForImageLoad(record, priority);
            } else if (!this.applyCachedResult(record)) {
              this.waitForImageLoad(record, priority);
            }
          }
          continue;
        }
        if (mutation.removedNodes?.length) needsCleanup = true;
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType === Node.ELEMENT_NODE) this.collectImages(node);
        }
      }
      if (this.controlRecords.size) this.scheduleControlPositions();
      this.syncProfileControl();
      if (needsCleanup) this.scheduleCleanup();
    }

    insertTask(task) {
      let low = 0;
      let high = this.queue.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const current = this.queue[middle];
        if (current.priority < task.priority
          || (current.priority === task.priority && current.order <= task.order)) low = middle + 1;
        else high = middle;
      }
      this.queue.splice(low, 0, task);
    }

    removeQueuedImage(image) {
      if (!this.queued.delete(image)) return;
      const index = this.queue.findIndex(task => task.image === image);
      if (index >= 0) this.queue.splice(index, 1);
    }

    queueImage(image, priority = 0) {
      const record = this.records.get(image);
      if (!this.processing || !record || !this.isContentImage(image, record.commentKind)) return;
      if (this.profileProcessingDisabled(record)) return;
      const source = image.currentSrc || image.src || '';
      if (!source || (record.source === source && record.result)) return;
      const pending = this.inFlight.get(image);
      if (pending?.source === source && pending.generation === this.processingGeneration) return;
      if (record.loadSource) return;
      if (!image.complete || !image.naturalWidth) {
        this.waitForImageLoad(record, priority);
        return;
      }
      record.loadSource = '';
      record.loadPriority = Number.POSITIVE_INFINITY;
      if (this.queued.has(image)) {
        const task = this.queue.find(item => item.image === image);
        if (task && priority < task.priority) {
          this.queue.splice(this.queue.indexOf(task), 1);
          task.priority = priority;
          this.insertTask(task);
          this.schedulePump(true);
        }
        return;
      }
      this.queued.add(image);
      this.insertTask({ image, priority, order: performance.now() });
      this.schedulePump(priority < 0);
    }

    waitForImageLoad(record, priority) {
      const image = record?.image;
      const requestKey = this.imageRequestKey(image);
      if (!image || !requestKey.trim()) return;
      record.loadPriority = Math.min(record.loadPriority ?? Number.POSITIVE_INFINITY, priority);
      const currentSource = image.currentSrc || image.src || '';
      if (image.complete && image.naturalWidth && currentSource
        && (!record.source || currentSource !== record.source)) {
        if (record.loadHandler) image.removeEventListener?.('load', record.loadHandler);
        record.loadHandler = null;
        record.loadSource = '';
        const queuedPriority = Number.isFinite(record.loadPriority) ? record.loadPriority : priority;
        record.loadPriority = Number.POSITIVE_INFINITY;
        this.queueImage(image, queuedPriority);
        return;
      }
      if (record.loadSource === requestKey) return;
      record.loadSource = requestKey;
      record.loadGeneration = (record.loadGeneration || 0) + 1;
      const generation = record.loadGeneration;
      if (record.loadHandler) image.removeEventListener?.('load', record.loadHandler);
      const onLoad = () => {
        if (record.loadHandler === onLoad) record.loadHandler = null;
        if (!this.processing || this.records.get(image) !== record
          || record.loadGeneration !== generation) return;
        const queuedPriority = Number.isFinite(record.loadPriority) ? record.loadPriority : priority;
        record.loadSource = '';
        record.loadPriority = Number.POSITIVE_INFINITY;
        if (requestKey !== this.imageRequestKey(image)) {
          this.waitForImageLoad(record, queuedPriority);
          return;
        }
        this.queueImage(image, queuedPriority);
      };
      record.loadHandler = onLoad;
      image.addEventListener('load', onLoad, { once: true });
    }

    schedulePump(urgent = false) {
      if (this.running >= 2 || !this.queue.length) return;
      if (this.pumpHandle) {
        if (!urgent || this.pumpKind === 'frame' || this.pumpKind === 'timeout-urgent') return;
        this.cancelPump();
      }
      const run = () => {
        this.pumpHandle = 0;
        this.pumpKind = '';
        this.pump();
      };
      if (urgent && typeof requestAnimationFrame === 'function') {
        this.pumpKind = 'frame';
        this.pumpHandle = requestAnimationFrame(run);
      } else if (urgent) {
        this.pumpKind = 'timeout-urgent';
        this.pumpHandle = setTimeout(run, 0);
      } else if (typeof requestIdleCallback === 'function') {
        this.pumpKind = 'idle';
        this.pumpHandle = requestIdleCallback(run, { timeout: 600 });
      } else {
        this.pumpKind = 'timeout';
        this.pumpHandle = setTimeout(run, 40);
      }
    }

    cancelPump() {
      if (!this.pumpHandle) return;
      if (this.pumpKind === 'idle' && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(this.pumpHandle);
      } else if (this.pumpKind === 'frame' && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.pumpHandle);
      } else {
        clearTimeout(this.pumpHandle);
      }
      this.pumpHandle = 0;
      this.pumpKind = '';
    }

    pump() {
      while (this.processing && this.running < 2 && this.queue.length) {
        const task = this.queue.shift();
        this.queued.delete(task.image);
        const record = this.records.get(task.image);
        if (!record || !task.image.isConnected
          || !this.isContentImage(task.image, record.commentKind)) continue;
        const generation = this.processingGeneration;
        const pending = { source: task.image.currentSrc || task.image.src || '', generation };
        this.inFlight.set(task.image, pending);
        this.running += 1;
        void this.analyze(task.image, generation).finally(() => {
          if (generation !== this.processingGeneration) return;
          if (this.inFlight.get(task.image) === pending) this.inFlight.delete(task.image);
          this.running -= 1;
          this.schedulePump((this.queue[0]?.priority ?? 0) < 0);
        });
      }
    }

    cacheKey(source) {
      const value = String(source || '');
      if (!value) return '';
      try {
        const url = new URL(value, location.href);
        if (/(?:^|\.)xhscdn\.com$/i.test(url.hostname)) {
          const filename = url.pathname.split('/').filter(Boolean).at(-1) || '';
          const identity = filename.split('!')[0];
          if (identity) return `xhs:${identity}`;
        }
        return url.href;
      } catch {
        return value;
      }
    }

    exactCacheKey(source) {
      const value = String(source || '');
      if (!value) return '';
      try {
        return `source:${new URL(value, location.href).href}`;
      } catch {
        return `source:${value}`;
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

    cachedResult(image, source) {
      const exactResult = this.cache.get(this.exactCacheKey(source));
      if (exactResult?.kind && exactResult.kind !== 'photo') return exactResult;
      const sourceResult = this.cache.get(this.cacheKey(source));
      if (sourceResult?.kind && sourceResult.kind !== 'photo') return sourceResult;
      const relatedResult = this.cache.get(this.noteCacheKey(image));
      if (relatedResult?.kind && relatedResult.kind !== 'photo') return relatedResult;
      return exactResult || null;
    }

    cacheResult(source, result, image = null) {
      if (!source || !result) return;
      const keys = [this.exactCacheKey(source)];
      if (result.kind !== 'photo') keys.push(this.cacheKey(source));
      const noteKey = this.noteCacheKey(image);
      if (noteKey && result.kind !== 'photo') keys.push(noteKey);
      for (const key of [...new Set(keys.filter(Boolean))]) {
        if (this.cache.has(key)) this.cache.delete(key);
        this.cache.set(key, result);
        while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
      }
      if (result.kind !== 'photo') this.refreshFeedCoverFromViewer(image);
    }

    refreshFeedCoverFromViewer(image) {
      if (!image || !this.viewerForImage(image)) return;
      const noteKey = this.noteCacheKey(image);
      const match = /^note:([^:]+):0$/.exec(noteKey);
      if (!match) return;
      const postId = match[1];
      const anchors = document.querySelectorAll?.(
        'a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"]'
      ) || [];
      const seen = new Set();
      for (const anchor of anchors) {
        if (this.noteId(anchor.href || anchor.getAttribute?.('href')) !== postId) continue;
        const images = anchor.matches?.('img') ? [anchor] : anchor.querySelectorAll?.('img') || [];
        for (const relatedImage of images) {
          if (relatedImage === image || seen.has(relatedImage) || !relatedImage.isConnected
            || !this.isContentImage(relatedImage)) continue;
          seen.add(relatedImage);
          const record = this.records.get(relatedImage) || this.createRecord(relatedImage);
          this.applyCachedResult(record);
        }
      }
    }

    applyCachedResult(record) {
      const source = record?.image?.currentSrc || record?.image?.src || '';
      if (!source) return false;
      const cached = this.cachedResult(record.image, source);
      if (!cached) return record.source === source && !!record.result;
      if (record.source === source && record.result === cached) return true;
      this.adoptSource(record, source);
      record.result = cached;
      this.applyResult(record);
      return true;
    }

    adoptSource(record, source) {
      if (record.source && record.source !== source) {
        record.cancelGesture?.();
        record.imageMode = null;
        record.concealed = null;
        if (this.controlMenu?.record === record) this.closeControlMenu();
      }
      record.source = source;
    }

    async analyze(image, generation = this.processingGeneration) {
      const record = this.records.get(image);
      if (!record || !this.processing || generation !== this.processingGeneration
        || this.profileProcessingDisabled(record)) return;
      const source = image.currentSrc || image.src || '';
      if (!source) return;
      const cached = this.cachedResult(image, source);
      if (cached) {
        this.adoptSource(record, source);
        record.result = cached;
        this.applyResult(record);
        return;
      }
      try { await image.decode?.(); } catch {}
      if (!this.processing || generation !== this.processingGeneration
        || this.profileProcessingDisabled(record)
        || this.records.get(image) !== record || !image.isConnected
        || source !== (image.currentSrc || image.src || '')) return;
      const sample = await this.sampleImage(image);
      if (!this.processing || generation !== this.processingGeneration
        || this.profileProcessingDisabled(record)
        || this.records.get(image) !== record || !image.isConnected
        || source !== (image.currentSrc || image.src || '')) return;
      if (!sample) return;
      const result = this.classifySample(sample.data, sample.width, sample.height);
      this.cacheResult(source, result, image);
      record.requestKey = this.imageRequestKey(image);
      this.adoptSource(record, source);
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
      const width = Math.min(MAX_SAMPLE_PIXELS, Math.max(1, Math.floor(sourceWidth * scale)));
      const height = Math.min(Math.floor(MAX_SAMPLE_PIXELS / width), Math.max(1, Math.floor(sourceHeight * scale)));
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
      const rowOpaque = new Uint16Array(height);
      const rowLightSurface = new Uint16Array(height);
      const rowDarkSurface = new Uint16Array(height);
      const edgeBand = Math.max(1, Math.round(Math.min(width, height) * 0.08));
      let opaque = 0;
      let edgeOpaque = 0;
      let transparent = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const alpha = data[offset + 3] / 255;
        if (alpha < 0.95) transparent += 1;
        const r = Math.round(data[offset] * alpha + 255 * (1 - alpha));
        const g = Math.round(data[offset + 1] * alpha + 255 * (1 - alpha));
        const b = Math.round(data[offset + 2] * alpha + 255 * (1 - alpha));
        const key = (Math.min(COLOR_BUCKETS - 1, r >> 5) << 6)
          | (Math.min(COLOR_BUCKETS - 1, g >> 5) << 3)
          | Math.min(COLOR_BUCKETS - 1, b >> 5);
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
        rowOpaque[y] += 1;
        const pixelValue = luminance({ r, g, b });
        const pixelChroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        if (pixelValue >= 0.72 && pixelChroma <= 0.32) rowLightSurface[y] += 1;
        if (pixelValue <= 0.28 && pixelChroma <= 0.18) rowDarkSurface[y] += 1;
        opaque += 1;
        if (x < edgeBand || x >= width - edgeBand || y < edgeBand || y >= height - edgeBand) {
          edgeBuckets.set(key, (edgeBuckets.get(key) || 0) + 1);
          edgeOpaque += 1;
        }
      }
      if (!buckets.size) return { kind: 'photo' };
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
      const vividBackground = !lightBackground && !grayBackground
        ? colorsByShare.find(color => color.share >= 0.58
          && color.value >= 0.52 && color.chroma <= 0.72)
        : null;
      const darkPanel = lightBackground && colorsByShare.find(color => color.key !== lightBackground.key
        && color.share >= 0.12 && color.value <= 0.28 && color.chroma <= 0.18);
      const strongestPanelShare = counts => {
        const panelRows = Math.max(3, Math.round(height * 0.14));
        let panelPixels = 0;
        let panelOpaque = 0;
        let strongest = 0;
        for (let y = 0; y < height; y += 1) {
          panelPixels += counts[y];
          panelOpaque += rowOpaque[y];
          if (y >= panelRows) {
            panelPixels -= counts[y - panelRows];
            panelOpaque -= rowOpaque[y - panelRows];
          }
          if (y + 1 >= panelRows && panelOpaque) {
            strongest = Math.max(strongest, panelPixels / panelOpaque);
          }
        }
        return strongest;
      };
      const lightPanelShare = strongestPanelShare(rowLightSurface);
      const darkPanelShare = strongestPanelShare(rowDarkSurface);
      const splitToneLayout = !!(lightBackground && darkPanel
        && lightBackground.share + darkPanel.share >= 0.62
        && lightPanelShare >= 0.72
        && darkPanelShare >= 0.48);
      const background = lightBackground || grayBackground || vividBackground;
      if (!background) return { kind: 'photo' };
      const grayCard = !lightBackground && background === grayBackground;
      const vividCard = !lightBackground && !grayCard && background === vividBackground;
      const backgroundLuminance = luminance(background);
      const annotationSurfaces = lightBackground?.share >= 0.58
        ? colorsByShare.filter(color => color.key !== lightBackground.key
          && color.share >= 0.008 && color.share <= 0.18
          && color.value >= Math.max(0.62, backgroundLuminance - 0.28)
          && color.chroma >= 0.18 && color.chroma <= 0.78).slice(0, 3)
        : [];
      const annotationShare = annotationSurfaces.reduce((total, color) => total + color.share, 0);
      const annotatedCard = annotationShare >= 0.03 && annotationShare <= 0.24;
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
      const conversationSurfaceCandidates = lightBackground
        ? colorsByShare.filter(color => {
          if (color.key === lightBackground.key
            || color.share < 0.025 || color.share > 0.38
            || color.value < 0.54 || color.chroma < 0.16 || color.chroma > 0.75) return false;
          const dr = (color.r - lightBackground.r) / 255;
          const dg = (color.g - lightBackground.g) / 255;
          const db = (color.b - lightBackground.b) / 255;
          return dr * dr + dg * dg + db * db >= 0.025;
        }).slice(0, 3)
        : [];
      const conversationSurfaceShare = conversationSurfaceCandidates
        .reduce((total, color) => total + color.share, 0);
      let conversationLayout = false;
      let conversationSurfaceComponents = { count: 0, largestShare: 0 };
      if (conversationSurfaceShare >= 0.06 && conversationSurfaceShare <= 0.4) {
        const conversationMask = new Uint8Array(pixelCount);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          const offset = pixel * 4;
          const alpha = data[offset + 3] / 255;
          const color = {
            r: Math.round(data[offset] * alpha + 255 * (1 - alpha)),
            g: Math.round(data[offset + 1] * alpha + 255 * (1 - alpha)),
            b: Math.round(data[offset + 2] * alpha + 255 * (1 - alpha))
          };
          if (conversationSurfaceCandidates.some(surface => {
            const dr = (color.r - surface.r) / 255;
            const dg = (color.g - surface.g) / 255;
            const db = (color.b - surface.b) / 255;
            return dr * dr + dg * dg + db * db <= 0.045;
          })) conversationMask[pixel] = 1;
        }
        conversationSurfaceComponents = this.componentStats(conversationMask, width, height, opaque);
        conversationLayout = conversationSurfaceComponents.count >= 3
          && conversationSurfaceComponents.largestShare <= 0.16;
      }
      const surfacePalette = grayCard
        ? colorsByShare.filter(color => color.share >= 0.02
          && color.chroma <= 0.18 && Math.abs(color.value - backgroundLuminance) <= 0.16).slice(0, 4)
        : vividCard
          ? colorsByShare.filter(color => {
            const dr = (color.r - background.r) / 255;
            const dg = (color.g - background.g) / 255;
            const db = (color.b - background.b) / 255;
            return color.share >= 0.006
              && dr * dr + dg * dg + db * db <= 0.06
              && Math.abs(color.value - backgroundLuminance) <= 0.22;
          }).slice(0, 6)
          : [...lightSurfaces];
      if (conversationLayout) {
        for (const surface of conversationSurfaceCandidates) {
          if (!surfacePalette.some(existing => existing.key === surface.key)) surfacePalette.push(surface);
        }
      }
      if (annotatedCard) {
        for (const annotation of annotationSurfaces) {
          if (!surfacePalette.some(surface => surface.key === annotation.key)) surfacePalette.push(annotation);
        }
      }
      if (frame && !surfacePalette.some(surface => surface.key === frame.key)) surfacePalette.push(frame);
      if (splitToneLayout && !surfacePalette.some(surface => surface.key === darkPanel.key)) {
        surfacePalette.push(darkPanel);
      }
      const foregroundMask = new Uint8Array(pixelCount);
      let surfaceCount = 0;
      let lightCount = 0;
      let contrastForegroundCount = 0;
      let foregroundCount = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        const alpha = data[offset + 3] / 255;
        const color = {
          r: Math.round(data[offset] * alpha + 255 * (1 - alpha)),
          g: Math.round(data[offset + 1] * alpha + 255 * (1 - alpha)),
          b: Math.round(data[offset + 2] * alpha + 255 * (1 - alpha))
        };
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
          if (splitToneLayout
            || (grayCard
              ? value >= backgroundLuminance + 0.22
              : vividCard
                ? Math.abs(value - backgroundLuminance) >= 0.22
                : value <= backgroundLuminance - 0.22)) {
            contrastForegroundCount += 1;
          }
        }
      }
      const surfaceShare = surfaceCount / opaque;
      const foregroundShare = foregroundCount / opaque;
      const lightShare = lightCount / opaque;
      const contrastForegroundShare = contrastForegroundCount / opaque;
      const transparencyShare = transparent / pixelCount;
      const foregroundComponents = this.componentStats(foregroundMask, width, height, opaque);
      const largestForegroundShare = foregroundComponents.largestShare;
      const uniformLightSurface = !grayCard && !vividCard && surfacePalette.length > 0
        && surfaceShare >= 0.72
        && lightShare >= (splitToneLayout ? 0.24 : frame ? 0.5 : 0.72);
      const uniformGraySurface = grayCard
        && surfacePalette.length > 0
        && surfaceShare >= 0.72;
      const uniformVividSurface = vividCard
        && surfacePalette.length > 0
        && surfaceShare >= 0.72;
      const regularTextForeground = foregroundShare >= 0.008
        && foregroundShare <= 0.32
        && contrastForegroundShare >= 0.006
        && largestForegroundShare <= 0.16;
      const sparseTextForeground = !grayCard && !vividCard
        && surfaceShare >= 0.985
        && backgroundLuminance >= 0.9
        && foregroundShare >= 0.005
        && foregroundShare < 0.008
        && contrastForegroundShare >= 0.004
        && foregroundComponents.count >= 3
        && largestForegroundShare <= 0.006;
      const textLikeForeground = regularTextForeground || sparseTextForeground;
      const vividTextStructure = !vividCard
        || (foregroundComponents.count >= 5 && largestForegroundShare <= 0.08);
      const annotationTextStructure = !annotatedCard
        || (foregroundComponents.count >= 5 && largestForegroundShare <= 0.12);
      const conversationTextStructure = !conversationLayout
        || (foregroundComponents.count >= 5 && largestForegroundShare <= 0.08);
      const transparentTextStructure = transparencyShare < 0.1
        || (foregroundComponents.count >= 3 && largestForegroundShare <= 0.12);
      return {
        kind: textLikeForeground && vividTextStructure && annotationTextStructure
          && conversationTextStructure && transparentTextStructure
          && (uniformLightSurface || uniformGraySurface || uniformVividSurface)
          ? grayCard ? 'gray-theme' : 'light-theme'
          : 'photo',
        backgroundShare: surfaceShare,
        surfaceCount: surfacePalette.length,
        frameDetected: frame !== null,
        splitToneLayout,
        frameEdgeShare: frame?.edgeShare || 0,
        foregroundShare,
        contrastForegroundShare,
        sparseTextForeground,
        backgroundLuminance,
        annotationShare,
        conversationLayout,
        conversationSurfaceShare,
        conversationSurfaceComponentCount: conversationSurfaceComponents.count,
        transparencyShare,
        largestForegroundShare,
        foregroundComponentCount: foregroundComponents.count
      };
    }

    componentStats(mask, width, height, opaque) {
      const visited = new Uint8Array(mask.length);
      const stack = [];
      let largest = 0;
      let count = 0;
      for (let start = 0; start < mask.length; start += 1) {
        if (!mask[start] || visited[start]) continue;
        count += 1;
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
      return { count, largestShare: largest / Math.max(opaque, 1) };
    }

    applyResult(record) {
      if (!this.processing || !record.image.isConnected || !record.result) return;
      this.intersectionObserver?.unobserve?.(record.image);
      this.clearVisual(record, false);
      const commentKind = this.recordCommentKind(record);
      const commentPreview = commentKind === 'preview';
      const override = commentKind ? null : this.postOverride(record);
      record.darkened = this.resolvedDarkened(record);
      const viewer = this.viewerForImage(record.image);
      if (viewer || commentPreview) this.createControl(record);
      this.updateRecordVisual(record, false);
      if (viewer || commentPreview) this.scheduleControlPositions();
      else if (record.result.kind === 'photo' && !override && !this.resolvedConcealed(record)
        && !commentPreview) {
        this.clearVisual(record, false);
        this.retireRecord(record);
      }
      this.syncInterventionStatus();
    }

    createControl(record) {
      const commentPreview = this.recordCommentKind(record) === 'preview';
      if (!this.controlLayer || record.button
        || (!commentPreview && !this.viewerForImage(record.image))) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      // Keep newly discovered controls out of the hit-testing layer until their
      // owning slide has been selected and positioned on the next frame.
      button.style.display = 'none';
      if (commentPreview) this.bindCommentControl(button, record);
      else this.bindControlGestures(button, record);
      this.controlLayer.append(button);
      record.button = button;
      this.controlRecords.add(record);
      if (this.showImageControl) {
        this.resizeObserver?.observe(record.image);
        this.startControlPositionTracking();
      }
      this.updateControl(record);
    }

    automaticDarkened(record) {
      return record?.result?.kind === 'light-theme' || record?.result?.kind === 'gray-theme';
    }

    resolvedDarkened(record) {
      if (this.profileProcessingDisabled(record)) return false;
      const override = this.recordCommentKind(record) ? null : this.postOverride(record);
      if (record.imageMode === 'auto') return this.automaticDarkened(record);
      if (record.imageMode) return record.imageMode === 'dark';
      return override?.darkened ?? this.automaticDarkened(record);
    }

    viewerPostKey(image) {
      if (this.commentImageKind(image)) return '';
      const noteKey = this.noteCacheKey(image);
      const match = /^note:([^:]+):/.exec(noteKey);
      return match?.[1] || (this.viewerForImage(image)
        ? this.noteId(location.href) || this.openingPostId || '' : '');
    }

    profileId(value) {
      try {
        return new URL(value, location.href).pathname.match(/^\/user\/profile\/([^/]+)/)?.[1] || '';
      } catch {
        return '';
      }
    }

    currentProfileKey() {
      return this.profileId(location.href);
    }

    profileKeyForImage(image, knownCommentKind) {
      const commentKind = knownCommentKind === undefined
        ? this.commentImageKind(image)
        : knownCommentKind;
      if (commentKind) return '';
      const currentProfileKey = this.currentProfileKey();
      if (currentProfileKey) return currentProfileKey;
      const postKey = this.viewerForImage(image) ? this.viewerPostKey(image) : '';
      return postKey && postKey === this.openingPostId ? this.openingProfileKey : '';
    }

    profileProcessingDisabled(recordOrImage) {
      const image = recordOrImage?.image || recordOrImage;
      const hasStoredProfileKey = !!recordOrImage && typeof recordOrImage === 'object'
        && Object.prototype.hasOwnProperty.call(recordOrImage, 'profileKey');
      const profileKey = hasStoredProfileKey
        ? recordOrImage.profileKey
        : this.profileKeyForImage(image);
      return !!profileKey && this.disabledProfileKeys.has(profileKey);
    }

    toggleProfileDisabled() {
      this.closeControlMenu();
      const profileKey = this.currentProfileKey();
      if (!profileKey) return;
      const nextDisabled = !this.disabledProfileKeys.has(profileKey);
      if (nextDisabled) this.disabledProfileKeys.add(profileKey);
      else this.disabledProfileKeys.delete(profileKey);
      for (const record of this.records.values()) {
        if (record.profileKey !== profileKey) continue;
        if (nextDisabled) {
          this.intersectionObserver?.unobserve?.(record.image);
          this.removeQueuedImage(record.image);
          record.darkened = false;
          this.updateRecordVisual(record, false);
        } else if (record.result) {
          record.darkened = this.resolvedDarkened(record);
          this.updateRecordVisual(record, false);
        } else {
          this.intersectionObserver?.observe?.(record.image);
        }
      }
      if (!nextDisabled) this.collectImages(document);
      this.updateProfileControl();
      this.updateControls();
      this.syncInterventionStatus();
    }

    syncProfileControl() {
      if (!this.controlLayer) return;
      const currentUrl = String(location.href || '');
      const controlMatchesCurrentPage = currentUrl === this.profileControlUrl
        && ((this.profileControlKey && this.profileControl?.isConnected !== false)
          || (!this.profileControlKey && !this.profileControl));
      if (controlMatchesCurrentPage) return;
      this.profileControlUrl = currentUrl;
      const profileKey = this.currentProfileKey();
      if (!profileKey) {
        this.profileControl?.remove();
        this.profileControl = null;
        this.profileControlKey = '';
        return;
      }
      if (this.profileControl?.isConnected === false) this.profileControl = null;
      if (this.profileControl && this.profileControlKey === profileKey) return;
      if (!this.profileControl) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'profile-control';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          this.toggleProfileDisabled();
        });
        this.controlLayer.append(button);
        this.profileControl = button;
      }
      this.profileControlKey = profileKey;
      this.updateProfileControl();
    }

    updateProfileControl() {
      if (!this.profileControl) return;
      const disabled = this.disabledProfileKeys.has(this.profileControlKey || this.currentProfileKey());
      const label = disabled ? COPY[this.locale].profileDisabled : COPY[this.locale].profileEnabled;
      this.profileControl.style.opacity = String(this.controlOpacity);
      this.profileControl.innerHTML = disabled ? POST_DISABLED_ICON : PROFILE_ENABLED_ICON;
      this.profileControl.title = label;
      this.profileControl.setAttribute('aria-label', label);
    }

    postOverride(record) {
      const postKey = this.viewerPostKey(record?.image);
      if (!postKey || !this.postOverrides.has(postKey)) return null;
      const choice = this.postOverrides.get(postKey);
      return { postKey, mode: choice === 'original' ? 'original' : choice ? 'dark' : 'light',
        darkened: choice === true };
    }

    recordsForPost(postKey) {
      const matches = new Set();
      for (const record of this.records.values()) {
        if (record.image.isConnected !== false && this.viewerPostKey(record.image) === postKey) matches.add(record);
      }
      const anchors = document.querySelectorAll?.(
        'a[href^="/explore/"], a[href*="xiaohongshu.com/explore/"]'
      ) || [];
      for (const anchor of anchors) {
        if (this.noteId(anchor.href || anchor.getAttribute?.('href')) !== postKey) continue;
        const images = anchor.matches?.('img') ? [anchor] : anchor.querySelectorAll?.('img') || [];
        for (const image of images) {
          if (!image.isConnected || !this.isContentImage(image)) continue;
          this.observeImage(image);
          const related = this.records.get(image);
          if (related) matches.add(related);
        }
      }
      return matches;
    }

    applyPostMode(postKey, mode) {
      this.concealedPosts.delete(postKey);
      const forced = typeof mode === 'boolean' || mode === 'original';
      for (const related of this.recordsForPost(postKey)) {
        related.imageMode = null;
        related.concealed = null;
        related.darkened = this.profileProcessingDisabled(related)
          ? false
          : (forced ? mode === true : this.automaticDarkened(related));
        this.updateRecordVisual(related, false);
        if (!forced && related.result?.kind === 'photo'
          && !this.viewerForImage(related.image)) {
          this.clearVisual(related, false);
          this.retireRecord(related);
        }
      }
      this.syncInterventionStatus();
    }

    togglePostOverride(record) {
      const viewer = this.viewerForImage(record?.image);
      if (!viewer || this.profileProcessingDisabled(record)) return;
      const postKey = this.viewerPostKey(record.image);
      if (!postKey) return;
      const existing = this.postOverride(record);
      const darkened = existing ? !existing.darkened : !record.darkened;
      this.postOverrides.set(postKey, darkened);
      this.applyPostMode(postKey, darkened);
    }

    restorePostAutomatic(record) {
      const postKey = this.viewerPostKey(record?.image);
      if (!postKey) return;
      this.postOverrides.delete(postKey);
      this.applyPostMode(postKey, null);
    }

    activateImageControl(record) {
      if (this.profileProcessingDisabled(record)) return;
      if (record.concealed === true) {
        record.concealed = false;
        this.updateRecordVisual(record);
        return;
      }
      if (this.resolvedConcealed(record)) {
        this.restoreConcealedPost(record);
        return;
      }
      if (!this.recordCommentKind(record) && this.postOverride(record)) {
        this.restorePostAutomatic(record);
        return;
      }
      this.setImageMode(record, record.darkened ? 'light' : 'dark');
    }

    resolvedConcealed(record) {
      if (this.profileProcessingDisabled(record)) return false;
      return record.concealed ?? this.concealedPosts.has(this.viewerPostKey(record.image));
    }

    setImageMode(record, mode) {
      if (this.profileProcessingDisabled(record)) return;
      record.imageMode = mode;
      record.concealed = false;
      record.darkened = this.resolvedDarkened(record);
      this.updateRecordVisual(record);
    }

    setPostMode(record, mode) {
      const postKey = this.viewerPostKey(record.image);
      if (!postKey) return;
      if (mode === 'auto') this.restorePostAutomatic(record);
      else {
        const choice = mode === 'original' ? 'original' : mode === 'dark';
        this.postOverrides.set(postKey, choice);
        this.applyPostMode(postKey, choice);
      }
    }

    concealImage(record) {
      record.concealed = true;
      this.updateRecordVisual(record);
    }

    concealPost(record) {
      const postKey = this.viewerPostKey(record.image);
      if (!postKey) return;
      this.concealedPosts.add(postKey);
      for (const related of this.recordsForPost(postKey)) {
        related.concealed = null;
        this.updateRecordVisual(related, false);
      }
      this.syncInterventionStatus();
    }

    restoreConcealedPost(record) {
      const postKey = this.viewerPostKey(record.image);
      if (!postKey || !this.concealedPosts.delete(postKey)) return;
      for (const related of this.records.values()) {
        if (related.image.isConnected === false || this.viewerPostKey(related.image) !== postKey) continue;
        this.updateRecordVisual(related, false);
        if (related.result?.kind === 'photo' && !this.postOverride(related)
          && !related.imageMode && !this.resolvedConcealed(related)
          && !this.viewerForImage(related.image)) {
          this.clearVisual(related, false);
          this.retireRecord(related);
        }
      }
      this.syncInterventionStatus();
    }

    postImageCount(record) {
      if (this.recordCommentKind(record)) return 1;
      const viewer = this.viewerForImage(record.image);
      if (!viewer) return 1;
      const total = Number(viewer.querySelector?.('.fraction')?.textContent?.match(/[/／]\s*(\d+)/)?.[1]) || 0;
      const carousel = viewer.querySelector?.('.xhs-slider-container, .note-slider') || viewer;
      const slides = carousel.querySelectorAll?.('.swiper-slide') || [];
      const indexes = new Set([...slides].map(slide => slide.getAttribute?.('data-swiper-slide-index') ?? slide));
      return Math.max(1, total, indexes.size);
    }

    controlMenuGroups(record) {
      const copy = COPY[this.locale];
      const override = this.postOverride(record);
      const imageMode = record.imageMode || override?.mode || 'auto';
      const group = (title, selected, action) => ({ title, items: ['hide', 'auto', 'dark', 'light', 'original'].map(mode =>
        ({ label: copy[mode], selected: selected === mode, run: () => action(mode) })) });
      const groups = [group(copy.imageGroup, this.resolvedConcealed(record) ? 'hide' : imageMode,
        mode => mode === 'hide' ? this.concealImage(record) : this.setImageMode(record, mode))];
      if (this.postImageCount(record) > 1) {
        const postKey = this.viewerPostKey(record.image);
        const postHidden = this.concealedPosts.has(postKey);
        const hasImageChoices = [...this.records.values()].some(related =>
          related.image.isConnected !== false && (postHidden ? related.concealed === false
            : related.imageMode || typeof related.concealed === 'boolean')
          && this.viewerPostKey(related.image) === postKey);
        const selected = hasImageChoices ? null : postHidden ? 'hide'
          : override?.mode || 'auto';
        groups.push(group(copy.allGroup, selected,
          mode => mode === 'hide' ? this.concealPost(record) : this.setPostMode(record, mode)));
      }
      return groups;
    }

    closeControlMenu(restoreFocus = false) {
      const menu = this.controlMenu;
      if (!menu) return;
      this.controlMenu = null;
      menu.cleanup();
      menu.element.remove();
      menu.record.button?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) menu.record.button?.focus?.({ preventScroll: true });
    }

    openControlMenu(record) {
      this.closeControlMenu();
      if (!this.controlLayer || !record.button || record.button.hidden) return;
      const menu = document.createElement('div');
      menu.className = 'image-menu';
      menu.tabIndex = -1;
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', COPY[this.locale].menuTitle);
      const source = record.source;
      const requestKey = record.requestKey;
      for (const [index, group] of this.controlMenuGroups(record).entries()) {
        if (index) menu.append(document.createElement('hr'));
        const heading = document.createElement('div');
        heading.className = 'menu-heading';
        heading.textContent = group.title;
        const section = document.createElement('div');
        section.setAttribute('role', 'group');
        section.setAttribute('aria-label', group.title);
        section.append(heading);
        for (const action of group.items) {
          const item = document.createElement('button');
          item.type = 'button';
          item.setAttribute('role', 'menuitemradio');
          item.setAttribute('aria-checked', String(action.selected));
          item.textContent = action.label;
          item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            this.closeControlMenu(true);
            if (record.image.isConnected && record.source === source && record.requestKey === requestKey) action.run();
          });
          section.append(item);
        }
        menu.append(section);
      }
      for (const type of ['pointerdown', 'pointerup', 'contextmenu']) menu.addEventListener(type, event => {
        event.stopPropagation();
        if (type === 'contextmenu') event.preventDefault();
      });
      const outside = event => {
        if (!event.composedPath().includes(this.controlHost)) this.closeControlMenu();
      };
      const keydown = event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          this.closeControlMenu(true);
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
          return;
        }
        const direction = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: 0 }[event.key];
        if (direction === undefined) return;
        event.preventDefault(); event.stopPropagation();
        const items = [...menu.querySelectorAll('button')];
        const current = items.indexOf(menu.getRootNode().activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : current < 0 ? direction > 0 ? 0 : items.length - 1
            : (current + direction + items.length) % items.length;
        items[next]?.focus();
      };
      window.addEventListener('pointerdown', outside, true);
      window.addEventListener('keydown', keydown, true);
      this.controlMenu = { record, element: menu, cleanup: () => {
        window.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('keydown', keydown, true);
      } };
      record.button.setAttribute('aria-expanded', 'true');
      this.controlLayer.append(menu);
      const anchor = record.button.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, anchor.left))}px`;
      menu.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, anchor.bottom + 6))}px`;
      menu.focus({ preventScroll: true });
    }

    bindControlGestures(button, record, allowHold = true) {
      let timer = 0;
      let gesture = null;
      let suppressClick = false;
      const cancelTimer = () => {
        if (timer) clearTimeout(timer);
        timer = 0;
      };
      const cancel = () => {
        cancelTimer();
        gesture = null;
        suppressClick = true;
      };
      record.cancelGesture = cancel;
      const shield = event => {
        event.preventDefault?.();
        event.stopPropagation?.();
      };
      const unchanged = press => record.image?.isConnected !== false
        && press.source === record.source && press.requestKey === record.requestKey;
      button.addEventListener('pointerdown', event => {
        shield(event);
        if (event.isPrimary === false) return;
        cancel();
        this.closeControlMenu();
        // Control-click is the native context-menu gesture on macOS.
        if (event.ctrlKey || (event.button !== undefined && event.button !== 0)) return;
        suppressClick = false;
        gesture = { id: event.pointerId, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0,
          source: record.source, requestKey: record.requestKey, held: false, moved: false };
        const press = gesture;
        try { button.setPointerCapture?.(event.pointerId); } catch {}
        if (allowHold) timer = setTimeout(() => {
          timer = 0;
          if (gesture !== press || press.moved || !unchanged(press)) return;
          press.held = true;
          suppressClick = true;
          this.togglePostOverride(record);
        }, LONG_PRESS_MS);
      });
      button.addEventListener('pointermove', event => {
        shield(event);
        if (!gesture || event.pointerId !== gesture.id) return;
        if (Math.hypot((Number(event.clientX) || 0) - gesture.x,
          (Number(event.clientY) || 0) - gesture.y) > LONG_PRESS_MOVE_TOLERANCE) {
          gesture.moved = true;
          cancelTimer();
        }
      });
      button.addEventListener('pointerup', event => {
        shield(event);
        if (!gesture || event.pointerId !== gesture.id) return;
        const press = gesture;
        cancel();
        // Commit a tap here: a carousel or DOM update may prevent Chrome from
        // delivering click, but it must not turn a tap into a no-op or double tap.
        if (!press.held && !press.moved && unchanged(press)) this.activateImageControl(record);
      });
      for (const type of ['pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, event => {
          shield(event);
          if (gesture && event.pointerId === gesture.id) cancel();
        });
      }
      button.addEventListener('contextmenu', event => {
        shield(event);
        // Touch long-press belongs to the post-wide gesture, not right-click.
        if (event.pointerType === 'touch') return;
        cancel();
        this.openControlMenu(record);
      });
      for (const type of ['mousedown', 'mouseup', 'auxclick', 'dblclick']) button.addEventListener(type, shield);
      button.addEventListener('click', event => {
        shield(event);
        if (event.ctrlKey || (event.button !== undefined && event.button !== 0)) return;
        const ignored = suppressClick && event.detail !== 0;
        suppressClick = false;
        if (!ignored) this.activateImageControl(record);
      });
    }

    bindCommentControl(button, record) {
      this.bindControlGestures(button, record, false);
    }

    startControlPositionTracking() {
      if (this.controlViewportListening) return;
      this.controlViewportListening = true;
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      for (const type of ['transitionrun', 'transitionend', 'transitioncancel',
        'animationstart', 'animationend', 'animationcancel']) {
        document.addEventListener(type, this.onControlMotion, true);
      }
    }

    stopControlPositionTracking() {
      if (!this.controlViewportListening) return;
      this.controlViewportListening = false;
      window.removeEventListener('scroll', this.onViewportChange, true);
      window.removeEventListener('resize', this.onViewportChange, false);
      for (const type of ['transitionrun', 'transitionend', 'transitioncancel',
        'animationstart', 'animationend', 'animationcancel']) {
        document.removeEventListener(type, this.onControlMotion, true);
      }
    }

    suspendControlPositions(duration) {
      if (!this.processing) return;
      this.controlTransitionUntil = Math.max(this.controlTransitionUntil, Date.now() + duration);
      if (this.positionFrame) cancelAnimationFrame(this.positionFrame);
      this.positionFrame = 0;
      for (const record of this.controlRecords) {
        if (record.button) record.button.style.display = 'none';
        record.cancelGesture?.();
      }
      this.closeControlMenu();
      if (this.controlTransitionTimer) clearTimeout(this.controlTransitionTimer);
      this.controlTransitionTimer = setTimeout(() => {
        this.controlTransitionTimer = 0;
        this.scheduleControlPositions();
      }, Math.max(1, this.controlTransitionUntil - Date.now() + 1));
    }

    onControlResize(entries) {
      let changing = false;
      for (const entry of entries) {
        const record = this.records.get(entry.target);
        if (!record?.button || !record.image.isConnected || !entry.contentRect) continue;
        const { width, height } = entry.contentRect;
        const last = record.controlImageSize;
        record.controlImageSize = { width, height };
        if (last && (Math.abs(width - last.width) > 1 || Math.abs(height - last.height) > 1)) changing = true;
      }
      if (changing) this.suspendControlPositions(CONTROL_RESIZE_SETTLE_MS);
      else this.scheduleControlPositions();
    }

    onControlMotion(event) {
      const target = event.target;
      const modal = this.viewerRoot?.closest?.('#noteContainer, .note-container');
      if (!this.processing || !this.controlRecords.size || !this.viewerRoot
        || !(this.viewerRoot.contains?.(target)
          || (modal?.contains?.(target) && target?.contains?.(this.viewerRoot)))) return;
      if (event.type === 'transitionrun' || event.type === 'animationstart') {
        this.suspendControlPositions(CONTROL_RESIZE_SETTLE_MS);
      } else this.scheduleControlPositions();
    }

    hasControlMotion(record) {
      let node = record.image;
      for (let depth = 0; node && depth < 8 && node !== document.body; depth += 1, node = node.parentElement) {
        for (const animation of node.getAnimations?.() || []) {
          if (animation.playState !== 'running') continue;
          let frames;
          try { frames = animation.effect?.getKeyframes?.() || []; } catch { continue; }
          if (!frames.some(frame => ['transform', 'translate', 'scale', 'width', 'height',
            'left', 'right', 'top', 'bottom', 'opacity'].some(property => property in frame))) continue;
          const finished = animation.finished;
          if (finished && this.watchedControlAnimations.get(animation) !== finished) {
            this.watchedControlAnimations.set(animation, finished);
            Promise.resolve(finished).then(
              () => this.scheduleControlPositions(),
              () => this.scheduleControlPositions()
            );
          }
          return true;
        }
      }
      return false;
    }

    removeControl(record) {
      this.resizeObserver?.unobserve?.(record.image);
      record.cancelGesture?.();
      record.cancelGesture = null;
      if (this.controlMenu?.record === record) this.closeControlMenu();
      record.button?.remove();
      record.button = null;
      record.controlIcon = '';
      this.controlRecords.delete(record);
      if (!this.controlRecords.size) this.stopControlPositionTracking();
    }

    updateRecordVisual(record, notify = true) {
      const grayTheme = record.result?.kind === 'gray-theme';
      const target = this.visualTarget(record.image);
      if (record.visualTarget && record.visualTarget !== target) {
        this.removeVisualClasses(record.visualTarget);
        record.visualTarget.style?.removeProperty?.('--cg-xhs-image-brightness');
      }
      if (target !== record.image) {
        this.removeVisualClasses(record.image);
      }
      target?.style?.setProperty?.('--cg-xhs-image-brightness', String(this.imageBrightness));
      target?.classList?.toggle('cg-xhs-image-dark-mode', record.darkened && !grayTheme);
      target?.classList?.toggle('cg-xhs-image-dark-mode-gray', record.darkened && grayTheme);
      record.visualTarget = target;
      const concealed = this.resolvedConcealed(record);
      target?.classList?.toggle('cg-xhs-image-hidden-dark', concealed);
      const transformed = record.darkened || concealed;
      if (transformed) this.intervenedRecords.add(record);
      else this.intervenedRecords.delete(record);
      this.updateControl(record);
      if (notify) this.syncInterventionStatus();
    }

    updateControl(record) {
      const button = record.button;
      if (!button) return;
      const copy = COPY[this.locale];
      button.hidden = !this.showImageControl || this.profileProcessingDisabled(record);
      button.style.opacity = String(this.controlOpacity);
      const concealed = this.resolvedConcealed(record);
      const icon = concealed ? POST_DISABLED_ICON : record.darkened ? LIGHT_ICON : DARK_ICON;
      // Keep the hit target stable throughout a pointer gesture and SPA refresh.
      if (record.controlIcon !== icon) { button.innerHTML = icon; record.controlIcon = icon; }
      const override = this.recordCommentKind(record) ? null : this.postOverride(record);
      const parts = [concealed
        ? record.concealed === true ? copy.clickRestoreImage : copy.clickRestoreAll
        : override ? copy.clickAutomatic : record.darkened ? copy.clickLight : copy.clickDark];
      if (!concealed && this.recordCommentKind(record) !== 'preview') {
        parts.push((override?.darkened ?? record.darkened) ? copy.holdLight : copy.holdDark);
      }
      parts.push(copy.menuHint);
      const label = parts.join(copy.separator);
      if (button.title !== label) {
        button.title = label;
        button.setAttribute('aria-label', label);
      }
    }

    updateControls() {
      if (this.showImageControl && this.controlRecords.size) {
        for (const record of this.controlRecords) this.resizeObserver?.observe(record.image);
        this.startControlPositionTracking();
      } else {
        for (const record of this.controlRecords) this.resizeObserver?.unobserve?.(record.image);
        this.stopControlPositionTracking();
      }
      if (!this.showImageControl) this.closeControlMenu();
      for (const record of this.controlRecords) this.updateControl(record);
      this.updateProfileControl();
      this.scheduleControlPositions();
    }

    onViewportChange(event) {
      if (!event?.composedPath?.().includes(this.controlHost)) this.closeControlMenu();
      if (this.controlRecords.size) this.scheduleControlPositions();
    }

    viewerImageContext(image) {
      const viewer = image?.closest?.('#noteContainer');
      if (!viewer?.querySelector?.('.note-slider, .media-container')) return null;
      const slide = image.closest?.('.swiper-slide') || null;
      const mediaRoot = image.closest?.('.note-slider-img, .img-container') || null;
      if (!mediaRoot || (!slide && !mediaRoot.matches?.('.note-slider-img'))) return null;
      const primaryImage = mediaRoot.querySelector?.(
        ':scope > img, :scope > picture > img, .note-slider-img > img, .note-slider-img > picture > img'
      );
      if (primaryImage && primaryImage !== image) return null;
      return { viewer, slide, mediaRoot };
    }

    viewerForImage(image) {
      return this.viewerImageContext(image)?.viewer || null;
    }

    visualTarget(image) {
      return this.viewerImageContext(image)?.slide || image;
    }

    visibleImageRect(image, minimumSize = 1) {
      if (!image || image.isConnected === false) return null;
      try {
        if (typeof image.checkVisibility === 'function'
          && !image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
      } catch {}
      const rect = image.getBoundingClientRect?.();
      if (!rect || rect.width < minimumSize || rect.height < minimumSize) return null;
      const visible = rect.bottom > 0 && rect.top < innerHeight
        && rect.right > 0 && rect.left < innerWidth;
      return visible ? rect : null;
    }

    controlPlacement(record) {
      if (this.recordCommentKind(record) === 'preview') {
        const rect = this.visibleImageRect(record.image, 120);
        if (!rect) return null;
        return {
          left: Math.max(4, Math.min(innerWidth - CONTROL_SIZE - 4, rect.right - CONTROL_SIZE - 10)),
          top: Math.max(4, Math.min(innerHeight - CONTROL_SIZE - 4, rect.top + 10))
        };
      }
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

    activeCommentPreviewRecord() {
      for (const record of [...this.commentPreviewRecords].reverse()) {
        const image = record.image;
        if (!image?.isConnected || this.recordCommentKind(record) !== 'preview') continue;
        if (this.visibleImageRect(image, 120)) return record;
      }
      return null;
    }

    hasOpenCommentPreview() {
      return !!this.activeCommentPreviewRecord();
    }

    scheduleControlPositions() {
      if (this.positionFrame || !this.processing || !this.controlRecords.size
        || Date.now() < this.controlTransitionUntil) return;
      this.positionFrame = requestAnimationFrame(() => {
        this.positionFrame = 0;
        const positionedOwners = new Set();
        const activeCommentPreview = this.activeCommentPreviewRecord();
        const commentPreviewOpen = !!activeCommentPreview;
        for (const record of this.controlRecords) {
          if (!record.button) continue;
          if (!record.image.isConnected) {
            record.button.style.display = 'none';
            if (this.controlMenu?.record === record) this.closeControlMenu();
            continue;
          }
          const classifiedCommentPreview = this.recordCommentKind(record) === 'preview';
          const commentPreview = classifiedCommentPreview && record === activeCommentPreview;
          const viewer = this.viewerForImage(record.image);
          const owner = commentPreview ? record.image : classifiedCommentPreview ? null : viewer;
          const eligible = this.showImageControl && (commentPreview || !commentPreviewOpen)
            && owner && !positionedOwners.has(owner);
          const placement = eligible && !this.hasControlMotion(record)
            ? this.controlPlacement(record) : null;
          record.button.style.display = placement ? 'grid' : 'none';
          if (!placement) {
            record.cancelGesture?.();
            if (this.controlMenu?.record === record) this.closeControlMenu();
            continue;
          }
          positionedOwners.add(owner);
          record.button.style.left = `${placement.left}px`;
          record.button.style.top = `${placement.top}px`;
        }
      });
    }

    clearVisual(record, notify = true) {
      this.removeVisualClasses(record.image);
      this.removeVisualClasses(record.visualTarget);
      record.image?.style?.removeProperty?.('--cg-xhs-image-brightness');
      record.visualTarget?.style?.removeProperty?.('--cg-xhs-image-brightness');
      record.visualTarget = null;
      const changed = this.intervenedRecords.delete(record);
      if (notify && changed) this.syncInterventionStatus();
    }

    removeVisualClasses(target) {
      for (const name of ['cg-xhs-image-dark-mode', 'cg-xhs-image-dark-mode-gray',
        'cg-xhs-image-hidden-dark']) {
        if (target?.classList?.contains?.(name)) target.classList.remove(name);
      }
    }

    syncInterventionStatus() {
      const intervened = this.active && this.processing && this.intervenedRecords.size > 0;
      if (intervened === this.intervened) return;
      this.intervened = intervened;
      this.reportStatus();
    }

    clearRecord(record) {
      this.clearVisual(record);
      this.intersectionObserver?.unobserve?.(record.image);
      this.removeQueuedImage(record.image);
      record.loadGeneration = (record.loadGeneration || 0) + 1;
      if (record.loadHandler) record.image?.removeEventListener?.('load', record.loadHandler);
      record.loadHandler = null;
      record.loadSource = '';
      record.loadPriority = Number.POSITIVE_INFINITY;
      this.removeControl(record);
      record.result = null;
      record.source = '';
      record.imageMode = null;
      record.concealed = null;
      record.darkened = false;
    }

    retireRecord(record) {
      if (!record || record.button || record.visualTarget) return;
      this.intersectionObserver?.unobserve?.(record.image);
      this.removeQueuedImage(record.image);
      if (record.loadHandler) record.image?.removeEventListener?.('load', record.loadHandler);
      record.loadHandler = null;
      record.loadGeneration = (record.loadGeneration || 0) + 1;
      this.commentPreviewRecords.delete(record);
      this.records.delete(record.image);
    }

    scheduleCleanup() {
      if (this.cleanupTimer || !this.processing) return;
      this.cleanupTimer = setTimeout(() => {
        this.cleanupTimer = 0;
        for (const [image, record] of this.records) {
          if (image.isConnected) continue;
          this.clearRecord(record);
          this.commentPreviewRecords.delete(record);
          this.records.delete(image);
        }
        this.queue = this.queue.filter(task => {
          const keep = task.image.isConnected && this.records.has(task.image);
          if (!keep) this.queued.delete(task.image);
          return keep;
        });
        if (this.viewerRoot && !this.viewerRoot.isConnected) {
          this.viewerObserver?.disconnect();
          this.viewerObserver = null;
          this.viewerRoot = null;
          if (this.viewerRefreshFrame) cancelAnimationFrame(this.viewerRefreshFrame);
          this.viewerRefreshFrame = 0;
        }
      }, 1_500);
    }
  }

  const runtime = new XhsImageDarkModeRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
