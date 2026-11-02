(() => {
  'use strict';
  const key = Symbol.for('cosmic-gemini.crash-page-warden');
  if (globalThis[key] || !/^https?:$/.test(location.protocol)
    || !/^(?:text\/html|application\/xhtml\+xml)$/i.test(document.contentType || '')) return;
  // Installed once for this document. Policy changes deliberately do not undo
  // interventions or remove these guards; a real navigation/reload retires them.
  const native = {
    timeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
    interval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis),
    raf: globalThis.requestAnimationFrame?.bind(globalThis), cancelRaf: globalThis.cancelAnimationFrame?.bind(globalThis),
    idle: globalThis.requestIdleCallback?.bind(globalThis), cancelIdle: globalThis.cancelIdleCallback?.bind(globalThis),
    source: Function.prototype.toString, now: performance.now.bind(performance)
  };
  const functions = new WeakMap(), riskySources = new Map(), pending = new Map();
  const stats = { stoppedTasks: 0, removedFrames: 0 };
  let active = false, running = null, inputUntil = 0, pressureUntil = 0, observer, performanceObserver;
  const feature = source => {
    const telemetry = /\b(?:analytics|telemetry|impression|fingerprint|advertis(?:ing|ement)|adblock|bidder|beacon)\b/i.test(source);
    const reports = /\b(?:sendBeacon|localStorage|sessionStorage|referrer|cookie|userAgent|deviceMemory|hardwareConcurrency)\b/.test(source);
    const reading = /\b(?:srcset|naturalWidth|IntersectionObserver|textContent|innerHTML|insertAdjacentHTML|appendChild|replaceChildren|pagination|loadMore|lazyLoad)\b/.test(source);
    return { risk: Number(telemetry) * 2 + Number(reports), reading };
  };
  function record(fn) {
    let value = functions.get(fn);
    if (value) return value;
    let source = '';
    try { source = Reflect.apply(native.source, fn, []).slice(0, 8192); } catch {}
    const flags = feature(source);
    // Share a bounded budget for recreated telemetry callbacks, but do not
    // conflate unrelated ordinary callbacks merely because a framework wraps them.
    value = flags.risk >= 3 ? riskySources.get(source) : null;
    if (!value) {
      value = { ...flags, start: native.now(), calls: 0, cost: 0, blocked: false, handles: new Set() };
      if (flags.risk >= 3) {
        if (riskySources.size >= 128) riskySources.delete(riskySources.keys().next().value);
        riskySources.set(source, value);
      }
    }
    functions.set(fn, value);
    return value;
  }
  function stop(value) {
    if (value.blocked) return;
    value.blocked = true; stats.stoppedTasks++;
    for (const entry of value.handles) {
      try { entry.cancel(entry.id); } catch {}
      pending.delete(entry.key);
    }
    value.handles.clear();
  }
  function measure(value, elapsed) {
    const now = native.now();
    if (now - value.start > 2000) { value.start = now; value.calls = 0; value.cost = 0; }
    value.calls++; value.cost += elapsed;
    if (now < inputUntil || document.hidden) return;
    const background = value.risk >= 3 && !value.reading;
    if (background && (value.calls >= 100 || value.cost >= 160)
      || !value.reading && (elapsed >= 1200 || value.calls >= 2 && value.cost >= 700)
      || value.reading && value.calls >= 12 && value.cost >= 3500) stop(value);
  }
  function bindScheduler(name, cancelName, schedule, cancel, repeating = false) {
    if (!schedule || !cancel) return;
    const namespace = name.startsWith('set') ? 'timer' : name;
    const wrappedSchedule = function(fn, ...args) {
      if (typeof fn !== 'function') return schedule(fn, ...args);
      let value = active ? record(fn) : null;
      if (value?.blocked) return 0;
      const entry = { id: 0, key: '', cancel };
      const invoke = function(...values) {
        if (!active) return Reflect.apply(fn, this, values);
        // Native execution termination does not unwind JavaScript finally
        // blocks. Retire a callback left running by rescue before it can recur.
        if (running) { const interrupted = running; running = null; stop(interrupted); }
        value ||= record(fn);
        if (!value) return Reflect.apply(fn, this, values);
        if (repeating && !value.handles.has(entry) && pending.size < 2048) {
          pending.set(entry.key, { entry, value }); value.handles.add(entry);
        }
        if (!repeating) { pending.delete(entry.key); value.handles.delete(entry); }
        if (value.blocked) { cancel(entry.id); return; }
        const start = native.now();
        running = value;
        try { return Reflect.apply(fn, this, values); }
        finally { running = null; measure(value, Math.max(0, native.now() - start)); }
      };
      entry.id = schedule(invoke, ...args);
      entry.key = namespace + ':' + entry.id;
      if (value && pending.size < 2048) { pending.set(entry.key, { entry, value }); value.handles.add(entry); }
      return entry.id;
    };
    const wrappedCancel = function(id) {
      const token = namespace + ':' + id;
      const owned = pending.get(token);
      if (owned) { owned.value.handles.delete(owned.entry); pending.delete(token); }
      return cancel(id);
    };
    try { globalThis[name] = wrappedSchedule; globalThis[cancelName] = wrappedCancel; } catch {}
  }
  bindScheduler('setTimeout', 'clearTimeout', native.timeout, native.clearTimeout);
  bindScheduler('setInterval', 'clearInterval', native.interval, native.clearInterval, true);
  bindScheduler('requestAnimationFrame', 'cancelAnimationFrame', native.raf, native.cancelRaf);
  bindScheduler('requestIdleCallback', 'cancelIdleCallback', native.idle, native.cancelIdle);
  const onInput = event => { if (event.isTrusted) inputUntil = native.now() + 1000; };

  const frames = new Set();
  let flushTimer = 0;
  function frameRisk(frame) {
    const description = [frame.id, frame.name, frame.title, frame.className].join(' ').slice(0, 2000);
    let address = '';
    try { const url = new URL(frame.getAttribute('src') || '', location.href); address = url.pathname + url.search; } catch {}
    const words = description + ' ' + address.slice(0, 2000);
    if (/\b(?:re?captcha|captcha|challenge|auth(?:entication|orization)?|oauth|sso|log[-_ ]?in|sign[-_ ]?in|payment|checkout|consent)\b/i.test(words)
      || frame === document.activeElement || frame.closest('form,dialog,[role="dialog"]')) return false;
    const marked = /(?:^|[\W_])(?:ads?|advertisement|advertising|analytics|telemetry|tracking|tracker|pixel|impression|bidder)(?:[\W_]|$)/i.test(words);
    if (!marked) return false;
    const rect = frame.getBoundingClientRect();
    const tiny = rect.width <= 4 && rect.height <= 4;
    const offscreen = rect.bottom < 0 || rect.top > innerHeight + 300;
    const explicit = /(?:^|[\W_])(?:advertisement|advertising|ad[-_ ]?(?:slot|container|frame))(?:[\W_]|$)/i.test(description);
    return tiny || explicit || offscreen && native.now() < pressureUntil;
  }
  function flush() {
    flushTimer = 0;
    const removals = [];
    for (const frame of [...frames].slice(0, 12)) {
      frames.delete(frame);
      if (frame.isConnected && frameRisk(frame)) removals.push(frame);
    }
    for (const frame of removals) { frame.remove(); stats.removedFrames++; }
    if (frames.size) flushTimer = native.timeout(flush, 100);
  }
  function enqueue(frame) {
    if (frames.size < 128) frames.add(frame);
    if (!flushTimer && frames.size) flushTimer = native.timeout(flush, 100);
  }
  function added(node) {
    if (node.nodeType !== 1) return;
    if (node.localName === 'iframe') enqueue(node);
    else {
      const found = node.querySelectorAll('iframe');
      for (let i = 0; i < Math.min(found.length, 128); i++) enqueue(found[i]);
    }
  }
  function observe() {
    observer?.disconnect();
    observer = new MutationObserver(changes => {
      for (const change of changes.slice(0, 256)) {
        for (const node of change.addedNodes) added(node);
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    const scan = () => {
      const found = document.querySelectorAll('iframe');
      for (let i = 0; i < Math.min(found.length, 128); i++) enqueue(found[i]);
    };
    scan();
    try {
      performanceObserver?.disconnect();
      performanceObserver = new PerformanceObserver(list => {
        const entries = list.getEntries();
        if (entries.some(entry => entry.duration > 250)) {
          pressureUntil = native.now() + 5000;
          scan();
        }
      });
      const type = PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame') ? 'long-animation-frame' : 'longtask';
      performanceObserver.observe({ type, buffered: false });
    } catch {}
  }
  addEventListener('pagehide', () => { observer?.disconnect(); performanceObserver?.disconnect();
    if (flushTimer) native.clearTimeout(flushTimer); flushTimer = 0; frames.clear(); });
  addEventListener('pageshow', event => { if (active && event.persisted) observe(); });
  Object.defineProperty(globalThis, key, { value: Object.freeze({
    activate() {
      if (active) return;
      active = true;
      for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        addEventListener(type, onInput, { capture: true, passive: true });
      }
      observe();
    },
    state: () => ({ ...stats, active })
  }), configurable: false });
})();
