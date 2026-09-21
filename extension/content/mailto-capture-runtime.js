(() => {
  const READY = 'cosmic-gemini:mailto-capture:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:mailto-capture:main-ready';
  const CONFIGURE = 'cosmic-gemini:mailto-capture:configure';
  const DISPOSE = 'cosmic-gemini:mailto-capture:dispose';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.mailto-capture.runtime');
  const NANP_KEY = Symbol.for('cosmic-gemini.mailto-capture.nanp');
  const CAPTURED_LINK = /^(?:mailto|tel|sms):/i;
  const COPY = Object.freeze({
    'en-US': Object.freeze({
      title: 'Email link',
      telephoneTitle: 'Telephone link',
      textMessageTitle: 'Text message link',
      to: 'To',
      phoneNumber: 'Phone number',
      cc: 'CC',
      bcc: 'BCC',
      subject: 'Subject',
      message: 'Message',
      other: 'Other fields',
      noAddress: 'No recipient specified',
      copyAddress: 'Copy address',
      copyPhoneNumber: 'Copy number',
      copyTextMessage: 'Copy text message',
      copyMessage: 'Copy message',
      close: 'Close',
      addressCopied: 'Address copied',
      phoneNumberCopied: 'Number copied',
      textMessageCopied: 'Text message copied',
      messageCopied: 'Message copied',
      copyFailed: 'Could not copy'
    }),
    'zh-CN': Object.freeze({
      title: '邮件链接',
      telephoneTitle: '电话链接',
      textMessageTitle: '短信链接',
      to: '收件人',
      phoneNumber: '电话号码',
      cc: '抄送',
      bcc: '密送',
      subject: '主题',
      message: '正文',
      other: '其他信息',
      noAddress: '未指定收件人',
      copyAddress: '复制地址',
      copyPhoneNumber: '复制号码',
      copyTextMessage: '复制短信内容',
      copyMessage: '复制邮件内容',
      close: '关闭',
      addressCopied: '已复制地址',
      phoneNumberCopied: '已复制号码',
      textMessageCopied: '已复制短信内容',
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

  function nanpLocation(value) {
    try { return globalThis[NANP_KEY]?.lookup(value) || ''; }
    catch { return ''; }
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
      this.capture = null;
      this.closingHost = null;
      this.closingAnimation = null;
      this.closeSequence = 0;
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
      else if (nextActive && localeChanged && this.capture) this.render();
    }

    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      try { delete globalThis[RUNTIME_KEY]; } catch {}
      try { delete globalThis[NANP_KEY]; } catch {}
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
        && CAPTURED_LINK.test(node.getAttribute('href')?.trim() || '')) || null;
    }

    onActivate(event) {
      if (!this.active || !event.isTrusted) return;
      if (event.type === 'click' && Number(event.button || 0) !== 0) return;
      if (event.type === 'auxclick' && Number(event.button) !== 1) return;
      const anchor = this.anchorFromEvent(event);
      const href = anchor?.getAttribute('href')?.trim() || '';
      if (!CAPTURED_LINK.test(href)) return;
      const capture = this.parseLink(href);
      if (!capture) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.show(anchor, href, capture);
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
        kind: 'mailto',
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

    parseTel(href) {
      const raw = String(href || '').trim();
      if (!/^tel:/i.test(raw)) return null;
      const content = raw.slice(raw.indexOf(':') + 1).split('#', 1)[0];
      const number = decodeMailtoPart(content).trim();
      return number ? { kind: 'tel', href: raw, number, location: nanpLocation(number) } : null;
    }

    parseSms(href) {
      const raw = String(href || '').trim();
      if (!/^sms:/i.test(raw)) return null;
      const content = raw.slice(raw.indexOf(':') + 1).split('#', 1)[0];
      const queryAt = content.indexOf('?');
      const recipientPart = queryAt < 0 ? content : content.slice(0, queryAt);
      const query = queryAt < 0 ? '' : content.slice(queryAt + 1);
      const recipients = addressValues([decodeMailtoPart(recipientPart)]);
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
      const body = (fields.get('body')?.values || []).join('\n\n');
      fields.delete('body');
      const otherFields = [...fields.values()]
        .map(field => ({ name: field.name, values: field.values.filter(value => value !== '') }))
        .filter(field => field.values.length);
      if (!recipients.length && !body && !otherFields.length) return null;
      return {
        kind: 'sms',
        href: raw,
        recipients,
        body,
        otherFields,
        numberText: recipients.join(', '),
        locations: recipients
          .map(number => ({ number, location: nanpLocation(number) }))
          .filter(item => item.location),
        simpleNumberOnly: recipients.length > 0 && !body && !otherFields.length
      };
    }

    parseLink(href) {
      return this.parseMailto(href) || this.parseTel(href) || this.parseSms(href);
    }

    messageText(capture = this.capture) {
      if (!capture) return '';
      if (capture.kind === 'tel') return capture.number;
      const labels = COPY[this.locale];
      if (capture.kind === 'sms') {
        const lines = [];
        if (capture.recipients.length) lines.push(`${labels.to}: ${capture.numberText}`);
        for (const field of capture.otherFields) lines.push(`${field.name}: ${field.values.join(', ')}`);
        if (capture.body) lines.push('', capture.body);
        return lines.join('\n');
      }
      const lines = [];
      if (capture.to.length) lines.push(`${labels.to}: ${capture.to.join(', ')}`);
      if (capture.cc.length) lines.push(`${labels.cc}: ${capture.cc.join(', ')}`);
      if (capture.bcc.length) lines.push(`${labels.bcc}: ${capture.bcc.join(', ')}`);
      if (capture.subject) lines.push(`${labels.subject}: ${capture.subject}`);
      for (const field of capture.otherFields) lines.push(`${field.name}: ${field.values.join(', ')}`);
      if (capture.body) lines.push('', capture.body);
      return lines.join('\n');
    }

    displayTelephoneNumber(value) {
      const raw = String(value || '').trim();
      const parameterAt = raw.indexOf(';');
      const primary = parameterAt < 0 ? raw : raw.slice(0, parameterAt);
      const parameters = parameterAt < 0 ? [] : raw.slice(parameterAt + 1).split(';').filter(Boolean);
      if (primary.startsWith('+') && !primary.startsWith('+1')) return raw;
      const digits = primary.replace(/\D/g, '');
      let national;
      let international = false;
      if (digits.length === 11 && digits.startsWith('1')) {
        national = digits.slice(1);
        international = true;
      } else if (digits.length === 10 && nanpLocation(raw)) national = digits;
      else return raw;
      let display = `${international ? '+1 ' : ''}(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
      for (const parameter of parameters) {
        const extension = /^ext=(.+)$/i.exec(parameter);
        display += extension ? ` ext. ${extension[1]}` : `;${parameter}`;
      }
      return display;
    }

    show(anchor, href, parsed = null) {
      const capture = parsed || this.parseLink(href);
      if (!capture) return;
      this.finishClosing();
      this.close(false, true);
      this.anchor = anchor;
      this.capture = capture;
      this.render();
    }

    render() {
      if (!this.anchor || !this.capture) return;
      this.host?.remove();
      const labels = COPY[this.locale];
      const telephone = this.capture.kind === 'tel';
      const textMessage = this.capture.kind === 'sms';
      const dialogTitle = telephone
        ? labels.telephoneTitle
        : textMessage ? labels.textMessageTitle : labels.title;
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
        .popover{position:relative;width:min(324px,calc(100vw - 20px));max-height:min(460px,calc(100vh - 20px));overflow:auto;border:1px solid var(--mc-line);border-radius:12px;background:var(--mc-bg);color:var(--mc-text);box-shadow:0 10px 26px rgba(0,0,0,.2);padding:10px 13px 13px}
        .heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 7px}.heading strong{font-size:14px;line-height:1.2;font-weight:700}.close{display:inline-flex;align-items:center;justify-content:center;align-self:baseline;width:22px;height:20px;min-height:20px;border:0;border-radius:50%;background:transparent;color:var(--mc-muted);padding:0;font-size:18px;line-height:1;cursor:pointer}.close:hover{background:var(--mc-raised)}
        .details{display:grid;gap:8px}.field{display:grid;gap:2px}.field span{color:var(--mc-muted);font-size:12px;font-weight:650;text-transform:none}.value{max-height:104px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text;border-radius:7px;background:var(--mc-raised);padding:7px 9px;color:var(--mc-text);font:13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.phone-value{display:grid;gap:7px}.phone-entry{display:grid;gap:1px}.phone-entry+.phone-entry{border-top:1px solid var(--mc-line);padding-top:6px}.phone-location{color:var(--mc-muted);font-size:11px;line-height:1.35}
        .other{display:grid;gap:6px}.other-row{display:grid;grid-template-columns:minmax(72px,auto) 1fr;gap:8px;align-items:start}.other-row b{color:var(--mc-muted);font-size:12px;overflow-wrap:anywhere}.other-row div{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
        .actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}button{min-height:33px;border:1px solid var(--mc-line);border-radius:8px;background:var(--mc-bg);color:var(--mc-text);padding:0 10px;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}button:hover{background:var(--mc-raised)}button.primary{border-color:var(--mc-blue);background:var(--mc-blue);color:var(--mc-on-blue)}button.primary:hover{filter:brightness(.96)}
        .status{margin:7px 0 0;color:var(--mc-muted);font-size:11px}.status:empty{display:none}
        @media(prefers-color-scheme:dark){:host{--mc-bg:#202124;--mc-raised:#292a2d;--mc-text:#f1f3f4;--mc-muted:#bdc1c6;--mc-line:#4a4d52;--mc-blue:#4f86df;--mc-on-blue:#fff}.popover{box-shadow:0 14px 36px rgba(0,0,0,.48)}}
        @media(prefers-reduced-motion:no-preference){.popover{animation:mc-in 100ms ease-out}@keyframes mc-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}}
      `;
      const popover = document.createElement('section');
      popover.className = 'popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', dialogTitle);
      const heading = document.createElement('div');
      heading.className = 'heading';
      const title = document.createElement('strong');
      title.textContent = dialogTitle;
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
      if (telephone) {
        this.appendTelephoneField(details, labels.phoneNumber, [{
          number: this.capture.number,
          location: this.capture.location
        }]);
      } else if (textMessage) {
        if (this.capture.recipients.length) {
          const locations = new Map(this.capture.locations.map(item => [item.number, item.location]));
          this.appendTelephoneField(details, labels.to, this.capture.recipients.map(number => ({
            number,
            location: locations.get(number) || ''
          })));
        } else this.appendField(details, labels.to, labels.noAddress);
        if (this.capture.body) this.appendField(details, labels.message, this.capture.body);
        if (this.capture.otherFields.length) this.appendOtherFields(details, labels);
      } else {
        this.appendField(details, labels.to, this.capture.addressText || labels.noAddress);
        if (this.capture.cc.length) this.appendField(details, labels.cc, this.capture.cc.join(', '));
        if (this.capture.bcc.length) this.appendField(details, labels.bcc, this.capture.bcc.join(', '));
        if (this.capture.subject) this.appendField(details, labels.subject, this.capture.subject);
        if (this.capture.body) this.appendField(details, labels.message, this.capture.body);
        if (this.capture.otherFields.length) this.appendOtherFields(details, labels);
      }

      const actions = document.createElement('div');
      actions.className = 'actions';
      let primaryAction = null;
      if (telephone) {
        primaryAction = this.action(labels.copyPhoneNumber, 'primary', () => this.copy(this.capture.number, labels.phoneNumberCopied));
      } else if (textMessage && this.capture.simpleNumberOnly) {
        primaryAction = this.action(labels.copyPhoneNumber, 'primary', () => this.copy(this.capture.numberText, labels.phoneNumberCopied));
      } else if (textMessage) {
        primaryAction = this.action(labels.copyTextMessage, 'primary', () => this.copy(this.messageText(), labels.textMessageCopied));
        primaryAction.disabled = !this.messageText();
      } else if (this.capture.simpleAddressOnly) {
        primaryAction = this.action(labels.copyAddress, 'primary', () => this.copy(this.capture.addressText, labels.addressCopied));
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

    appendTelephoneField(parent, labelText, entries) {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('span');
      label.textContent = labelText;
      const value = document.createElement('div');
      value.className = 'value phone-value';
      for (const item of entries) {
        const entry = document.createElement('div');
        entry.className = 'phone-entry';
        const number = document.createElement('div');
        number.className = 'phone-number';
        number.textContent = this.displayTelephoneNumber(item.number);
        entry.append(number);
        if (item.location) {
          const location = document.createElement('div');
          location.className = 'phone-location';
          location.textContent = item.location;
          entry.append(location);
        }
        value.append(entry);
      }
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
      for (const item of this.capture.otherFields) {
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

    finishClosing() {
      const host = this.closingHost;
      if (!host) return;
      this.closeSequence += 1;
      this.closingHost = null;
      const animation = this.closingAnimation;
      this.closingAnimation = null;
      try { animation?.cancel(); } catch {}
      host.remove();
    }

    close(restoreFocus = false, immediate = false) {
      if (this.viewportFrame) cancelAnimationFrame(this.viewportFrame);
      this.viewportFrame = 0;
      const host = this.host;
      const shadow = this.shadow;
      const anchor = this.anchor;
      this.host = null;
      this.shadow = null;
      this.anchor = null;
      this.capture = null;
      if (!host) return;
      const restore = () => {
        if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
      };
      const popover = shadow?.querySelector?.('.popover');
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
      if (immediate || reduceMotion || typeof popover?.animate !== 'function') {
        host.remove();
        restore();
        return;
      }
      host.style?.setProperty?.('pointer-events', 'none', 'important');
      const animation = popover.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-3px)' }
      ], { duration: 100, easing: 'ease-in', fill: 'forwards' });
      this.closingHost = host;
      this.closingAnimation = animation;
      const sequence = ++this.closeSequence;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        host.remove();
        if (sequence !== this.closeSequence) return;
        if (this.closingHost === host) {
          this.closingHost = null;
          this.closingAnimation = null;
        }
        restore();
      };
      animation.finished.then(finish, finish);
    }
  }

  const runtime = new MailtoCaptureRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
