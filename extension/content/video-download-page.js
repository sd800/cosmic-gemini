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

  function candidatesFromValue(root, source) {
    const candidates = [];
    const queue = [root];
    const seen = new WeakSet();
    let inspected = 0;
    while (queue.length && inspected < 50000 && candidates.length < 500) {
      const value = queue.shift();
      inspected += 1;
      if (typeof value === 'string') {
        candidates.push(...urlsFromText(value, source));
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
      this.active = true;
      this.install();
      globalThis.addEventListener('message', event => this.onMessage(event));
    }

    publish(candidates) {
      if (!this.active || !candidates.length) return;
      globalThis.postMessage({ marker: MARKER, type: 'candidates', candidates: candidates.slice(0, 500) }, location.origin);
    }

    publishManifests(manifests) {
      if (!this.active || !manifests.length) return;
      globalThis.postMessage({ marker: MARKER, type: 'manifests', manifests: manifests.slice(0, 12) }, location.origin);
    }

    publishWrappedManifest(response) {
      const length = Number(response.headers?.get?.('content-length') || 0);
      if (!/\.m3u8(?:$|[?#])/i.test(response.url || '') || length > 2 * 1024 * 1024) return;
      void response.clone().arrayBuffer().then(buffer => {
        if (buffer.byteLength > 2 * 1024 * 1024) return;
        globalThis.postMessage({
          marker: MARKER,
          type: 'wrapped-manifest',
          data: bytesToBase64(new Uint8Array(buffer)),
          baseUrl: response.url || location.href
        }, location.origin);
      }).catch(() => {});
    }

    scan() {
      const globals = [
        globalThis.__NEXT_DATA__, globalThis.__INITIAL_STATE__, globalThis.__playinfo__,
        globalThis.__PLAYINFO__, globalThis.ytInitialPlayerResponse, globalThis.playerConfig,
        globalThis.__NUXT__, globalThis.__APOLLO_STATE__
      ];
      const candidates = globals.flatMap(value => candidatesFromValue(value, 'page-state'));
      const manifests = [];
      for (const value of globals) {
        try { manifests.push(...manifestsFromText(JSON.stringify(value), location.href, 'page-state')); }
        catch {}
      }
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
      this.publishWrappedManifest(response);
      const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
      const length = Number(response.headers?.get?.('content-length') || 0);
      if (length > MAX_TEXT_LENGTH) return;
      const useful = type.includes('json') || type.includes('javascript') || type.includes('xml')
        || type.includes('mpegurl') || type.startsWith('text/');
      if (!useful) return;
      void response.clone().text().then(text => {
        if (text.length > MAX_TEXT_LENGTH) return;
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
      function trackedFetch(...args) {
        const promise = Reflect.apply(runtime.originalFetch, this, args);
        void promise.then(response => runtime.inspectResponse(response)).catch(() => {});
        return promise;
      }
      this.trackedFetch = trackedFetch;
      globalThis.fetch = trackedFetch;

      XMLHttpRequest.prototype.open = function trackedOpen(method, url, ...rest) {
        this.__cosmicGeminiVideoUrl = normalizeUrl(url);
        return Reflect.apply(runtime.originalXhrOpen, this, [method, url, ...rest]);
      };
      XMLHttpRequest.prototype.send = function trackedSend(...args) {
        this.addEventListener('load', () => {
          if (!runtime.active) return;
          const type = String(this.getResponseHeader?.('content-type') || '').toLowerCase();
          if (!(type.includes('json') || type.includes('javascript') || type.includes('xml') || type.includes('mpegurl') || type.startsWith('text/'))) return;
          let text = '';
          try {
            if (!this.responseType || this.responseType === 'text') text = this.responseText;
            else if (this.responseType === 'json' && this.response !== null) text = JSON.stringify(this.response);
          } catch {}
          if (!text || text.length > MAX_TEXT_LENGTH) return;
          let candidates = urlsFromText(text, 'page-xhr');
          if (type.includes('json')) {
            try { candidates = candidates.concat(candidatesFromValue(JSON.parse(text), 'page-xhr-json')); }
            catch {}
          }
          runtime.publish(candidates);
          runtime.publishManifests(manifestsFromText(text, this.responseURL || this.__cosmicGeminiVideoUrl || location.href, 'page-xhr'));
        }, { once: true });
        return Reflect.apply(runtime.originalXhrSend, this, args);
      };
    }

    onMessage(event) {
      if (event.source !== globalThis || event.data?.marker !== MARKER) return;
      if (event.data.type === 'scan') {
        this.active = true;
        this.scan();
      } else if (event.data.type === 'stop') this.stop();
    }

    stop() {
      this.active = false;
      if (globalThis.fetch === this.trackedFetch) globalThis.fetch = this.originalFetch;
      if (XMLHttpRequest.prototype.open.name === 'trackedOpen') XMLHttpRequest.prototype.open = this.originalXhrOpen;
      if (XMLHttpRequest.prototype.send.name === 'trackedSend') XMLHttpRequest.prototype.send = this.originalXhrSend;
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
