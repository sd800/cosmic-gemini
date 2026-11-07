// Injected on demand into the isolated world; no listeners exist before a capture.
export function showDocumentChoice(payload) {
  // This function is serialized into an isolated webpage world, including HTTP.
  function randomNonce() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  const key = Symbol.for('cosmic-gemini.document-preview.dialog');
  if (globalThis[key]) { globalThis[key].enqueue(payload); return true; }
  const queue = [payload];
  let host, current, closing = false;
  const previous = document.activeElement;
  const send = async (action, remember = false, previewNonce = undefined) => {
    const response = await chrome.runtime.sendMessage({ type: 'CG_DOCUMENT_CHOICE', featureId: 'documentPreview', id: current.id, action, remember, previewNonce });
    if (!response?.ok) throw Error();
    return response.result;
  };
  async function close() {
    if (closing) return;
    closing = true;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await host.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(3px)' }], { duration: 100 }).finished.catch(() => {});
    }
    host.remove(); host = null; closing = false;
    if (queue.length) render();
    else { delete globalThis[key]; previous?.focus?.({ preventScroll: true }); }
  }
  function render() {
    current = queue.shift();
    const { labels } = current;
    host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host{color-scheme:light dark;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--bg:#fff;--text:#202124;--muted:#5f6368;--line:#dadce0;--blue:#0b57d0;--raised:#f6f8fc}
      *{box-sizing:border-box;letter-spacing:normal}dialog{position:fixed;inset:0;margin:auto;width:min(380px,calc(100vw - 28px));max-height:calc(100vh - 32px);overflow:auto;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--bg);color:var(--text);box-shadow:0 12px 38px #0003;font:inherit}dialog::backdrop{background:#0002}
      header{display:flex;align-items:center;gap:9px}header svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}strong{font-size:15px}button{font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;min-height:36px;border:1px solid var(--line);border-radius:8px;padding:8px 15px;background:var(--bg);color:var(--text)}button:hover{background:var(--raised)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--blue);outline-offset:3px}.close{margin-left:auto;border:0;min-height:26px;padding:2px 6px;color:var(--muted);font-size:20px}.name{overflow-wrap:anywhere;white-space:pre-wrap;margin:16px 0 0;user-select:text}.size{margin:4px 0 0;color:var(--muted);font-size:12px}label{display:flex;align-items:flex-start;gap:8px;margin-top:18px;font-size:13px;color:var(--muted)}input{accent-color:var(--blue);margin:3px 0 0;flex-shrink:0}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.primary{background:var(--blue);color:#fff;border-color:var(--blue)}.primary:hover{background:var(--blue);filter:brightness(.95)}.error{color:var(--muted);font-size:12px;margin:9px 0 0}.error:empty{display:none}
      .progress{flex:1;min-width:20px;max-width:120px;height:3px;align-self:center;margin-right:auto;visibility:hidden;border-radius:3px;overflow:hidden;background:var(--line)}.progress span{display:block;width:38%;height:100%;background:var(--blue);animation:dp-loading 1.25s ease-in-out infinite;animation-play-state:paused}.progress[aria-hidden=false]{visibility:visible}.progress[aria-hidden=false] span{animation-play-state:running}@keyframes dp-loading{from{transform:translateX(-100%)}to{transform:translateX(365%)}}[hidden]{display:none}@media(prefers-reduced-motion:reduce){.progress span{animation:none;width:100%;opacity:.6}}
      @media(prefers-color-scheme:dark){:host{--bg:#202124;--text:#f1f3f4;--muted:#bdc1c6;--line:#4a4d52;--blue:#4f86df;--raised:#292a2d}}
      @media(prefers-reduced-motion:no-preference){dialog{animation:dp-in 120ms ease-out}@keyframes dp-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}}
    `);
    shadow.adoptedStyleSheets = [sheet];
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', labels.title);
    const element = (tag, text, className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
    const heading = element('header', '');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h6'); icon.append(path);
    const dismiss = element('button', '×', 'close'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', labels.close);
    heading.append(icon, element('strong', labels.title), dismiss);
    dialog.append(heading, element('p', current.filename, 'name'));
    if (current.size > 0) dialog.append(element('p', current.sizeLabel, 'size'));
    const label = element('label', ''), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    label.append(checkbox, element('span', labels.remember)); dialog.append(label);
    const footer = element('footer', ''), preview = element('button', labels.preview, 'primary'), download = element('button', labels.download);
    preview.type = download.type = 'button';
    const error = element('p', '', 'error'); error.setAttribute('role', 'status');
    const progress = element('div', '', 'progress'); progress.setAttribute('aria-hidden', 'true');
    progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', labels.loading);
    progress.append(element('span', '')); footer.append(progress, preview, download); dialog.append(footer, error);
    let busy = false;
    async function choose(action) {
      if (busy) return;
      busy = true; preview.disabled = download.disabled = checkbox.disabled = true;
      error.textContent = ''; progress.setAttribute('aria-hidden', 'false'); preview.setAttribute('aria-busy', String(action === 'preview'));
      let target, nonce;
      if (action === 'preview' && current.url) {
        try {
          const url = new URL(current.url);
          if (url.origin === location.origin && /^https?:$/.test(url.protocol) && !url.username && !url.password) {
            target = window.open('about:blank', '_blank');
            if (target) {
              nonce = randomNonce(); target.name = 'cosmic-gemini-document:' + nonce;
              target.document.open();
              target.document.write('<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="darkreader-lock"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src chrome-extension:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>Document Preview</title><style>html{color-scheme:light dark;background:light-dark(#faf9f7,#171819);color:light-dark(#24272b,#e3e5e8);font:16px/1.5 system-ui}body{margin:0}p{padding:36px}</style><p id="loading"></p>');
              target.document.close();
              // Commit the initial history item so Chrome updates its visible
              // address too; replacing the blank item only updates internal URLs.
              target.history.pushState(null, '', url.href);
              target.document.documentElement.dataset.cgDocumentPreviewShell = 'true';
              target.document.title = current.filename + ' · Document Preview';
              const dark = current.appearance === 'dark' || current.appearance !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches;
              target.document.documentElement.style.background = dark ? '#171819' : '#faf9f7';
              target.document.documentElement.style.color = dark ? '#e3e5e8' : '#24272b';
              target.document.getElementById('loading').textContent = labels.loading;
              target.opener = null;
            }
          }
        } catch { try { target?.close(); } catch {} target = null; nonce = undefined; }
      }
      const closeTarget = () => { try { if (target?.location.href === current.url && target.name === 'cosmic-gemini-document:' + nonce
        && target.document.documentElement.dataset.cgDocumentPreviewShell === 'true') target.close(); } catch {} };
      try { const result = await send(action, checkbox.checked, nonce); if (!result?.urlPreview) closeTarget(); await close(); }
      catch { closeTarget(); error.textContent = labels.failed; progress.setAttribute('aria-hidden', 'true'); preview.removeAttribute('aria-busy'); busy = false; preview.disabled = download.disabled = checkbox.disabled = false; }
    }
    preview.onclick = () => void choose('preview'); download.onclick = () => void choose('download');
    const cancel = () => { if (!busy) { void send('dismiss').catch(() => {}); void close(); } };
    dismiss.onclick = cancel;
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    dialog.addEventListener('pointerdown', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) cancel();
    });
    shadow.append(dialog); (document.body || document.documentElement).append(host); dialog.showModal(); preview.focus();
  }
  globalThis[key] = { enqueue(value) { queue.push(value); } };
  try { render(); return true; }
  catch { host?.remove(); delete globalThis[key]; return false; }
}
