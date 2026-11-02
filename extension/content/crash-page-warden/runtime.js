(() => {
  const state = globalThis[Symbol.for('cosmic-gemini.crash-page-warden.static')];
  if (!state?.started || state.rendering) return;
  state.rendering = true;
  const parser = globalThis[Symbol.for('cosmic-gemini.crash-page-warden.extract')];
  const element = (tag, text = '', className = '') => {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className; return node;
  };
  async function copy(text, button, label) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const input = element('textarea', text, 'cg-warden-clipboard'); document.body.append(input);
      input.select(); try { document.execCommand('copy'); } finally { input.remove(); }
    }
    if (button && label) { const original = button.textContent; button.textContent = label; setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1200); }
  }
  async function render() {
    let options = null;
    try { const reply = await state.reply; options = reply?.ok && reply.result?.active ? reply.result : null; } catch {}
    // Registration and the response CSP already started protection for this
    // document. A concurrent off choice applies to subsequent reloads.
    const labels = options?.labels || { copy: 'Copy page link', copied: 'Copied', smaller: 'Smaller text', larger: 'Larger text', fallback: 'Available page content', contact: 'Copy' };
    let article;
    try { article = parser.extract(document); }
    catch { article = { title: document.title || location.hostname, byline: '', base: location.href, published: '', fallback: true, source: document.body || document.documentElement }; }
    const content = parser.rebuild(article, document);
    const root = document.documentElement;
    root.removeAttribute('data-cg-warden-theme');
    for (const name of ['class', 'style']) root.removeAttribute(name);
    for (const attribute of [...root.attributes]) if (/^on/i.test(attribute.name)) root.removeAttribute(attribute.name);
    if (/^\d{1,3} \d{1,3} \d{1,3}$/.test(options?.whiteRGB || '')) root.style.setProperty('--cg-warden-white', options.whiteRGB);
    root.lang = article.lang || options?.locale || 'en-US';
    root.dir = article.dir === 'rtl' ? 'rtl' : 'ltr';
    const head = document.head || document.createElement('head');
    // Retain our restrictive meta policy while discarding refresh, preloads,
    // source styles, and other presentation left by the original document.
    const policy = [...head.querySelectorAll('meta[http-equiv]')].find(node => node.httpEquiv.toLowerCase() === 'content-security-policy');
    const lock = state.lock || element('meta'); lock.name = 'darkreader-lock'; state.lock = lock;
    const charset = element('meta'); charset.setAttribute('charset', 'utf-8');
    const scheme = element('meta'); scheme.name = 'color-scheme'; scheme.content = 'light dark';
    const title = element('title', article.title);
    head.replaceChildren(...(policy ? [policy] : []), charset, scheme, lock, title);
    if (!document.head) root.prepend(head);
    const body = element('body'); body.id = 'cg-warden-root'; body.dataset.textSize = 'normal';
    const toolbar = element('header', '', 'cg-warden-toolbar');
    const site = element('span', location.hostname.replace(/^www\./i, ''), 'cg-warden-site');
    const actions = element('div', '', 'cg-warden-actions');
    const smaller = element('button', 'A−'), larger = element('button', 'A+'), copyLink = element('button', labels.copy);
    smaller.type = larger.type = copyLink.type = 'button';
    smaller.setAttribute('aria-label', labels.smaller); larger.setAttribute('aria-label', labels.larger);
    let size = 1; const sizes = ['small', 'normal', 'large', 'larger'];
    const resize = delta => { size = Math.min(3, Math.max(0, size + delta)); body.dataset.textSize = sizes[size]; smaller.disabled = size === 0; larger.disabled = size === 3; };
    smaller.addEventListener('click', () => resize(-1)); larger.addEventListener('click', () => resize(1));
    copyLink.addEventListener('click', () => { void copy(location.href, copyLink, labels.copied); });
    actions.append(smaller, larger, copyLink); toolbar.append(site, actions);
    const main = element('main', '', 'cg-warden-article');
    main.append(element('h1', article.title));
    const metadata = element('p', '', 'cg-warden-metadata');
    if (article.byline) metadata.append(element('span', article.byline));
    if (article.published && Number.isFinite(Date.parse(article.published))) {
      const time = element('time', new Intl.DateTimeFormat(options?.locale || 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(article.published)));
      time.dateTime = article.published; metadata.append(time);
    }
    if (metadata.childNodes.length) main.append(metadata);
    if (article.fallback) main.append(element('p', labels.fallback, 'cg-warden-note'));
    main.append(content); body.append(toolbar, main);
    let contact;
    const dismiss = () => { contact?.remove(); contact = null; };
    body.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (link?.dataset.cgWardenTarget) {
        event.preventDefault();
        document.getElementById(link.dataset.cgWardenTarget)?.scrollIntoView({ block: 'start' });
        history.replaceState(null, '', '#' + encodeURIComponent(link.dataset.cgWardenFragment));
        dismiss(); return;
      }
      if (!link || !/^(?:mailto|tel|sms):/i.test(link.href)) { if (!contact?.contains(event.target)) dismiss(); return; }
      event.preventDefault(); event.stopPropagation(); dismiss();
      contact = element('div', '', 'cg-warden-contact'); contact.setAttribute('role', 'dialog');
      const value = element('p', link.href); const button = element('button', labels.contact); button.type = 'button';
      button.addEventListener('click', () => { void copy(link.href, button, labels.copied); }); contact.append(value, button); body.append(contact);
    });
    body.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
    // document_start can precede the parser's own head node. Replace the whole
    // root contents so a second source head or stray active node cannot remain.
    root.replaceChildren(head, body);
    root.dataset.cgWarden = 'ready'; state.ready = true;
    state.lockDarkReader?.();
    if (location.hash) {
      let id = ''; try { id = decodeURIComponent(location.hash.slice(1)); } catch {}
      const anchor = content.querySelector('[data-cg-warden-anchor="current"]') || document.getElementById(id);
      anchor?.scrollIntoView({ block: 'start' });
    }
  }
  const ready = () => { void render().catch(() => { document.documentElement.dataset.cgWarden = 'ready'; }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
