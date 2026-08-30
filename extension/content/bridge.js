(() => {
  const EVENTS = {
    nativeScroll: {
      ready: 'cosmic-gemini:native-scroll:bridge-ready',
      mainReady: 'cosmic-gemini:native-scroll:main-ready',
      configure: 'cosmic-gemini:native-scroll:configure',
      intervened: 'cosmic-gemini:native-scroll:suppressed'
    },
    noAutoplay: {
      ready: 'cosmic-gemini:no-autoplay:bridge-ready',
      mainReady: 'cosmic-gemini:no-autoplay:main-ready',
      configure: 'cosmic-gemini:no-autoplay:configure',
      intervened: 'cosmic-gemini:no-autoplay:intervened',
      audioBlocked: 'cosmic-gemini:no-autoplay:audio-blocked'
    }
  };
  const tokens = { nativeScroll: '', noAutoplay: '' };
  let promptHost = null;
  let promptLocale = (chrome.i18n.getUILanguage() || navigator.language || 'en-US').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';

  function locale() {
    return promptLocale;
  }

  function copy() {
    if (locale() === 'zh-CN') {
      return {
        question: '允许此网站自动播放声音吗？',
        continueBlocking: '继续拦截',
        allowOnce: '本次允许',
        alwaysAllow: '永久允许',
        label: 'No Autoplay 声音播放选项'
      };
    }
    return {
      question: 'Allow this site to autoplay sound?',
      continueBlocking: 'Continue blocking',
      allowOnce: 'Allow this time',
      alwaysAllow: 'Always allow',
      label: 'No Autoplay sound options'
    };
  }

  function dispatchConfig(featureId, config) {
    const token = tokens[featureId];
    if (!token) return;
    window.dispatchEvent(new CustomEvent(EVENTS[featureId].configure, {
      detail: JSON.stringify({ token, config })
    }));
  }

  async function requestConfig() {
    if (!tokens.nativeScroll && !tokens.noAutoplay) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_PAGE_STATE' });
      if (!response?.ok) throw new Error(response?.error || 'Unable to load Cosmic Gemini.');
      if (tokens.nativeScroll) dispatchConfig('nativeScroll', response.result.nativeScroll);
      if (tokens.noAutoplay) dispatchConfig('noAutoplay', response.result.noAutoplay);
      await Promise.allSettled(Object.keys(tokens).filter(featureId => tokens[featureId]).map(featureId =>
        chrome.runtime.sendMessage({
          type: 'CG_CONFIG_APPLIED',
          featureId,
          active: response.result[featureId].active
        })));
    } catch {}
  }

  async function decideAudio(decision) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_AUDIO_DECISION', decision });
      if (response?.ok && response.result) dispatchConfig('noAutoplay', response.result);
    } catch {}
    promptHost?.remove();
    promptHost = null;
  }

  function showAudioPrompt() {
    if (promptHost?.isConnected || !document.documentElement) return;
    const text = copy();
    promptHost = document.createElement('div');
    promptHost.setAttribute('data-cosmic-gemini-audio-prompt', '');
    promptHost.lang = locale();
    const shadow = promptHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial;position:fixed;z-index:2147483647;top:18px;right:18px;--surface:#fff;--surface-raised:#f5f7fa;--text:#202124;--line:#dfe3e8;--link:#0b57d0;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:normal}
      .panel{box-sizing:border-box;width:min(360px,calc(100vw - 36px));padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--text);box-shadow:0 10px 32px #0003}
      h2{margin:0 0 14px;font:650 14px/1.45 inherit;letter-spacing:inherit}
      .buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      button{min-height:36px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:transparent;color:inherit;font:600 12px/1.3 inherit;letter-spacing:inherit;cursor:pointer}
      button:hover{background:var(--surface-raised)}
      button:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}
      .primary{border-color:#0b57d0;background:#0b57d0;color:#fff}
      .primary:hover{background:#0949b1}
      .always{width:100%;margin-top:8px;border:0;color:var(--link)}
      :host(:lang(zh-CN)){letter-spacing:.04em}
      @media(prefers-color-scheme:dark){:host{--surface:#202124;--surface-raised:#2b2d31;--text:#f1f3f4;--line:#454950;--link:#8ab4f8}}
    `;
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', text.label);
    const heading = document.createElement('h2');
    heading.textContent = text.question;
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const block = document.createElement('button');
    block.type = 'button';
    block.textContent = text.continueBlocking;
    const once = document.createElement('button');
    once.type = 'button';
    once.className = 'primary';
    once.textContent = text.allowOnce;
    const always = document.createElement('button');
    always.type = 'button';
    always.className = 'always';
    always.textContent = text.alwaysAllow;
    block.addEventListener('click', () => void decideAudio('continue'));
    once.addEventListener('click', () => void decideAudio('temporary'));
    always.addEventListener('click', () => void decideAudio('permanent'));
    buttons.append(block, once);
    panel.append(heading, buttons, always);
    shadow.append(style, panel);
    document.documentElement.append(promptHost);
  }

  for (const featureId of Object.keys(EVENTS)) {
    const events = EVENTS[featureId];
    window.addEventListener(events.mainReady, event => {
      if (typeof event.detail !== 'string' || !event.detail) return;
      tokens[featureId] = event.detail;
      void requestConfig();
    }, true);
    window.addEventListener(events.intervened, event => {
      if (!tokens[featureId] || event.detail !== tokens[featureId]) return;
      void chrome.runtime.sendMessage({ type: 'CG_FEATURE_INTERVENED', featureId }).catch(() => {});
    }, true);
  }

  window.addEventListener(EVENTS.noAutoplay.audioBlocked, event => {
    if (!tokens.noAutoplay || event.detail !== tokens.noAutoplay) return;
    void chrome.runtime.sendMessage({ type: 'CG_AUDIO_BLOCKED' }).then(response => {
      if (response?.ok && response.result?.showPrompt) showAudioPrompt();
    }).catch(() => {});
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'CG_REFRESH_CONFIG') void requestConfig();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (Object.hasOwn(changes, 'cosmicGeminiSettings') || Object.hasOwn(changes, 'interfaceLocale'))) {
      if (Object.hasOwn(changes, 'interfaceLocale')) {
        const value = changes.interfaceLocale.newValue;
        promptLocale = typeof value === 'string' && value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
      }
      void requestConfig();
    }
  });

  void chrome.storage.local.get('interfaceLocale').then(stored => {
    if (stored.interfaceLocale) promptLocale = stored.interfaceLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  }).catch(() => {});

  window.dispatchEvent(new CustomEvent(EVENTS.nativeScroll.ready));
  window.dispatchEvent(new CustomEvent(EVENTS.noAutoplay.ready));
})();
