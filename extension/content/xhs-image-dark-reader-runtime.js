(() => {
  const READY = 'cosmic-gemini:xhs-image-dark-reader:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:xhs-image-dark-reader:main-ready';
  const CONFIGURE = 'cosmic-gemini:xhs-image-dark-reader:configure';
  const STATUS = 'cosmic-gemini:xhs-image-dark-reader:status';
  const DISPOSE = 'cosmic-gemini:xhs-image-dark-reader:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.xhs-image-dark-reader.runtime');
  const SAMPLE_SIZE = 64;
  const TILE_COUNT = 8;
  const CACHE_LIMIT = 240;
  const COPY = Object.freeze({
    'en-US': Object.freeze({ restore: 'Show original image', reapply: 'Apply dark image' }),
    'zh-CN': Object.freeze({ restore: '显示原图', reapply: '恢复深色显示' })
  });

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
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || (parts.length > 3 && parts[3] === 0)) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }

  function luminance(color) {
    if (!color) return null;
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  }

  function tileMaskDataUrl(mask) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_COUNT;
    canvas.height = TILE_COUNT;
    const context = canvas.getContext('2d');
    if (!context) return '';
    const image = context.createImageData(TILE_COUNT, TILE_COUNT);
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = mask[index] ? 255 : 0;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class XhsImageDarkReaderRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.processing = false;
      this.darkModeDetected = false;
      this.locale = 'en-US';
      this.overrideDarkMode = false;
      this.showImageControl = true;
      this.controlOpacity = 0.5;
      this.records = new Map();
      this.cache = new Map();
      this.positionedParents = new Map();
      this.queue = [];
      this.queued = new Set();
      this.running = 0;
      this.pumpHandle = 0;
      this.themeTimer = 0;
      this.positionFrame = 0;
      this.cleanupTimer = 0;
      this.style = null;
      this.themeObserver = null;
      this.themeHead = null;
      this.themeMedia = null;
      this.pageObserver = null;
      this.intersectionObserver = null;
      this.resizeObserver = null;
      this.controlHost = null;
      this.controlLayer = null;
      this.faceDetector = null;
      this.faceChain = Promise.resolve([]);
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onThemeChange = this.onThemeChange.bind(this);
      this.onPageMutations = this.onPageMutations.bind(this);
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
    }

    disable() {
      if (!this.active && !this.processing) return;
      this.active = false;
      if (this.themeTimer) clearTimeout(this.themeTimer);
      this.themeTimer = 0;
      this.themeObserver?.disconnect();
      this.themeObserver = null;
      this.themeHead = null;
      this.themeMedia?.removeEventListener?.('change', this.onThemeChange);
      this.themeMedia = null;
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
      this.themeMedia = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
      this.themeMedia?.addEventListener?.('change', this.onThemeChange);
    }

    observeThemeHead() {
      if (!document.head || this.themeHead === document.head) return;
      this.themeObserver?.observe(document.head, { childList: true, subtree: true });
      this.themeHead = document.head;
    }

    onThemeChange() {
      if (!this.active || this.themeTimer) return;
      this.observeThemeHead();
      this.themeTimer = setTimeout(() => {
        this.themeTimer = 0;
        this.evaluateTheme();
      }, 90);
    }

    effectiveBackground(element) {
      let current = element;
      while (current) {
        const value = parseColor(getComputedStyle(current).backgroundColor);
        if (value) return value;
        current = current.parentElement;
      }
      return null;
    }

    detectDarkMode() {
      const roots = [
        document.documentElement,
        document.body,
        document.querySelector('#app'),
        document.querySelector('main'),
        document.querySelector('[class*="layout"]')
      ].filter(Boolean);
      const backgrounds = roots.map(root => luminance(this.effectiveBackground(root))).filter(value => value !== null);
      const text = roots.map(root => luminance(parseColor(getComputedStyle(root).color))).filter(value => value !== null);
      if (!backgrounds.length) return false;
      backgrounds.sort((a, b) => a - b);
      text.sort((a, b) => a - b);
      const background = backgrounds[Math.floor(backgrounds.length / 2)];
      const foreground = text.length ? text[Math.floor(text.length / 2)] : 1;
      return background < 0.34 && foreground - background > 0.28;
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
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) this.syncOverlay(this.records.get(entry.target));
        this.scheduleControlPositions();
      });
      this.pageObserver = new MutationObserver(this.onPageMutations);
      this.pageObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset']
      });
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      this.collectImages(document);
      this.scheduleCleanup();
    }

    stopProcessing() {
      if (!this.processing && !this.records.size) return;
      this.processing = false;
      this.pageObserver?.disconnect();
      this.pageObserver = null;
      this.intersectionObserver?.disconnect();
      this.intersectionObserver = null;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      window.removeEventListener('scroll', this.onViewportChange, true);
      window.removeEventListener('resize', this.onViewportChange, false);
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
      for (const [parent, original] of this.positionedParents) {
        if (!parent.isConnected) continue;
        if (original) parent.style.position = original;
        else parent.style.removeProperty('position');
        delete parent.dataset.cgXhsOriginalPosition;
      }
      this.positionedParents.clear();
      this.controlHost?.remove();
      this.controlHost = null;
      this.controlLayer = null;
      this.style?.remove();
      this.style = null;
    }

    installStyle() {
      if (this.style?.isConnected) return;
      const style = document.createElement('style');
      style.dataset.cosmicGeminiXhsImageDarkReader = '';
      style.textContent = `
        html .cg-xhs-dark-full { filter: invert(1) hue-rotate(180deg) brightness(.78) contrast(.92) saturate(.88) !important; }
        html .cg-xhs-dark-overlay { position: absolute !important; pointer-events: none !important; margin: 0 !important; z-index: 1 !important; filter: invert(1) hue-rotate(180deg) brightness(.78) contrast(.92) saturate(.88) !important; }
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
        record = { image, source: '', mode: '', overlay: null, button: null, restored: false, result: null };
        this.records.set(image, record);
        this.intersectionObserver?.observe(image);
        this.resizeObserver?.observe(image);
      }
      if (image.complete && image.naturalWidth) return;
      image.addEventListener('load', () => this.queueImage(image, 0), { once: true });
    }

    prioritizeModal(modal) {
      const images = [...modal.querySelectorAll('img')].filter(image => this.isContentImage(image));
      for (const image of images) {
        this.observeImage(image);
        const slide = image.closest('.swiper-slide');
        const priority = slide?.classList.contains('swiper-slide-active') ? -20
          : slide?.classList.contains('swiper-slide-next') || slide?.classList.contains('swiper-slide-prev') ? -10 : 5;
        this.queueImage(image, priority);
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
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const image = mutation.target;
          const record = this.records.get(image);
          if (record && record.source !== (image.currentSrc || image.src || '')) {
            this.clearRecord(record);
            record.source = '';
            record.restored = false;
            this.queueImage(image, -10);
          }
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) this.collectImages(node);
        }
      }
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

    cacheResult(source, result) {
      if (!source || !result) return;
      if (this.cache.has(source)) this.cache.delete(source);
      this.cache.set(source, result);
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    }

    async analyze(image) {
      const record = this.records.get(image);
      if (!record || !this.processing) return;
      const source = image.currentSrc || image.src || '';
      if (!source) return;
      const cached = this.cache.get(source);
      if (cached) {
        record.source = source;
        record.result = cached;
        this.applyResult(record);
        return;
      }
      try { await image.decode?.(); } catch {}
      if (!this.processing || !image.isConnected || source !== (image.currentSrc || image.src || '')) return;
      const sample = this.sampleImage(image);
      if (!sample) return;
      let result = this.classifySample(sample.data, sample.width, sample.height);
      if (result.kind !== 'photo' && result.needsFaceCheck) {
        const faces = await this.detectFaces(image);
        if (faces.length) result = this.protectFaces(result, faces, image.naturalWidth, image.naturalHeight);
      }
      if (result.kind === 'mixed') result.maskUrl = tileMaskDataUrl(result.mask);
      delete result.tiles;
      delete result.needsFaceCheck;
      this.cacheResult(source, result);
      record.source = source;
      record.result = result;
      this.applyResult(record);
    }

    sampleImage(image) {
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      try {
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      } catch { return null; }
    }

    classifySample(data, width, height) {
      const tileSize = Math.max(1, Math.floor(width / TILE_COUNT));
      const tiles = [];
      let total = 0;
      let bright = 0;
      let dark = 0;
      let lowChroma = 0;
      let highChroma = 0;
      let midtone = 0;
      for (let tileY = 0; tileY < TILE_COUNT; tileY += 1) {
        for (let tileX = 0; tileX < TILE_COUNT; tileX += 1) {
          let count = 0;
          let tileBright = 0;
          let tileDark = 0;
          let tileLowChroma = 0;
          let tileHighChroma = 0;
          let tileMidtone = 0;
          let edge = 0;
          let previous = null;
          for (let y = tileY * tileSize; y < Math.min(height, (tileY + 1) * tileSize); y += 1) {
            for (let x = tileX * tileSize; x < Math.min(width, (tileX + 1) * tileSize); x += 1) {
              const index = (y * width + x) * 4;
              if (data[index + 3] < 24) continue;
              const r = data[index] / 255;
              const g = data[index + 1] / 255;
              const b = data[index + 2] / 255;
              const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
              const chroma = Math.max(r, g, b) - Math.min(r, g, b);
              if (value > 0.72) tileBright += 1;
              if (value < 0.3) tileDark += 1;
              if (chroma < 0.22) tileLowChroma += 1;
              if (chroma > 0.34) tileHighChroma += 1;
              if (value >= 0.3 && value <= 0.72) tileMidtone += 1;
              if (previous !== null && Math.abs(value - previous) > 0.22) edge += 1;
              previous = value;
              count += 1;
            }
          }
          const safe = Math.max(count, 1);
          const metrics = {
            bright: tileBright / safe,
            dark: tileDark / safe,
            lowChroma: tileLowChroma / safe,
            highChroma: tileHighChroma / safe,
            midtone: tileMidtone / safe,
            edge: edge / safe
          };
          metrics.document = metrics.bright > 0.58 && metrics.lowChroma > 0.62
            && metrics.highChroma < 0.13 && metrics.midtone < 0.3
            && (metrics.dark > 0.012 || metrics.edge > 0.035);
          metrics.photo = metrics.highChroma > 0.16 || metrics.midtone > 0.42;
          tiles.push(metrics);
          total += count;
          bright += tileBright;
          dark += tileDark;
          lowChroma += tileLowChroma;
          highChroma += tileHighChroma;
          midtone += tileMidtone;
        }
      }
      const safeTotal = Math.max(total, 1);
      const documentRatio = tiles.filter(tile => tile.document).length / tiles.length;
      const photoRatio = tiles.filter(tile => tile.photo).length / tiles.length;
      const brightRatio = bright / safeTotal;
      const darkRatio = dark / safeTotal;
      const lowChromaRatio = lowChroma / safeTotal;
      const highChromaRatio = highChroma / safeTotal;
      const midtoneRatio = midtone / safeTotal;
      const mask = tiles.map(tile => tile.document);
      const strongDocument = documentRatio > 0.7 && brightRatio > 0.5 && lowChromaRatio > 0.58
        && highChromaRatio < 0.16 && midtoneRatio < 0.34 && photoRatio < 0.08;
      const hasReadableContrast = darkRatio > 0.004 || tiles.some(tile => tile.edge > 0.035);
      if (strongDocument && hasReadableContrast) {
        return {
          kind: 'text', mask, tiles,
          needsFaceCheck: highChromaRatio > 0.025 || midtoneRatio > 0.1
        };
      }
      if (documentRatio > 0.14 && photoRatio > 0.08 && mask.filter(Boolean).length >= 7) {
        return { kind: 'mixed', mask, tiles, needsFaceCheck: true };
      }
      if (documentRatio > 0.48 && brightRatio > 0.62 && photoRatio < 0.08 && hasReadableContrast) {
        return { kind: 'text', mask, tiles, needsFaceCheck: true };
      }
      return { kind: 'photo', mask, tiles, needsFaceCheck: false };
    }

    async detectFaces(image) {
      if (!('FaceDetector' in globalThis)) return [];
      if (!this.faceDetector) {
        try { this.faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 6 }); }
        catch { return []; }
      }
      const task = async () => {
        try { return await this.faceDetector.detect(image); }
        catch { return []; }
      };
      const result = this.faceChain.then(task, task);
      this.faceChain = result.catch(() => []);
      return result;
    }

    protectFaces(result, faces, width, height) {
      const mask = [...result.mask];
      for (const face of faces) {
        const box = face.boundingBox || face;
        const left = clamp((box.x - box.width * 0.25) / width, 0, 1);
        const right = clamp((box.x + box.width * 1.25) / width, 0, 1);
        const top = clamp((box.y - box.height * 0.25) / height, 0, 1);
        const bottom = clamp((box.y + box.height * 1.35) / height, 0, 1);
        for (let y = 0; y < TILE_COUNT; y += 1) {
          for (let x = 0; x < TILE_COUNT; x += 1) {
            const centerX = (x + 0.5) / TILE_COUNT;
            const centerY = (y + 0.5) / TILE_COUNT;
            if (centerX >= left && centerX <= right && centerY >= top && centerY <= bottom) {
              mask[y * TILE_COUNT + x] = false;
            }
          }
        }
      }
      const activeTiles = mask.filter(Boolean).length;
      if (activeTiles < 5) return { kind: 'photo', mask, tiles: result.tiles, needsFaceCheck: false };
      return { kind: 'mixed', mask, tiles: result.tiles, needsFaceCheck: false };
    }

    applyResult(record) {
      if (!this.processing || !record.image.isConnected || !record.result) return;
      this.clearVisual(record);
      if (record.result.kind === 'text') {
        record.mode = 'text';
        record.image.classList.add('cg-xhs-dark-full');
      } else if (record.result.kind === 'mixed' && record.result.maskUrl) {
        record.mode = 'mixed';
        this.createOverlay(record);
      } else {
        record.mode = 'photo';
        return;
      }
      this.createControl(record);
      this.updateRecordVisual(record);
      this.scheduleControlPositions();
    }

    createOverlay(record) {
      const image = record.image;
      const parent = image.parentElement;
      if (!parent) return;
      if (getComputedStyle(parent).position === 'static') {
        if (!this.positionedParents.has(parent)) this.positionedParents.set(parent, parent.style.position || '');
        parent.style.position = 'relative';
      }
      const overlay = image.cloneNode(false);
      overlay.removeAttribute('id');
      overlay.removeAttribute('srcset');
      overlay.className = 'cg-xhs-dark-overlay';
      overlay.src = image.currentSrc || image.src;
      overlay.alt = '';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.maskImage = `url("${record.result.maskUrl}")`;
      overlay.style.webkitMaskImage = `url("${record.result.maskUrl}")`;
      overlay.style.maskSize = '100% 100%';
      overlay.style.webkitMaskSize = '100% 100%';
      parent.append(overlay);
      record.overlay = overlay;
      this.syncOverlay(record);
    }

    syncOverlay(record) {
      if (!record?.overlay?.isConnected || !record.image.isConnected) return;
      const image = record.image;
      const style = getComputedStyle(image);
      Object.assign(record.overlay.style, {
        left: `${image.offsetLeft}px`,
        top: `${image.offsetTop}px`,
        width: `${image.offsetWidth}px`,
        height: `${image.offsetHeight}px`,
        borderRadius: style.borderRadius,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
        transform: style.transform === 'none' ? '' : style.transform,
        transformOrigin: style.transformOrigin
      });
    }

    createControl(record) {
      if (!this.controlLayer || record.button) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        record.restored = !record.restored;
        this.updateRecordVisual(record);
      });
      this.controlLayer.append(button);
      record.button = button;
      this.updateControl(record);
    }

    updateRecordVisual(record) {
      const visible = !record.restored;
      if (record.mode === 'text') record.image.classList.toggle('cg-xhs-dark-full', visible);
      if (record.overlay) record.overlay.hidden = !visible;
      this.updateControl(record);
    }

    updateControl(record) {
      if (!record.button) return;
      record.button.hidden = !this.showImageControl;
      record.button.style.opacity = String(this.controlOpacity);
      const copy = COPY[this.locale];
      const label = record.restored ? copy.reapply : copy.restore;
      record.button.title = label;
      record.button.setAttribute('aria-label', label);
    }

    updateControls() {
      for (const record of this.records.values()) this.updateControl(record);
      this.scheduleControlPositions();
    }

    onViewportChange() { this.scheduleControlPositions(); }

    scheduleControlPositions() {
      if (this.positionFrame || !this.processing) return;
      this.positionFrame = requestAnimationFrame(() => {
        this.positionFrame = 0;
        for (const record of this.records.values()) {
          if (!record.button || !record.image.isConnected) continue;
          const rect = record.image.getBoundingClientRect();
          const visible = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
          record.button.style.display = visible && this.showImageControl ? 'grid' : 'none';
          if (!visible) continue;
          record.button.style.left = `${Math.max(4, Math.min(innerWidth - 31, rect.right - 33))}px`;
          record.button.style.top = `${Math.max(4, Math.min(innerHeight - 31, rect.top + 7))}px`;
        }
      });
    }

    clearVisual(record) {
      record.image?.classList?.remove('cg-xhs-dark-full');
      record.overlay?.remove();
      record.overlay = null;
    }

    clearRecord(record) {
      this.clearVisual(record);
      record.button?.remove();
      record.button = null;
      record.result = null;
      record.mode = '';
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
      }, 1_500);
    }
  }

  const runtime = new XhsImageDarkReaderRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
