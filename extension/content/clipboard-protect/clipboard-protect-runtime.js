(() => {
  const KEY = Symbol.for('cosmic-gemini.clipboard-protect.runtime');
  const PREFIX = 'cosmic-gemini:clipboard-protect:';
  const EDITOR_SELECTOR = 'input,textarea,[contenteditable]:not([contenteditable="false"]),'
    + '[role="textbox"],[role="grid"],[role="treegrid"],.monaco-editor,.CodeMirror,.cm-editor,.ace_editor';
  if (globalThis[KEY]) { globalThis[KEY].announce(); return; }

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  class ClipboardProtectRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.snapshots = new WeakMap();
      this.originalStop = Event.prototype.stopImmediatePropagation;
      this.originalPrevent = Event.prototype.preventDefault;
      this.originalClipboard = Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, 'clipboardData');
      this.originalStopDescriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'stopImmediatePropagation');
      this.setData = DataTransfer.prototype.setData;
      this.clearData = DataTransfer.prototype.clearData;
      this.onConfigure = this.onConfigure.bind(this);
      this.onCopy = this.onCopy.bind(this);
      this.announce = this.announce.bind(this);
      this.onDispose = this.onDispose.bind(this);
      window.addEventListener(PREFIX + 'configure', this.onConfigure, true);
      window.addEventListener(PREFIX + 'bridge-ready', this.announce, true);
      window.addEventListener(PREFIX + 'dispose', this.onDispose, true);
    }

    announce() {
      window.dispatchEvent(new CustomEvent(PREFIX + 'main-ready', { detail: this.token }));
    }

    onConfigure(event) {
      let message;
      try { message = JSON.parse(event.detail); } catch { return; }
      if (message?.token !== this.token) return;
      if (message.config?.active === true) this.enable();
      else this.disable();
    }

    snapshot(event) {
      if (!this.active || event.type !== 'copy' || !event.isTrusted || !event.eventPhase) return null;
      if (this.snapshots.has(event)) return this.snapshots.get(event);
      let data = null;
      try { data = this.selectionData(event); } catch {}
      // Weak event keys retain neither clipboard history nor detached document ranges.
      this.snapshots.set(event, data);
      return data;
    }

    selectionData(event) {
      if (String(document.designMode).toLowerCase() === 'on') return null;
      const path = event.composedPath();
      let focused = document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      if (this.isEditor(focused) || path.some(node => this.isEditor(node))) return null;
      const root = path[0]?.getRootNode?.();
      const selection = root?.getSelection?.() || window.getSelection();
      if (this.isEditor(selection?.anchorNode) || this.isEditor(selection?.focusNode)) return null;
      const text = selection?.toString() || '';
      if (!text) return null;
      let html = '';
      try {
        const template = document.createElement('template');
        for (let index = 0; index < selection.rangeCount; index += 1) {
          template.content.append(selection.getRangeAt(index).cloneContents());
        }
        for (const node of template.content.querySelectorAll('script,style,noscript,template,iframe,object,embed,input,textarea')) node.remove();
        for (const node of template.content.querySelectorAll('*')) {
          for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || ['srcdoc', 'srcset'].includes(name)) node.removeAttribute(attribute.name);
            else if (['href', 'src', 'xlink:href'].includes(name)) {
              try {
                const url = new URL(attribute.value, document.baseURI);
                if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) node.setAttribute(attribute.name, url.href);
                else node.removeAttribute(attribute.name);
              } catch { node.removeAttribute(attribute.name); }
            }
          }
        }
        html = template.innerHTML;
      } catch {}
      return { text, html };
    }

    isEditor(node) {
      let element = node instanceof Element ? node : node?.parentElement;
      while (element) {
        if (element.isContentEditable || element.closest(EDITOR_SELECTOR)) return true;
        element = element.getRootNode()?.host;
      }
      return false;
    }

    enable() {
      if (this.active) return;
      this.active = true;
      const runtime = this;
      // Earlier window listeners can run before the newly authorized product.
      // Snapshot before their first clipboard write and keep our final handler reachable.
      this.clipboardGetter = function () {
        const value = Reflect.apply(runtime.originalClipboard.get, this, []);
        runtime.snapshot(this);
        return value;
      };
      this.stopWrapper = function (...args) {
        if (runtime.snapshot(this)) return undefined;
        return Reflect.apply(runtime.originalStop, this, args);
      };
      if (this.originalClipboard?.configurable && this.originalClipboard.get) {
        try { Object.defineProperty(ClipboardEvent.prototype, 'clipboardData', {
          ...this.originalClipboard, get: this.clipboardGetter
        }); } catch {}
      }
      if (this.originalStopDescriptor?.configurable) {
        try { Object.defineProperty(Event.prototype, 'stopImmediatePropagation', {
          ...this.originalStopDescriptor, value: this.stopWrapper
        }); } catch {}
      }
      window.addEventListener('copy', this.onCopy, true);
    }

    onCopy(event) {
      const data = this.snapshot(event);
      if (!data) return;
      const transfer = this.originalClipboard?.get
        ? Reflect.apply(this.originalClipboard.get, event, []) : event.clipboardData;
      if (!transfer) return;
      try {
        Reflect.apply(this.clearData, transfer, []);
        Reflect.apply(this.setData, transfer, ['text/plain', data.text]);
      } catch { return; }
      if (data.html) {
        try { Reflect.apply(this.setData, transfer, ['text/html', data.html]); } catch {}
      }
      Reflect.apply(this.originalPrevent, event, []);
      Reflect.apply(this.originalStop, event, []);
    }

    disable() {
      this.active = false;
      window.removeEventListener('copy', this.onCopy, true);
      if (this.clipboardGetter && Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, 'clipboardData')?.get === this.clipboardGetter) {
        try { Object.defineProperty(ClipboardEvent.prototype, 'clipboardData', this.originalClipboard); } catch {}
      }
      if (this.stopWrapper && Event.prototype.stopImmediatePropagation === this.stopWrapper) {
        try { Object.defineProperty(Event.prototype, 'stopImmediatePropagation', this.originalStopDescriptor); } catch {}
      }
      this.snapshots = new WeakMap();
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(PREFIX + 'configure', this.onConfigure, true);
      window.removeEventListener(PREFIX + 'bridge-ready', this.announce, true);
      window.removeEventListener(PREFIX + 'dispose', this.onDispose, true);
      try { delete globalThis[KEY]; } catch {}
    }
  }

  const runtime = new ClipboardProtectRuntime();
  Object.defineProperty(globalThis, KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
