const ALLOWED = new Set('p h1 h2 h3 h4 h5 h6 strong em u s del sub sup br hr ul ol li table thead tbody tfoot tr th td a img blockquote pre code span div'.split(' '));
const DROP = new Set('script style iframe frame object embed form input button textarea select meta link base svg math'.split(' '));

// Rebuild a fresh allowlisted tree. Never insert converter output directly.
export function safeDocumentHtml(html, parser = new DOMParser()) {
  const source = parser.parseFromString(html, 'text/html');
  const output = document.implementation.createHTMLDocument('');
  let count = 0;
  function copy(node, target, depth = 0) {
    if (++count > 150000 || depth > 80) throw Error('documentTooLarge');
    if (node.nodeType === 3) { target.append(output.createTextNode(node.textContent)); return; }
    if (node.nodeType !== 1 || DROP.has(node.localName)) return;
    let next = target;
    if (ALLOWED.has(node.localName)) {
      next = output.createElement(node.localName);
      if (node.localName === 'a') {
        const href = node.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href)) { next.setAttribute('href', href); next.setAttribute('target', '_blank'); next.setAttribute('rel', 'noopener noreferrer'); }
        else if (/^#[\w:.-]+$/.test(href)) next.setAttribute('href', href);
      }
      if (node.localName === 'img') {
        const src = node.getAttribute('src') || '';
        if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return;
        next.setAttribute('src', src); next.setAttribute('alt', (node.getAttribute('alt') || '').slice(0, 2000));
      }
      const id = node.getAttribute('id');
      if (id && /^[\w:.-]{1,150}$/.test(id)) next.setAttribute('id', id);
      for (const attr of ['colspan', 'rowspan', 'start']) {
        const value = node.getAttribute(attr);
        if (value && /^\d{1,4}$/.test(value)) next.setAttribute(attr, String(Math.min(1000, Number(value))));
      }
      target.append(next);
    }
    for (const child of node.childNodes) copy(child, next, depth + 1);
  }
  for (const node of source.body.childNodes) copy(node, output.body);
  return output.body.innerHTML;
}

export function previewSrcdoc(body, locale) {
  return `<!doctype html><html lang="${locale === 'zh-CN' ? 'zh-CN' : 'en-US'}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
    html{color-scheme:light dark;background:#f1f3f4;color:#202124;font:16px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow-wrap:anywhere}body{box-sizing:border-box;max-width:860px;min-height:100vh;margin:0 auto;padding:40px 48px;background:white;box-shadow:0 2px 8px #0001}p{margin:0 0 1em}h1,h2,h3,h4{line-height:1.35;margin:1.3em 0 .6em}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%;margin:1em 0}td,th{border:1px solid #bfc3c8;padding:7px 10px;vertical-align:top}a{color:#0b57d0}pre{white-space:pre-wrap}blockquote{border-left:3px solid #ccc;padding-left:16px;margin-left:0}@media(max-width:600px){body{padding:24px 18px}}@media(prefers-color-scheme:dark){html{background:#202124;color:#e8eaed}body{background:#292a2d}a{color:#a8c7fa}td,th,blockquote{border-color:#5f6368}}
    </style></head><body>${body}</body></html>`;
}
