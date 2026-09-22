import { acceptedStyles, formatStylesheet, DOCUMENT_DARK_TEXT } from './format-styles.js';
const ALLOWED = new Set('p h1 h2 h3 h4 h5 h6 strong em u s del sub sup br hr ul ol li table colgroup col thead tbody tfoot tr th td a img blockquote pre code span div dl dt dd'.split(' '));
const DROP = new Set('script style iframe frame object embed form input button textarea select meta link base svg math'.split(' '));

// Rebuild a fresh allowlisted tree. Never insert converter output directly.
export function safeDocumentHtml(html, formatting, parser = new DOMParser()) {
  const source = parser.parseFromString(html, 'text/html');
  const output = document.implementation.createHTMLDocument('');
  let count = 0;
  const styleCount = acceptedStyles(formatting).length;
  function copy(node, target, depth = 0) {
    if (++count > 150000 || depth > 80) throw Error('documentTooLarge');
    if (node.nodeType === 3) { target.append(output.createTextNode(node.textContent)); return; }
    if (node.nodeType !== 1 || DROP.has(node.localName)) return;
    let next = target;
    if (ALLOWED.has(node.localName)) {
      next = output.createElement(node.localName);
      const classes = (node.getAttribute('class') || '').split(/\s+/).filter(value => /^cg-f\d{1,4}$/.test(value)
        ? Number(value.slice(4)) < styleCount : ['cg-numbered','cg-list-marker','cg-page-break','cg-sheet','cg-row-number','cg-hidden','cg-slide','cg-shape','cg-slide-picture','cg-slide-background'].includes(value));
      if (classes.length) next.setAttribute('class', classes.slice(0,4).join(' '));
      if (classes.includes('cg-page-break')) next.setAttribute('role', 'separator');
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

export function previewSrcdoc(body, locale, formatting) {
  const kind = ['xlsx', 'pptx'].includes(formatting?.kind) ? formatting.kind : 'docx';
  return `<!doctype html><html lang="${locale === 'zh-CN' ? 'zh-CN' : 'en-US'}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
    html{color-scheme:light dark;background:#eceef1;color:#202124;font:11pt/1.4 'Aptos','Calibri','Arial','PingFang SC','Microsoft YaHei',sans-serif;overflow-wrap:anywhere}
    body{box-sizing:border-box;width:calc(100% - 40px);max-width:612pt;min-height:calc(100vh - 40px);margin:20px auto;padding:54pt;background:white;box-shadow:0 1px 5px #0002}
    p{margin:0 0 8pt;white-space:pre-wrap}p:empty::before{content:'\u00a0'}h1,h2,h3,h4,h5,h6{line-height:1.25;margin:16pt 0 8pt}h1{font-size:22pt}h2{font-size:18pt}h3{font-size:14pt}h4,h5,h6{font-size:12pt}img{max-width:100%;height:auto}
    table{border-collapse:collapse;max-width:100%;margin:8pt 0}td,th{border:1px solid #bfc3c8;padding:4pt 6pt;vertical-align:top;font-weight:inherit}td>p:last-child,th>p:last-child{margin-bottom:0}col{max-width:100%}
    a{color:#0b57d0}pre{white-space:pre-wrap}blockquote{border-left:3px solid #ccc;padding-left:16px;margin-left:0}.cg-list-marker{display:inline-block;white-space:pre;text-align:start}
    .cg-page-break{display:block;height:0;min-height:0;border:0;border-top:1px dashed #bfc3c8;margin:22px 0;clear:both;text-indent:0}
    @media(prefers-color-scheme:dark){html{background:#202124;color:${DOCUMENT_DARK_TEXT}}body{background:#292a2d}a{color:#a8c7fa}td,th,blockquote,.cg-page-break{border-color:#5f6368}}
    ${formatStylesheet(formatting)}
    @media(max-width:700px){body{width:100%;margin:0;min-height:100vh;padding:24px 18px;box-shadow:none}}
    body.cg-format-xlsx,body.cg-format-pptx{width:max-content;max-width:none;min-width:calc(100% - 40px);min-height:0;padding:0;background:transparent;box-shadow:none}
    .cg-sheet{background:white}.cg-sheet table{margin:0;max-width:none;table-layout:fixed;font-size:11pt}.cg-sheet td{min-width:54pt;white-space:pre-wrap}.cg-sheet th{background:#eef0f3;text-align:center;color:#5f6368;font-size:10pt;font-weight:400;position:sticky;top:0}.cg-sheet .cg-row-number{width:32pt}.cg-hidden{display:none}
    .cg-slide{position:relative;overflow:hidden;box-sizing:border-box;box-shadow:0 1px 5px #0002}.cg-shape{box-sizing:border-box;line-height:1.2}.cg-shape p{margin:0 0 5pt}.cg-shape table{width:100%;margin:0}.cg-slide-picture{display:block;width:100%;height:100%;max-width:none;object-fit:contain}.cg-slide-background{position:absolute;width:100%;height:100%;max-width:none;object-fit:cover}
    @media(prefers-color-scheme:dark){.cg-sheet{background:#292a2d}.cg-sheet th{background:#303238;color:#aeb4bc}}
    @media(max-width:700px){body.cg-format-xlsx,body.cg-format-pptx{min-width:100%;padding:0}}
    </style></head><body class="cg-format-${kind}">${body}</body></html>`;
}
