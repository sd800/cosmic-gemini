(() => {
  const READY = 'cosmic-gemini:chinese-response-claude:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:chinese-response-claude:main-ready';
  const CONFIGURE = 'cosmic-gemini:chinese-response-claude:configure';
  const DISPOSE = 'cosmic-gemini:chinese-response-claude:dispose';
  const ACTIVITY = 'cosmic-gemini:chinese-response-claude:activity';
  const RUNTIME_KEY = Symbol.for('cosmic-gemini.chinese-response-claude.runtime');
  const ASSISTANT_ROOT_SELECTOR = [
    '[data-message-author-role="assistant"]',
    '[data-testid="assistant-message"]',
    '[data-testid^="assistant-message-"]',
    '[data-testid*="assistant-response"]',
    '.font-claude-response'
  ].join(',');
  const TEXT_BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,figcaption,dt,dd';
  const EXCLUDED_SELECTOR = [
    'a', 'button', 'pre', 'code', 'kbd', 'samp', 'script', 'style', 'textarea', 'input', 'select', 'option',
    'math', 'svg', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]',
    '[data-testid*="code"]', '[data-testid*="citation"]', '.katex', '.MathJax'
  ].join(',');
  const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
  const HAN_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const LATIN_OR_NUMBER = /[A-Za-z0-9]/;
  const TOKEN_PREFIX_SYMBOL = /[$€£¥￥₩₹₽@#]/;
  const TOKEN_SUFFIX_SYMBOL = /[%‰℃°]/;
  const OPERATOR_SYMBOL = /[+−±×÷=<>≤≥&|]/;
  const ASCII_WORD_CHARACTER = /[A-Za-z0-9]/;
  const PROTECTED_TEXT = /(?:https?:\/\/|www\.)[^\s<>()\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+\d{1,3}[\s.-]?)?\(\d{2,4}\)[\s.-]*\d{3,4}[\s.-]\d{4}\b|\b(?:[A-Za-z]:\\|\/)[^\s]+/g;
  const EAST_EIGHT_TIMEZONE_OFFSET = -480;

  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  if (globalThis[RUNTIME_KEY]) {
    globalThis[RUNTIME_KEY].announce();
    return;
  }

  class ChineseResponseClaudeRuntime {
    constructor() {
      this.token = randomToken();
      this.active = false;
      this.responseDisplay = location.hostname === 'claude.ai';
      this.identityRestorers = [];
      this.systemTimeZone = '';
      this.systemTimeZoneOffset = 0;
      this.identityTimeZone = '';
      this.nativeDate = null;
      this.nativeDateTimeFormat = null;
      this.zonedPartsFormatter = null;
      this.zonedNameFormatter = null;
      this.discoveryObserver = null;
      this.responseObserver = null;
      this.observedRoots = new Set();
      this.pendingTargets = new Set();
      this.flushQueued = false;
      this.records = new Map();
      this.recordsNeedPrune = false;
      this.reportedActivity = null;
      this.flushCount = 0;
      this.onConfigure = this.onConfigure.bind(this);
      this.onDispose = this.onDispose.bind(this);
      this.onBridgeReady = this.onBridgeReady.bind(this);
      this.onDiscoveryMutations = this.onDiscoveryMutations.bind(this);
      this.onResponseMutations = this.onResponseMutations.bind(this);
      this.flush = this.flush.bind(this);
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
      const responseDisplay = location.hostname === 'claude.ai' && message.config?.responseDisplay !== false;
      if (message.config?.active === true) {
        if (!this.active) {
          this.responseDisplay = responseDisplay;
          this.enable();
        } else {
          const changed = responseDisplay !== this.responseDisplay;
          this.responseDisplay = responseDisplay;
          if (changed && responseDisplay) this.startResponseDisplay();
          else if (changed) this.stopResponseDisplay();
          this.syncActivity(true, true);
        }
      }
      else this.disable();
    }
    onDispose(event) {
      if (event?.detail !== this.token) return;
      this.disable();
      window.removeEventListener(CONFIGURE, this.onConfigure, true);
      window.removeEventListener(DISPOSE, this.onDispose, true);
      window.removeEventListener(READY, this.onBridgeReady, true);
      try { delete globalThis[RUNTIME_KEY]; } catch {}
    }

    selectTimeZone(timeZone, offset) {
      const value = String(timeZone || '');
      return Number(offset) === EAST_EIGHT_TIMEZONE_OFFSET ? 'America/New_York' : value;
    }

    detectSystemTimeZone() {
      try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
      catch { return ''; }
    }

    detectSystemTimeZoneOffset() {
      try { return new this.nativeDate().getTimezoneOffset(); }
      catch { return 0; }
    }

    descriptorMatches(current, installed) {
      return !!current && current.value === installed.value && current.get === installed.get
        && current.set === installed.set;
    }

    installIdentityProperty(owner, name, descriptor) {
      if (!owner) return false;
      const original = Object.getOwnPropertyDescriptor(owner, name);
      if (original && original.configurable === false) return false;
      try { Object.defineProperty(owner, name, descriptor); }
      catch { return false; }
      const installed = Object.getOwnPropertyDescriptor(owner, name);
      this.identityRestorers.push(() => {
        const current = Object.getOwnPropertyDescriptor(owner, name);
        if (!this.descriptorMatches(current, installed)) return;
        try {
          if (original) Object.defineProperty(owner, name, original);
          else delete owner[name];
        } catch {}
      });
      return true;
    }

    propertyOwner(value, name) {
      let owner = value;
      while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) owner = Object.getPrototypeOf(owner);
      return owner || Object.getPrototypeOf(value) || value;
    }

    installNavigatorIdentity() {
      const pageNavigator = globalThis.navigator;
      if (!pageNavigator) return;
      const languages = Object.freeze(['en-US']);
      for (const [name, value] of [
        ['language', 'en-US'],
        ['languages', languages],
        ['userLanguage', 'en-US'],
        ['browserLanguage', 'en-US'],
        ['systemLanguage', 'en-US']
      ]) {
        const owner = this.propertyOwner(pageNavigator, name);
        this.installIdentityProperty(owner, name, {
          configurable: true,
          enumerable: Object.getOwnPropertyDescriptor(owner, name)?.enumerable ?? true,
          get: () => value
        });
      }
    }

    defaultLocaleArguments(args, localeIndex = 0) {
      const normalized = [...args];
      while (normalized.length <= localeIndex) normalized.push(undefined);
      if (normalized[localeIndex] === undefined) normalized[localeIndex] = 'en-US';
      return normalized;
    }

    dateTimeFormatArguments(args) {
      const normalized = this.defaultLocaleArguments(args);
      if (!this.identityTimeZone) return normalized;
      while (normalized.length < 2) normalized.push(undefined);
      if (normalized[1] === undefined) normalized[1] = { timeZone: this.identityTimeZone };
      else if (normalized[1] && typeof normalized[1] === 'object' && !('timeZone' in normalized[1])) {
        normalized[1] = { ...normalized[1], timeZone: this.identityTimeZone };
      }
      return normalized;
    }

    installIntlConstructor(name, argumentTransform) {
      const intl = globalThis.Intl;
      const Original = intl?.[name];
      if (typeof Original !== 'function') return;
      let wrapped;
      wrapped = new Proxy(Original, {
        apply: (target, receiver, args) => Reflect.apply(target, receiver, argumentTransform(args)),
        construct: (target, args, newTarget) => Reflect.construct(
          target,
          argumentTransform(args),
          newTarget === wrapped ? target : newTarget
        )
      });
      const descriptor = Object.getOwnPropertyDescriptor(intl, name) || {
        configurable: true, enumerable: false, writable: true
      };
      if (this.installIdentityProperty(intl, name, { ...descriptor, value: wrapped })) {
        const constructorDescriptor = Object.getOwnPropertyDescriptor(Original.prototype, 'constructor');
        if (constructorDescriptor?.value === Original) {
          this.installIdentityProperty(Original.prototype, 'constructor', {
            ...constructorDescriptor,
            value: wrapped
          });
        }
      }
    }

    installLocaleMethod(owner, name, localeIndex = 0, applyTimeZone = false) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      const original = descriptor?.value;
      if (typeof original !== 'function') return;
      const runtime = this;
      const wrapped = function localeMethod(...args) {
        const normalized = runtime.defaultLocaleArguments(args, localeIndex);
        if (applyTimeZone && runtime.identityTimeZone) {
          const optionsIndex = localeIndex + 1;
          while (normalized.length <= optionsIndex) normalized.push(undefined);
          if (normalized[optionsIndex] === undefined) {
            normalized[optionsIndex] = { timeZone: runtime.identityTimeZone };
          } else if (normalized[optionsIndex] && typeof normalized[optionsIndex] === 'object'
            && !('timeZone' in normalized[optionsIndex])) {
            normalized[optionsIndex] = { ...normalized[optionsIndex], timeZone: runtime.identityTimeZone };
          }
        }
        return Reflect.apply(original, this, normalized);
      };
      this.installIdentityProperty(owner, name, { ...descriptor, value: wrapped });
    }

    zonedParts(value) {
      const time = Date.prototype.getTime.call(value);
      if (!Number.isFinite(time)) return null;
      this.zonedPartsFormatter ||= new this.nativeDateTimeFormat('en-US', {
        timeZone: this.identityTimeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      });
      const parts = {};
      for (const part of this.zonedPartsFormatter.formatToParts(value)) {
        if (part.type !== 'literal') parts[part.type] = part.value;
      }
      return {
        year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second)
      };
    }

    zonedOffset(value, parts = this.zonedParts(value)) {
      if (!parts) return NaN;
      const time = Date.prototype.getTime.call(value);
      const wholeSecondTime = Math.trunc(time / 1000) * 1000;
      const representedAsUtc = Date.UTC(
        parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second
      );
      return Math.round((wholeSecondTime - representedAsUtc) / 60_000);
    }

    zonedTimeZoneName(value) {
      this.zonedNameFormatter ||= new this.nativeDateTimeFormat('en-US', {
        timeZone: this.identityTimeZone, year: 'numeric', timeZoneName: 'long'
      });
      return this.zonedNameFormatter.formatToParts(value).find(part => part.type === 'timeZoneName')?.value || '';
    }

    installZonedDateReads() {
      if (this.identityTimeZone === this.systemTimeZone) return;
      const runtime = this;
      const datePrototype = Date.prototype;
      const numericReads = {
        getFullYear: parts => parts.year,
        getYear: parts => parts.year - 1900,
        getMonth: parts => parts.month - 1,
        getDate: parts => parts.day,
        getDay: parts => new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay(),
        getHours: parts => parts.hour,
        getMinutes: parts => parts.minute,
        getSeconds: parts => parts.second
      };
      for (const [name, read] of Object.entries(numericReads)) {
        const descriptor = Object.getOwnPropertyDescriptor(datePrototype, name);
        const original = descriptor?.value;
        if (typeof original !== 'function') continue;
        this.installIdentityProperty(datePrototype, name, {
          ...descriptor,
          value: function zonedDateRead() {
            Date.prototype.getTime.call(this);
            const parts = runtime.zonedParts(this);
            return parts ? read(parts) : NaN;
          }
        });
      }
      const offsetDescriptor = Object.getOwnPropertyDescriptor(datePrototype, 'getTimezoneOffset');
      this.installIdentityProperty(datePrototype, 'getTimezoneOffset', {
        ...offsetDescriptor,
        value: function getTimezoneOffset() { return runtime.zonedOffset(this); }
      });
      const pad = value => String(Math.abs(value)).padStart(2, '0');
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const strings = {
        toDateString(parts) {
          const weekday = weekdays[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
          return `${weekday} ${months[parts.month - 1]} ${pad(parts.day)} ${parts.year}`;
        },
        toTimeString(parts, value) {
          const offset = runtime.zonedOffset(value, parts);
          const sign = offset <= 0 ? '+' : '-';
          const absolute = Math.abs(offset);
          const zoneName = runtime.zonedTimeZoneName(value);
          return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} GMT${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}${zoneName ? ` (${zoneName})` : ''}`;
        }
      };
      for (const name of ['toDateString', 'toTimeString', 'toString']) {
        const descriptor = Object.getOwnPropertyDescriptor(datePrototype, name);
        const original = descriptor?.value;
        if (typeof original !== 'function') continue;
        this.installIdentityProperty(datePrototype, name, {
          ...descriptor,
          value: function zonedDateString() {
            Date.prototype.getTime.call(this);
            const parts = runtime.zonedParts(this);
            if (!parts) return 'Invalid Date';
            const date = strings.toDateString(parts, this);
            if (name === 'toDateString') return date;
            const time = strings.toTimeString(parts, this);
            return name === 'toTimeString' ? time : `${date} ${time}`;
          }
        });
      }
    }

    installZonedDateConstructor() {
      if (this.identityTimeZone === this.systemTimeZone || typeof this.nativeDate !== 'function') return;
      const runtime = this;
      const Original = this.nativeDate;
      let wrapped;
      wrapped = new Proxy(Original, {
        apply() { return new Original().toString(); },
        construct(target, args, newTarget) {
          let normalized = args;
          if (args.length >= 2) {
            const values = [
              Number(args[0]), Number(args[1]),
              args.length > 2 ? Number(args[2]) : 1,
              args.length > 3 ? Number(args[3]) : 0,
              args.length > 4 ? Number(args[4]) : 0,
              args.length > 5 ? Number(args[5]) : 0,
              args.length > 6 ? Number(args[6]) : 0
            ];
            const representedAsUtc = Original.UTC(...values);
            let instant = representedAsUtc;
            if (Number.isFinite(instant)) {
              for (let attempt = 0; attempt < 3; attempt += 1) {
                const offset = runtime.zonedOffset(new Original(instant));
                const adjusted = representedAsUtc + offset * 60_000;
                if (adjusted === instant) break;
                instant = adjusted;
              }
            }
            normalized = [instant];
          }
          return Reflect.construct(target, normalized, newTarget === wrapped ? target : newTarget);
        }
      });
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Date') || {
        configurable: true, enumerable: false, writable: true
      };
      if (this.installIdentityProperty(globalThis, 'Date', { ...descriptor, value: wrapped })) {
        const constructorDescriptor = Object.getOwnPropertyDescriptor(Original.prototype, 'constructor');
        if (constructorDescriptor?.value === Original) {
          this.installIdentityProperty(Original.prototype, 'constructor', {
            ...constructorDescriptor,
            value: wrapped
          });
        }
      }
    }

    installIdentityNormalization() {
      if (this.identityRestorers.length) return;
      this.nativeDate = Date;
      this.nativeDateTimeFormat = Intl.DateTimeFormat;
      this.systemTimeZone = this.detectSystemTimeZone();
      this.systemTimeZoneOffset = this.detectSystemTimeZoneOffset();
      this.identityTimeZone = this.selectTimeZone(this.systemTimeZone, this.systemTimeZoneOffset)
        || this.systemTimeZone;
      this.installNavigatorIdentity();
      this.installIntlConstructor('DateTimeFormat', args => this.dateTimeFormatArguments(args));
      for (const name of [
        'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat',
        'DisplayNames', 'Segmenter', 'DurationFormat'
      ]) this.installIntlConstructor(name, args => this.defaultLocaleArguments(args));
      for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
        this.installLocaleMethod(Date.prototype, name, 0, true);
      }
      this.installLocaleMethod(Number.prototype, 'toLocaleString');
      if (typeof BigInt === 'function') this.installLocaleMethod(BigInt.prototype, 'toLocaleString');
      this.installLocaleMethod(Array.prototype, 'toLocaleString');
      this.installLocaleMethod(String.prototype, 'localeCompare', 1);
      this.installZonedDateReads();
      this.installZonedDateConstructor();
    }

    restoreIdentityNormalization() {
      for (const restore of this.identityRestorers.reverse()) restore();
      this.identityRestorers = [];
      this.systemTimeZone = '';
      this.systemTimeZoneOffset = 0;
      this.identityTimeZone = '';
      this.nativeDate = null;
      this.nativeDateTimeFormat = null;
      this.zonedPartsFormatter = null;
      this.zonedNameFormatter = null;
    }

    protectedMask(text) {
      const mask = new Uint8Array(text.length);
      PROTECTED_TEXT.lastIndex = 0;
      for (const match of text.matchAll(PROTECTED_TEXT)) {
        const end = match.index + match[0].length;
        for (let index = match.index; index < end; index += 1) mask[index] = 1;
      }
      return mask;
    }

    addInterScriptSpacing(characters) {
      const spaced = [];
      for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        const previous = characters[index - 1] || '';
        const afterChinese = HAN_CHARACTER.test(previous)
          && (LATIN_OR_NUMBER.test(character)
            || TOKEN_PREFIX_SYMBOL.test(character)
            || OPERATOR_SYMBOL.test(character));
        const beforeChinese = HAN_CHARACTER.test(character)
          && (LATIN_OR_NUMBER.test(previous)
            || TOKEN_SUFFIX_SYMBOL.test(previous)
            || OPERATOR_SYMBOL.test(previous));
        if (afterChinese || beforeChinese) {
          spaced.push(' ');
        }
        spaced.push(character);
      }
      return spaced.join('');
    }

    optimizeText(text, chineseBlock = true, quoteState = { double: false, single: false }) {
      if (!chineseBlock || !text) return text;
      const protectedCharacters = this.protectedMask(text);
      const characters = text.split('');
      const previousNonSpaces = new Array(characters.length);
      const nextNonSpaces = new Array(characters.length);
      let visibleCharacter = '';
      for (let index = 0; index < characters.length; index += 1) {
        previousNonSpaces[index] = visibleCharacter;
        if (!/\s/.test(characters[index])) visibleCharacter = characters[index];
      }
      visibleCharacter = '';
      for (let index = characters.length - 1; index >= 0; index -= 1) {
        nextNonSpaces[index] = visibleCharacter;
        if (!/\s/.test(characters[index])) visibleCharacter = characters[index];
      }
      const mapped = {
        ',': '，', '?': '？', '!': '！', ':': '：', ';': '；',
        '(': '（', ')': '）'
      };
      for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (protectedCharacters[index]) continue;
        const previous = characters[index - 1] || '';
        const next = characters[index + 1] || '';
        const withinAsciiPhrase = ASCII_WORD_CHARACTER.test(previousNonSpaces[index])
          && ASCII_WORD_CHARACTER.test(nextNonSpaces[index]);
        if ((character === ',' || character === '.' || character === ':') && /\d/.test(previous) && /\d/.test(next)) continue;
        if ((character === ',' || character === '.' || character === ':' || character === ';')
          && withinAsciiPhrase) continue;
        if (character === '.' && (previous === '.' || next === '.')) continue;
        if (character === '.') {
          characters[index] = '。';
          continue;
        }
        if (mapped[character]) {
          characters[index] = mapped[character];
          continue;
        }
        if (character === '"') {
          characters[index] = quoteState.double ? '”' : '“';
          quoteState.double = !quoteState.double;
          continue;
        }
        if (character === "'" && !(/[A-Za-z0-9]/.test(previous) && /[A-Za-z0-9]/.test(next))) {
          characters[index] = quoteState.single ? '’' : '‘';
          quoteState.single = !quoteState.single;
        }
      }
      return this.addInterScriptSpacing(characters);
    }

    assistantRoot(node) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.(ASSISTANT_ROOT_SELECTOR) || null;
    }

    collectRoots(scope) {
      const roots = [];
      if (scope?.matches?.(ASSISTANT_ROOT_SELECTOR)) roots.push(scope);
      for (const root of scope?.querySelectorAll?.(ASSISTANT_ROOT_SELECTOR) || []) roots.push(root);
      return roots.filter(root => !root.parentElement?.closest?.(ASSISTANT_ROOT_SELECTOR));
    }

    observeRoot(root) {
      if (!this.active || !root || this.observedRoots.has(root)) return;
      this.observedRoots.add(root);
      this.responseObserver ||= new MutationObserver(this.onResponseMutations);
      this.responseObserver.observe(root, { subtree: true, childList: true, characterData: true });
      this.queueTarget(root);
    }

    pruneRemovedRoots() {
      const connectedRoots = [...this.observedRoots].filter(root => root.isConnected);
      if (connectedRoots.length === this.observedRoots.size) return;
      this.responseObserver?.disconnect();
      this.responseObserver = null;
      this.observedRoots = new Set(connectedRoots);
      for (const [node] of this.records) if (!node.isConnected) this.records.delete(node);
      this.syncActivity();
      if (!this.active || !connectedRoots.length) return;
      this.responseObserver = new MutationObserver(this.onResponseMutations);
      for (const root of connectedRoots) {
        this.responseObserver.observe(root, { subtree: true, childList: true, characterData: true });
      }
    }

    shouldExclude(textNode) {
      const parent = textNode.parentElement;
      return !parent || !!parent.closest(EXCLUDED_SELECTOR);
    }

    textNodes(block, assistantRoot) {
      const nodes = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: node => this.shouldExclude(node) || !node.data.trim()
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
      });
      while (walker.nextNode()) nodes.push(walker.currentNode);
      return nodes;
    }

    transformNode(node, chineseBlock, quoteState) {
      const existing = this.records.get(node);
      if (existing && node.data === existing.transformed) return;
      const source = node.data;
      const transformed = this.optimizeText(source, chineseBlock, quoteState);
      if (source === transformed) {
        if (existing) this.records.delete(node);
        return;
      }
      this.records.set(node, { original: source, transformed });
      node.data = transformed;
    }

    syncActivity(force = false, prune = false) {
      if (prune) {
        for (const [node, record] of this.records) {
          if (!node.isConnected || node.data !== record.transformed) this.records.delete(node);
        }
      }
      const activity = this.records.size > 0;
      if (!force && this.reportedActivity === activity) return;
      this.reportedActivity = activity;
      window.dispatchEvent(new CustomEvent(ACTIVITY, {
        detail: JSON.stringify({ token: this.token, active: activity })
      }));
    }

    processBlock(block, assistantRoot) {
      const nodes = this.textNodes(block, assistantRoot);
      if (!nodes.length) return;
      const text = nodes.map(node => node.data).join(' ');
      const chineseBlock = (text.match(HAN) || []).length > 0;
      if (!chineseBlock) return;
      const quoteState = { double: false, single: false };
      for (const node of nodes) this.transformNode(node, true, quoteState);
    }

    processRoot(root) {
      if (!root?.isConnected) return;
      const blocks = [];
      if (root.matches?.(TEXT_BLOCK_SELECTOR)) blocks.push(root);
      for (const block of root.querySelectorAll?.(TEXT_BLOCK_SELECTOR) || []) blocks.push(block);
      if (!blocks.length) this.processBlock(root, root);
      else for (const block of blocks) this.processBlock(block, root);
    }

    processingTarget(node) {
      const root = this.assistantRoot(node);
      if (!root) return null;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const block = element?.closest?.(TEXT_BLOCK_SELECTOR);
      return block && root.contains(block) ? block : root;
    }

    queueTarget(target) {
      if (!this.active || !target) return;
      this.pendingTargets.add(target);
      if (this.flushQueued) return;
      this.flushQueued = true;
      queueMicrotask(this.flush);
    }

    flush() {
      this.flushQueued = false;
      if (!this.active) { this.pendingTargets.clear(); return; }
      const targets = [...this.pendingTargets];
      this.pendingTargets.clear();
      for (const target of targets) {
        if (target.matches?.(ASSISTANT_ROOT_SELECTOR)) this.processRoot(target);
        else {
          const root = this.assistantRoot(target);
          if (root) this.processBlock(target, root);
        }
      }
      this.flushCount += 1;
      const periodicPrune = this.records.size > 1500 || this.flushCount % 128 === 0;
      this.syncActivity(false, this.recordsNeedPrune || periodicPrune);
      this.recordsNeedPrune = false;
    }

    onDiscoveryMutations(mutations) {
      let rootsWereRemoved = false;
      for (const mutation of mutations) {
        const owner = this.assistantRoot(mutation.target);
        if (owner && this.observedRoots.has(owner)) continue;
        if (owner) this.observeRoot(owner);
        for (const node of mutation.addedNodes) {
          for (const root of this.collectRoots(node)) this.observeRoot(root);
        }
        for (const node of mutation.removedNodes || []) {
          if (this.observedRoots.has(node)) rootsWereRemoved = true;
          for (const root of this.collectRoots(node)) {
            if (this.observedRoots.has(root)) rootsWereRemoved = true;
          }
        }
      }
      if (rootsWereRemoved) this.pruneRemovedRoots();
    }

    isRecordedOutput(node) {
      const record = this.records.get(node);
      return !!record && node.data === record.transformed;
    }

    onResponseMutations(mutations) {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          if (this.isRecordedOutput(mutation.target)) continue;
          this.queueTarget(this.processingTarget(mutation.target));
          continue;
        }
        if (mutation.removedNodes?.length) this.recordsNeedPrune = true;
        this.queueTarget(this.processingTarget(mutation.target));
        for (const node of mutation.addedNodes) {
          this.queueTarget(this.processingTarget(node));
          for (const root of this.collectRoots(node)) this.queueTarget(root);
        }
      }
    }

    enable() {
      if (this.active) return;
      this.active = true;
      this.installIdentityNormalization();
      if (this.responseDisplay) this.startResponseDisplay();
      else queueMicrotask(() => this.syncActivity());
    }

    startResponseDisplay() {
      if (!this.active || this.discoveryObserver) return;
      const target = document.documentElement;
      if (!target) return;
      this.discoveryObserver = new MutationObserver(this.onDiscoveryMutations);
      this.discoveryObserver.observe(target, { subtree: true, childList: true });
      for (const root of this.collectRoots(document)) this.observeRoot(root);
      queueMicrotask(() => this.syncActivity());
    }

    stopResponseDisplay() {
      this.discoveryObserver?.disconnect();
      this.responseObserver?.disconnect();
      this.discoveryObserver = null;
      this.responseObserver = null;
      this.observedRoots = new Set();
      this.pendingTargets.clear();
      this.flushQueued = false;
      this.recordsNeedPrune = false;
      this.restore();
    }

    restore() {
      for (const [node, record] of this.records) {
        if (node.isConnected && node.data === record.transformed) node.data = record.original;
      }
      this.records.clear();
      this.syncActivity();
    }

    disable() {
      this.active = false;
      this.stopResponseDisplay();
      this.restoreIdentityNormalization();
      this.reportedActivity = null;
    }
  }

  const runtime = new ChineseResponseClaudeRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
