(() => {
  const READY = 'cosmic-gemini:chinese-response-claude:bridge-ready';
  const MAIN_READY = 'cosmic-gemini:chinese-response-claude:main-ready';
  const CONFIGURE = 'cosmic-gemini:chinese-response-claude:configure';
  const DISPOSE = 'cosmic-gemini:chinese-response-claude:dispose';
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
  const PROTECTED_TEXT = /(?:https?:\/\/|www\.)[^\s<>()\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+\d{1,3}[\s.-]?)?\(\d{2,4}\)[\s.-]*\d{3,4}[\s.-]\d{4}\b|\b(?:[A-Za-z]:\\|\/)[^\s]+/g;

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
      this.discoveryObserver = null;
      this.responseObserver = null;
      this.observedRoots = new Set();
      this.pendingTargets = new Set();
      this.flushQueued = false;
      this.records = new Map();
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
      if (message.config?.active === true) this.enable();
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
      const mapped = {
        ',': '，', '?': '？', '!': '！', ':': '：', ';': '；',
        '(': '（', ')': '）'
      };
      for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (protectedCharacters[index]) continue;
        const previous = characters[index - 1] || '';
        const next = characters[index + 1] || '';
        if ((character === ',' || character === '.' || character === ':') && /\d/.test(previous) && /\d/.test(next)) continue;
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
      if (this.records.size > 1500 || this.flushCount % 128 === 0) {
        for (const [node] of this.records) if (!node.isConnected) this.records.delete(node);
      }
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
      const target = document.documentElement;
      if (!target) return;
      this.discoveryObserver = new MutationObserver(this.onDiscoveryMutations);
      this.discoveryObserver.observe(target, { subtree: true, childList: true });
      for (const root of this.collectRoots(document)) this.observeRoot(root);
    }

    restore() {
      for (const [node, record] of this.records) {
        if (node.isConnected && node.data === record.transformed) node.data = record.original;
      }
      this.records.clear();
    }

    disable() {
      this.active = false;
      this.discoveryObserver?.disconnect();
      this.responseObserver?.disconnect();
      this.discoveryObserver = null;
      this.responseObserver = null;
      this.observedRoots = new Set();
      this.pendingTargets.clear();
      this.flushQueued = false;
      this.restore();
    }
  }

  const runtime = new ChineseResponseClaudeRuntime();
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: runtime, configurable: true });
  runtime.announce();
})();
