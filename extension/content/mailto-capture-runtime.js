(() => {
  const READY = 'cosmic-gemini:mailto-capture:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:mailto-capture:main-ready';
  const CONFIGURE = 'cosmic-gemini:mailto-capture:configure';
  const DISPOSE = 'cosmic-gemini:mailto-capture:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.mailto-capture.runtime');
  const COPY = Object.freeze({
    'en-US': Object.freeze({
      title: 'Email link',
      to: 'To',
      cc: 'CC',
      bcc: 'BCC',
      subject: 'Subject',
      message: 'Message',
      other: 'Other fields',
      noAddress: 'No recipient specified',
      copyAddress: 'Copy address',
      copyMessage: 'Copy message',
      close: 'Close',
      addressCopied: 'Address copied',
      messageCopied: 'Message copied',
      copyFailed: 'Could not copy'
    }),
    'zh-CN': Object.freeze({
      title: '邮件链接',
      to: '收件人',
      cc: '抄送',
      bcc: '密送',
      subject: '主题',
      message: '正文',
      other: '其他信息',
      noAddress: '未指定收件人',
      copyAddress: '复制地址',
      copyMessage: '复制邮件内容',
      close: '关闭',
      addressCopied: '已复制地址',
      messageCopied: '已复制邮件内容',
      copyFailed: '无法复制'
    })
  });

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function decodeMailtoPart(value) {
    try { return decodeURIComponent(String(value || '')); }
    catch { return String(value || ''); }
  }

  function normalizeLineBreaks(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
  }

  function addressValues(values) {
    return values.flatMap(value => String(value || '').split(','))
      .map(value => value.trim())
      .filter(Boolean);
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class MailtoCaptureRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.locale = 'en-US';
      this.host = null;
      this.shadow = null;
      this.anchor = null;
      this.mailto = null;
      this.viewportFrame = 0;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onActivate = this.onActivate.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onViewportChange = this.onViewportChange.bind(this);
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
      const nextActive = message.config?.active === true;
      const nextLocale = message.config?.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
      const localeChanged = nextLocale !== this.locale;
      this.locale = nextLocale;
      if (nextActive && !this.active) this.enable();
      else if (!nextActive && this.active) this.disable();
      else if (nextActive && localeChanged && this.mailto) this.render();
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      try { delete globalThis[RUNTIME_KEY]; } catch {}
    }

    enable() {
      if (this.active) return;
      this.active = true;
      window.addEventListener('click', this.onActivate, true);
      window.addEventListener('auxclick', this.onActivate, true);
      window.addEventListener('pointerdown', this.onPointerDown, true);
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.addEventListener('resize', this.onViewportChange, { passive: true });
    }

    disable() {
      if (this.active) {
        window.removeEventListener('click', this.onActivate, true);
        window.removeEventListener('auxclick', this.onActivate, true);
        window.removeEventListener('pointerdown', this.onPointerDown, true);
        window.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('scroll', this.onViewportChange, true);
        window.removeEventListener('resize', this.onViewportChange, false);
      }
      this.active = false;
      this.close();
    }

    anchorFromEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      return path.find(node => typeof node?.getAttribute === 'function'
        && /^mailto:/i.test(node.getAttribute('href')?.trim() || '')) || null;
    }

    onActivate(event) {
      if (!this.active || !event.isTrusted) return;
      if (event.type === 'click' && Number(event.button || 0) !== 0) return;
      if (event.type === 'auxclick' && Number(event.button) !== 1) return;
      const anchor = this.anchorFromEvent(event);
      const href = anchor?.getAttribute('href')?.trim() || '';
      if (!/^mailto:/i.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.show(anchor, href);
    }

    onPointerDown(event) {
      if (!this.host) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (path.includes(this.host)) return;
      this.close();
    }

    onKeyDown(event) {
      if (event.key === 'Escape' && this.host) {
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
      }
    }

    onViewportChange() {
      if (!this.host || this.viewportFrame) return;
      this.viewportFrame = requestAnimationFrame(() => {
        this.viewportFrame = 0;
        this.position();
      });
    }

    parseMailto(href) {
      const raw = String(href || '').trim();
      if (!/^mailto:/i.test(raw)) return null;
      const content = raw.slice(raw.indexOf(':') + 1).split('#', 1)[0];
      const queryAt = content.indexOf('?');
      const recipientPart = queryAt < 0 ? content : content.slice(0, queryAt);
      const query = queryAt < 0 ? '' : content.slice(queryAt + 1);
      const fields = new Map();
      for (const pair of query.split('&')) {
        if (!pair) continue;
        const equalsAt = pair.indexOf('=');
        const rawName = equalsAt < 0 ? pair : pair.slice(0, equalsAt);
        const rawValue = equalsAt < 0 ? '' : pair.slice(equalsAt + 1);
        const name = decodeMailtoPart(rawName).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const entry = fields.get(key) || { name, values: [] };
        entry.values.push(normalizeLineBreaks(decodeMailtoPart(rawValue)));
        fields.set(key, entry);
      }
      const recipientValues = addressValues([
        decodeMailtoPart(recipientPart),
        ...(fields.get('to')?.values || [])
      ]);
      fields.delete('to');
      const take = name => {
        const values = (fields.get(name)?.values || []).map(value => value.trim()).filter(Boolean);
        fields.delete(name);
        return values;
      };
      const takeAddresses = name => addressValues(take(name));
      const cc = takeAddresses('cc');
      const bcc = takeAddresses('bcc');
      const subject = take('subject').join('\n');
      const body = take('body').join('\n\n');
      const otherFields = [...fields.values()]
        .map(field => ({ name: field.name, values: field.values.filter(value => value !== '') }))
        .filter(field => field.values.length);
      return {
        href: raw,
        to: recipientValues,
        cc,
        bcc,
        subject,
        body,
        otherFields,
        addressText: recipientValues.join(', '),
        simpleAddressOnly: recipientValues.length === 1
          && !subject
          && !body
          && !cc.length
          && !bcc.length
          && !otherFields.length
      };
    }

    messageText(mailto = this.mailto) {
      if (!mailto) return '';
      const labels = COPY[this.locale];
      const lines = [];
      if (mailto.to.length) lines.push(`${labels.to}: ${mailto.to.join(', ')}`);
      if (mailto.cc.length) lines.push(`${labels.cc}: ${mailto.cc.join(', ')}`);
      if (mailto.bcc.length) lines.push(`${labels.bcc}: ${mailto.bcc.join(', ')}`);
      if (mailto.subject) lines.push(`${labels.subject}: ${mailto.subject}`);
      for (const field of mailto.otherFields) lines.push(`${field.name}: ${field.values.join(', ')}`);
      if (mailto.body) lines.push('', mailto.body);
      return lines.join('\n');
    }

    show(anchor, href) {
      const mailto = this.parseMailto(href);
      if (!mailto) return;
      this.close();
      this.anchor = anchor;
      this.mailto = mailto;
      this.render();
    }

    render() {
      if (!this.anchor || !this.mailto) return;
      this.host?.remove();
      const labels = COPY[this.locale];
      const host = document.createElement('div');
      host.dataset.cosmicGeminiMailtoCapture = '';
      host.style.setProperty('all', 'initial', 'important');
      host.style.setProperty('position', 'fixed', 'important');
      host.style.setProperty('z-index', '2147483647', 'important');
      host.style.setProperty('display', 'block', 'important');
      host.style.setProperty('margin', '0', 'important');
      host.style.setProperty('padding', '0', 'important');
      const shadow = host.attachShadow({ mode: 'closed', delegatesFocus: true });
      this.host = host;
      this.shadow = shadow;

      const style = document.createElement('style');
      style.textContent = `
        :host{color-scheme:light dark;--mc-bg:#fff;--mc-raised:#f6f8fc;--mc-text:#202124;--mc-muted:#5f6368;--mc-line:#dadce0;--mc-blue:#0b57d0;--mc-on-blue:#fff;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:normal}
        *{box-sizing:border-box;letter-spacing:normal}
        .popover{position:relative;width:min(324px,calc(100vw - 20px));max-height:min(460px,calc(100vh - 20px));overflow:auto;border:1px solid var(--mc-line);border-radius:12px;background:var(--mc-bg);color:var(--mc-text);box-shadow:0 10px 26px rgba(0,0,0,.2);padding:13px}
        .heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 9px}.heading strong{font-size:15px;font-weight:700}.close{display:grid;width:26px;height:26px;place-items:center;border:0;border-radius:50%;background:transparent;color:var(--mc-muted);cursor:pointer}.close:hover{background:var(--mc-raised)}
        .details{display:grid;gap:8px}.field{display:grid;gap:2px}.field span{color:var(--mc-muted);font-size:12px;font-weight:650;text-transform:none}.value{max-height:104px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text;border-radius:7px;background:var(--mc-raised);padding:7px 9px;color:var(--mc-text);font:13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}
        .other{display:grid;gap:6px}.other-row{display:grid;grid-template-columns:minmax(72px,auto) 1fr;gap:8px;align-items:start}.other-row b{color:var(--mc-muted);font-size:12px;overflow-wrap:anywhere}.other-row div{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
        .actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}button{min-height:33px;border:1px solid var(--mc-line);border-radius:8px;background:var(--mc-bg);color:var(--mc-text);padding:0 10px;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}button:hover{background:var(--mc-raised)}button.primary{border-color:var(--mc-blue);background:var(--mc-blue);color:var(--mc-on-blue)}button.primary:hover{filter:brightness(.96)}
        .status{margin:7px 0 0;color:var(--mc-muted);font-size:11px}.status:empty{display:none}
        @media(prefers-color-scheme:dark){:host{--mc-bg:#202124;--mc-raised:#292a2d;--mc-text:#f1f3f4;--mc-muted:#bdc1c6;--mc-line:#4a4d52;--mc-blue:#4f86df;--mc-on-blue:#fff}.popover{box-shadow:0 14px 36px rgba(0,0,0,.48)}}
        @media(prefers-reduced-motion:no-preference){.popover{animation:mc-in 100ms ease-out}@keyframes mc-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}}
      `;
      const popover = document.createElement('section');
      popover.className = 'popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', labels.title);
      const heading = document.createElement('div');
      heading.className = 'heading';
      const title = document.createElement('strong');
      title.textContent = labels.title;
      const close = document.createElement('button');
      close.className = 'close';
      close.type = 'button';
      close.title = labels.close;
      close.setAttribute('aria-label', labels.close);
      close.textContent = '×';
      close.addEventListener('click', () => this.close(true));
      heading.append(title, close);

      const details = document.createElement('div');
      details.className = 'details';
      this.appendField(details, labels.to, this.mailto.addressText || labels.noAddress);
      if (this.mailto.cc.length) this.appendField(details, labels.cc, this.mailto.cc.join(', '));
      if (this.mailto.bcc.length) this.appendField(details, labels.bcc, this.mailto.bcc.join(', '));
      if (this.mailto.subject) this.appendField(details, labels.subject, this.mailto.subject);
      if (this.mailto.body) this.appendField(details, labels.message, this.mailto.body);
      if (this.mailto.otherFields.length) this.appendOtherFields(details, labels);

      const actions = document.createElement('div');
      actions.className = 'actions';
      let primaryAction = null;
      if (this.mailto.simpleAddressOnly) {
        primaryAction = this.action(labels.copyAddress, 'primary', () => this.copy(this.mailto.addressText, labels.addressCopied));
      } else {
        primaryAction = this.action(labels.copyMessage, 'primary', () => this.copy(this.messageText(), labels.messageCopied));
        primaryAction.disabled = !this.messageText();
      }
      actions.append(primaryAction);
      const status = document.createElement('p');
      status.className = 'status';
      status.setAttribute('aria-live', 'polite');
      status.dataset.status = '';
      popover.append(heading, details, actions, status);
      shadow.append(style, popover);
      (document.body || document.documentElement).append(host);
      this.position();
      (primaryAction.disabled ? close : primaryAction).focus({ preventScroll: true });
    }

    appendField(parent, labelText, valueText) {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('span');
      label.textContent = labelText;
      const value = document.createElement('div');
      value.className = 'value';
      value.textContent = valueText;
      field.append(label, value);
      parent.append(field);
    }

    appendOtherFields(parent, labels) {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('span');
      label.textContent = labels.other;
      const value = document.createElement('div');
      value.className = 'value other';
      for (const item of this.mailto.otherFields) {
        const row = document.createElement('div');
        row.className = 'other-row';
        const name = document.createElement('b');
        name.textContent = item.name;
        const content = document.createElement('div');
        content.textContent = item.values.join(', ');
        row.append(name, content);
        value.append(row);
      }
      field.append(label, value);
      parent.append(field);
    }

    action(label, className, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.addEventListener('click', handler);
      return button;
    }

    async copy(text, successMessage) {
      const value = String(text || '');
      if (!value) return;
      let copied = false;
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch {
        const input = document.createElement('textarea');
        input.value = value;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        (document.body || document.documentElement).append(input);
        input.select();
        try { copied = document.execCommand('copy'); } catch {}
        input.remove();
      }
      const status = this.shadow?.querySelector('[data-status]');
      if (status) status.textContent = copied ? successMessage : COPY[this.locale].copyFailed;
    }

    position() {
      if (!this.host || !this.anchor?.isConnected) { this.close(); return; }
      const rect = this.anchor.getBoundingClientRect();
      const width = Math.min(324, Math.max(220, window.innerWidth - 20));
      this.host.style.setProperty('width', `${width}px`, 'important');
      let left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      this.host.style.setProperty('left', `${Math.round(left)}px`, 'important');
      this.host.style.setProperty('top', `${Math.round(rect.bottom + 8)}px`, 'important');
      const height = this.host.getBoundingClientRect().height;
      let top = rect.bottom + 8;
      if (top + height > window.innerHeight - 12 && rect.top - height - 8 >= 12) top = rect.top - height - 8;
      else top = Math.min(top, Math.max(12, window.innerHeight - height - 12));
      this.host.style.setProperty('top', `${Math.round(top)}px`, 'important');
    }

    close(restoreFocus = false) {
      if (this.viewportFrame) cancelAnimationFrame(this.viewportFrame);
      this.viewportFrame = 0;
      const anchor = this.anchor;
      this.host?.remove();
      this.host = null;
      this.shadow = null;
      this.anchor = null;
      this.mailto = null;
      if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
    }
  }

  const runtime = new MailtoCaptureRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
