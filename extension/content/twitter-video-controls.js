(() => {
  const KEY = Symbol.for('cosmic-gemini.video-download.twitter-controls');
  if (globalThis[KEY]) { void globalThis[KEY].sync(); return; }
  if (window !== window.top || !/^(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com$/.test(location.hostname)) return;
  const records = new Map();
  const roots = new Set();
  let nextControl = 0;
  let observer, intersections, appearance, timer = 0, disposed = false, locale = 'en-US';
  const text = (en, zh) => locale.startsWith('zh') ? zh : en;
  function postUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (/^(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com$/.test(url.hostname)
        && /^\/(?:\w+|i\/web)\/status\/\d+(?:\/(?:video|photo)\/[1-9]\d*)?\/?$/.test(url.pathname)) return url.origin + url.pathname;
    } catch {}
    return '';
  }
  function target(player) {
    const article = player.closest('article[data-testid="tweet"]');
    if (!article) return null;
    // The attachment link or a nearer quoted-post container owns the video before the outer article.
    const attachment = player.closest('a[href*="/status/"]');
    let url = postUrl(attachment?.getAttribute('href'));
    let scope = article;
    for (let parent = player.parentElement; parent && parent !== article; parent = parent.parentElement) {
      if (parent.getAttribute('role') !== 'link') continue;
      const link = parent.querySelector('a[href*="/status/"]');
      const nestedUrl = postUrl(link?.getAttribute('href'));
      scope = parent;
      if (nestedUrl) url ||= nestedUrl;
      if (!url) return { controlId: records.get(player)?.controlId || '' };
      break;
    }
    if (!url) {
      const time = article.querySelector('a[href*="/status/"] time');
      url = postUrl(time?.closest('a')?.getAttribute('href'));
    }
    if (!url) return null;
    const players = [...scope.querySelectorAll('[data-testid="videoPlayer"]')].filter(item =>
      item.closest('article[data-testid="tweet"]') === article
      && (scope !== article || !item.closest('[role="link"]') || item.closest('[role="link"]') === article));
    return { postUrl: url, videoIndex: Math.max(0, players.indexOf(player)) };
  }
  function dark() {
    const style = getComputedStyle(document.body || document.documentElement);
    const rgb = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (rgb?.length >= 3 && (rgb.length < 4 || rgb[3] > .5)) return (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) < 128;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function updateAppearance() {
    const theme = dark() ? 'dark' : 'light';
    for (const record of records.values()) {
      record.host.dataset.theme = theme;
      record.button.title = text('Choose video quality', '选择视频清晰度');
      record.button.setAttribute('aria-label', record.button.title);
    }
  }
  function remove(player) {
    const record = records.get(player);
    if (!record) return;
    record.host.remove();
    if (player.dataset.cosmicGeminiVideoTarget === record.controlId) delete player.dataset.cosmicGeminiVideoTarget;
    if (record.positionChanged && player.style.position === 'relative') {
      if (record.position) player.style.setProperty('position', record.position, record.priority);
      else player.style.removeProperty('position');
    }
    intersections?.unobserve(player);
    records.delete(player);
  }
  function add(player) {
    if (disposed || records.has(player) || records.size >= 256 || !target(player)) return;
    const host = document.createElement('span');
    host.dataset.cosmicGeminiVideoControl = '';
    host.style.cssText = 'position:absolute!important;top:10px!important;right:10px!important;z-index:30!important;display:none;pointer-events:auto!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host{all:initial}button{box-sizing:border-box;display:grid;place-items:center;width:30px;height:30px;padding:4px;border:0;border-radius:5px;color:#0b57d0;background:rgba(255,255,255,.88);box-shadow:0 1px 4px #0003;cursor:pointer}
      :host([data-theme="dark"]) button{color:#98beff;background:rgba(28,31,36,.82)}
      button:hover{filter:brightness(1.12)}button:focus-visible{outline:2px solid currentColor;outline-offset:2px}button:disabled{opacity:.65;cursor:wait}svg{width:18px;height:18px;pointer-events:none}
      output{position:absolute;top:36px;right:0;max-width:220px;width:max-content;background:#202124;color:#fff;padding:8px 10px;border-radius:8px;font:12px/1.4 system-ui}output:empty{display:none}
    </style><button type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v14m-6-6 6 6 6-6M5 21h14"/></svg></button><output role="status"></output>`;
    const button = shadow.querySelector('button');
    const output = shadow.querySelector('output');
    const position = player.style.getPropertyValue('position');
    const priority = player.style.getPropertyPriority('position');
    const positionChanged = getComputedStyle(player).position === 'static';
    if (positionChanged) player.style.setProperty('position', 'relative');
    const controlId = `video-${Date.now().toString(36)}-${++nextControl}`;
    player.dataset.cosmicGeminiVideoTarget = controlId;
    const record = { host, button, position, priority, positionChanged, controlId };
    records.set(player, record);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) host.addEventListener(type, event => event.stopPropagation());
    host.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      if (!event.isTrusted || disposed || button.disabled) return;
      const chosen = target(player);
      if (!chosen) return;
      button.disabled = true;
      output.textContent = '';
      try {
        const response = await chrome.runtime.sendMessage({ type: 'CG_VIDEO_SELECT_TWITTER', pageUrl: location.href, ...chosen });
        if (!response?.ok) throw new Error('selection unavailable');
        if (!response.result?.popupOpened) output.textContent = text('Video selected. Open Cosmic Gemini from the toolbar.', '已选择视频，请从工具栏打开 Cosmic Gemini。');
      } catch { output.textContent = text('Could not select this video. Reopen Video Download and try again.', '暂时无法选择此视频，请重新打开 Video Download 后重试。'); }
      finally { button.disabled = false; }
    });
    player.append(host);
    intersections.observe(player);
  }
  function scan(root) {
    if (root.matches?.('[data-testid="videoPlayer"]')) add(root);
    for (const player of root.querySelectorAll?.('[data-testid="videoPlayer"]') || []) add(player);
  }
  function flush() {
    timer = 0;
    if (disposed) return;
    for (const player of records.keys()) if (!player.isConnected) remove(player);
    const pending = [...roots]; roots.clear();
    for (const root of pending) if (root.isConnected) scan(root);
    updateAppearance();
  }
  function stop() {
    disposed = true;
    clearTimeout(timer);
    observer?.disconnect(); intersections?.disconnect(); appearance?.disconnect();
    for (const player of records.keys()) remove(player);
    roots.clear();
    chrome.runtime.onMessage.removeListener(onMessage);
    if (globalThis[KEY] === api) delete globalThis[KEY];
  }
  async function sync() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CG_VIDEO_TWITTER_CONTROLS_STATE', pageUrl: location.href });
      if (disposed) return;
      if (!response?.ok || !response.result?.active) { stop(); return; }
      locale = response.result.locale || locale;
      if (!observer) {
        intersections = new IntersectionObserver(entries => {
          for (const entry of entries) {
            const record = records.get(entry.target);
            if (record) record.host.style.display = entry.isIntersecting ? 'block' : 'none';
          }
        }, { rootMargin: '200px' });
        observer = new MutationObserver(mutations => {
          for (const mutation of mutations) for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && !node.hasAttribute('data-cosmic-gemini-video-control') && roots.size < 128) roots.add(node);
          }
          if (!timer) timer = setTimeout(flush, 100);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        appearance = new MutationObserver(updateAppearance);
        for (const element of [document.documentElement, document.body].filter(Boolean)) {
          appearance.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-color-mode'] });
        }
      }
      scan(document);
      updateAppearance();
    } catch { stop(); }
  }
  function onMessage(message) {
    if (message?.type === 'CG_VIDEO_STOP') stop();
    if (message?.type === 'CG_VIDEO_TWITTER_CONTROLS') { locale = message.locale || locale; updateAppearance(); }
  }
  const api = { sync, stop };
  globalThis[KEY] = api;
  chrome.runtime.onMessage.addListener(onMessage);
  void sync();
})();
