import { showReaderDialog } from '../pdf-viewer/dialog.js';
import { labels } from '../pdf-viewer/labels.js';
import { formatPdfDate } from '../pdf-viewer/document-dates.js';
import { documentKind, formatDocumentBytes, inspectOffice, isZipDocument } from '../../core/document-preview/document-preview.js';

export function formatDocumentDate(value) {
  if(typeof value!=='string'||value.length>80)return '';
  const m=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/);
  if(!m)return '';
  const date=formatPdfDate('D:'+m[1]+m[2]+m[3]+(m[4]?m[4]+m[5]+(m[6]||'')+(m[7]||'').replace(':',''):''));
  return m[4]?date:date.split(' ')[0];
}
// Read only bounded passive property parts from the already-open RAM file.
export async function readPackageProperties(buffer,format) {
  if(!isZipDocument(format))return {};
  const {files}=inspectOffice(buffer,format),result={};
  const ns={dc:'http://purl.org/dc/elements/1.1/',core:'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',date:'http://purl.org/dc/terms/',app:'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',meta:'urn:oasis:names:tc:opendocument:xmlns:meta:1.0'};
  for(const name of ['docProps/core.xml','docProps/app.xml','meta.xml']) {
    const file=files.find(file=>file.name===name);if(!file||file.size>256*1024)continue;
    try {
      const source=new Uint8Array(buffer,file.start,file.compressed);let bytes=source;
      if(file.method===8){
        const reader=new Blob([source]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let size=0;
        try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>file.size||size>256*1024)throw Error('property budget');chunks.push(value);}if(size!==file.size)throw Error('property size');bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}}
        finally{await reader.cancel().catch(()=>{});}
      }
      const xml=new TextDecoder().decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(xml))continue;
      const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))continue;
      const get=(namespace,key)=>doc.getElementsByTagNameNS(ns[namespace],key)[0]?.textContent?.trim().slice(0,4096)||'';
      const mapping={documentTitle:[['dc','title']],author:[['dc','creator'],['meta','initial-creator']],subject:[['dc','subject']],keywords:[['core','keywords'],['meta','keyword']],created:[['date','created'],['meta','creation-date']],modified:[['date','modified'],['dc','date']],application:[['app','Application'],['meta','generator']]};
      for(const [key,choices]of Object.entries(mapping))for(const [namespace,local]of choices){const value=get(namespace,local);if(value){result[key]=value;break;}}
    }catch{/* A malformed optional property never hides readable file details. */}
  }
  return result;
}
export function createDocumentProperties({getDocument,getLocale,signal}) {
  const dialog=document.getElementById('properties-dialog'),list=document.getElementById('properties-list'),status=document.getElementById('properties-status');
  let pending,request=0;
  const text=()=>({...labels[getLocale()]||labels['en-US'],...(getLocale()==='zh-CN'?{fileType:'文件类型',slides:'幻灯片数',sheets:'工作表数'}:{fileType:'File type',slides:'Slides',sheets:'Worksheets'})});
  const set=(key,value)=>{
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=text()[key];dd.dataset.property=key;
    dd.textContent=typeof value==='string'&&value.trim()?value.slice(0,key==='fileUrl'?8192:4096):'—';list.append(dt,dd);
  };
  function basic(){
    const {metadata,blob,rendered}=getDocument();list.replaceChildren();
    if(!metadata)return;
    set('fileName',metadata.filename);set('fileUrl',metadata.url);set('fileType',metadata.format.toUpperCase());
    set('fileSize',formatDocumentBytes(blob?.size??metadata.size,getLocale()));
    const kind=documentKind(metadata.format);if(rendered?.parts?.length&&['pptx','xlsx'].includes(kind))set(kind==='pptx'?'slides':'sheets',String(rendered.parts.length));
  }
  function localize(){document.getElementById('properties-title').textContent=text().properties;document.getElementById('properties-close').textContent=text().close;}
  function close(){request++;if(dialog.open)dialog.close();}
  document.getElementById('properties-close').addEventListener('click',close,{signal});dialog.addEventListener('close',()=>request++,{signal});
  let outside=false;const isOutside=e=>{const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
  dialog.addEventListener('pointerdown',e=>outside=isOutside(e),{signal});dialog.addEventListener('pointercancel',()=>outside=false,{signal});
  dialog.addEventListener('click',e=>{if(outside&&isOutside(e))close();outside=false;},{signal});signal.addEventListener('abort',close,{once:true});
  return {close,async open(){
    if(signal.aborted||dialog.open)return;const run=++request;basic();localize();status.textContent='';
    showReaderDialog(dialog,document.getElementById('properties-title'));dialog.scrollTop=dialog.scrollLeft=0;
    const {metadata,blob}=getDocument();if(!blob||!isZipDocument(metadata?.format))return;
    status.textContent=text().propertiesLoading;
    const properties=await(pending||=blob.arrayBuffer().then(bytes=>readPackageProperties(bytes,metadata.format)).catch(()=>({})));
    if(run!==request||signal.aborted||!dialog.open)return;
    // Refresh counts if conversion completed while the dialog was open.
    basic();for(const key of ['documentTitle','author','subject','keywords','created','modified','application'])if(properties[key])set(key,['created','modified'].includes(key)?formatDocumentDate(properties[key]):properties[key]);
    status.textContent='';
  }};
}
