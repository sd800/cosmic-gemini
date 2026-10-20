import { formatDocumentBytes, DOCUMENT_LIMIT } from '../../core/document-preview/document-preview.js';
import { EMAIL_FIELDS, EMAIL_HELP } from './email-labels.js';
import { emailInfoTokens } from './email-info.js';

const EMAIL_LABELS=new Set(Object.keys(EMAIL_FIELDS));

// Split only outside comments, quoted strings, and address literals. The raw
// header view remains unchanged; this is a reading layout for individual hops.
function headerBreaks(value) {
  let depth=0, quoted=false, escaped=false, literal=0;
  const breaks=[], semicolons=[];
  for(let i=0;i<value.length;i++) {
    const c=value[i];
    if(escaped){escaped=false;continue;}
    if(c==='\\'&&(depth||quoted)){escaped=true;continue;}
    if(!quoted&&c==='('){depth++;continue;}
    if(depth){if(c===')')depth--;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(quoted)continue;
    if(c==='['){literal++;continue;}if(c===']'){literal=Math.max(0,literal-1);continue;}if(literal)continue;
    if(c===';'){semicolons.push(i);continue;}
    if(i>0&&/\s/.test(value[i-1])&&/^(?:from|by|via|with|id|for)\s/i.test(value.slice(i,i+10)))breaks.push(i);
  }
  return {breaks,semicolons};
}
export function receivedParts(value) {
  const {breaks,semicolons}=headerBreaks(value), separator=semicolons.at(-1)??-1;
  const end=separator<0?value.length:separator;
  const starts=[0,...breaks.filter(i=>i<end),end];
  return {route:starts.slice(0,-1).map((start,i)=>value.slice(start,starts[i+1]).trim()).filter(Boolean).join('\n'),
    date:separator<0?'':value.slice(separator+1).trim()};
}

const CLAUSE_HEADERS=new Set(['Authentication-Results','ARC-Authentication-Results','Received-SPF','DKIM-Signature','ARC-Seal','ARC-Message-Signature','Content-Type','Content-Disposition']);
export function formatEmailHeader(name,value) {
  if(['References','In-Reply-To'].includes(name))return value.replace(/>\s+</g,'>\n<');
  if(!CLAUSE_HEADERS.has(name))return value.replace(/\n\n/g,'\n');
  return value.split('\n\n').map(header=>{
    const positions=[0,...headerBreaks(header).semicolons.map(i=>i+1),header.length];
    return positions.slice(0,-1).map((start,i)=>header.slice(start,positions[i+1]).trim()).filter(Boolean).join('\n');
  }).join('\n\n');
}

// Only trusted UI elements added after sanitization carry these markers.
export function localizeEmail(locale, labels, root=document) {
  if(!['en-US','zh-CN'].includes(locale)||!labels||typeof labels!=='object')return;
  const regions=[...root.body.children].filter(element=>element.classList.contains('cg-email-header')||element.classList.contains('cg-email-attachments'));
  for(const region of regions) {
    for(const element of region.querySelectorAll('[data-email-label]')) {
      const key=element.dataset.emailLabel,value=labels[key];
      if(EMAIL_LABELS.has(key)&&typeof value==='string'&&value.length<=256)element.textContent=value;
    }
    for(const element of region.querySelectorAll('[data-email-hint]')) {
      const keys=element.dataset.emailHint.split('|').slice(0,3), values=keys.map(key=>Object.hasOwn(EMAIL_HELP,key)?labels.hints?.[key]:null);
      if(values.every(value=>typeof value==='string'&&value.length<=512))element.textContent=element.dataset.emailTerm+' – '+values.join(' ');
    }
    for(const element of region.querySelectorAll('[data-email-date]'))element.textContent=formatEmailDate(element.dataset.emailDate,locale);
    for(const element of region.querySelectorAll('[data-email-size]')) {
      const size=Number(element.dataset.emailSize);
      if(Number.isSafeInteger(size)&&size>=0&&size<=DOCUMENT_LIMIT)element.textContent=formatDocumentBytes(size,locale);
    }
  }
}

// Preserve the message's own explicit offset, rather than silently changing its
// wall-clock time to the device zone. Unknown/invalid dates remain plain text.
export function formatEmailDate(value, locale) {
  if (typeof value !== 'string' || value.length > 256) return value;
  const clean=value.trim(), zone=/(Z|UTC|GMT|[+-]\d{2}:?\d{2})(?:\s*\([^)]*\))?$/i.exec(clean);
  const timestamp=Date.parse(clean);
  if (!zone || !Number.isFinite(timestamp)) return value;
  let offset=0, suffix='UTC';
  if (/^[+-]/.test(zone[1])) {
    const parts=/^([+-])(\d{2}):?(\d{2})$/.exec(zone[1]), hour=Number(parts[2]), minute=Number(parts[3]);
    if (hour>23 || minute>59) return value;
    offset=(hour*60+minute)*(parts[1]==='-'?-1:1);
    if (offset) suffix+=''+parts[1]+hour+(minute?':'+parts[3]:'');
  }
  const date=new Date(timestamp+offset*60000);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale==='zh-CN'?'zh-CN':'en-US',{
    year:'numeric',month:locale==='zh-CN'?'long':'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:'UTC'
  }).format(date)+' ('+suffix+')';
}

