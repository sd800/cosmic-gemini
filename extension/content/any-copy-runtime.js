(() => {
  const READY = 'cosmic-gemini:any-copy:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:any-copy:main-ready';
  const CONFIGURE = 'cosmic-gemini:any-copy:configure';
  const INTERVENED = 'cosmic-gemini:any-copy:intervened';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.any-copy.runtime');

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

  const INTERACTIVE = [
    'input', 'textarea', 'select', 'button', '[contenteditable="true"]',
    '[role="textbox"]', '[role="button"]', '[role="slider"]', 'canvas'
  ].join(',');

  class AnyCopyRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.reported = false;
      this.style = null;
      this.observer = null;
      this.savedStyles = new Map();
      this.onConfigure = this.onConfigure.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onCopy = this.onCopy.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onSelectionEvent = this.onSelectionEvent.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onMutations = this.onMutations.bind(this);
      window.addEventListener(CONFIGURE, this.onConfigure, true);
      window.addEventListener(READY, this.onBridgeReady, true);
      window.addEventListener('copy', this.onCopy, true);
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('selectstart', this.onSelectionEvent, true);
      window.addEventListener('contextmenu', this.onSelectionEvent, true);
      window.addEventListener('pointerdown', this.onPointerDown, true);
      window.addEventListener('mousedown', this.onPointerDown, true);
    }

    announce() {
      window.dispatchEvent(new CustomEvent(MAIN_READY, { detail: this.token }));
    }

    onBridgeReady() {
      this.announce();
      if (this.reported) window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      const shouldRun = message.config?.active === true;
      if (shouldRun === this.active) {
        if (shouldRun) this.ensureStyle();
        return;
      }
      this.active = shouldRun;
      if (this.active) this.enable();
      else this.disable();
    }

    enable() {
      this.reported = false;
      this.ensureStyle();
      this.reportIntervention();
    }

    disable() {
      this.style?.remove();
      this.style = null;
      this.observer?.disconnect();
      this.observer = null;
      for (const [element, properties] of this.savedStyles) {
        if (!(element instanceof Element)) continue;
        for (const [property, original] of properties) {
          if (original.value) element.style.setProperty(property, original.value, original.priority);
          else element.style.removeProperty(property);
        }
      }
      this.savedStyles.clear();
      this.reported = false;
    }

    ensureStyle() {
      if (!this.active || !document.documentElement || this.style?.isConnected) return;
      this.style = document.createElement('style');
      this.style.dataset.cosmicGeminiAnyCopy = 'selection';
      this.style.textContent = `
        :root,body,*:not(input):not(textarea):not(select):not(button):not(canvas){
          -webkit-user-select:text!important;
          user-select:text!important;
          -webkit-touch-callout:default!important;
        }
      `;
      (document.head || document.documentElement).append(this.style);
    }

    onKeyDown(event) {
      if (!this.active || !event.isTrusted) return;
      if (!(event.metaKey || event.ctrlKey) || String(event.key).toLowerCase() !== 'c') return;
      event.stopImmediatePropagation();
    }

    onSelectionEvent(event) {
      if (!this.active || !event.isTrusted) return;
      if (this.isInteractive(event.target)) return;
      event.stopImmediatePropagation();
      this.reportIntervention();
    }

    onPointerDown(event) {
      if (!this.active || !event.isTrusted || Number(event.button || 0) !== 0) return;
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target || this.isInteractive(target) || !this.hasReadableText(target)) return;
      let restricted = false;
      for (let element = target; element && element !== document.documentElement; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.userSelect === 'none' || style.webkitUserSelect === 'none') {
          restricted = true;
          this.forceSelectable(element);
        }
        if (element.onselectstart || element.oncopy || element.oncontextmenu) restricted = true;
      }
      if (!restricted) return;
      event.stopImmediatePropagation();
      this.startObserver();
      this.reportIntervention();
    }

    isInteractive(value) {
      if (!(value instanceof Element)) return false;
      try { return value.matches(INTERACTIVE) || !!value.closest(INTERACTIVE); }
      catch { return false; }
    }

    hasReadableText(element) {
      return typeof element.textContent === 'string' && element.textContent.trim().length > 0;
    }

    forceSelectable(element) {
      let saved = this.savedStyles.get(element);
      if (!saved) {
        saved = new Map();
        this.savedStyles.set(element, saved);
      }
      for (const property of ['user-select', '-webkit-user-select']) {
        if (!saved.has(property)) {
          saved.set(property, {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property)
          });
        }
        element.style.setProperty(property, 'text', 'important');
      }
    }

    startObserver() {
      if (this.observer || !document.documentElement) return;
      this.observer = new MutationObserver(this.onMutations);
      this.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'oncopy', 'onselectstart', 'oncontextmenu']
      });
    }

    onMutations() {
      if (!this.active) return;
      this.ensureStyle();
      for (const element of this.savedStyles.keys()) {
        if (element.isConnected) this.forceSelectable(element);
        else this.savedStyles.delete(element);
      }
    }

    selectionData(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      const field = path.find(node => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement);
      if (field && Number.isInteger(field.selectionStart) && Number.isInteger(field.selectionEnd)) {
        return { text: field.value.slice(field.selectionStart, field.selectionEnd), html: '' };
      }
      const selection = window.getSelection();
      const text = selection?.toString() || '';
      if (!text || !selection?.rangeCount) return { text, html: '' };
      try {
        const container = document.createElement('div');
        for (let index = 0; index < selection.rangeCount; index += 1) {
          container.append(selection.getRangeAt(index).cloneContents());
        }
        for (const element of container.querySelectorAll('script,style,noscript,template')) element.remove();
        for (const element of container.querySelectorAll('*')) {
          for (const attribute of [...element.attributes]) {
            if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
          }
        }
        return { text, html: container.innerHTML };
      } catch { return { text, html: '' }; }
    }

    onCopy(event) {
      if (!this.active || !event.isTrusted) return;
      const data = this.selectionData(event);
      if (!data.text || !event.clipboardData) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      event.clipboardData.setData('text/plain', data.text);
      if (data.html) event.clipboardData.setData('text/html', data.html);
      this.reportIntervention();
    }

    reportIntervention() {
      if (this.reported) return;
      this.reported = true;
      window.dispatchEvent(new CustomEvent(INTERVENED, { detail: this.token }));
    }
  }

  const runtime = new AnyCopyRuntime();
  window[RUNTIME_KEY] = runtime;
  runtime.announce();
})();
