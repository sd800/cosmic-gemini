const PostalMime=require('postal-mime');
const {esc}=require('./office-package.cjs');
async function email(buffer,labels={}){
  const mail=await PostalMime.parse(buffer,{maxNestingDepth:40,maxHeadersSize:65536,attachmentEncoding:'base64',forceRfc822Attachments:true});
  function address(value){if(!value)return '';if(value.group)return (value.name?value.name+': ':'')+value.group.map(address).join(', ');return value.name?value.name+(value.address?' <'+value.address+'>':''):value.address||'';}
  // Keep trusted layout separate from arbitrary message HTML. The sandbox
  // builds the subject, envelope and attachment list using plain text nodes.
  const fields=[];
  for(const [key,data] of [['from',address(mail.from)],['to',(mail.to||[]).map(address).join(', ')],['cc',(mail.cc||[]).map(address).join(', ')],['date',mail.headers.find(header=>header.key==='date')?.value||mail.date]])
    if(data)fields.push({label:labels[key]||key,value:data,...(key==='date'?{date:true}:{})});
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
    subject:mail.subject||labels.noSubject||'(No subject)',fields,plain:!html,
    locale:labels.locale==='zh-CN'?'zh-CN':'en-US',attachmentsLabel:labels.attachments||'Attachments',
    attachments:attachments.map(a=>({name:a.filename||a.mimeType,
      size:Math.max(0,Math.floor(a.content.length*3/4)-(a.content.endsWith('==')?2:a.content.endsWith('=')?1:0))}))
  }}};
}
module.exports={email};
