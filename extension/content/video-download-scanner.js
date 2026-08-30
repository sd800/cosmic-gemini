(() => {
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.video-download.scanner');
  const PAGE_MARKER = 'cosmic-gemini-video-download';
  const MEDIA_URL = /(?:\.m3u8|\.mpd|\.(?:mp4|webm|mov|mkv|m4v|ogv))(?:$|[?#])/i;

  function absoluteUrl(value) {
    try {
      const url = new URL(value, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function kindFromUrl(url) {
    if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls';
    if (/\.mpd(?:$|[?#])/i.test(url)) return 'dash';
    return 'direct';
  }

  class VideoDownloadScanner {
    constructor() {
      this.active = true;
      this.seen = new Set();
      this.observer = null;
      this.performanceObserver = null;
      this.frame = 0;
      this.metadataListening = false;
      this.onMessage = this.onMessage.bind(this);
      this.onMutation = this.onMutation.bind(this);
      this.onLoadedMetadata = this.onLoadedMetadata.bind(this);
      this.onWindowMessage = this.onWindowMessage.bind(this);
      chrome.runtime.onMessage.addListener(this.onMessage);
      globalThis.addEventListener('message', this.onWindowMessage);
      this.observe();
    }

    onMessage(message, sender, respond) {
      if (message?.type === 'CG_VIDEO_SCAN') {
        this.active = true;
        this.observe();
        void this.scan(true).then(candidates => respond({ candidates }));
        return true;
      }
      if (message?.type === 'CG_VIDEO_STOP') this.stop();
      return false;
    }

    onWindowMessage(event) {
      if (!this.active || event.source !== globalThis || event.data?.marker !== PAGE_MARKER) return;
      if (event.data.type === 'candidates' && Array.isArray(event.data.candidates)) void this.publish(event.data.candidates);
      if (event.data.type === 'manifests' && Array.isArray(event.data.manifests)) {
        void chrome.runtime.sendMessage({ type: 'CG_VIDEO_INLINE_MANIFESTS', manifests: event.data.manifests }).catch(() => {});
      }
      if (event.data.type === 'wrapped-manifest' && typeof event.data.data === 'string') {
        void chrome.runtime.sendMessage({
          type: 'CG_VIDEO_WRAPPED_MANIFEST',
          data: event.data.data,
          baseUrl: event.data.baseUrl
        }).catch(() => {});
      }
    }

    observe() {
      if (!this.active) return;
      if (!this.observer && document.documentElement) {
        this.observer = new MutationObserver(this.onMutation);
        this.observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src', 'data-src', 'data-video-src', 'content']
        });
      }
      if (!this.performanceObserver && typeof PerformanceObserver === 'function') {
        try {
          this.performanceObserver = new PerformanceObserver(entries => {
            const candidates = entries.getEntries().map(entry => this.fromUrl(entry.name, 'performance', {
              contentLength: Number(entry.encodedBodySize || entry.decodedBodySize || entry.transferSize || 0)
            })).filter(Boolean);
            void this.publish(candidates);
          });
          this.performanceObserver.observe({ type: 'resource', buffered: true });
        } catch {}
      }
      if (!this.metadataListening) {
        document.addEventListener('loadedmetadata', this.onLoadedMetadata, true);
        this.metadataListening = true;
      }
      void this.scan();
      globalThis.postMessage({ marker: PAGE_MARKER, type: 'scan' }, location.origin);
    }

    onMutation() {
      if (this.frame || !this.active) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        void this.scan();
      });
    }

    onLoadedMetadata(event) {
      if (!this.active || !(event.target instanceof HTMLMediaElement)) return;
      void this.scan();
    }

    fromUrl(value, source, details = {}) {
      const url = absoluteUrl(value);
      if (!url || !MEDIA_URL.test(url)) return null;
      return {
        url,
        kind: kindFromUrl(url),
        source,
        title: document.title || '',
        width: Number(details.width || 0),
        height: Number(details.height || 0),
        duration: Number(details.duration || 0),
        contentLength: Number(details.contentLength || 0)
      };
    }

    collect() {
      const candidates = [];
      for (const media of document.querySelectorAll('video,audio')) {
        const details = {
          width: media instanceof HTMLVideoElement ? media.videoWidth || media.clientWidth : 0,
          height: media instanceof HTMLVideoElement ? media.videoHeight || media.clientHeight : 0,
          duration: Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0
        };
        for (const value of [media.currentSrc, media.src, media.getAttribute('data-src'), media.getAttribute('data-video-src')]) {
          const candidate = this.fromUrl(value, 'media-element', details);
          if (candidate) candidates.push(candidate);
        }
      }
      for (const source of document.querySelectorAll('source[src],[data-video-src],[data-stream-url]')) {
        for (const value of [source.getAttribute('src'), source.getAttribute('data-video-src'), source.getAttribute('data-stream-url')]) {
          const candidate = this.fromUrl(value, 'source-element');
          if (candidate) candidates.push(candidate);
        }
      }
      for (const meta of document.querySelectorAll([
        'meta[property="og:video"]',
        'meta[property="og:video:url"]',
        'meta[property="og:video:secure_url"]',
        'meta[name="twitter:player:stream"]'
      ].join(','))) {
        const candidate = this.fromUrl(meta.content, 'page-metadata');
        if (candidate) candidates.push(candidate);
      }
      try {
        for (const entry of performance.getEntriesByType('resource')) {
          const candidate = this.fromUrl(entry.name, 'performance', {
            contentLength: Number(entry.encodedBodySize || entry.decodedBodySize || entry.transferSize || 0)
          });
          if (candidate) candidates.push(candidate);
        }
      } catch {}
      return candidates;
    }

    async publish(candidates, includeSeen = false) {
      const unique = [];
      for (const candidate of candidates) {
        if (!candidate?.url) continue;
        const signature = [candidate.url, candidate.kind, candidate.width, candidate.height, candidate.duration, candidate.contentLength].join('|');
        if (!includeSeen && this.seen.has(signature)) continue;
        this.seen.add(signature);
        unique.push(candidate);
      }
      if (!unique.length) return [];
      try {
        await chrome.runtime.sendMessage({ type: 'CG_VIDEO_CANDIDATES', candidates: unique });
      } catch {}
      return unique;
    }

    scan(includeSeen = false) {
      return this.publish(this.collect(), includeSeen);
    }

    stop() {
      this.active = false;
      this.observer?.disconnect();
      this.performanceObserver?.disconnect();
      if (this.metadataListening) document.removeEventListener('loadedmetadata', this.onLoadedMetadata, true);
      this.observer = null;
      this.performanceObserver = null;
      this.metadataListening = false;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.seen.clear();
      globalThis.postMessage({ marker: PAGE_MARKER, type: 'stop' }, location.origin);
    }
  }

  const existing = globalThis[RUNTIME_KEY];
  if (existing) {
    existing.active = true;
    existing.observe();
    return existing.scan(true);
  }
  const runtime = new VideoDownloadScanner();
  globalThis[RUNTIME_KEY] = runtime;
  return runtime.scan(true);
})();
