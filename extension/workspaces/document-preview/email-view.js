import { formatDocumentBytes, DOCUMENT_LIMIT } from '../../core/document-preview/document-preview.js';

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
  const text = value => {
    if (typeof value !== 'string' || value.length > 65536) throw Error('invalidDocument');
    return value;
  };
  const node = (tag, name, value) => {
    const element = output.createElement(tag); element.className = name;
    if (value !== undefined) element.textContent = text(value);
    return element;
  };
  const header = node('div','cg-email-header');
  header.append(node('h1','cg-email-subject',mail.subject));
  const fields = node('dl','cg-email-fields');
  for (const field of mail.fields) {
    const value=text(field.value);
    fields.append(node('dt','cg-email-label',field.label),node('dd','cg-email-value',field.date===true?formatEmailDate(value,mail.locale):value));
  }
  if (fields.childNodes.length) header.append(fields);
  const body = node('div','cg-email-body' + (mail.plain === true ? ' cg-email-plain' : ''));
  if (bodyClass) body.classList.add(bodyClass);
  while (output.body.firstChild) body.append(output.body.firstChild);
  output.body.append(header,body);
  if (mail.attachments.length) {
    const section = node('div','cg-email-attachments'), heading = node('h2','cg-email-attachments-title',mail.attachmentsLabel);
    heading.append(node('span','cg-email-attachment-count',String(mail.attachments.length)));
    const list = node('ul','cg-email-attachment-list');
    for (const attachment of mail.attachments) {
      const row = node('li','cg-email-attachment'), icon = node('span','cg-email-attachment-icon');
      icon.setAttribute('aria-hidden','true');
      const info = node('div','cg-email-attachment-info');
      info.append(node('span','cg-email-attachment-name',attachment.name));
      if (Number.isSafeInteger(attachment.size) && attachment.size >= 0 && attachment.size <= DOCUMENT_LIMIT) {
        info.append(node('span','cg-email-attachment-size',formatDocumentBytes(attachment.size,mail.locale === 'zh-CN' ? 'zh-CN' : 'en-US')));
      }
      row.append(icon,info); list.append(row);
    }
    section.append(heading,list); output.body.append(section);
  }
}

export const emailStyles = `
  body.cg-format-eml{width:calc(100% - 48px);max-width:960px;min-height:0;margin:24px auto;padding:0;border:1px solid #dce0e5;border-radius:12px;box-shadow:0 2px 12px #00000008;font:15px/1.65 Arial,'PingFang SC','Microsoft YaHei',sans-serif}
  .cg-email-header{padding:26px 30px 22px;border-bottom:1px solid #e2e5e9}
  .cg-email-subject{margin:0 0 20px;font-size:24px;line-height:1.4;font-weight:700;white-space:normal;overflow-wrap:anywhere}
  .cg-email-fields{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:9px 18px;margin:0}
  .cg-email-label{color:#687079;font-size:14px}.cg-email-value{margin:0;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
  .cg-email-body{padding:28px 30px;overflow-x:auto;min-width:0}
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
  @media(prefers-color-scheme:dark){body.cg-format-eml{border-color:#454950;background:#292a2d}.cg-email-header,.cg-email-attachments{border-color:#454950}.cg-email-label,.cg-email-attachment-size{color:#aeb4bc}.cg-email-attachments{background:#25272b}.cg-email-attachment{background:#303238;border-color:#4a4f57}.cg-email-attachment-count{background:#393d44;color:#bfc6d0}:where(.cg-format-eml) blockquote{background:#25272b;color:#c0c6ce;border-color:#59616c}:where(.cg-format-eml) hr{border-color:#454950}}
  @media(max-width:700px){body.cg-format-eml{width:100%;margin:0;border:0;border-radius:0}.cg-email-header{padding:22px 20px 18px}.cg-email-subject{font-size:22px}.cg-email-fields{gap:8px 12px}.cg-email-body{padding:22px 20px}.cg-email-attachments{padding:18px 20px;border-radius:0}.cg-email-attachment-list{grid-template-columns:minmax(0,1fr)}}
`;
