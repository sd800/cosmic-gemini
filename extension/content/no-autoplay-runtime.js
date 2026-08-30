(() => {
  const READY = 'cosmic-gemini:no-autoplay:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:no-autoplay:main-ready';
  const CONFIGURE = 'cosmic-gemini:no-autoplay:configure';
  const INTERVENED = 'cosmic-gemini:no-autoplay:intervened';
  const AUDIO_BLOCKED = 'cosmic-gemini:no-autoplay:audio-blocked';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.no-autoplay.runtime');

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
      this.active = true;
      this.configured = false;
      this.mode = 'standard';
      this.audioAllowed = false;
      this.reported = false;
      this.audioPrompted = false;
      this.observer = null;
      this.mediaIntent = new WeakMap();
      this.pendingAudio = new Set();
      this.pendingVideo = new Set();
      this.pendingContexts = new Set();
      this.originalPlay = HTMLMediaElement.prototype.play;
      this.originalPause = HTMLMediaElement.prototype.pause;
      this.originalResume = globalThis.AudioContext?.prototype?.resume;
      this.originalWebkitResume = globalThis.webkitAudioContext?.prototype?.resume;
      this.onConfigure = this.onConfigure.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onUserIntent = this.onUserIntent.bind(this);
      this.onPlay = this.onPlay.bind(this);
      this.onMutations = this.onMutations.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener('pointerdown', this.onUserIntent, true);
      window.addEventListener('keydown', this.onUserIntent, true);
      window.addEventListener('play', this.onPlay, true);
      this.patchMediaPlay();
      this.patchAudioContexts();
    }

    announce() {
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }

    onBridgeReady() {
      this.announce();
      if (this.reported) window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
      if (this.audioPrompted) window.dispatchEvent(new CustomEvent(AUDIO_BLOCKED, { detail: this.token }));
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      const config = message.config || {};
      const wasAudioAllowed = this.audioAllowed;
      this.configured = true;
      this.active = config.active === true;
      this.mode = config.mode === 'enhanced' ? 'enhanced' : 'standard';
      this.audioAllowed = config.audioAllowed === true && this.mode !== 'enhanced';
      if (!this.active) {
        this.disableObserver();
        this.reported = false;
        this.audioPrompted = false;
        this.resumePendingMedia(true);
        this.resumePendingContexts();
        return;
      }
      if (this.mode === 'enhanced') {
        this.enableEnhancedObserver();
        this.removeMedia(document);
      } else {
        this.disableObserver();
        this.stopInitialAutoplay();
      }
      if (!wasAudioAllowed && this.audioAllowed) {
        this.resumePendingMedia(false);
        this.resumePendingContexts();
      }
    }

    patchMediaPlay() {
      const runtime = this;
      HTMLMediaElement.prototype.play = function cosmicGeminiPlay() {
        if (!runtime.shouldBlockMedia(this)) {
          runtime.pendingAudio.delete(this);
          runtime.pendingVideo.delete(this);
          return Reflect.apply(runtime.originalPlay, this, []);
        }
        runtime.blockMedia(this);
        return Promise.resolve();
      };
    }

    patchAudioContexts() {
      const runtime = this;
      const patched = new Set();
      const patch = (property, constructor, original) => {
        if (!constructor?.prototype || typeof original !== 'function') return;
        if (patched.has(constructor)) return;
        patched.add(constructor);
        constructor.prototype.resume = function cosmicGeminiResume() {
          if (!runtime.shouldBlockAudioContext()) return Reflect.apply(original, this, []);
          runtime.rememberPendingContext(this, original);
          runtime.reportIntervention();
          if (runtime.mode !== 'enhanced') runtime.reportAudioBlocked();
          try { void this.suspend(); } catch {}
          return Promise.resolve();
        };
        try {
          const wrapped = new Proxy(constructor, {
            construct(target, args, newTarget) {
              const context = Reflect.construct(target, args, newTarget === wrapped ? target : newTarget);
              if (runtime.shouldBlockAudioContext()) {
                runtime.rememberPendingContext(context, original);
                runtime.reportIntervention();
                if (runtime.mode !== 'enhanced') runtime.reportAudioBlocked();
                try { void context.suspend(); } catch {}
              }
              return context;
            }
          });
          Object.defineProperty(globalThis, property, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: wrapped
          });
        } catch {}
      };
      patch('AudioContext', globalThis.AudioContext, this.originalResume);
      patch('webkitAudioContext', globalThis.webkitAudioContext, this.originalWebkitResume);
    }

    onUserIntent(event) {
      if (!event.isTrusted) return;
      if (event.type === 'keydown' && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      for (const node of path) {
        if (node instanceof HTMLMediaElement) {
          this.mediaIntent.set(node, performance.now() + 2000);
          break;
        }
      }
    }

    hasUserIntent(media) {
      if (navigator.userActivation?.isActive) return true;
      return (this.mediaIntent.get(media) || 0) >= performance.now();
    }

    shouldBlockMedia(media) {
      if (!this.active) return false;
      if (this.mode === 'enhanced') return true;
      if (this.hasUserIntent(media)) return false;
      if (media instanceof HTMLAudioElement && this.audioAllowed) return false;
      return true;
    }

    shouldBlockAudioContext() {
      if (!this.active) return false;
      if (this.mode === 'enhanced') return true;
      if (navigator.userActivation?.isActive) return false;
      return !this.audioAllowed;
    }

    onPlay(event) {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement) || !this.shouldBlockMedia(media)) return;
      this.blockMedia(media);
    }

    blockMedia(media) {
      try { Reflect.apply(this.originalPause, media, []); } catch {}
      try { media.removeAttribute('autoplay'); } catch {}
      this.reportIntervention();
      if (this.mode === 'enhanced') {
        media.remove();
        return;
      }
      if (media instanceof HTMLAudioElement) {
        this.rememberPending(this.pendingAudio, media);
        if (!media.muted && Number(media.volume) > 0) this.reportAudioBlocked();
      } else if (media instanceof HTMLVideoElement) {
        this.rememberPending(this.pendingVideo, media);
      }
    }

    stopInitialAutoplay() {
      if (!document.querySelectorAll) return;
      for (const media of document.querySelectorAll('video[autoplay],audio[autoplay]')) this.blockMedia(media);
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
      if (collection.size >= 8) collection.delete(collection.values().next().value);
      collection.add(value);
    }

    rememberPendingContext(context, resume) {
      if (this.pendingContexts.size >= 8) this.pendingContexts.delete(this.pendingContexts.values().next().value);
      this.pendingContexts.add({ context, resume });
    }

    resumePendingMedia(includeVideo) {
      this.audioPrompted = false;
      for (const media of this.pendingAudio) {
        if (!media?.isConnected || !(media instanceof HTMLAudioElement)) continue;
        try { void Reflect.apply(this.originalPlay, media, []); } catch {}
      }
      this.pendingAudio.clear();
      if (includeVideo) {
        for (const media of this.pendingVideo) {
          if (!media?.isConnected || !(media instanceof HTMLVideoElement)) continue;
          try { void Reflect.apply(this.originalPlay, media, []); } catch {}
        }
        this.pendingVideo.clear();
      }
    }

    resumePendingContexts() {
      for (const entry of this.pendingContexts) {
        try { if (typeof entry.resume === 'function') void Reflect.apply(entry.resume, entry.context, []); }
        catch {}
      }
      this.pendingContexts.clear();
    }

    reportIntervention() {
      if (this.reported) return;
      this.reported = true;
      window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }

    reportAudioBlocked() {
      if (this.audioPrompted || !this.active || this.audioAllowed || this.mode === 'enhanced') return;
      this.audioPrompted = true;
      window.dispatchEvent(new CustomEvent(AUDIO_BLOCKED, { detail: this.token }));
    }
  }

  const runtime = new NoAutoplayRuntime();
  window[RUNTIME_KEY] = runtime;
  runtime.announce();
})();
