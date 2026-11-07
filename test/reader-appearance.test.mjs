import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageAppearance} from '../extension/workspaces/pdf-viewer/page-appearance.js';
import {formatDocumentDate} from '../extension/workspaces/document-preview/properties.js';
import {slideAppearanceStyles} from '../extension/workspaces/document-preview/format-styles.js';

test('document defaults are inherited while overrides are explicit and local to each page',()=>{
 let globalDark=false;
 const node=()=>({dataset:{}});
 const root=node(),pages=[node(),node()],thumbnails={children:[node(),node()]};
 const appearance=createPageAppearance({root,getPage:n=>pages[n-1],thumbnails,getDark:()=>globalDark});
 appearance.apply();
 assert.equal(root.dataset.paperDark,'false');
 appearance.set(1,'dark');
 assert.equal(pages[0].dataset.paperDark,'true');
 assert.equal(thumbnails.children[0].dataset.paperDark,'true');
 assert.equal(pages[1].dataset.paperDark,undefined);
 globalDark=true;appearance.apply();
 appearance.set(2,'original');
 assert.equal(root.dataset.paperDark,'true');
 assert.equal(pages[1].dataset.paperDark,'false');
 assert.equal(appearance.dark(2),false);
 assert.equal(appearance.get(2),'original');
 const rebuiltThumbnail=node();
 appearance.applyOverride(rebuiltThumbnail,2);
 assert.equal(rebuiltThumbnail.dataset.paperDark,'false');
 appearance.set(2,'auto');
 assert.equal(appearance.dark(2),true);
 assert.equal(pages[1].dataset.paperDark,undefined);
 assert.equal(thumbnails.children[1].dataset.paperDark,undefined);
 for(const [page,mode]of [[0,'dark'],[NaN,'dark'],[2,'invalid'],[1.5,'light']])appearance.set(page,mode);
 assert.equal(appearance.get(2),'auto');
});

test('Office property dates retain source precision and compact UTC offsets',()=>{
 assert.equal(formatDocumentDate('2026-11-04T12:34:56.000Z'),'2026-11-04 12:34:56 (UTC)');
 assert.equal(formatDocumentDate('2026-11-04T12:34+08:00'),'2026-11-04 12:34 (UTC+8)');
 assert.equal(formatDocumentDate('2026-11-04T12:34:56-05:30'),'2026-11-04 12:34:56 (UTC-5:30)');
 assert.equal(formatDocumentDate('2026-11-04'),'2026-11-04');
 for(const input of ['bad','2026-02-30T12:00:00Z','2026-11-04T12:34:00+25:00',null])assert.equal(formatDocumentDate(input),'');
});

test('slide-specific color rules keep both source and dark palettes on trusted wrappers',()=>{
 const css=slideAppearanceStyles({styles:[{'background-color':'#101218',color:'#ffffff'},{'background-color':'#ffffff',color:'#000000'},{color:'url(https://invalid)',position:'fixed'}]});
 assert.match(css,/\[data-slide-dark=false\] \.cg-f0\.cg-f0\{background-color:#101218;color:#ffffff\}/);
 assert.match(css,/\[data-slide-dark=true\] \.cg-f0\.cg-f0\{background-color:#101218;color:#f1f3f4\}/);
 assert.match(css,/\[data-slide-dark=true\] \.cg-f1\.cg-f1\{background-color:#292929;color:#f1f3f4\}/);
 assert.doesNotMatch(css,/url\(|position:fixed/);
});

test('pending slide loading keeps current-render tone commands and rejects invalid page indices',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 let resolveModule,receive,renderedOptions;const calls=[];
 const ready=new Promise(resolve=>resolveModule=resolve),port={postMessage:data=>calls.push(data),close(){}};
 const style={textContent:''};
 const source=(await readFile(new URL('../extension/workspaces/document-preview/content.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace("import('./slides.js')",'qaSlidesReady').replaceAll('import.meta.url',"'chrome-extension://fixture/content.js'");
 const parent={},body={replaceChildren(){},classList:{},className:''};
 runInNewContext(source,{
  AbortController,queueMicrotask,qaSlidesReady:ready,parent,importMeta:{},
  window:{addEventListener:(name,fn)=>{if(name==='message')receive=fn;},scrollTo(){}},
  document:{documentElement:{dataset:{},style:{}},body,head:{append:node=>queueMicrotask(()=>node.onload())},querySelector:()=>style,createElement:()=>({}),addEventListener(){}},
  createDocumentZoom:()=>({reset(){},setZoom(){}}),documentStyles:()=>'',isSandboxHost:()=>true
 });
 receive({source:parent,origin:'chrome-extension://fixture',data:{type:'CG_DOCUMENT_CONTENT_INIT'},ports:[port]});
 port.onmessage({data:{type:'slides',id:1,formatting:{kind:'pptx'},parts:[{html:'<div/>'},{html:'<div/>'}],themes:[],locale:'en-US'}});
 port.onmessage({data:{type:'slide-theme',id:1,index:0,mode:'dark'}});
 port.onmessage({data:{type:'slide-theme',id:1,index:7,mode:'light'}});
 port.onmessage({data:{type:'slide-theme',id:0,index:1,mode:'dark'}});
 port.onmessage({data:{type:'theme',dark:true}});
 resolveModule({createSlidesView:options=>{renderedOptions=options;return {setTheme(){},setPageTheme(){},destroy(){}};}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(renderedOptions.dark,true);assert.deepEqual(JSON.parse(JSON.stringify(renderedOptions.themes)),[[0,'dark']]);
 assert.ok(calls.some(data=>data.type==='rendered'&&data.id===1));
});