// Added only after sanitizing the message body: source HTML cannot impersonate
// the envelope or attachment UI, and none of these fields is treated as HTML.
export function wrapEmail(output, mail, bodyClass) {
  if (!mail || !Array.isArray(mail.fields) || mail.fields.length > 16
    || !Array.isArray(mail.attachments) || mail.attachments.length > 2000) throw Error('invalidDocument');
  let textSize=0;
  const text = (value, limit=65536) => {
    if (typeof value !== 'string' || value.length > limit) throw Error('invalidDocument');
    if ((textSize+=value.length)>1024*1024) throw Error('documentTooComplex');
    return value;
  };
  const node = (tag, name, value) => {
    const element = output.createElement(tag); element.className = name;
    if (value !== undefined) element.textContent = text(value);
    return element;
  };
  const label=(element,key)=>{if(EMAIL_LABELS.has(key))element.dataset.emailLabel=key;return element;};
  const date=(element,value)=>{if(value.length<=256)element.dataset.emailDate=value;return element;};
  const header = node('div','cg-email-header');
  const subject=node('h1','cg-email-subject',mail.subject);
  if(mail.emptySubject===true)label(subject,'noSubject');header.append(subject);
  const fields = node('dl','cg-email-fields');
  for (const field of mail.fields) {
    const value=text(field.value);
    const content=node('dd','cg-email-value',field.date===true?formatEmailDate(value,mail.locale):value);
    if(field.date===true)date(content,value);
    fields.append(label(node('dt','cg-email-label',field.label),field.key),content);
  }
  if (fields.childNodes.length) header.append(fields);
  let termIndex=0;
  const term=(value,keys,tag='span',name='')=>{
    const element=node(tag,'cg-email-term '+name), hint=node('span','cg-email-term-hint',value);
    hint.id='cg-email-term-'+(++termIndex);hint.setAttribute('role','tooltip');hint.dataset.emailHint=keys.join('|');hint.dataset.emailTerm=value;
    element.tabIndex=0;element.setAttribute('aria-describedby',hint.id);element.append(node('span','cg-email-term-name',value),hint);return element;
  };
  const appendValue=(target,name,value)=>{
    let end=0;const tokens=emailInfoTokens(name,value);
    if(tokens.length>4000)throw Error('documentTooComplex');
    for(const token of tokens) {
      if(token.start<end)continue;
      target.append(output.createTextNode(value.slice(end,token.start)),term(value.slice(token.start,token.end),token.keys));end=token.end;
    }
    target.append(output.createTextNode(value.slice(end)));
  };
  const detailFields = entries => {
    if (!Array.isArray(entries) || entries.length>32) throw Error('invalidDocument');
    const list=node('dl','cg-email-fields cg-email-detail-fields');
    for (const entry of entries) {
      const value=text(entry.value), content=node('dd','cg-email-value');
      if(entry.label==='Received') {
        content.classList.add('cg-email-received');const hops=value.split('\n\n');
        if(hops.length>2000)throw Error('documentTooComplex');
        for(const hop of hops) {
          const parts=receivedParts(hop), item=node('div','cg-email-hop'), route=node('div','cg-email-hop-route');
          for(const line of parts.route.split('\n')){const row=node('div','');appendValue(row,'route',line);route.append(row);}
          item.append(route);
          if(parts.date)item.append(date(node('div','cg-email-hop-time',formatEmailDate(parts.date,mail.locale)),parts.date));
          content.append(item);
        }
      } else if(entry.label==='Resent-Date') {
        for(const item of value.split('\n\n'))content.append(date(node('div','',formatEmailDate(item,mail.locale)),item));
      } else appendValue(content,entry.label,formatEmailHeader(entry.label,value));
      const title=Object.hasOwn(EMAIL_HELP,entry.label)?term(entry.label,[entry.label],'dt','cg-email-label'):node('dt','cg-email-label',entry.label);
      if(title.firstElementChild)label(title.firstElementChild,entry.label);else title.title=entry.label;
      list.append(title,content);
    }
    return list;
  };
  const disclosure = (name,label) => {
    const section=node('details','cg-email-disclosure '+name);
    const key=name==='cg-email-details'?'details':'rawHeaders';
    const summary=node('summary','cg-email-summary',label);summary.dataset.emailLabel=key;section.append(summary);
    return section;
  };
  const inspector=node('div','cg-email-inspector');
  if (mail.details) {
    const details=mail.details;
    if (!Array.isArray(details.groups) || details.groups.length>8 || !Array.isArray(details.attachments) || details.attachments.length>2000) throw Error('invalidDocument');
    if (details.groups.length || details.attachments.length) {
      const section=disclosure('cg-email-details',details.label), content=node('div','cg-email-detail-content');
      for (const group of details.groups) content.append(label(node('h2','cg-email-detail-heading',group.label),group.key),detailFields(group.fields));
      if (details.attachments.length) {
        content.append(label(node('h2','cg-email-detail-heading',details.attachmentsLabel),'attachments'));
        for (const attachment of details.attachments) content.append(node('h3','cg-email-detail-name',attachment.name),detailFields(attachment.fields));
      }
      section.append(content);inspector.append(section);
    }
  }
  if (mail.rawHeaders) {
    const value=text(mail.rawHeaders.value,131072);
    if (value) {
      const section=disclosure('cg-email-raw',mail.rawHeaders.label), pre=node('pre','cg-email-raw-text');
      pre.textContent=value;section.append(pre);inspector.append(section);
    }
  }
  if(inspector.childNodes.length)header.append(inspector);
  const body = node('div','cg-email-body' + (mail.plain === true ? ' cg-email-plain' : ''));
  if (bodyClass) body.classList.add(bodyClass);
  while (output.body.firstChild) body.append(output.body.firstChild);
  output.body.append(header,body);
  if (mail.attachments.length) {
    const section = node('div','cg-email-attachments'), heading = node('h2','cg-email-attachments-title');
    heading.append(label(node('span','',mail.attachmentsLabel),'attachments'));
    heading.append(node('span','cg-email-attachment-count',String(mail.attachments.length)));
    const list = node('ul','cg-email-attachment-list');
    for (const attachment of mail.attachments) {
      const row = node('li','cg-email-attachment'), icon = node('span','cg-email-attachment-icon');
      icon.setAttribute('aria-hidden','true');
      const info = node('div','cg-email-attachment-info');
      info.append(node('span','cg-email-attachment-name',attachment.name));
      if (Number.isSafeInteger(attachment.size) && attachment.size >= 0 && attachment.size <= DOCUMENT_LIMIT) {
        const size=node('span','cg-email-attachment-size',formatDocumentBytes(attachment.size,mail.locale === 'zh-CN' ? 'zh-CN' : 'en-US'));
        size.dataset.emailSize=String(attachment.size);info.append(size);
      }
      row.append(icon,info); list.append(row);
    }
    section.append(heading,list); output.body.append(section);
  }
}

