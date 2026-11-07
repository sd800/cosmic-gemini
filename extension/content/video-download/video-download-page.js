(() => {
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.video-download.page-runtime');
  const MARKER = 'cosmic-gemini-video-download';
  const MEDIA_URL = /(?:\.m3u8|\.mpd|\.(?:mp4|webm|mov|mkv|m4v|ogv))(?:$|[?#])/i;
  const MAX_TEXT_LENGTH = 12 * 1024 * 1024;

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return btoa(binary);
  }

  function decodedText(value) {
    const text = String(value || '').slice(0, MAX_TEXT_LENGTH);
    try {
      if (/^"(?:\\.|[^"\\])*"$/.test(text.trim())) return JSON.parse(text.trim());
    } catch {}
    return text
      .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>')
      .replace(/\\u002f/gi, '/').replace(/\\n/g, '\n')
      .replace(/\\"/g, '"').replace(/\\\//g, '/');
  }

  function manifestsFromText(value, baseUrl, source) {
    const text = decodedText(value);
    const manifests = [];
    const hlsStarts = [...text.matchAll(/#EXTM3U/gi)].map(match => match.index);
    for (const start of hlsStarts.slice(0, 8)) {
      const following = text.slice(start);
      const end = following.search(/(?:\n\s*\n|<\/script>|"\s*[,}])/i);
      const manifestText = (end > 20 ? following.slice(0, end) : following).trim();
      if (manifestText.length < 20 || manifestText.length > 2 * 1024 * 1024) continue;
      manifests.push({ kind: 'hls', manifestText, baseUrl, source, inlineId: hashText(manifestText) });
    }
    const mpdPattern = /<MPD\b[\s\S]*?<\/MPD>/gi;
    for (const match of text.matchAll(mpdPattern)) {
      const manifestText = match[0].trim();
      if (manifestText.length > 2 * 1024 * 1024) continue;
      manifests.push({ kind: 'dash', manifestText, baseUrl, source, inlineId: hashText(manifestText) });
      if (manifests.length >= 12) break;
    }
    return manifests;
  }

  function normalizeUrl(value) {
    try {
      const text = String(value || '')
        .replace(/\\u002f/gi, '/')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');
      const url = new URL(text, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function kindFromUrl(url) {
    if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls';
    if (/\.mpd(?:$|[?#])/i.test(url)) return 'dash';
    return 'direct';
  }

  function candidateFromObject(value, source) {
    if (!value || typeof value !== 'object') return null;
    const url = normalizeUrl(value.url || value.src || value.playUrl || value.play_url || value.baseUrl || value.base_url);
    const mime = String(value.mimeType || value.mime_type || value.type || '').toLowerCase();
    if (!url || (!MEDIA_URL.test(url) && !mime.startsWith('video/') && mime !== 'application/dash+xml' && !mime.includes('mpegurl'))) return null;
    return {
      url,
      kind: kindFromUrl(url),
      source,
      title: document.title || '',
      mime,
      width: Number(value.width || 0),
      height: Number(value.height || 0),
      duration: Number(value.duration || value.durationSeconds || value.approxDurationMs / 1000 || 0),
      contentLength: Number(value.contentLength || value.content_length || value.size || 0),
      bandwidth: Number(value.bandwidth || value.bitrate || 0),
      codecs: String(value.codecs || value.codec || '')
    };
  }

  function urlsFromText(value, source) {
    const text = String(value || '').slice(0, MAX_TEXT_LENGTH)
      .replace(/\\u002f/gi, '/')
      .replace(/\\\//g, '/');
    const candidates = [];
    const pattern = /https?:\/\/[^\s"'<>\\]+/gi;
    for (const match of text.matchAll(pattern)) {
      const url = normalizeUrl(match[0].replace(/[),;]+$/, ''));
      if (!url || !MEDIA_URL.test(url)) continue;
      candidates.push({ url, kind: kindFromUrl(url), source, title: document.title || '' });
      if (candidates.length >= 300) break;
    }
    return candidates;
  }

  function candidatesFromValue(root, source, manifests = null, baseUrl = location.href) {
    const candidates = [];
    const queue = [root];
    const seen = new WeakSet();
    let inspected = 0;
    let cursor = 0;
    while (cursor < queue.length && inspected < 50000 && candidates.length < 500) {
      const value = queue[cursor];
      queue[cursor++] = null;
      inspected += 1;
      if (typeof value === 'string') {
        candidates.push(...urlsFromText(value, source));
        if (manifests && manifests.length < 12) manifests.push(...manifestsFromText(value, baseUrl, source));
        continue;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      const direct = candidateFromObject(value, source);
      if (direct) candidates.push(direct);
      let values;
      try { values = Array.isArray(value) ? value : Object.values(value); }
      catch { continue; }
      for (const child of values.slice(0, 5000)) {
        if (queue.length >= 50000) break;
        if (child && (typeof child === 'object' || typeof child === 'string')) queue.push(child);
      }
    }
    return candidates;
  }

  class PageVideoRuntime {
    constructor() {
      this.originalFetch = globalThis.fetch;
      this.originalXhrOpen = XMLHttpRequest.prototype.open;
      this.originalXhrSend = XMLHttpRequest.prototype.send;
      this.xhrUrls = new WeakMap();
      this.trackedXhrOpen = null;
      this.trackedXhrSend = null;
      this.active = true;
      this.responseReaders = new Set();
      this.messageListening = false;
      this.onMessage = this.onMessage.bind(this);
      this.install();
    }

    publish(candidates) {
      if (!this.active || !candidates.length) return;
      globalThis.postMessage({ marker: MARKER, type: 'candidates', candidates: candidates.slice(0, 500) }, location.origin);
    }

    publishManifests(manifests) {
      if (!this.active || !manifests.length) return;
      globalThis.postMessage({ marker: MARKER, type: 'manifests', manifests: manifests.slice(0, 12) }, location.origin);
    }

    async readResponse(response) {
      let reader;
      try {
        reader = response.clone().body?.getReader();
        if (!reader) return null;
        this.responseReaders.add(reader);
        const chunks = [];
        let size = 0;
        while (this.active) {
          const { value, done } = await reader.read();
          if (!this.active) return null;
          if (done) {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            return bytes;
          }
          size += value.byteLength;
          if (size > MAX_TEXT_LENGTH) return null;
          chunks.push(value);
        }
        return null;
      } finally {
        if (reader) {
          this.responseReaders.delete(reader);
          // A cloned response tees the original stream. Do not wait for tee
          // cancellation: the website still owns and consumes the other branch.
          try { void reader.cancel().catch(() => {}); } catch {}
          try { reader.releaseLock(); } catch {}
        }
      }
    }

    scan() {
      const globals = [
        globalThis.__NEXT_DATA__, globalThis.__INITIAL_STATE__, globalThis.__playinfo__,
        globalThis.__PLAYINFO__, globalThis.ytInitialPlayerResponse, globalThis.playerConfig,
        globalThis.__NUXT__, globalThis.__APOLLO_STATE__
      ];
      const manifests = [];
      const candidates = globals.flatMap(value => candidatesFromValue(value, 'page-state', manifests));
      for (const script of document.scripts) {
        const text = script.textContent || '';
        if (text && text.length <= MAX_TEXT_LENGTH) candidates.push(...urlsFromText(text, 'page-script'));
        if (text && text.length <= MAX_TEXT_LENGTH) manifests.push(...manifestsFromText(text, location.href, 'page-script'));
        if (candidates.length >= 500) break;
      }
      this.publish(candidates);
      this.publishManifests(manifests);
    }

    inspectResponse(response) {
      if (!this.active || !response) return;
      const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
      const length = Number(response.headers?.get?.('content-length') || 0);
      if (length > MAX_TEXT_LENGTH) return;
      const wrapped = /\.m3u8(?:$|[?#])/i.test(response.url || '');
      const useful = type.includes('json') || type.includes('javascript') || type.includes('xml')
        || type.includes('mpegurl') || type.startsWith('text/');
      if (!useful && !wrapped) return;
      return this.readResponse(response).then(bytes => {
        if (!this.active || !bytes) return;
        if (wrapped && bytes.byteLength <= 2 * 1024 * 1024) {
          globalThis.postMessage({ marker: MARKER, type: 'wrapped-manifest', data: bytesToBase64(bytes),
            baseUrl: response.url || location.href }, location.origin);
        }
        if (!useful) return;
        const text = new TextDecoder().decode(bytes);
        let candidates = urlsFromText(text, 'page-response');
        if (type.includes('json')) {
          try { candidates = candidates.concat(candidatesFromValue(JSON.parse(text), 'page-json')); }
          catch {}
        }
        this.publish(candidates);
        this.publishManifests(manifestsFromText(text, response.url || location.href, 'page-response'));
      }).catch(() => {});
    }

    install() {
      const runtime = this;
      if (!this.messageListening) {
        globalThis.addEventListener('message', this.onMessage);
        this.messageListening = true;
      }
      function trackedFetch(...args) {
        const promise = Reflect.apply(runtime.originalFetch, this, args);
        if (runtime.active) void promise.then(response => runtime.inspectResponse(response)).catch(() => {});
        return promise;
      }
      this.trackedFetch = trackedFetch;
      globalThis.fetch = trackedFetch;

      this.trackedXhrOpen = function trackedOpen(...args) {
        const result = Reflect.apply(runtime.originalXhrOpen, this, args);
        if (runtime.active && this && typeof this === 'object') {
          // Native open owns URL coercion. A successful load also provides
          // the final URL for URL objects, redirects, and other inputs.
          if (typeof args[1] === 'string') runtime.xhrUrls.set(this, normalizeUrl(args[1]));
          else runtime.xhrUrls.delete(this);
        }
        return result;
      };
      const addListener = EventTarget.prototype.addEventListener;
      function observeXhr() {
        try {
          if (!runtime.active) return;
          const type = String(this.getResponseHeader?.('content-type') || '').toLowerCase();
          if (!(type.includes('json') || type.includes('javascript') || type.includes('xml') || type.includes('mpegurl') || type.startsWith('text/'))) return;
          const baseUrl = this.responseURL || runtime.xhrUrls.get(this) || location.href;
          if (this.responseType === 'json') {
            // The browser has already parsed this object. Traverse it once;
            // serializing and reparsing duplicates both CPU work and memory.
            const manifests = [];
            try { runtime.publish(candidatesFromValue(this.response, 'page-xhr-json', manifests, baseUrl)); } catch {}
            runtime.publishManifests(manifests);
            return;
          }
          let text = '';
          try {
            if (!this.responseType || this.responseType === 'text') text = this.responseText;
          } catch {}
          if (!text || text.length > MAX_TEXT_LENGTH) return;
          let candidates = urlsFromText(text, 'page-xhr');
          if (type.includes('json')) {
            try { candidates = candidates.concat(candidatesFromValue(JSON.parse(text), 'page-xhr-json')); }
            catch {}
          }
          runtime.publish(candidates);
          runtime.publishManifests(manifestsFromText(text, baseUrl, 'page-xhr'));
        } catch {} // Discovery must not interrupt a page's XHR handlers.
      }
      this.trackedXhrSend = function trackedSend(...args) {
        if (runtime.active && this && typeof this === 'object') {
          // Reuse a single callback so failed or retried sends don't stack
          // observers. The browser retires it after the next successful load.
          try { Reflect.apply(addListener, this, ['load', observeXhr, { once: true }]); } catch {}
        }
        return Reflect.apply(runtime.originalXhrSend, this, args);
      };
      XMLHttpRequest.prototype.open = this.trackedXhrOpen;
      XMLHttpRequest.prototype.send = this.trackedXhrSend;
    }

    onMessage(event) {
      if (!this.active) return;
      if (event.source !== globalThis || event.data?.marker !== MARKER) return;
      if (event.data.type === 'scan') {
        this.active = true;
        this.scan();
      } else if (event.data.type === 'stop') this.stop();
    }

    stop() {
      this.active = false;
      for (const reader of this.responseReaders) { try { void reader.cancel().catch(() => {}); } catch {} }
      this.responseReaders.clear();
      if (globalThis.fetch === this.trackedFetch) globalThis.fetch = this.originalFetch;
      if (XMLHttpRequest.prototype.open === this.trackedXhrOpen) XMLHttpRequest.prototype.open = this.originalXhrOpen;
      if (XMLHttpRequest.prototype.send === this.trackedXhrSend) XMLHttpRequest.prototype.send = this.originalXhrSend;
      if (this.messageListening) globalThis.removeEventListener('message', this.onMessage);
      this.messageListening = false;
      if (globalThis[RUNTIME_KEY] === this) delete globalThis[RUNTIME_KEY];
    }
  }

  const existing = globalThis[RUNTIME_KEY];
  if (existing) {
    existing.active = true;
    existing.install();
    existing.scan();
    return;
  }
  const runtime = new PageVideoRuntime();
  globalThis[RUNTIME_KEY] = runtime;
  runtime.scan();
})();
