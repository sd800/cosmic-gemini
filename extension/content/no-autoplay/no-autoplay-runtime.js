(() => {
  const READY = 'cosmic-gemini:no-autoplay:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:no-autoplay:main-ready';
  const CONFIGURE = 'cosmic-gemini:no-autoplay:configure';
  const DISPOSE = 'cosmic-gemini:no-autoplay:dispose';
  const INTERVENED = 'cosmic-gemini:no-autoplay:intervened';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.no-autoplay.runtime');
  const SESSION_KEY = Symbol.for('cosmic-gemini.no-autoplay.playback-session');
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

  function nativeGetter(constructor, name) {
    return constructor?.prototype && Object.getOwnPropertyDescriptor(constructor.prototype, name)?.get;
  }

  const audioState = nativeGetter(globalThis.BaseAudioContext, 'state');
  const audioNodeContext = nativeGetter(globalThis.AudioNode, 'context');
  const mediaNodeElement = nativeGetter(globalThis.MediaElementAudioSourceNode, 'mediaElement');
  const contextState = context => audioState ? Reflect.apply(audioState, context, []) : context.state;

  class NoAutoplayRuntime {
    constructor() {
      const retained = window[SESSION_KEY];
      try { delete window[SESSION_KEY]; } catch {}
      this.token = randomToken();
      this.active = false;
      this.disposed = false;
      this.configured = false;
      this.mode = 'standard';
      this.audioAllowed = false;
      this.reported = false;
      this.userIntentUntil = -1;
      this.surfaceIntent = null;
      this.controlIntent = null;
      this.intentContext = null;
      this.observer = null;
      this.mediaIntent = new WeakMap();
      this.playerIntent = new WeakMap();
      this.mediaPlayers = retained?.mediaPlayers instanceof WeakMap ? retained.mediaPlayers : new WeakMap();
      this.authorizedPlayers = retained?.authorizedPlayers instanceof WeakSet ? retained.authorizedPlayers : new WeakSet();
      this.userPlayback = retained?.userPlayback instanceof WeakSet ? retained.userPlayback : new WeakSet();
      this.pendingAudio = new Set();
      this.pendingVideo = new Set();
      this.autoplayAttributes = new WeakMap();
      this.autoplayAttributeRefs = new Set();
      this.pendingContexts = new Map();
      this.pendingContextEntries = new WeakMap();
      this.pendingContextRefs = new Set();
      this.audioContexts = new Map();
      this.authorizedContexts = retained?.authorizedContexts instanceof WeakSet ? retained.authorizedContexts : new WeakSet();
      this.mediaContexts = retained?.mediaContexts instanceof WeakMap ? retained.mediaContexts : new WeakMap();
      this.contextMedia = retained?.contextMedia instanceof WeakMap ? retained.contextMedia : new WeakMap();
      this.mediaSourcePatch = null;
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
      if (this.disposed) return;
      // document.open() may erase Window listeners while retaining the runtime.
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener(DISPOSE, this.onDispose, true);
      if (this.active) {
        this.installBehaviorHooks();
        if (this.mode === 'enhanced') this.enableEnhancedObserver();
      }
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }

    onBridgeReady() {
      if (this.disposed) return;
      this.announce();
      if (this.reported) window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }

    onDispose(event) {
      if (event?.detail !== this.token || this.disposed) return;
      this.disposed = true;
      // Inert, weak, document-local policy survives off/on reinjection without
      // keeping media or contexts alive, observing the page, or storing URLs.
      try { Object.defineProperty(window, SESSION_KEY, { configurable: true, value: {
        userPlayback: this.userPlayback, authorizedContexts: this.authorizedContexts,
        mediaContexts: this.mediaContexts, contextMedia: this.contextMedia,
        mediaPlayers: this.mediaPlayers, authorizedPlayers: this.authorizedPlayers
      } }); } catch {}
      this.active = false;
      this.surfaceIntent = null;
      this.controlIntent = null; this.intentContext = null;
      this.disableObserver();
      this.pendingAudio.clear(); this.pendingVideo.clear();
      this.resumePendingContexts();
      this.removeBehaviorHooks();
      this.restoreAutoplayAttributes();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      try { if (window[RUNTIME_KEY] === this) delete window[RUNTIME_KEY]; } catch {}
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token || this.disposed) return;
      const config = message.config || {};
      const nextActive = config.active === true;
      const nextMode = config.mode === 'enhanced' ? 'enhanced' : 'standard';
      const nextAudioAllowed = config.audioAllowed === true && nextMode !== 'enhanced';
      if (this.configured && this.active === nextActive && this.mode === nextMode
        && this.audioAllowed === nextAudioAllowed
        && (!nextActive || nextMode !== 'enhanced' || this.observer || !document.documentElement)) return;
      const wasActive = this.active;
      const wasAudioAllowed = this.audioAllowed;
      this.configured = true;
      this.active = nextActive;
      this.mode = nextMode;
      this.audioAllowed = nextAudioAllowed;
      if (!this.active) {
        this.surfaceIntent = null;
        this.controlIntent = null; this.intentContext = null;
        this.disableObserver();
        this.reported = false;
        this.pendingAudio.clear(); this.pendingVideo.clear();
        this.resumePendingContexts();
        this.removeBehaviorHooks();
        this.restoreAutoplayAttributes();
        return;
      }
      this.installBehaviorHooks();
      if (this.mode === 'enhanced') {
        this.enableEnhancedObserver();
        this.removeMedia(document);
        this.suspendAutomaticContexts();
      } else {
        this.disableObserver();
        if (!wasActive) this.stopInitialPlayback();
        else if (wasAudioAllowed && !this.audioAllowed) {
          this.stopInitialPlayback('audio');
          this.suspendAutomaticContexts();
        }
      }
      if (!wasAudioAllowed && this.audioAllowed) {
        this.resumePendingAudio();
        this.resumePendingContexts();
      }
    }

    patchMediaPlay() {
      if (this.patchedPlay) return;
      const runtime = this;
      const original = HTMLMediaElement.prototype.play;
      this.patchedPlay = function cosmicGeminiPlay() {
        if (!runtime.active) return Reflect.apply(original, this, arguments);
        if (!(this instanceof HTMLMediaElement)) return Reflect.apply(original, this, arguments);
        const manual = runtime.hasUserIntent(this);
        if (!runtime.shouldBlockMedia(this, manual)) {
          if (manual) runtime.authorizeMedia(this);
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
          if (!runtime.active) return Reflect.apply(original, this, arguments);
          if (!(this instanceof constructor)) return Reflect.apply(original, this, arguments);
          if (contextState(this) === 'closed' || !runtime.shouldBlockAudioContext(this)) {
            runtime.rememberAudioContext(this, original, runtime.hasContextIntent(this)
              || runtime.hasUserAudioContext(this) || runtime.hasLinkedMediaIntent(this));
            runtime.forgetPendingContext(this);
            return Reflect.apply(original, this, arguments);
          }
          runtime.rememberPendingContext(this, original);
          runtime.reportIntervention();
          try { void Promise.resolve(this.suspend()).catch(() => {}); } catch {}
          return runtime.blockedPlayPromise('resume');
        };
        if (!shared) {
          constructor.prototype.resume = wrappedResume;
          const sourceDescriptor = Object.getOwnPropertyDescriptor(constructor.prototype, 'createMediaElementSource');
          const originalSource = constructor.prototype.createMediaElementSource;
          let wrappedSource = null;
          if (typeof originalSource === 'function') {
            const wrapper = function cosmicGeminiMediaSource(...args) {
              const source = Reflect.apply(originalSource, this, args);
              if (runtime.active) runtime.bindMediaSource(source);
              return source;
            };
            try {
              constructor.prototype.createMediaElementSource = wrapper;
              if (constructor.prototype.createMediaElementSource === wrapper) wrappedSource = wrapper;
            } catch {}
          }
          patched.set(constructor, { original, wrappedResume, originalSource, wrappedSource, sourceDescriptor });
        }
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, property);
        let wrappedConstructor = null;
        try {
          const wrapped = new Proxy(constructor, {
            construct(target, args, newTarget) {
              const context = Reflect.construct(target, args, newTarget === wrapped ? target : newTarget);
              if (!runtime.active) return context;
              runtime.rememberAudioContext(context, original, runtime.hasContextIntent(context));
              if (runtime.shouldBlockAudioContext(context)) {
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
        this.audioContextPatches.push({ property, constructor, ...patched.get(constructor), wrappedConstructor, descriptor });
      };
      patch('AudioContext', globalThis.AudioContext);
      patch('webkitAudioContext', globalThis.webkitAudioContext);
      const sourceConstructor = globalThis.MediaElementAudioSourceNode;
      if (typeof sourceConstructor === 'function') {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaElementAudioSourceNode');
        const wrapped = new Proxy(sourceConstructor, {
          construct(target, args, newTarget) {
            const source = Reflect.construct(target, args, newTarget === wrapped ? target : newTarget);
            if (runtime.active) runtime.bindMediaSource(source);
            return source;
          }
        });
        try {
          Object.defineProperty(globalThis, 'MediaElementAudioSourceNode', {
            configurable: true, enumerable: descriptor?.enumerable ?? true, writable: true, value: wrapped
          });
          this.mediaSourcePatch = { original: sourceConstructor, wrapped, descriptor };
        } catch {}
      }
    }

    installBehaviorHooks() {
      window.addEventListener('pointerdown', this.onUserIntent, true);
      window.addEventListener('click', this.onUserIntent, true);
      window.addEventListener('keydown', this.onUserIntent, true);
      window.addEventListener('play', this.onPlay, true);
      for (const type of ['pause', 'ended', 'emptied']) window.addEventListener(type, this.onPlaybackStopped, true);
      if (this.behaviorHooksInstalled) return;
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
          if (entry.wrappedSource && entry.constructor.prototype.createMediaElementSource === entry.wrappedSource) {
            if (entry.sourceDescriptor) Object.defineProperty(entry.constructor.prototype, 'createMediaElementSource', entry.sourceDescriptor);
            else delete entry.constructor.prototype.createMediaElementSource;
          }
          if (entry.wrappedConstructor && globalThis[entry.property] === entry.wrappedConstructor) {
            if (entry.descriptor) Object.defineProperty(globalThis, entry.property, entry.descriptor);
            else delete globalThis[entry.property];
          }
        } catch {}
      }
      const sourcePatch = this.mediaSourcePatch;
      if (sourcePatch && globalThis.MediaElementAudioSourceNode === sourcePatch.wrapped) {
        try {
          if (sourcePatch.descriptor) Object.defineProperty(globalThis, 'MediaElementAudioSourceNode', sourcePatch.descriptor);
          else delete globalThis.MediaElementAudioSourceNode;
        } catch {}
      }
      this.mediaSourcePatch = null;
      this.audioContextPatches = [];
      this.behaviorHooksInstalled = false;
      this.userIntentUntil = -1;
      this.mediaIntent = new WeakMap();
      this.playerIntent = new WeakMap();
      this.audioContexts.clear();
    }

    onUserIntent(event) {
      if (!this.active || !event.isTrusted) return;
      if (event.isPrimary === false || (typeof event.button === 'number' && event.button !== 0) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.type === 'keydown' && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (path.some(node => this.isTextEntry(node))) return;
      this.surfaceIntent = null; this.controlIntent = null;
      this.userIntentUntil = -1; this.intentContext = null;
      const action = path.find(node => ['button', 'a', 'input'].includes(String(node?.localName || '').toLowerCase())
        || node?.getAttribute?.('role'));
      if (action && this.isPlaybackOption(action)) return;
      if (this.isNavigationInput(path)) return;
      for (const node of path) {
        if (node instanceof HTMLMediaElement) {
          this.mediaIntent.set(node, performance.now() + ASSOCIATED_MEDIA_INTENT_MS);
          return;
        }
      }
      const controls = path.filter(node => this.isPlaybackControl(node));
      const targetInfo = this.controlTargets(path), targets = targetInfo.targets;
      const declaredTargets = targetInfo.ids.length > 0;
      const audioOnly = !declaredTargets && controls.some(node => {
        const label = this.controlText(node).toLowerCase();
        return /(^|\W)(listen|audio)(?=$|\W)|音频|收听|朗读|试听/.test(label) && !/video|视频/.test(label);
      });
      if (controls.length || targets.length) {
        const now = performance.now(), deadline = now + ASSOCIATED_MEDIA_INTENT_MS;
        const scopes = this.localScopes(path);
        // Explicit ARIA targets take precedence over an unrelated nearby player.
        const association = declaredTargets ? targets : scopes;
        this.controlIntent = { scopes: association.map(node => new WeakRef(node)), until: deadline, audioOnly,
          targets: declaredTargets ? { ids: targetInfo.ids, root: new WeakRef(targetInfo.root) } : null };
        const media = this.associatePlaybackIntent(association, deadline, { allowHidden: true,
          documentFallback: !declaredTargets && controls.length > 0, audioOnly });
        if (media) this.controlIntent = null;
        // Media permissions are always scoped. A media-free audio control can
        // start one Web Audio context, rather than unlocking every context.
        if (!media && !declaredTargets && !association.some(node => this.mediaCandidates(node, audioOnly).any)) {
          this.controlIntent.documentFallback = !this.mediaCandidates(document, audioOnly).any;
          this.userIntentUntil = now + CONTROL_INTENT_MS;
        }
        return;
      }
      this.rememberSurfaceIntent(event, path);
    }

    isNavigationInput(path) {
      for (const node of path) {
        const tag = String(node?.localName || '').toLowerCase();
        if (['a', 'area'].includes(tag)) {
          const href = String(node.getAttribute?.('href') || '').trim();
          if (href && !/^(?:#|javascript:)/i.test(href)) return true;
        }
        // An actual button inside a linked media card owns its activation;
        // the surrounding link must not invalidate that independent action.
        if (tag === 'button' || node?.getAttribute?.('role') === 'button') return false;
      }
      return false;
    }

    localScopes(path) {
      const scopes = [];
      for (const node of path.slice(0, MAX_ASSOCIATION_PATH_DEPTH)) {
        if (node === document || node === document.body || node === document.documentElement) break;
        if (node && (node instanceof HTMLMediaElement || typeof node.querySelectorAll === 'function')) scopes.push(node);
      }
      return scopes;
    }

    controlTargets(path) {
      const control = path.find(node => ['button', 'a', 'input'].includes(String(node?.localName || '').toLowerCase())
        || node?.getAttribute?.('role') === 'button');
      if (!control) return { ids: [], targets: [] };
      const ids = String(control.getAttribute?.('aria-controls') || '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
      if (!ids.length) return { ids, targets: [] };
      let root;
      try { root = control.getRootNode?.() || document; } catch { return { ids: [], targets: [] }; }
      const targets = ids.map(id => root.getElementById?.(id)).filter(node => node && node !== document.body
        && node !== document.documentElement && (node instanceof HTMLMediaElement || this.isPlaybackControl(control)));
      return { ids, root, targets };
    }

    rememberSurfaceIntent(event, path) {
      // Unlabelled covers can be the real play control. Keep weak local scopes
      // and the input point; inspect media only if playback is actually requested.
      // Do not scan the page or grant a page-wide audio/video permission on clicks.
      if (this.isNavigationInput(path)) return;
      let x = event.clientX, y = event.clientY;
      if (event.type === 'keydown' || event.type === 'click' && event.detail === 0) {
        const control = path.find(node => String(node?.localName || '').toLowerCase() === 'button'
          || node?.getAttribute?.('role') === 'button');
        if (!control?.getBoundingClientRect) return;
        let rect;
        try { rect = control.getBoundingClientRect(); } catch { return; }
        if (!(rect.width > 0 && rect.height > 0)) return;
        x = rect.left + rect.width / 2; y = rect.top + rect.height / 2;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const scopes = [];
      for (const node of path.slice(0, MAX_ASSOCIATION_PATH_DEPTH)) {
        if (node === document || node === document.body || node === document.documentElement) break;
        if (typeof node?.contains === 'function' && typeof node.querySelectorAll === 'function') scopes.push(new WeakRef(node));
      }
      if (scopes.length) this.surfaceIntent = { x, y, scopes, until: performance.now() + ASSOCIATED_MEDIA_INTENT_MS };
    }

    hasSurfaceIntent(media) {
      const intent = this.surfaceIntent;
      if (!intent) return false;
      if (intent.until <= performance.now()) { this.surfaceIntent = null; return false; }
      if (!(media instanceof HTMLMediaElement) || media.isConnected === false) return false;
      let rect;
      try { rect = media.getBoundingClientRect?.(); } catch { return false; }
      if (!rect || !(rect.width >= 16 && rect.height >= 16
        && intent.x >= rect.left && intent.x <= rect.right && intent.y >= rect.top && intent.y <= rect.bottom)) return false;
      for (const reference of intent.scopes) {
        const scope = reference.deref();
        try {
          if (!scope?.contains(media)) continue;
          let found = null;
          for (const candidate of scope.querySelectorAll('video,audio')) {
            if (candidate !== media && !this.isVisibleMedia(candidate)) continue;
            if (found) return false;
            found = candidate;
          }
          return found === media;
        } catch {}
      }
      return false;
    }

    mediaCandidates(root, audioOnly = false) {
      try {
        const candidates = root instanceof HTMLMediaElement ? [root] : root.querySelectorAll('video,audio');
        let single = null, visible = null, count = 0;
        for (const media of candidates) {
          if (!(media instanceof HTMLMediaElement) || media.isConnected === false || audioOnly && !(media instanceof HTMLAudioElement)) continue;
          count += 1; single = media;
          if (this.isVisibleMedia(media)) {
            if (visible) return { any: true, ambiguous: true };
            visible = media;
          }
        }
        return { any: count > 0, visible, single: count === 1 ? single : null };
      } catch { return {}; }
    }

    associatePlaybackIntent(path, deadline, { allowHidden = false, documentFallback = false, audioOnly = false } = {}) {
      let hidden = null, sawMedia = false;
      for (const node of this.localScopes(path)) {
        const candidates = this.mediaCandidates(node, audioOnly);
        sawMedia ||= candidates.any;
        if (candidates.ambiguous) return null;
        if (candidates.visible) {
          this.rememberPlayerIntent(node, candidates.visible, deadline, audioOnly ? null : candidates);
          return candidates.visible;
        }
        if (!hidden && allowHidden && candidates.single) hidden = { node, media: candidates.single, candidates };
      }
      if (hidden) {
        this.rememberPlayerIntent(hidden.node, hidden.media, deadline, audioOnly ? null : hidden.candidates);
        return hidden.media;
      }
      if (documentFallback && !sawMedia) {
        const candidates = this.mediaCandidates(document);
        const media = candidates.visible || candidates.single;
        if (!candidates.ambiguous && media && (!audioOnly || media instanceof HTMLAudioElement)) {
          // A detached toolbar may control the document's only player. Never
          // retain document/body as an authorized player for later insertions.
          this.mediaIntent.set(media, deadline);
          return media;
        }
      }
      return null;
    }

    rememberPlayerIntent(player, media, deadline, candidates = null) {
      this.mediaIntent.set(media, deadline);
      if (player === media) return;
      candidates ||= this.mediaCandidates(player);
      if (candidates.ambiguous || (candidates.visible || candidates.single) !== media) return;
      this.playerIntent.set(player, deadline);
      this.mediaPlayers.set(media, new WeakRef(player));
    }

    hasControlIntent(media) {
      const intent = this.controlIntent;
      if (!intent || intent.audioOnly && !(media instanceof HTMLAudioElement)) return false;
      if (intent.until <= performance.now()) { this.controlIntent = null; return false; }
      let scopes = intent.scopes.map(reference => reference.deref());
      if (intent.targets) {
        const root = intent.targets.root.deref();
        scopes = intent.targets.ids.map(id => root?.getElementById?.(id));
      }
      for (const scope of scopes) {
        if (!scope || scope === document.body || scope === document.documentElement || scope === document) continue;
        try {
          if (scope !== media && !scope?.contains?.(media)) continue;
          const candidate = this.associatePlaybackIntent([scope], intent.until, { allowHidden: true, audioOnly: intent.audioOnly });
          return candidate === media;
        } catch {}
      }
      if (intent.documentFallback) {
        const candidates = this.mediaCandidates(document, intent.audioOnly);
        return !candidates.ambiguous && (candidates.visible || candidates.single) === media;
      }
      return false;
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

    controlText(node) {
      const attribute = name => String(node.getAttribute?.(name) || '').slice(0, 256);
      let labelled = '';
      const ids = attribute('aria-labelledby').trim().split(/\s+/).filter(Boolean).slice(0, 4);
      if (ids.length) {
        try {
          const root = node.getRootNode?.() || document;
          labelled = ids.map(id => String(root.getElementById?.(id)?.textContent || '').slice(0, 128)).join(' ');
        } catch {}
      }
      const interactive = ['button', 'a', 'input'].includes(String(node.localName || '').toLowerCase()) || attribute('role') === 'button';
      const text = interactive ? String(node.textContent || attribute('value') || '').slice(0, 128) : '';
      return [attribute('aria-label'), attribute('title'), labelled || text].join(' ').trim().slice(0, 384);
    }

    isPlaybackOption(node) {
      if (typeof node?.getAttribute !== 'function') return false;
      const role = node.getAttribute('role') || '';
      if (['checkbox', 'radio', 'switch', 'slider', 'tab', 'menuitemcheckbox', 'menuitemradio'].includes(role)) return true;
      if (node.localName === 'input' && ['checkbox', 'radio'].includes(node.getAttribute('type'))) return true;
      const action = ['button', 'a', 'input'].includes(node.localName) || role === 'button';
      const description = [node.getAttribute('id'), node.getAttribute('aria-label'), node.getAttribute('title'),
        typeof node.className === 'string' ? node.className : '', action ? this.controlText(node) : '']
        .join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      return /auto[\s:_-]*play|playback[\s:_-]*(?:speed|rate)|自动播放|播放速度/.test(description);
    }

    isPlaybackControl(node) {
      if (!node || typeof node.getAttribute !== 'function') return false;
      if (node === document.body || node === document.documentElement || this.isTextEntry(node) || this.isPlaybackOption(node)) return false;
      const attribute = name => String(node.getAttribute(name) || '');
      const metadata = [
        attribute('aria-label'), attribute('title'), attribute('data-action'),
        attribute('data-testid'), attribute('data-control'), attribute('id'),
        typeof node.className === 'string' ? node.className : node.className?.baseVal || ''
      ].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      if (/auto[\s:_-]*play|playback[\s:_-]*(?:speed|rate)|自动播放|播放速度/.test(metadata)) return false;
      const metadataSignalsPlayback = /(^|[\s:_-])(play|replay|resume|unmute|listen)(?=$|[\s:_-])|播放|重播|解除静音|取消静音/.test(metadata)
        || (/(^|[\s:_-])start(?=$|[\s:_-])/.test(metadata) && /(media|video|audio|player)/.test(metadata));
      if (metadataSignalsPlayback) return true;
      const tagName = String(node.localName || node.tagName || '').toLowerCase();
      const role = attribute('role').toLowerCase();
      if (!['button', 'a', 'input'].includes(tagName) && role !== 'button') return false;
      const text = this.controlText(node).toLowerCase();
      if (/auto[\s:_-]*play|playback[\s:_-]*(?:speed|rate)|自动播放|播放速度/.test(text)) return false;
      return /(^|\s)(play|replay|resume|unmute|listen)(?=$|\s)|播放|重播|解除静音|取消静音|^[▶►▷⏵⏯]\uFE0F?$/.test(text);
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

    hasContextIntent(context) {
      if (!context || contextState(context) === 'closed' || !this.hasRecentPlaybackIntent()) return false;
      const selected = this.intentContext?.deref();
      if (selected && selected !== context) return false;
      this.intentContext = new WeakRef(context);
      return true;
    }

    hasUserIntent(media) {
      if (this.userPlayback.has(media)) return true;
      const now = performance.now();
      if ((this.mediaIntent.get(media) || -1) > now) return true;
      if (this.hasControlIntent(media) || this.hasSurfaceIntent(media)) return true;
      let node = media;
      for (let depth = 0; node && depth < MAX_ASSOCIATION_PATH_DEPTH; depth += 1) {
        if (this.authorizedPlayers.has(node)) return true;
        if ((this.playerIntent.get(node) || -1) > now && this.mediaCandidates(node).visible === media) return true;
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

    shouldBlockMedia(media, manual) {
      if (!this.active) return false;
      if (manual === undefined) manual = this.hasUserIntent(media);
      if (manual) return false;
      if (this.mode === 'enhanced') return true;
      if (media instanceof HTMLAudioElement && this.audioAllowed) return false;
      return true;
    }

    hasUserAudioContext(context) {
      return !!context && contextState(context) !== 'closed' && this.authorizedContexts.has(context);
    }

    shouldBlockAudioContext(context) {
      if (!this.active) return false;
      if (this.hasUserAudioContext(context)) return false;
      if (this.hasLinkedMediaIntent(context)) return false;
      if (this.hasContextIntent(context)) return false;
      if (this.mode === 'enhanced') return true;
      return !this.audioAllowed;
    }

    bindMediaSource(source) {
      if (!this.active) return;
      let media, context;
      try {
        media = mediaNodeElement ? Reflect.apply(mediaNodeElement, source, []) : source?.mediaElement;
        context = audioNodeContext ? Reflect.apply(audioNodeContext, source, []) : source?.context;
      } catch { return; }
      if (!(media instanceof HTMLMediaElement) || !context || typeof context !== 'object') return;
      const remember = (map, owner, value) => {
        let refs = map.get(owner);
        if (!refs) { refs = new Set(); map.set(owner, refs); }
        for (const reference of refs) {
          const current = reference.deref();
          if (!current) refs.delete(reference);
          else if (current === value) return;
        }
        refs.add(new WeakRef(value));
      };
      remember(this.mediaContexts, media, context);
      remember(this.contextMedia, context, media);
      if (this.hasUserIntent(media)) this.authorizeMedia(media);
    }

    hasLinkedMediaIntent(context) {
      const refs = context && this.contextMedia.get(context);
      if (!refs) return false;
      for (const reference of refs) {
        const media = reference.deref();
        if (!media) refs.delete(reference);
        else if (this.hasUserIntent(media)) return true;
      }
      return false;
    }

    authorizeMedia(media) {
      if (!this.active) return;
      if (!this.mediaPlayers.get(media)?.deref()) {
        let node = media.parentElement || media.parentNode || null;
        for (let depth = 0; node && depth < MAX_ASSOCIATION_PATH_DEPTH; depth += 1) {
          if (node === document.body || node === document.documentElement || node === document) break;
          const candidates = this.mediaCandidates(node);
          if (candidates.any) {
            // Authorization must never seed a sibling's intent while guessing
            // this requested media's player, including hidden audio beside video.
            if (!candidates.ambiguous && (candidates.visible || candidates.single) === media) {
              this.rememberPlayerIntent(node, media, performance.now() + ASSOCIATED_MEDIA_INTENT_MS, candidates);
            }
            break;
          }
          node = node.parentElement || node.parentNode || node.host || null;
        }
      }
      this.userPlayback.add(media);
      const player = this.mediaPlayers.get(media)?.deref();
      if (player) this.authorizedPlayers.add(player);
      this.restoreAutoplayAttribute(media);
      const refs = this.mediaContexts.get(media);
      if (!refs) return;
      for (const reference of refs) {
        const context = reference.deref();
        if (!context || contextState(context) === 'closed') { refs.delete(reference); continue; }
        this.authorizedContexts.add(context);
        const entry = this.audioContexts.get(context);
        if (entry) entry.userStarted = true;
        const pending = this.pendingContextEntries.get(context);
        if (pending) {
          this.forgetPendingContext(context);
          try { void Promise.resolve(Reflect.apply(pending.resume, context, [])).catch(() => {}); } catch {}
        }
      }
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
      if (!this.active) return;
      const media = event.target;
      if (!(media instanceof HTMLMediaElement) || event.isTrusted !== true) return;
      if (this.active && this.isNativePlaybackIntent(event, media)) {
        this.mediaIntent.set(media, performance.now() + ASSOCIATED_MEDIA_INTENT_MS);
      }
      const manual = this.hasUserIntent(media);
      if (this.shouldBlockMedia(media, manual)) this.blockMedia(media);
      else {
        if (manual) this.authorizeMedia(media);
        this.pendingAudio.delete(media);
        this.pendingVideo.delete(media);
      }
    }

    onPlaybackStopped(event) {
      if (!this.active || event.isTrusted !== true || !(event.target instanceof HTMLMediaElement)) return;
      // A deliberate player remains authorized through buffering, pauses,
      // replay, and source/quality changes. Only this document's lifetime owns it.
      if (event.type === 'emptied') {
        this.mediaIntent.delete(event.target);
        this.pendingAudio.delete(event.target);
        this.pendingVideo.delete(event.target);
      }
    }

    blockMedia(media) {
      if (!this.active) return;
      this.userPlayback.delete(media);
      try { Reflect.apply(this.originalPause, media, []); } catch {}
      try {
        if (media.hasAttribute('autoplay')) {
          let entry = this.autoplayAttributes.get(media);
          if (!entry) {
            for (const reference of this.autoplayAttributeRefs) if (!reference.deref()) this.autoplayAttributeRefs.delete(reference);
            entry = { reference: new WeakRef(media) };
            this.autoplayAttributes.set(media, entry); this.autoplayAttributeRefs.add(entry.reference);
          }
          entry.value = media.getAttribute('autoplay');
          media.removeAttribute('autoplay');
        }
      } catch {}
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
      if (!this.active || !document.querySelectorAll) return;
      for (const media of document.querySelectorAll(selector)) {
        const requestedAutoplay = media.hasAttribute?.('autoplay') === true;
        const alreadyPlaying = media.paused === false;
        if ((requestedAutoplay || alreadyPlaying) && this.shouldBlockMedia(media)) this.blockMedia(media);
      }
    }

    restoreAutoplayAttribute(media) {
      const entry = this.autoplayAttributes.get(media);
      if (!entry) return;
      this.autoplayAttributes.delete(media); this.autoplayAttributeRefs.delete(entry.reference);
      try { if (!media.hasAttribute('autoplay')) media.setAttribute('autoplay', entry.value); } catch {}
    }

    restoreAutoplayAttributes() {
      for (const reference of this.autoplayAttributeRefs) {
        const media = reference.deref();
        if (media) this.restoreAutoplayAttribute(media);
      }
      this.autoplayAttributeRefs.clear(); this.autoplayAttributes = new WeakMap();
    }

    enableEnhancedObserver() {
      if (this.observer || !document.documentElement) return;
      this.observer = new MutationObserver(this.onMutations);
      this.observer.observe(document, { childList: true, subtree: true });
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
      if (!this.active || !root) return;
      if (root instanceof HTMLMediaElement) {
        if (this.shouldBlockMedia(root)) this.blockMedia(root);
        return;
      }
      if (!root.querySelectorAll) return;
      for (const media of root.querySelectorAll('video,audio')) if (this.shouldBlockMedia(media)) this.blockMedia(media);
    }

    rememberPending(collection, value) {
      if (!collection.has(value) && collection.size >= 8) collection.delete(collection.values().next().value);
      collection.add(value);
    }

    rememberPendingContext(context, resume) {
      if (!this.pendingContextEntries.has(context)) {
        for (const reference of this.pendingContextRefs) if (!reference.deref()) this.pendingContextRefs.delete(reference);
        const reference = new WeakRef(context);
        this.pendingContextEntries.set(context, { resume, reference });
        this.pendingContextRefs.add(reference);
      }
      if (!this.pendingContexts.has(context) && this.pendingContexts.size >= 8) this.pendingContexts.delete(this.pendingContexts.keys().next().value);
      this.pendingContexts.set(context, resume);
    }

    forgetPendingContext(context) {
      const entry = this.pendingContextEntries.get(context);
      if (entry) this.pendingContextRefs.delete(entry.reference);
      this.pendingContextEntries.delete(context);
      this.pendingContexts.delete(context);
    }

    rememberAudioContext(context, resume, userStarted) {
      if (!this.active) return;
      for (const existing of this.audioContexts.keys()) if (contextState(existing) === 'closed') this.audioContexts.delete(existing);
      if (contextState(context) === 'closed') return;
      userStarted ||= this.authorizedContexts.has(context);
      if (userStarted) this.authorizedContexts.add(context);
      if (!this.audioContexts.has(context) && this.audioContexts.size >= 8) this.audioContexts.delete(this.audioContexts.keys().next().value);
      this.audioContexts.set(context, { resume, userStarted });
    }

    suspendAutomaticContexts() {
      if (!this.active) return;
      for (const [context, entry] of this.audioContexts) {
        if (contextState(context) === 'closed') { this.audioContexts.delete(context); continue; }
        if (contextState(context) !== 'running' || this.hasUserAudioContext(context) || this.hasLinkedMediaIntent(context)) continue;
        this.rememberPendingContext(context, entry.resume);
        this.reportIntervention();
        try { void Promise.resolve(context.suspend()).catch(() => {}); } catch {}
      }
    }

    resumePendingAudio() {
      if (!this.active) return;
      for (const media of this.pendingAudio) {
        if (!media?.isConnected || !(media instanceof HTMLAudioElement)) continue;
        try { void Promise.resolve(Reflect.apply(this.originalPlay, media, [])).catch(() => {}); } catch {}
      }
      this.pendingAudio.clear();
    }

    resumePendingContexts() {
      for (const reference of this.pendingContextRefs) {
        const context = reference.deref();
        if (!context) continue;
        const resume = this.pendingContextEntries.get(context)?.resume;
        this.forgetPendingContext(context);
        try { if (contextState(context) !== 'closed' && typeof resume === 'function') void Promise.resolve(Reflect.apply(resume, context, [])).catch(() => {}); }
        catch {}
      }
      this.pendingContextRefs.clear();
      this.pendingContextEntries = new WeakMap();
      this.pendingContexts.clear();
    }

    reportIntervention() {
      if (!this.active || this.reported) return;
      this.reported = true;
      window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }

  }

  const runtime = new NoAutoplayRuntime();
  window[RUNTIME_KEY] = runtime;
  runtime.announce();
})();
