(() => {
  const READY = 'cosmic-gemini:no-autoplay:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:no-autoplay:main-ready';
  const CONFIGURE = 'cosmic-gemini:no-autoplay:configure';
  const DISPOSE = 'cosmic-gemini:no-autoplay:dispose';
  const INTERVENED = 'cosmic-gemini:no-autoplay:intervened';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.no-autoplay.runtime');
  const CONTROL_INTENT_MS = 2000;
  const ASSOCIATED_MEDIA_INTENT_MS = 15000;
  const MAX_ASSOCIATION_PATH_DEPTH = 10;

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  if (window[RUNTIME_KEY]) {
    window[RUNTIME_KEY].announce();
    return;
  }

  class NoAutoplayRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.configured = false;
      this.mode = 'standard';
      this.audioAllowed = false;
      this.reported = false;
      this.userIntentUntil = -1;
      this.observer = null;
      this.mediaIntent = new WeakMap();
      this.playerIntent = new WeakMap();
      this.userPlayback = new WeakSet();
      this.pendingAudio = new Set();
      this.pendingVideo = new Set();
      this.pendingContexts = new Map();
      this.audioContexts = new Map();
      this.originalPlay = HTMLMediaElement.prototype.play;
      this.originalPause = HTMLMediaElement.prototype.pause;
      this.patchedPlay = null;
      this.audioContextPatches = [];
      this.behaviorHooksInstalled = false;
      this.onConfigure = this.onConfigure.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onUserIntent = this.onUserIntent.bind(this);
      this.onPlay = this.onPlay.bind(this);
      this.onPlaybackStopped = this.onPlaybackStopped.bind(this);
      this.onMutations = this.onMutations.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
    }

    announce() {
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }

    onBridgeReady() {
      this.announce();
      if (this.reported) window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.active = false;
      this.disableObserver();
      this.resumePendingMedia(true);
      this.resumePendingContexts();
      this.removeBehaviorHooks();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      try { delete window[RUNTIME_KEY]; } catch {}
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      const config = message.config || {};
      const wasActive = this.active;
      const wasAudioAllowed = this.audioAllowed;
      this.configured = true;
      this.active = config.active === true;
      this.mode = config.mode === 'enhanced' ? 'enhanced' : 'standard';
      this.audioAllowed = config.audioAllowed === true && this.mode !== 'enhanced';
      if (!this.active) {
        this.disableObserver();
        this.reported = false;
        this.resumePendingMedia(true);
        this.resumePendingContexts();
        this.removeBehaviorHooks();
        return;
      }
      this.installBehaviorHooks();
      if (this.mode === 'enhanced') {
        this.enableEnhancedObserver();
        this.removeMedia(document);
        this.suspendAutomaticContexts(true);
      } else {
        this.disableObserver();
        if (!wasActive) this.stopInitialPlayback();
        else if (wasAudioAllowed && !this.audioAllowed) {
          this.stopInitialPlayback('audio');
          this.suspendAutomaticContexts();
        }
      }
      if (!wasAudioAllowed && this.audioAllowed) {
        this.resumePendingMedia(false);
        this.resumePendingContexts();
      }
    }

    patchMediaPlay() {
      if (this.patchedPlay) return;
      const runtime = this;
      const original = HTMLMediaElement.prototype.play;
      this.patchedPlay = function cosmicGeminiPlay() {
        if (!(this instanceof HTMLMediaElement)) return Reflect.apply(original, this, arguments);
        if (!runtime.shouldBlockMedia(this)) {
          runtime.pendingAudio.delete(this);
          runtime.pendingVideo.delete(this);
          return Reflect.apply(original, this, arguments);
        }
        runtime.blockMedia(this);
        return runtime.blockedPlayPromise();
      };
      this.previousPlay = original;
      HTMLMediaElement.prototype.play = this.patchedPlay;
    }

    patchAudioContexts() {
      const runtime = this;
      if (this.audioContextPatches.length) return;
      const patched = new Map();
      const patch = (property, constructor) => {
        const shared = patched.get(constructor);
        const original = shared?.original || constructor?.prototype?.resume;
        if (!constructor?.prototype || typeof original !== 'function') return;
        const wrappedResume = shared?.wrappedResume || function cosmicGeminiResume() {
          if (!(this instanceof constructor)) return Reflect.apply(original, this, arguments);
          if (this.state === 'closed' || !runtime.shouldBlockAudioContext(this)) {
            runtime.rememberAudioContext(this, original, runtime.hasRecentPlaybackIntent() || runtime.hasUserAudioContext(this));
            runtime.pendingContexts.delete(this);
            return Reflect.apply(original, this, arguments);
          }
          runtime.rememberPendingContext(this, original);
          runtime.reportIntervention();
          try { void Promise.resolve(this.suspend()).catch(() => {}); } catch {}
          return runtime.blockedPlayPromise('resume');
        };
        if (!shared) {
          constructor.prototype.resume = wrappedResume;
          patched.set(constructor, { original, wrappedResume });
        }
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, property);
        let wrappedConstructor = null;
        try {
          const wrapped = new Proxy(constructor, {
            construct(target, args, newTarget) {
              const context = Reflect.construct(target, args, newTarget === wrapped ? target : newTarget);
              runtime.rememberAudioContext(context, original, runtime.hasRecentPlaybackIntent());
              if (runtime.shouldBlockAudioContext()) {
                runtime.rememberPendingContext(context, original);
                runtime.reportIntervention();
                try { void Promise.resolve(context.suspend()).catch(() => {}); } catch {}
              }
              return context;
            }
          });
          wrappedConstructor = wrapped;
          Object.defineProperty(globalThis, property, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: wrapped
          });
        } catch {}
        this.audioContextPatches.push({ property, constructor, original, wrappedResume, wrappedConstructor, descriptor });
      };
      patch('AudioContext', globalThis.AudioContext);
      patch('webkitAudioContext', globalThis.webkitAudioContext);
    }

    installBehaviorHooks() {
      if (this.behaviorHooksInstalled) return;
      window.addEventListener('pointerdown', this.onUserIntent, true);
      window.addEventListener('click', this.onUserIntent, true);
      window.addEventListener('keydown', this.onUserIntent, true);
      window.addEventListener('play', this.onPlay, true);
      for (const type of ['pause', 'ended', 'emptied']) window.addEventListener(type, this.onPlaybackStopped, true);
      this.patchMediaPlay();
      this.patchAudioContexts();
      this.behaviorHooksInstalled = true;
    }

    removeBehaviorHooks() {
      if (!this.behaviorHooksInstalled) return;
      window.removeEventListener('pointerdown', this.onUserIntent, true);
      window.removeEventListener('click', this.onUserIntent, true);
      window.removeEventListener('keydown', this.onUserIntent, true);
      window.removeEventListener('play', this.onPlay, true);
      for (const type of ['pause', 'ended', 'emptied']) window.removeEventListener(type, this.onPlaybackStopped, true);
      try {
        if (HTMLMediaElement.prototype.play === this.patchedPlay) HTMLMediaElement.prototype.play = this.previousPlay;
      } catch {}
      this.patchedPlay = null;
      for (const entry of this.audioContextPatches) {
        try {
          if (entry.constructor.prototype.resume === entry.wrappedResume) entry.constructor.prototype.resume = entry.original;
          if (entry.wrappedConstructor && globalThis[entry.property] === entry.wrappedConstructor) {
            if (entry.descriptor) Object.defineProperty(globalThis, entry.property, entry.descriptor);
            else delete globalThis[entry.property];
          }
        } catch {}
      }
      this.audioContextPatches = [];
      this.behaviorHooksInstalled = false;
      this.userIntentUntil = -1;
      this.mediaIntent = new WeakMap();
      this.playerIntent = new WeakMap();
      this.userPlayback = new WeakSet();
      this.audioContexts.clear();
    }

    onUserIntent(event) {
      if (!event.isTrusted) return;
      if (event.isPrimary === false || (typeof event.button === 'number' && event.button !== 0) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.type === 'keydown' && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (path.some(node => this.isTextEntry(node))) return;
      for (const node of path) {
        if (node instanceof HTMLMediaElement) {
          this.mediaIntent.set(node, performance.now() + ASSOCIATED_MEDIA_INTENT_MS);
          return;
        }
      }
      if (path.some(node => this.isPlaybackControl(node))) {
        const now = performance.now();
        this.userIntentUntil = now + CONTROL_INTENT_MS;
        this.associatePlaybackIntent(path, now + ASSOCIATED_MEDIA_INTENT_MS);
      }
    }

    associatePlaybackIntent(path, deadline) {
      for (const node of path.slice(0, MAX_ASSOCIATION_PATH_DEPTH)) {
        // Never turn a local play button into a long page-wide permission.
        if (node === document || node === document.body || node === document.documentElement) break;
        if (!node || typeof node.querySelectorAll !== 'function') continue;
        let candidates;
        try {
          candidates = [];
          for (const media of node.querySelectorAll('video,audio')) {
            if (this.isVisibleMedia(media)) candidates.push(media);
            if (candidates.length > 1) break;
          }
        } catch {
          continue;
        }
        if (!candidates.length) continue;
        if (candidates.length > 1) return;
        this.playerIntent.set(node, deadline);
        for (const media of candidates) this.mediaIntent.set(media, deadline);
        return;
      }
    }

    isVisibleMedia(media) {
      if (!(media instanceof HTMLMediaElement) || media.isConnected === false) return false;
      if (typeof media.getBoundingClientRect === 'function') {
        try {
          const rect = media.getBoundingClientRect();
          return Number(rect?.width) >= 16 && Number(rect?.height) >= 16;
        } catch {
          return false;
        }
      }
      return !!(media.currentSrc || media.src || media.getAttribute?.('src'));
    }

    isPlaybackControl(node) {
      if (!node || typeof node.getAttribute !== 'function') return false;
      if (node === document.body || node === document.documentElement || this.isTextEntry(node)) return false;
      const attribute = name => String(node.getAttribute(name) || '');
      const metadata = [
        attribute('aria-label'), attribute('title'), attribute('data-action'),
        attribute('data-testid'), attribute('data-control'), attribute('id'),
        typeof node.className === 'string' ? node.className : node.className?.baseVal || ''
      ].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const metadataSignalsPlayback = /(^|[\s:_-])(play|replay|resume|unmute|listen)(?=$|[\s:_-])|播放|重播|解除静音|取消静音/.test(metadata)
        || (/(^|[\s:_-])start(?=$|[\s:_-])/.test(metadata) && /(media|video|audio|player)/.test(metadata));
      if (metadataSignalsPlayback) return true;
      const tagName = String(node.localName || node.tagName || '').toLowerCase();
      const role = attribute('role').toLowerCase();
      if (!['button', 'a', 'input'].includes(tagName) && role !== 'button') return false;
      const text = String(node.textContent || attribute('value') || '').trim().slice(0, 80).toLowerCase();
      return /(^|\s)(play|replay|resume|unmute|listen)(?=$|\s)|播放|重播|解除静音|取消静音/.test(text);
    }

    isTextEntry(node) {
      if (!node || typeof node.getAttribute !== 'function') return false;
      const tag = String(node.localName || node.tagName || '').toLowerCase();
      if (node.isContentEditable === true || node.getAttribute('role') === 'textbox' || ['textarea', 'select'].includes(tag)) return true;
      return tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(String(node.getAttribute('type') || 'text').toLowerCase());
    }

    hasRecentPlaybackIntent() {
      return this.userIntentUntil > performance.now();
    }

    hasUserIntent(media) {
      if (this.hasRecentPlaybackIntent()) return true;
      if (media.paused === false && this.userPlayback.has(media)) return true;
      const now = performance.now();
      if ((this.mediaIntent.get(media) || -1) > now) return true;
      let node = media;
      for (let depth = 0; node && depth < MAX_ASSOCIATION_PATH_DEPTH; depth += 1) {
        if ((this.playerIntent.get(node) || -1) > now && this.isVisibleMedia(media)) return true;
        node = node.parentElement || node.parentNode || node.host || null;
      }
      return false;
    }

    blockedPlayPromise(method = 'play') {
      const message = `The ${method}() request was prevented because it was not initiated by a media playback control.`;
      let error;
      try { error = new DOMException(message, 'NotAllowedError'); }
      catch {
        error = new Error(message);
        error.name = 'NotAllowedError';
      }
      const denial = Promise.reject(error);
      void denial.catch(() => {});
      return denial;
    }

    shouldBlockMedia(media) {
      if (!this.active) return false;
      if (this.mode === 'enhanced') return true;
      if (this.hasUserIntent(media)) return false;
      if (media instanceof HTMLAudioElement && this.audioAllowed) return false;
      return true;
    }

    hasUserAudioContext(context) {
      return !!context && context.state === 'running' && this.audioContexts.get(context)?.userStarted === true;
    }

    shouldBlockAudioContext(context) {
      if (!this.active) return false;
      if (this.mode === 'enhanced') return true;
      if (this.hasRecentPlaybackIntent()) return false;
      if (this.hasUserAudioContext(context)) return false;
      return !this.audioAllowed;
    }

    isNativePlaybackIntent(event, media) {
      // Chromium's own controls consume their pointer events inside UA Shadow
      // DOM. Their trusted play event still identifies the focused media.
      // This exception is event-only: it never relaxes the script play() guard
      // or grants a page-wide HTML-media / Web Audio permission.
      if (event.isTrusted !== true || media.controls !== true || navigator.userActivation?.isActive !== true) return false;
      let root;
      try { root = media.getRootNode?.() || document; } catch { return false; }
      return root.activeElement === media;
    }

    onPlay(event) {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement) || event.isTrusted !== true) return;
      if (this.active && this.mode !== 'enhanced' && this.isNativePlaybackIntent(event, media)) {
        this.mediaIntent.set(media, performance.now() + ASSOCIATED_MEDIA_INTENT_MS);
      }
      if (this.shouldBlockMedia(media)) this.blockMedia(media);
      else {
        if (this.hasUserIntent(media)) this.userPlayback.add(media);
        this.pendingAudio.delete(media);
        this.pendingVideo.delete(media);
      }
    }

    onPlaybackStopped(event) {
      if (event.isTrusted !== true || !(event.target instanceof HTMLMediaElement)) return;
      // A queued pause from an earlier block must not revoke a newer play.
      if (event.type === 'emptied' || event.target.paused === true || event.target.ended === true) this.userPlayback.delete(event.target);
      if (event.type === 'emptied') {
        this.mediaIntent.delete(event.target);
        this.pendingAudio.delete(event.target);
        this.pendingVideo.delete(event.target);
      }
    }

    blockMedia(media) {
      this.userPlayback.delete(media);
      try { Reflect.apply(this.originalPause, media, []); } catch {}
      try { media.removeAttribute('autoplay'); } catch {}
      this.reportIntervention();
      if (this.mode === 'enhanced') {
        media.remove();
        return;
      }
      if (media instanceof HTMLAudioElement) {
        this.rememberPending(this.pendingAudio, media);
      } else if (media instanceof HTMLVideoElement) {
        this.rememberPending(this.pendingVideo, media);
      }
    }

    stopInitialPlayback(selector = 'video,audio') {
      if (!document.querySelectorAll) return;
      for (const media of document.querySelectorAll(selector)) {
        const requestedAutoplay = media.hasAttribute?.('autoplay') === true;
        const alreadyPlaying = media.paused === false;
        if ((requestedAutoplay || alreadyPlaying) && this.shouldBlockMedia(media)) this.blockMedia(media);
      }
    }

    enableEnhancedObserver() {
      if (this.observer || !document.documentElement) return;
      this.observer = new MutationObserver(this.onMutations);
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    disableObserver() {
      this.observer?.disconnect();
      this.observer = null;
    }

    onMutations(records) {
      if (!this.active || this.mode !== 'enhanced') return;
      for (const record of records) {
        for (const node of record.addedNodes) this.removeMedia(node);
      }
    }

    removeMedia(root) {
      if (!root) return;
      if (root instanceof HTMLMediaElement) {
        this.blockMedia(root);
        return;
      }
      if (!root.querySelectorAll) return;
      for (const media of root.querySelectorAll('video,audio')) this.blockMedia(media);
    }

    rememberPending(collection, value) {
      if (!collection.has(value) && collection.size >= 8) collection.delete(collection.values().next().value);
      collection.add(value);
    }

    rememberPendingContext(context, resume) {
      if (!this.pendingContexts.has(context) && this.pendingContexts.size >= 8) this.pendingContexts.delete(this.pendingContexts.keys().next().value);
      this.pendingContexts.set(context, resume);
    }

    rememberAudioContext(context, resume, userStarted) {
      if (!this.active) return;
      for (const existing of this.audioContexts.keys()) if (existing.state === 'closed') this.audioContexts.delete(existing);
      if (context.state === 'closed') return;
      if (!this.audioContexts.has(context) && this.audioContexts.size >= 8) this.audioContexts.delete(this.audioContexts.keys().next().value);
      this.audioContexts.set(context, { resume, userStarted });
    }

    suspendAutomaticContexts(includeUser = false) {
      for (const [context, entry] of this.audioContexts) {
        if (context.state === 'closed') { this.audioContexts.delete(context); continue; }
        if (context.state !== 'running' || (!includeUser && entry.userStarted)) continue;
        this.rememberPendingContext(context, entry.resume);
        this.reportIntervention();
        try { void Promise.resolve(context.suspend()).catch(() => {}); } catch {}
      }
    }

    resumePendingMedia(includeVideo) {
      for (const media of this.pendingAudio) {
        if (!media?.isConnected || !(media instanceof HTMLAudioElement)) continue;
        try { void Promise.resolve(Reflect.apply(this.originalPlay, media, [])).catch(() => {}); } catch {}
      }
      this.pendingAudio.clear();
      if (includeVideo) {
        for (const media of this.pendingVideo) {
          if (!media?.isConnected || !(media instanceof HTMLVideoElement)) continue;
          try { void Promise.resolve(Reflect.apply(this.originalPlay, media, [])).catch(() => {}); } catch {}
        }
        this.pendingVideo.clear();
      }
    }

    resumePendingContexts() {
      for (const [context, resume] of this.pendingContexts) {
        try { if (context.state !== 'closed' && typeof resume === 'function') void Promise.resolve(Reflect.apply(resume, context, [])).catch(() => {}); }
        catch {}
      }
      this.pendingContexts.clear();
    }

    reportIntervention() {
      if (this.reported) return;
      this.reported = true;
      window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }

  }

  const runtime = new NoAutoplayRuntime();
  window[RUNTIME_KEY] = runtime;
  runtime.announce();
})();
