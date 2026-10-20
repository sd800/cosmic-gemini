const PostalMime=require('postal-mime');
const {esc}=require('./office-package.cjs');
async function email(buffer,labels={}){
  const mail=await PostalMime.parse(buffer,{maxNestingDepth:40,maxHeadersSize:65536,attachmentEncoding:'base64',forceRfc822Attachments:true});
  function address(value){if(!value)return '';if(value.group)return (value.name?value.name+': ':'')+value.group.map(address).join(', ');return value.name?value.name+(value.address?' <'+value.address+'>':''):value.address||'';}
  // Keep trusted layout separate from arbitrary message HTML. The sandbox
  // builds the subject, envelope and attachment list using plain text nodes.
  const fields=[];
  const from=address(mail.from), sender=address(mail.sender), replyTo=(mail.replyTo||[]).map(address).join(', ');
  const sameFrom=value=>value?.address&&mail.from?.address&&value.address.toLowerCase()===mail.from.address.toLowerCase();
  for(const [key,data] of [['from',from],['sender',sameFrom(mail.sender)?'':sender],['to',(mail.to||[]).map(address).join(', ')],['cc',(mail.cc||[]).map(address).join(', ')],
    ['bcc',(mail.bcc||[]).map(address).join(', ')],['replyTo',mail.replyTo?.length===1&&sameFrom(mail.replyTo[0])?'':replyTo],['date',mail.headers.find(header=>header.key==='date')?.value||mail.date]])
    if(data)fields.push({key,label:labels[key]||key,value:data,...(key==='date'?{date:true}:{})});
  // Group repeated headers without dropping hops or inventing verification.
  // All values stay inert text; raw headers retain their order and folding.
  const headers=new Map();
  for(const header of mail.headers){if(!headers.has(header.key))headers.set(header.key,[]);headers.get(header.key).push(header.value);}
  const groups=[];
  for(const [key,fallback,names] of [
    ['thread','Message and conversation',['Message-ID','In-Reply-To','References']],
    ['delivery','Delivery',['Delivered-To','Return-Path','Received','Resent-From','Resent-To','Resent-Date']],
    ['priority','Priority',['Importance','Priority','X-Priority','Sensitivity']],
    ['authentication','Authentication headers',['Authentication-Results','ARC-Authentication-Results','Received-SPF','DKIM-Signature','ARC-Seal','ARC-Message-Signature']],
    ['format','Format and software',['MIME-Version','Content-Type','Content-Transfer-Encoding','Content-Language','X-Mailer','User-Agent']]
  ]){
    const rows=names.flatMap(name=>{const value=(headers.get(name.toLowerCase())||[]).filter(Boolean).join('\n\n');return value?[{label:name,value}]:[];});
    if(rows.length)groups.push({key,label:labels[key]||fallback,fields:rows});
  }
  const attachmentDetails=(mail.attachments||[]).map(a=>({name:a.filename||a.mimeType,fields:[
    ['Content-Type',a.mimeType],['Content-Disposition',a.disposition],['Content-Description',a.description],['Content-ID',a.contentId]
  ].filter(([,value])=>value).map(([label,value])=>({label,value}))}));
  const rawHeaders=(mail.headerLines||[]).map(header=>header.line).join('\n');
  if(rawHeaders.length>131072)throw Error('documentTooLarge');
  let value='';
  const images=new Map();
  for(const attachment of mail.attachments||[]){
    if(!attachment.contentId||!/^image\/(png|jpeg|gif|webp)$/.test(attachment.mimeType)||attachment.content.length>12*1024*1024)continue;
    // A CID reference may resolve only to a raster attachment in this message.
    const head=attachment.content.slice(0,16),mime=attachment.mimeType;
    if((mime==='image/png'&&!head.startsWith('iVBORw0KGgo'))||(mime==='image/jpeg'&&!head.startsWith('/9j/'))||(mime==='image/gif'&&!head.startsWith('R0lGOD'))||(mime==='image/webp'&&!head.startsWith('UklGR')))continue;
    images.set(attachment.contentId.replace(/^<|>$/g,''),'data:'+mime+';base64,'+attachment.content);
  }
  const html=mail.html;let embeddedSize=html?.length||0;
  if(html)value+=html.replace(/\bsrc\s*=\s*(["'])cid:([^"']+)\1/gi,(_all,_quote,cid)=>{const src=images.get(cid)||'';embeddedSize+=src.length;if(embeddedSize>32*1024*1024)throw Error('documentTooLarge');return 'src="'+src+'"';});
  else value+='<pre>'+esc(mail.text||'')+'</pre>';
  const attachments=(mail.attachments||[]).filter(a=>a.disposition==='attachment'||!a.contentId);
  if(value.length>32*1024*1024)throw Error('documentTooLarge');
  // The shared DOM sanitizer drops scripts/styles/forms and all remote sources.
  // Attachments are listed as text, never embedded as documents or programs.
  return {value,formatting:{kind:'eml',styles:[],email:{
    subject:mail.subject||labels.noSubject||'(No subject)',emptySubject:!mail.subject,fields,plain:!html,
    locale:labels.locale==='zh-CN'?'zh-CN':'en-US',attachmentsLabel:labels.attachments||'Attachments',
    details:{label:labels.details||'Message details',groups,attachmentsLabel:labels.attachments||'Attachments',attachments:attachmentDetails},
    rawHeaders:{label:labels.rawHeaders||'Raw headers',value:rawHeaders},
    attachments:attachments.map(a=>({name:a.filename||a.mimeType,
      size:Math.max(0,Math.floor(a.content.length*3/4)-(a.content.endsWith('==')?2:a.content.endsWith('=')?1:0))}))
  }}};
}
module.exports={email};
