import { showReaderDialog } from './dialog.js';
import { parseExternalLink, linkFields, linkCopyText } from './model.js';
const COPY={
 'en-US':{web:'External link',app:'Application link',openApp:'Open application',mailto:'Email link',tel:'Telephone link',sms:'Text message link',url:'Address',to:'To',phoneNumber:'Phone number',cc:'CC',bcc:'BCC',subject:'Subject',message:'Message',close:'Close',copy:'Copy',open:'Open link',copied:'Copied',failed:'Could not copy',noAddress:'No recipient specified'},
 'zh-CN':{web:'外部链接',app:'应用链接',openApp:'打开应用',mailto:'邮件链接',tel:'电话链接',sms:'短信链接',url:'网址',to:'收件人',phoneNumber:'电话号码',cc:'抄送',bcc:'密送',subject:'主题',message:'正文',close:'关闭',copy:'复制',open:'打开链接',copied:'已复制',failed:'无法复制',noAddress:'未指定收件人'}
};
// External Links Capture runs in the opaque document/PDF sandbox after a click.
// Only plain text is rendered. Opening is another trusted user action on a
// validated href; no URL or clipboard command enters the privileged host.
let styles;
function loadStyles() {
  return styles ||= new Promise((resolve,reject) => {
    const link=document.createElement('link');link.rel='stylesheet';
    link.href=new URL('capture.css',import.meta.url).href;
    link.onload=resolve;link.onerror=()=>reject(Error('External Links Capture styles unavailable'));
    document.head.append(link);
  });
}
export async function createExternalLinksCapture({signal,locale}){
 await loadStyles();
 let dialog=null,anchor=null,capture=null,closing=null;
 const node=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
 function close(restore=true,animate=true){
  if(!dialog)return;const old=dialog,focus=anchor;old.inert=true;dialog=null;capture=null;anchor=null;
  const finish=()=>{old.close();old.remove();if(restore&&focus?.isConnected)focus.focus({preventScroll:true});};
  if(animate&&document.documentElement.dataset.motion!=='false'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   closing?.finish();closing=old.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-3px)'}],{duration:100,easing:'ease-in',fill:'forwards'});closing.finished.then(finish,finish);
  }else finish();
 }
 function render(){
  if(!capture||signal.aborted)return;
  dialog?.close();dialog?.remove();
  const labels=COPY[locale]||COPY['en-US'],current=capture;
  dialog=node('dialog','','link-capture notranslate');dialog.translate=false;dialog.setAttribute('aria-label',labels[current.kind]);
  const heading=node('div','','link-heading'),title=node('strong',labels[current.kind]),dismiss=node('button','×','link-close');dismiss.type='button';dismiss.setAttribute('aria-label',labels.close);dismiss.onclick=()=>close();heading.append(title,dismiss);
  const details=node('div','','link-details');
  for(const [label,value]of linkFields(current,labels)){const field=node('div','','link-field');field.append(node('span',label),node('div',value||labels.noAddress,'link-value'));details.append(field);}
  const actions=node('div','','link-actions'),copy=node('button',labels.copy,'link-primary'),status=node('p','','link-status');status.setAttribute('role','status');
  const text=linkCopyText(current,labels);copy.type='button';copy.disabled=!text;
  copy.onclick=async()=>{
   // execCommand first keeps the user's activation in this opaque sandbox.
   const input=node('textarea');input.value=text;input.className='link-copy-buffer';input.readOnly=true;dialog.append(input);input.select();
   let copied=false;try{copied=document.execCommand('copy');}catch{}input.remove();copy.focus({preventScroll:true});
   if(!copied)try{await navigator.clipboard.writeText(text);copied=true;}catch{}
   if(status.isConnected)status.textContent=copied?labels.copied:labels.failed;
  };
  actions.append(copy);
  if(current.kind==='web'||current.kind==='app'){
   const open=node('a',current.kind==='app'?labels.openApp:labels.open,'link-open');open.href=current.href;open.target='_blank';open.rel='noopener noreferrer';
   for (const type of ['click','auxclick']) open.addEventListener(type,event=>{if(!event.isTrusted)event.preventDefault();});actions.append(open);
  }
  dialog.append(heading,details,actions,status);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('pointerdown',event=>{const r=dialog?.getBoundingClientRect();if(r&&event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))close(false);});
  document.body.append(dialog);showReaderDialog(dialog,copy.disabled?dismiss:copy);
 }
 signal.addEventListener('abort',()=>{close(false,false);closing?.finish();},{once:true});
 return{show(value,source){const parsed=parseExternalLink(value);if(!parsed||signal.aborted)return;close(false,false);capture=parsed;anchor=source;render();},setLocale(value){locale=value;if(capture)render();},closeWeb(){if(capture?.kind==='web')close(false,false);},close};
}
