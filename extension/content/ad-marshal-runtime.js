(() => {
  const READY = 'cosmic-gemini:ad-marshal:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:ad-marshal:main-ready';
  const CONFIGURE = 'cosmic-gemini:ad-marshal:configure';
  const DISPOSE = 'cosmic-gemini:ad-marshal:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.ad-marshal.runtime');
  const STYLE_MARKER = 'data-cosmic-gemini-ad-marshal-style';
  const NEWS_MEDIA_ACTIVE_MARKER = 'data-cosmic-gemini-news-media-active';
  const NEWS_QQ_AD_CONTAINER_SELECTOR = [
    '.tonglan-ad-channel.ad-news',
    '.rectangle-ad-channel.ad-news',
    '.adbox',
    '[class^="adbox_"]',
    '.ad-brandArea',
    '.ad-click-wrapper',
    '.ad-header-image',
    '.c2s-ad-message-tips',
    '.c2s-ad-title',
    '[class*="qqchannel-ad"]',
    '[id*="qqchannel-ad"]'
  ].join(',');
  const NEWS_QQ_REMOVED_VIDEO_SELECTOR = [
    '.qqcom-jxvideo',
    '.video-wrap',
    'iframe[src*="video.qq.com"]',
    'iframe[src*="v.qq.com"]'
  ].join(',');
  const NEWS_QQ_MEDIA_CONTAINER_SELECTOR = [
    '#content-right.content-right',
    NEWS_QQ_REMOVED_VIDEO_SELECTOR,
    '.qnt-p .videoPlayerMini'
  ].join(',');
  const TENCENT_QQ_TRACKING_HOSTS = [
    'h.trace.qq.com',
    'btrace.qq.com',
    'otheve.beacon.qq.com',
    'beacon.cdn.qq.com',
    'beaconcdn.qq.com',
    'snowflake.qq.com',
    'oth.str.beacon.qq.com',
    'htrace.wetvinfo.com',
    'svibeacon.onezapp.com',
    'news.ssp.qq.com',
    'op.ssp.qq.com',
    'n.ssp.qq.com'
  ];
  const SITE_CONFIGS = Object.freeze({
    newsQqCom: Object.freeze({
      hosts: new Set(['news.qq.com', 'view.inews.qq.com']),
      trackingHosts: new Set(TENCENT_QQ_TRACKING_HOSTS),
      scriptPaths: Object.freeze([
        'universal-report.min.js',
        '/news-plugin/sdk/emonitor_',
        '/qqindex2021/advertisement/',
        '/qqcdn/news-share/js/custom_'
      ]),
      style: `${NEWS_QQ_AD_CONTAINER_SELECTOR}{display:none!important;visibility:hidden!important;}`,
      hostStyles: Object.freeze({
        'news.qq.com': [
          `${NEWS_QQ_MEDIA_CONTAINER_SELECTOR}{display:none!important;visibility:hidden!important;}`,
          `.qnt-p:not([${NEWS_MEDIA_ACTIVE_MARKER}]) .txp_poster_img{display:block!important;visibility:visible!important;opacity:1!important;}`
        ].join('')
      }),
      localProbe: true
    }),
    wwwQqCom: Object.freeze({
      hosts: new Set(['www.qq.com']),
      trackingHosts: new Set([...TENCENT_QQ_TRACKING_HOSTS, 'h5.ssp.qq.com']),
      scriptPaths: Object.freeze([
        '/www/js/emonitor/',
        'universal-report.min.js',
        '/qqindex2021/advertisement/'
      ]),
      style: '.qqhome-col-1:has(> .game-rank-wrap){display:none!important;visibility:hidden!important;}',
      localProbe: true
    }),
    zhihuCom: Object.freeze({
      hosts: new Set(['zhihu.com']),
      hostSuffix: '.zhihu.com',
      trackingHosts: new Set([
        'zhihu-web-analytics.zhihu.com',
        'apm.zhihu.com',
        'datahub.zhihu.com',
        'crash2.zhihu.com',
        'hm.baidu.com'
      ]),
      scriptPaths: Object.freeze([
        '/@cfe/sentry-script@',
        '/za-js-sdk@'
      ]),
      style: '',
      localProbe: false
    }),
    gmailCom: Object.freeze({
      hosts: new Set(['mail.google.com', 'chat.google.com', 'ogs.google.com']),
      trackingHosts: new Set(),
      requestPaths: new Set(['play.google.com/log']),
      scriptPaths: Object.freeze([]),
      style: '',
      localProbe: false
    })
  });
  const TRANSPARENT_IMAGE_URL = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E';

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function urlString(value) {
    if (value instanceof Request) return value.url;
    if (value instanceof URL) return value.href;
    return String(value || '');
  }

  function siteIdForLocation() {
    const hostname = location.hostname.toLowerCase();
    return Object.keys(SITE_CONFIGS).find(siteId => matchesConfiguredHost(SITE_CONFIGS[siteId], hostname)) || '';
  }

  function matchesConfiguredHost(config, hostname) {
    return config.hosts.has(hostname) || (!!config.hostSuffix && hostname.endsWith(config.hostSuffix));
  }

  function shouldNeutralize(value, siteId) {
    const config = SITE_CONFIGS[siteId];
    const raw = urlString(value);
    if (!config || !raw) return false;
    const normalized = raw.toLowerCase();
    if (config.scriptPaths.some(fragment => normalized.includes(fragment))) return true;
    try {
      const url = new URL(normalized, location.href);
      if (config.localProbe && url.hostname === '127.0.0.1' && url.port === '11601' && url.pathname === '/check') return true;
      if (config.requestPaths?.has(`${url.hostname.toLowerCase()}${url.pathname.toLowerCase()}`)) return true;
      return config.trackingHosts.has(url.hostname.toLowerCase());
    }
    catch { return false; }
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class AdMarshalRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.siteId = '';
      this.originalFetch = globalThis.fetch;
      this.originalXhrOpen = XMLHttpRequest.prototype.open;
      this.originalSendBeacon = Navigator.prototype.sendBeacon;
      this.imageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      this.imageSetAttributeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'setAttribute');
      this.originalImageSetAttribute = HTMLImageElement.prototype.setAttribute;
      this.imageSources = new WeakMap();
      this.emptyResponseUrl = '';
      this.fetchWrapper = null;
      this.xhrOpenWrapper = null;
      this.sendBeaconWrapper = null;
      this.imageSrcGetter = null;
      this.imageSrcSetter = null;
      this.imageSetAttributeWrapper = null;
      this.styleElement = null;
      this.newsFloatingPlayerObserver = null;
      this.newsVideoContainerObserver = null;
      this.newsMediaGuardsInstalled = false;
      this.newsMediaIntent = new WeakMap();
      this.newsUnmuteIntent = new WeakMap();
      this.newsActivatedMedia = new WeakSet();
      this.newsUserUnmutedMedia = new WeakSet();
      this.newsSuspendedPlayers = new WeakSet();
      this.newsMediaLoadingStates = new WeakMap();
      this.originalMediaPause = HTMLMediaElement.prototype.pause;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.ensureStyle = this.ensureStyle.bind(this);
      this.startNewsVideoContainerRemoval = this.startNewsVideoContainerRemoval.bind(this);
      this.onNewsMediaIntent = this.onNewsMediaIntent.bind(this);
      this.onNewsMediaPlay = this.onNewsMediaPlay.bind(this);
      this.onNewsVolumeChange = this.onNewsVolumeChange.bind(this);
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
      if (message.config?.active === true) this.enable(message.config.siteId || siteIdForLocation());
      else this.disable();
    }
    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      try { delete globalThis[RUNTIME_KEY]; } catch {}
    }

    enable(siteId) {
      const config = SITE_CONFIGS[siteId];
      if (!config || !matchesConfiguredHost(config, location.hostname.toLowerCase())) return;
      if (this.active && this.siteId === siteId) return;
      if (this.active) this.disable();
      this.active = true;
      this.siteId = siteId;
      this.emptyResponseUrl = URL.createObjectURL(new Blob(['{}'], { type: 'application/json' }));
      const runtime = this;
      this.fetchWrapper = function adMarshalFetch(resource, options) {
        if (runtime.active && shouldNeutralize(resource, runtime.siteId)) {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' }
          }));
        }
        return Reflect.apply(runtime.originalFetch, this, [resource, options]);
      };
      this.xhrOpenWrapper = function adMarshalXhrOpen(method, url, async = true, ...rest) {
        if (runtime.active && shouldNeutralize(url, runtime.siteId)) {
          return Reflect.apply(runtime.originalXhrOpen, this, ['GET', runtime.emptyResponseUrl, async !== false]);
        }
        return Reflect.apply(runtime.originalXhrOpen, this, [method, url, async, ...rest]);
      };
      this.sendBeaconWrapper = function adMarshalSendBeacon(url, data) {
        if (runtime.active && shouldNeutralize(url, runtime.siteId)) return true;
        return Reflect.apply(runtime.originalSendBeacon, this, [url, data]);
      };
      this.imageSrcGetter = function adMarshalImageSrcGet() {
        return runtime.imageSources.get(this) || Reflect.apply(runtime.imageSrcDescriptor.get, this, []);
      };
      this.imageSrcSetter = function adMarshalImageSrcSet(value) {
        if (runtime.active && shouldNeutralize(value, runtime.siteId)) {
          runtime.imageSources.set(this, String(value));
          Reflect.apply(runtime.imageSrcDescriptor.set, this, [TRANSPARENT_IMAGE_URL]);
          return;
        }
        Reflect.apply(runtime.imageSrcDescriptor.set, this, [value]);
      };
      this.imageSetAttributeWrapper = function adMarshalImageSetAttribute(name, value) {
        if (runtime.active && String(name).toLowerCase() === 'src' && shouldNeutralize(value, runtime.siteId)) {
          runtime.imageSources.set(this, String(value));
          return Reflect.apply(runtime.originalImageSetAttribute, this, [name, TRANSPARENT_IMAGE_URL]);
        }
        return Reflect.apply(runtime.originalImageSetAttribute, this, [name, value]);
      };
      globalThis.fetch = this.fetchWrapper;
      XMLHttpRequest.prototype.open = this.xhrOpenWrapper;
      Navigator.prototype.sendBeacon = this.sendBeaconWrapper;
      if (this.imageSrcDescriptor?.configurable && this.imageSrcDescriptor.get && this.imageSrcDescriptor.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          ...this.imageSrcDescriptor,
          get: this.imageSrcGetter,
          set: this.imageSrcSetter
        });
      }
      HTMLImageElement.prototype.setAttribute = this.imageSetAttributeWrapper;
      this.ensureStyle();
      this.installNewsMediaGuards();
      this.startNewsVideoContainerRemoval();
      this.startNewsFloatingPlayerMonitoring();
    }

    isNewsMediaPolicyActive() {
      return this.active
        && this.siteId === 'newsQqCom'
        && location.hostname.toLowerCase() === 'news.qq.com';
    }

    mediaElementsWithin(root) {
      const media = [];
      if (root instanceof HTMLMediaElement) media.push(root);
      media.push(...(root?.querySelectorAll?.('video,audio') || []));
      return media;
    }

    pauseNewsMedia(media) {
      try { Reflect.apply(this.originalMediaPause, media, []); } catch {}
      try { media.removeAttribute('autoplay'); } catch {}
    }

    prepareNewsMedia(media, { force = false, reload = false } = {}) {
      if (!(media instanceof HTMLMediaElement)) return;
      if (!force && this.newsActivatedMedia.has(media)) return;
      this.pauseNewsMedia(media);
      if (media instanceof HTMLVideoElement && !this.newsUserUnmutedMedia.has(media)) {
        try { media.muted = true; } catch {}
      }
      if (!this.newsMediaLoadingStates.has(media)) {
        this.newsMediaLoadingStates.set(media, { preload: media.getAttribute('preload') });
        reload = true;
      }
      try {
        if (media.getAttribute('preload') !== 'none') {
          media.setAttribute('preload', 'none');
          reload = true;
        }
        if (reload) media.load();
      } catch {}
    }

    prepareNewsMediaWithin(root) {
      if (!this.isNewsMediaPolicyActive()) return;
      for (const media of this.mediaElementsWithin(root)) this.prepareNewsMedia(media);
    }

    activateNewsMedia(media) {
      if (!(media instanceof HTMLMediaElement)) return;
      const state = this.newsMediaLoadingStates.get(media);
      if (state) {
        try {
          if (state.preload === null) media.removeAttribute('preload');
          else media.setAttribute('preload', state.preload);
        } catch {}
        this.newsMediaLoadingStates.delete(media);
      }
      this.newsActivatedMedia.add(media);
      try { media.closest?.('.qnt-p')?.setAttribute(NEWS_MEDIA_ACTIVE_MARKER, ''); } catch {}
    }

    newsMediaForEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      for (const node of path) {
        if (node instanceof HTMLMediaElement) {
          return [node];
        }
      }
      for (const node of path) {
        const player = node?.closest?.('.qnt-p');
        if (!player) continue;
        return this.mediaElementsWithin(player);
      }
      return [];
    }

    isNewsVolumeControlEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      return path.some(node => {
        const marker = `${node?.className || ''} ${node?.id || ''}`;
        return /(?:^|[-_\s])(?:volume|mute|muted|unmuted)(?:[-_\s]|$)/i.test(marker);
      });
    }

    isNewsPlaybackControlEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      return path.some(node => {
        if (node instanceof HTMLMediaElement) return true;
        const marker = `${node?.className || ''} ${node?.id || ''}`;
        return /(?:^|[-_\s])(?:play|replay|poster)(?:[-_\s]|$)/i.test(marker);
      });
    }

    onNewsMediaIntent(event) {
      if (!this.isNewsMediaPolicyActive() || !event.isTrusted) return;
      if (event.type === 'keydown' && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
      const mediaItems = this.newsMediaForEvent(event);
      if (!mediaItems.length) return;
      const until = performance.now() + 2000;
      const volumeControl = this.isNewsVolumeControlEvent(event);
      const playbackControl = this.isNewsPlaybackControlEvent(event);
      if (!volumeControl && !playbackControl) return;
      for (const media of mediaItems) {
        const previouslyActivated = this.newsActivatedMedia.has(media);
        if (playbackControl) this.newsMediaIntent.set(media, until);
        if (volumeControl || (previouslyActivated && event.target === media && media.controls)) {
          this.newsUnmuteIntent.set(media, until);
        }
        if (playbackControl) this.activateNewsMedia(media);
      }
    }

    hasNewsMediaIntent(media) {
      return (this.newsMediaIntent.get(media) || 0) >= performance.now();
    }

    hasNewsUnmuteIntent(media) {
      return (this.newsUnmuteIntent.get(media) || 0) >= performance.now();
    }

    onNewsMediaPlay(event) {
      const media = event.target;
      if (!this.isNewsMediaPolicyActive() || !(media instanceof HTMLMediaElement)) return;
      if (media.closest?.('.videoPlayerMini')) {
        this.prepareNewsMedia(media, { force: true });
        return;
      }
      if (this.hasNewsMediaIntent(media)) {
        this.activateNewsMedia(media);
        return;
      }
      this.prepareNewsMedia(media);
    }

    onNewsVolumeChange(event) {
      const media = event.target;
      if (!this.isNewsMediaPolicyActive() || !(media instanceof HTMLVideoElement)) return;
      if (this.hasNewsUnmuteIntent(media)) {
        if (!media.muted && media.volume > 0) this.newsUserUnmutedMedia.add(media);
        else this.newsUserUnmutedMedia.delete(media);
        return;
      }
      if (!this.newsUserUnmutedMedia.has(media) && !media.muted) {
        try { media.muted = true; } catch {}
      }
    }

    installNewsMediaGuards() {
      if (!this.isNewsMediaPolicyActive() || this.newsMediaGuardsInstalled) return;
      window.addEventListener('pointerdown', this.onNewsMediaIntent, true);
      window.addEventListener('keydown', this.onNewsMediaIntent, true);
      window.addEventListener('play', this.onNewsMediaPlay, true);
      window.addEventListener('volumechange', this.onNewsVolumeChange, true);
      this.newsMediaGuardsInstalled = true;
      this.prepareNewsMediaWithin(document);
    }

    removeNewsMediaGuards() {
      if (!this.newsMediaGuardsInstalled) return;
      window.removeEventListener('pointerdown', this.onNewsMediaIntent, true);
      window.removeEventListener('keydown', this.onNewsMediaIntent, true);
      window.removeEventListener('play', this.onNewsMediaPlay, true);
      window.removeEventListener('volumechange', this.onNewsVolumeChange, true);
      this.newsMediaGuardsInstalled = false;
      this.newsMediaIntent = new WeakMap();
      this.newsUnmuteIntent = new WeakMap();
    }

    releaseNewsMediaContainer(container) {
      for (const video of container.querySelectorAll('video')) {
        try {
          video.pause();
          video.removeAttribute('src');
          for (const source of video.querySelectorAll('source')) source.removeAttribute('src');
          video.load();
        } catch {}
      }
      if (container.matches('video')) {
        try {
          container.pause();
          container.removeAttribute('src');
          for (const source of container.querySelectorAll('source')) source.removeAttribute('src');
          container.load();
        } catch {}
      }
      if (container.matches('iframe')) container.removeAttribute('src');
      container.remove();
    }

    suspendNewsFloatingPlayer(player) {
      if (!this.active || !player?.matches?.('.videoPlayerMini') || !player.closest('.qnt-p')) return;
      this.newsSuspendedPlayers.add(player);
      for (const media of this.mediaElementsWithin(player)) {
        this.prepareNewsMedia(media, { force: true });
      }
    }

    restoreNewsInlinePlayer(player) {
      if (!this.newsSuspendedPlayers.has(player)) return;
      for (const media of this.mediaElementsWithin(player)) {
        if (this.newsActivatedMedia.has(media)) this.activateNewsMedia(media);
      }
      this.newsSuspendedPlayers.delete(player);
    }

    updateNewsFloatingPlayer(player) {
      if (!this.isNewsMediaPolicyActive() || !player?.closest?.('.qnt-p')) return;
      if (player.matches('.videoPlayerMini')) this.suspendNewsFloatingPlayer(player);
      else this.restoreNewsInlinePlayer(player);
    }

    updateNewsFloatingPlayers(root) {
      if (!this.active || this.siteId !== 'newsQqCom' || location.hostname.toLowerCase() !== 'news.qq.com') return;
      if (root?.matches?.('.videoPlayerMini')) this.updateNewsFloatingPlayer(root);
      for (const player of root?.querySelectorAll?.('.videoPlayerMini') || []) {
        this.updateNewsFloatingPlayer(player);
      }
    }

    removeNewsVideoContainers(root) {
      if (!this.active || this.siteId !== 'newsQqCom' || location.hostname.toLowerCase() !== 'news.qq.com') return;
      const containers = [];
      if (root?.matches?.(NEWS_QQ_REMOVED_VIDEO_SELECTOR)) containers.push(root);
      containers.push(...(root?.querySelectorAll?.(NEWS_QQ_REMOVED_VIDEO_SELECTOR) || []));
      for (const container of containers) {
        if (!container.parentElement?.closest?.(NEWS_QQ_REMOVED_VIDEO_SELECTOR)) {
          this.releaseNewsMediaContainer(container);
        }
      }
    }

    startNewsVideoContainerRemoval() {
      if (this.siteId !== 'newsQqCom' || location.hostname.toLowerCase() !== 'news.qq.com') return;
      const parent = document.documentElement;
      if (!parent) {
        document.addEventListener('readystatechange', this.startNewsVideoContainerRemoval, { once: true });
        return;
      }
      this.removeNewsVideoContainers(document);
      this.newsVideoContainerObserver?.disconnect();
      this.newsVideoContainerObserver = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') {
            const media = record.target instanceof HTMLMediaElement
              ? record.target
              : record.target?.closest?.('video,audio');
            if (media && !this.newsActivatedMedia.has(media)) {
              this.prepareNewsMedia(media, { reload: record.attributeName === 'src' });
            }
            continue;
          }
          for (const node of record.addedNodes) {
            this.removeNewsVideoContainers(node);
            if (node.isConnected) this.prepareNewsMediaWithin(node);
          }
        }
      });
      this.newsVideoContainerObserver.observe(parent, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['src', 'autoplay', 'preload']
      });
    }

    observeNewsFloatingPlayerRoot(root) {
      this.newsFloatingPlayerObserver?.disconnect();
      this.updateNewsFloatingPlayers(root);
      this.newsFloatingPlayerObserver = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') {
            this.updateNewsFloatingPlayer(record.target);
            continue;
          }
          for (const node of record.addedNodes) this.updateNewsFloatingPlayers(node);
        }
      });
      this.newsFloatingPlayerObserver.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }

    startNewsFloatingPlayerMonitoring() {
      if (this.siteId !== 'newsQqCom' || location.hostname.toLowerCase() !== 'news.qq.com') return;
      const root = document.querySelector('.qnt-p');
      if (root) {
        this.observeNewsFloatingPlayerRoot(root);
        return;
      }
      const parent = document.documentElement;
      if (!parent) return;
      this.newsFloatingPlayerObserver = new MutationObserver(records => {
        if (!this.active) return;
        for (const record of records) {
          for (const node of record.addedNodes) {
            const nextRoot = node?.matches?.('.qnt-p')
              ? node
              : node?.querySelector?.('.qnt-p');
            if (!nextRoot) continue;
            this.observeNewsFloatingPlayerRoot(nextRoot);
            return;
          }
        }
      });
      this.newsFloatingPlayerObserver.observe(parent, { subtree: true, childList: true });
    }

    ensureStyle() {
      const config = SITE_CONFIGS[this.siteId];
      const style = [config?.style, config?.hostStyles?.[location.hostname.toLowerCase()]]
        .filter(Boolean)
        .join('');
      if (!this.active || !style || this.styleElement?.isConnected) return;
      const parent = document.head || document.documentElement;
      if (!parent) {
        document.addEventListener('readystatechange', this.ensureStyle, { once: true });
        return;
      }
      const existing = document.querySelector(`style[${STYLE_MARKER}="${this.siteId}"]`);
      if (existing) {
        existing.textContent = style;
        this.styleElement = existing;
        return;
      }
      this.styleElement = document.createElement('style');
      this.styleElement.setAttribute(STYLE_MARKER, this.siteId);
      this.styleElement.textContent = style;
      parent.appendChild(this.styleElement);
    }

    disable() {
      const wasActive = this.active;
      this.active = false;
      this.newsFloatingPlayerObserver?.disconnect();
      this.newsFloatingPlayerObserver = null;
      this.newsVideoContainerObserver?.disconnect();
      this.newsVideoContainerObserver = null;
      document.removeEventListener('readystatechange', this.startNewsVideoContainerRemoval);
      this.removeNewsMediaGuards();
      this.newsActivatedMedia = new WeakSet();
      this.newsUserUnmutedMedia = new WeakSet();
      this.newsSuspendedPlayers = new WeakSet();
      this.newsMediaLoadingStates = new WeakMap();
      if (!wasActive) return;
      if (globalThis.fetch === this.fetchWrapper) globalThis.fetch = this.originalFetch;
      if (XMLHttpRequest.prototype.open === this.xhrOpenWrapper) XMLHttpRequest.prototype.open = this.originalXhrOpen;
      if (Navigator.prototype.sendBeacon === this.sendBeaconWrapper) Navigator.prototype.sendBeacon = this.originalSendBeacon;
      const currentImageDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (currentImageDescriptor?.get === this.imageSrcGetter && currentImageDescriptor?.set === this.imageSrcSetter) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', this.imageSrcDescriptor);
      }
      if (HTMLImageElement.prototype.setAttribute === this.imageSetAttributeWrapper) {
        if (this.imageSetAttributeDescriptor) {
          Object.defineProperty(HTMLImageElement.prototype, 'setAttribute', this.imageSetAttributeDescriptor);
        } else {
          delete HTMLImageElement.prototype.setAttribute;
        }
      }
      if (this.emptyResponseUrl) URL.revokeObjectURL(this.emptyResponseUrl);
      this.emptyResponseUrl = '';
      this.siteId = '';
      document.removeEventListener('readystatechange', this.ensureStyle);
      this.styleElement = null;
    }
  }

  const runtime = new AdMarshalRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
