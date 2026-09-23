import { externalLinkTarget } from '../../shared/external-links-capture/target.js';
import { acceptedStyles, formatStylesheet, DOCUMENT_DARK_TEXT } from './format-styles.js';
const ALLOWED = new Set('p h1 h2 h3 h4 h5 h6 strong em u s del sub sup br hr ul ol li table colgroup col thead tbody tfoot tr th td a img blockquote pre code span div dl dt dd ruby rt rp'.split(' '));
const DROP = new Set('script style iframe frame object embed form input button textarea select meta link base svg'.split(' '));
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
const MATH = new Set('math mrow mi mn mo mtext mfrac msqrt mroot msub msup msubsup mover munder munderover mtable mtr mtd'.split(' '));
const MATH_ATTRIBUTES = {display:/^(?:inline|block)$/,mathvariant:/^(?:normal|italic|bold|bold-italic)$/,linethickness:/^0$/,fence:/^(?:true|false)$/,stretchy:/^(?:true|false)$/};

// Mail HTML often uses inline presentation attributes. Convert only passive
// visual declarations to the same validated, deduplicated classes as Office.
// Never retain source CSS, selectors, remote fonts or resource-bearing values.
function emailStyle(node) {
  if ((node.getAttribute('style') || '').length > 8192) return {};
  const css = node.style, result = {};
  const color = value => {
    if (/^#[\da-f]{6}$/i.test(value)) return value;
    const m = value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
    return m ? '#' + m.slice(1).map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('') : value;
  };
  for (const property of ['color','background-color','font-size','font-weight','font-style','font-family','text-align','text-indent','text-decoration-line','line-height','width','height','white-space','vertical-align',
    ...['top','bottom','left','right'].flatMap(side => ['padding-'+side,'margin-'+side,'border-'+side+'-width','border-'+side+'-style','border-'+side+'-color'])]) {
    let value = css?.getPropertyValue(property) || '';
    if (!value && property === 'text-align') value = node.getAttribute('align') || '';
    if (!value && property === 'background-color') value = node.getAttribute('bgcolor') || '';
    if (!value && ['width','height'].includes(property)) { const v=node.getAttribute(property)||'';value=/^\d+(?:\.\d+)?$/.test(v)?v+'px':v; }
    if (!value) continue;
    if (property.endsWith('color')) value = color(value);
    else if (/^-?\d+(?:\.\d+)?px$/.test(value)) value = Math.round(parseFloat(value)*.75*1000)/1000+'pt';
    else if (property === 'font-family') {
      const names=value.split(',').map(v=>v.trim().replace(/^['"]|['"]$/g,'')).filter(v=>/^[\p{L}\p{N} ._+-]{1,80}$/u.test(v)).slice(0,8);
      value=names.map(v=>'"'+v+'",').join('')+'sans-serif';
    } else if (property === 'font-weight') value = value === 'bold' ? '700' : value === 'normal' ? '400' : value;
    result[property] = value;
  }
  return acceptedStyles({styles:[result]})[0];
}

// Rebuild a fresh allowlisted tree. Never insert converter output directly.
export function safeDocumentHtml(html, formatting, parser = new DOMParser()) {
  const source = parser.parseFromString(html, 'text/html');
  const output = document.implementation.createHTMLDocument('');
  let count = 0;
  const styleCount = acceptedStyles(formatting).length;
  const mail = formatting?.kind === 'eml';
  const mailStyles = mail ? acceptedStyles(formatting) : [];
  const styleKey = value => JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
  const mailKeys = new Map(mailStyles.map((value,index)=>[styleKey(value),index]));
  function copy(node, target, depth = 0) {
    if (++count > 150000 || depth > 80) throw Error('documentTooLarge');
    if (node.nodeType === 3) { target.append(output.createTextNode(node.textContent)); return; }
    if (node.nodeType !== 1 || DROP.has(node.localName)) return;
    if (node.namespaceURI === MATH_NS) {
      if (!MATH.has(node.localName)) return;
      const next = output.createElementNS(MATH_NS, node.localName);
      for (const [key, pattern] of Object.entries(MATH_ATTRIBUTES)) {
        const value = node.getAttribute(key); if(value && pattern.test(value))next.setAttribute(key,value);
      }
      target.append(next);
      for(const child of node.childNodes)copy(child,next,depth+1);
      return;
    }
    // Do not allow foreign HTML inside a mathematical tree.
    if (target.namespaceURI === MATH_NS) return;
    let next = target;
    if (ALLOWED.has(node.localName)) {
      next = output.createElement(node.localName);
      const classes = (node.getAttribute('class') || '').split(/\s+/).filter(value => /^cg-f\d{1,4}$/.test(value)
        ? Number(value.slice(4)) < styleCount : ['cg-numbered','cg-list-marker','cg-list-content','cg-page-break','cg-sheet','cg-row-number','cg-hidden','cg-slide','cg-shape','cg-slide-picture','cg-slide-background'].includes(value));
      if (mail) {
        const style = emailStyle(node);
        if (Object.keys(style).length) {
          const key=styleKey(style);
          if (!mailKeys.has(key)) { if (mailStyles.length >= 8192) throw Error('documentTooComplex');mailKeys.set(key,mailStyles.length);mailStyles.push(style); }
          classes.unshift('cg-f'+mailKeys.get(key));
        }
      }
      if (classes.length) next.setAttribute('class', classes.slice(0,4).join(' '));
      if (classes.includes('cg-page-break')) next.setAttribute('role', 'separator');
      if (node.localName === 'a') {
        const href = node.getAttribute('href') || '';
        const external = externalLinkTarget(href);
        if (external) { next.setAttribute('href', '#'); next.setAttribute('data-external-link', external); }
        else if (/^#[\w:.-]+$/.test(href)) next.setAttribute('href', href);
      }
      if (node.localName === 'img') {
        const src = node.getAttribute('src') || '';
        if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return;
        next.setAttribute('src', src); next.setAttribute('alt', (node.getAttribute('alt') || '').slice(0, 2000));
      }
      const language = node.getAttribute('lang');
      if (language && /^[a-z]{2,8}(?:-[a-z\d]{1,8}){0,3}$/i.test(language)) next.setAttribute('lang', language);
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
  if (mail) formatting.styles = mailStyles;
  return output.body.innerHTML;
}

export function documentStyles(formatting) {
  return `
    html{color-scheme:light dark;background:#eceef1;color:#202124;font:11pt/1.4 'Aptos','Calibri','Arial','PingFang SC','Microsoft YaHei',sans-serif;overflow-wrap:anywhere}
    body{box-sizing:border-box;width:calc(100% - 40px);max-width:612pt;min-height:calc(100vh - 40px);margin:20px auto;padding:54pt;background:white;box-shadow:0 1px 5px #0002}
    p,h1,h2,h3,h4,h5,h6,li{white-space:break-spaces;tab-size:36pt}p{margin:0 0 8pt;min-height:1em}p:empty::before{content:'\u00a0'}h1,h2,h3,h4,h5,h6{line-height:1.25;margin:16pt 0 8pt}h1{font-size:22pt}h2{font-size:18pt}h3{font-size:14pt}h4,h5,h6{font-size:12pt}img{max-width:100%;height:auto}rt{white-space:pre-wrap}sup,sub{line-height:0}
    table{border-collapse:collapse;max-width:100%;margin:8pt 0}td,th{border:1px solid #bfc3c8;padding:4pt 6pt;vertical-align:top;font-weight:inherit}td>p:last-child,th>p:last-child{margin-bottom:0}col{max-width:100%}
    a{color:#0b57d0}pre{white-space:pre-wrap}blockquote{border-left:3px solid #ccc;padding-left:16px;margin-left:0}.cg-list-marker{display:inline-block;white-space:pre;text-align:start;box-sizing:border-box}.cg-numbered{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:baseline}.cg-list-content{min-width:0}math{white-space:normal}math[display=block]{overflow-x:auto;padding:8pt 0}mtext{white-space:break-spaces}
    .cg-page-break{display:block;height:0;min-height:0;border:0;border-top:1px dashed #bfc3c8;margin:22px 0;clear:both;text-indent:0}
    @media(prefers-color-scheme:dark){html{background:#202124;color:${DOCUMENT_DARK_TEXT}}body{background:#292a2d}a{color:#a8c7fa}td,th,blockquote,.cg-page-break{border-color:#5f6368}}
    ${formatStylesheet(formatting)}
    @media(max-width:700px){body{width:100%;margin:0;min-height:100vh;padding:24px 18px;box-shadow:none}}
    body.cg-format-xlsx,body.cg-format-pptx{width:max-content;max-width:none;min-width:calc(100% - 40px);min-height:0;padding:0;background:transparent;box-shadow:none}
    body.cg-format-xlsx{margin:0;min-width:100%}
    .cg-sheet{background:white}.cg-sheet table{margin:0;max-width:none;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:11pt}.cg-sheet td{min-width:54pt;white-space:pre-wrap}.cg-sheet th{background:#eef0f3;text-align:center;color:#5f6368;font-size:10pt;font-weight:400}.cg-sheet thead th{position:sticky;top:0;z-index:2}.cg-sheet tbody th{position:sticky;left:0;z-index:1}.cg-sheet thead th:first-child{left:0;z-index:3}.cg-sheet .cg-row-number{width:32pt}.cg-hidden{display:none}
    .cg-slide{position:relative;overflow:hidden;box-sizing:border-box;box-shadow:0 1px 5px #0002}.cg-shape{box-sizing:border-box;line-height:1.2}.cg-shape p{margin:0 0 5pt}.cg-shape table{width:100%;margin:0}.cg-slide-picture{display:block;width:100%;height:100%;max-width:none;object-fit:contain}.cg-slide-background{position:absolute;width:100%;height:100%;max-width:none;object-fit:cover}
    @media(prefers-color-scheme:dark){.cg-sheet{background:#292a2d}.cg-sheet th{background:#303238;color:#aeb4bc}}
    @media(max-width:700px){body.cg-format-xlsx,body.cg-format-pptx{min-width:100%;padding:0}}
    `;
}