export const emailStyles = `
  body.cg-format-eml{width:calc(100% - 48px);max-width:960px;min-height:0;margin:24px auto;padding:0;border:1px solid #dce0e5;border-radius:12px;box-shadow:0 2px 12px #00000008;font:15px/1.65 Arial,'PingFang SC','Microsoft YaHei',sans-serif}
  .cg-email-header{padding:26px 30px 12px;border-bottom:1px solid #e2e5e9}
  .cg-email-subject{margin:0 0 20px;font-size:24px;line-height:1.4;font-weight:700;white-space:normal;overflow-wrap:anywhere}
  .cg-email-fields{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:9px 18px;margin:0}
  .cg-email-label{color:#687079;font-size:14px}.cg-email-value{margin:0;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
  .cg-email-inspector{margin-top:12px}
  .cg-email-summary{width:fit-content;max-width:100%;padding:3px 0;font-size:14px;color:#59616c;cursor:pointer;overflow-wrap:anywhere}
  .cg-email-summary::marker{font-size:.8em}.cg-email-summary:hover{color:#0b57d0}.cg-email-summary:focus-visible{outline:2px solid #0b57d0;outline-offset:3px;border-radius:3px}
  .cg-email-detail-content{padding:0 0 14px;font-size:14px}.cg-email-detail-heading{margin:18px 0 12px;font-size:15px;line-height:1.5}
  .cg-email-detail-heading:first-child{margin-top:10px}
  .cg-email-detail-fields{grid-template-columns:minmax(110px,165px) minmax(0,1fr);gap:8px 16px}.cg-email-detail-fields .cg-email-label{overflow-wrap:anywhere}
  .cg-email-detail-name{margin:16px 0 10px;font-size:14px;line-height:1.5;white-space:normal;overflow-wrap:anywhere}
  .cg-email-term{position:relative;align-self:start;cursor:help}.cg-email-term-name{text-decoration:underline dotted #aeb4bc;text-underline-offset:3px}
  .cg-email-term-hint{position:absolute;left:0;top:calc(100% + 5px);z-index:5;box-sizing:border-box;width:280px;max-width:calc(100vw - 48px);padding:10px 12px;border:1px solid #dce0e5;border-radius:7px;background:#fff;color:#202124;box-shadow:0 3px 14px #0002;font-size:13px;line-height:1.55;white-space:normal;visibility:hidden;opacity:0;pointer-events:none}
  .cg-email-term:hover>.cg-email-term-hint,.cg-email-term:focus>.cg-email-term-hint{visibility:visible;opacity:1;pointer-events:auto}.cg-email-term:focus-visible{outline:2px solid #0b57d0;outline-offset:3px;border-radius:3px}
  .cg-email-received{display:grid;gap:10px}.cg-email-hop{padding:8px 12px;border-left:2px solid #dce0e5;border-radius:0 5px 5px 0;background:#f8f9fb}.cg-email-hop-time{margin-top:6px;color:#687079}
  .cg-email-raw-text{box-sizing:border-box;max-height:360px;margin:4px 0 8px;padding:14px 16px;border:1px solid #dce0e5;border-radius:7px;background:#f8f9fb;overflow:auto;font:13px/1.65 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}
  .cg-email-body{padding:20px 30px 28px;overflow-x:auto;min-width:0}.cg-email-body>:where(:first-child){margin-top:0}
  :where(.cg-format-eml) :is(p,h1,h2,h3,h4,h5,h6,li){white-space:normal}
  :where(.cg-format-eml) p{margin:0 0 1em;line-height:1.65}:where(.cg-format-eml) td,:where(.cg-format-eml) th{border:0;padding:3px 8px 3px 0}
  :where(.cg-format-eml) table{margin:0;max-width:100%}:where(.cg-format-eml) td>p:last-child{margin-bottom:0}
  :where(.cg-format-eml) blockquote{margin:18px 0;padding:8px 16px;border-left:3px solid #cbd2dc;color:#59616c;background:#f7f8fa}
  :where(.cg-format-eml) hr{border:0;border-top:1px solid #e2e5e9;margin:22px 0}
  .cg-email-plain>pre{margin:0;font:inherit;line-height:1.75;white-space:break-spaces;overflow-wrap:anywhere}
  .cg-email-attachments{padding:20px 30px 26px;border-top:1px solid #e2e5e9;background:#f8f9fb;border-radius:0 0 12px 12px}
  .cg-email-attachments-title{display:flex;align-items:center;gap:9px;margin:0 0 14px;font-size:15px;font-weight:700}
  .cg-email-attachment-count{min-width:20px;box-sizing:border-box;padding:1px 6px;border-radius:6px;background:#e9edf2;color:#687079;font-size:12px;font-weight:400;text-align:center}
  .cg-email-attachment-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;list-style:none;margin:0;padding:0}
  .cg-email-attachment{display:flex;align-items:center;gap:12px;min-width:0;padding:12px 14px;border:1px solid #dce0e5;border-radius:8px;background:#fff;white-space:normal}
  .cg-email-attachment-icon{position:relative;flex:none;box-sizing:border-box;width:20px;height:26px;border:1.5px solid #7b8491;border-radius:3px}
  .cg-email-attachment-icon::after{content:'';position:absolute;left:4px;right:4px;top:9px;height:5px;border-top:1px solid currentColor;border-bottom:1px solid currentColor;color:#7b8491}
  .cg-email-attachment-info{display:grid;min-width:0;gap:2px}.cg-email-attachment-name{font-size:14px;overflow-wrap:anywhere}.cg-email-attachment-size{font-size:12px;color:#687079}
  @media(prefers-color-scheme:dark){body.cg-format-eml{border-color:#454950;background:#292a2d}.cg-email-header,.cg-email-attachments,.cg-email-raw-text{border-color:#454950}.cg-email-label,.cg-email-attachment-size,.cg-email-summary{color:#aeb4bc}.cg-email-summary:hover{color:#98beff}.cg-email-summary:focus-visible{outline-color:#98beff}.cg-email-raw-text{background:#25272b}.cg-email-attachments{background:#25272b}.cg-email-attachment{background:#303238;border-color:#4a4f57}.cg-email-attachment-count{background:#393d44;color:#bfc6d0}:where(.cg-format-eml) blockquote{background:#25272b;color:#c0c6ce;border-color:#59616c}:where(.cg-format-eml) hr{border-color:#454950}}
  @media(max-width:700px){body.cg-format-eml{width:100%;margin:0;border:0;border-radius:0}.cg-email-header{padding:22px 20px 12px}.cg-email-subject{font-size:22px}.cg-email-fields{gap:8px 12px}.cg-email-detail-fields{grid-template-columns:minmax(0,1fr);gap:2px}.cg-email-detail-fields .cg-email-value{margin-bottom:10px}.cg-email-body{padding:16px 20px 22px}.cg-email-attachments{padding:18px 20px;border-radius:0}.cg-email-attachment-list{grid-template-columns:minmax(0,1fr)}}
  @media(prefers-color-scheme:dark){.cg-email-hop{background:#25272b;border-color:#59616c}.cg-email-hop-time{color:#aeb4bc}}
  @media(prefers-color-scheme:dark){.cg-email-term-hint{background:#303238;border-color:#59616c;color:#f1f3f4}.cg-email-term:focus-visible{outline-color:#98beff}}
`;
