import './protocols.js';
import { externalLinkTarget } from './target.js';
const parser = globalThis[Symbol.for('cosmic.external-links-capture.protocols')];
export function parseExternalLink(value) {
  const href=externalLinkTarget(value);
  if(!href)return null;
  if (/^https?:/i.test(href)) return {kind:'web',href};
  const kind = new URL(href).protocol.slice(0,-1);
  if (['mailto','tel','sms'].includes(kind)) return parser['parse'+({mailto:'Mailto',tel:'Tel',sms:'Sms'}[kind])](href) || {kind,href,number:'',numberText:'',addressText:'',otherFields:[]};
  return {kind:'app',href,protocol:kind};
}
export function linkFields(capture,labels) {
  if(['web','app'].includes(capture.kind))return [[labels.url,capture.href]];
  if(capture.kind==='tel')return [[labels.phoneNumber,capture.number]];
  const rows=[[labels.to,capture.kind==='sms'?capture.numberText:capture.addressText]];
  if(capture.cc?.length)rows.push([labels.cc,capture.cc.join(', ')]);
  if(capture.bcc?.length)rows.push([labels.bcc,capture.bcc.join(', ')]);
  if(capture.subject)rows.push([labels.subject,capture.subject]);
  if(capture.body)rows.push([labels.message,capture.body]);
  for(const field of capture.otherFields)rows.push([field.name,field.values.join(', ')]);
  return rows;
}
export function linkCopyText(capture,labels) {
  if(['web','app'].includes(capture.kind))return capture.href;
  if(capture.kind==='tel')return capture.number;
  if(capture.simpleNumberOnly)return capture.numberText;
  if(capture.simpleAddressOnly)return capture.addressText;
  return linkFields(capture,labels).filter(([,value])=>value).map(([label,value])=>label+': '+value).join('\n');
}
