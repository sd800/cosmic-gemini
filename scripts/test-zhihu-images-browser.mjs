// Real product injection and Settings in a disposable profile with synthetic page content.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder=await mkdtemp(join(tmpdir(),'cg-zhihu-')),artifacts=resolve('test-dist/zhihu-image-adjustment');
await mkdir(artifacts,{recursive:true});
const html=`<!doctype html><html data-theme="dark"><meta charset="utf-8"><title>Zhihu images fixture</title>
<style>body{margin:20px;background:#191b1e;color:#ddd;font:16px/1.5 system-ui}.RichText{width:654px}figure{margin:12px 0}img{width:100%;height:auto}button{font:inherit}.RichContent{margin-bottom:24px}.RichText-ConditionalImagePortal{position:relative}.gate{position:absolute;inset:0}.formula{width:40px}html[data-theme=light] body{background:white;color:#222}</style>
<h1>Reading with compact images</h1>
<div id="expanded" class="RichContent"><p>Full text is expanded by default.</p><div class="RichText ztext"><figure><div class="RichText-ConditionalImagePortal"><img id="text" width="640" height="960" data-original="https://pic1.zhimg.com/v2-aaaaaaaa_r.jpg"></div></figure><img id="formula" class="ztext-math formula"></div></div>
<div id="collapsed" class="RichContent is-collapsed"><p>Collapsed answer</p><div class="RichText ztext"><figure><img id="thumb" data-original="https://pic1.zhimg.com/v2-bbbbbbbb_r.jpg"></figure></div></div>
<div class="RichContent"><div class="RichText ztext"><figure><div class="RichText-ConditionalImagePortal"><img id="sensitive" style="filter:blur(12px)" data-original="https://pic1.zhimg.com/v2-cccccccc_r.jpg"><button id="confirm" class="gate">Click to view image</button></div></figure></div></div>
<script>
window.lastContextMenu=null;window.addEventListener('contextmenu',event=>{window.lastContextMenu=event},true);
window.nativeContextMenus=0;document.addEventListener('contextmenu',event=>{window.nativeContextMenus++;event.preventDefault();event.stopPropagation()},true);
// Expose only a test handle while preserving the browser's real closed-root event routing.
window.fixtureControls=new WeakMap();
const originalShadow=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=originalShadow.call(this,options);if(this.localName==='cg-zhihu-image-control')window.fixtureControls.set(this,root);return root};
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=960;const g=canvas.getContext('2d');g.scale(4,4);g.fillStyle='white';g.fillRect(0,0,160,240);g.fillStyle='#222';for(let y=22;y<220;y+=22)for(let x=12;x<140;x+=23)g.fillRect(x,y,11,4);const src=canvas.toDataURL();
for(const img of document.images)img.src=src;
window.openCount=0;document.getElementById('text').onclick=()=>{window.openCount++;const bg=document.createElement('div');bg.id='backdrop';bg.style='position:fixed;inset:0;background:#fff9;z-index:999';const big=document.createElement('img');big.id='big';big.src=src;big.setAttribute('data-original','https://pic1.zhimg.com/v2-aaaaaaaa_r.jpg');big.style='position:fixed;left:38%;top:10px;width:350px;height:auto;z-index:999';document.body.append(bg,big)};
document.getElementById('confirm').onclick=()=>{document.getElementById('sensitive').style.filter='';document.getElementById('confirm').remove()};
</script>`;
await writeFile(join(artifacts,'fixture.html'),html);
const context=await chromium.launchPersistentContext(join(folder,'profile'),{executablePath:process.env.PDF_VIEWER_CHROME,headless:true,viewport:{width:1100,height:950},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${resolve('extension')}`,`--load-extension=${resolve('extension')}`]});
const errors=[];
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const base=`chrome-extension://${new URL(worker.url()).host}/`;
 await context.route('https://**.zhihu.com/**',route=>route.fulfill({contentType:'text/html',body:html}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('https://www.zhihu.com/question/1');
 await page.waitForFunction(()=>document.getElementById('text').naturalWidth>0);
 assert.equal(await page.locator('[data-cg-zhihu-image]').count(),0);
 const settings=await context.newPage();settings.on('pageerror',e=>errors.push(e.message));await settings.goto(base+'settings/orbiters.html');
 await settings.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 await settings.locator('#orbiter-zhihu-image-adjustment').screenshot({path:join(artifacts,'settings.png')});
 // Exercise the real coordinated copy protection before installing the image controls.
 await settings.evaluate(async()=>{const result=await chrome.runtime.sendMessage({type:'UI_SET_AD_MARSHAL_SITE',siteId:'zhihu',enabled:true});if(!result.ok)throw Error(result.error)});
 await page.waitForFunction(()=>window[Symbol.for('cosmic-gemini.any-copy.runtime')]?.active===true);
 await settings.locator('#zhihuImageAdjustmentEnabled').check();
 await page.waitForSelector('#text[data-cg-zhihu-image]');
 await page.waitForFunction(()=>document.querySelector('#text').getAttribute('data-cg-zhihu-effect')==='invert');
 assert.ok((await page.locator('#text').boundingBox()).width<=280);
 assert.equal(await page.locator('#formula').getAttribute('data-cg-zhihu-image'),null);
 await page.locator('#thumb').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.getElementById('thumb').getAttribute('data-cg-zhihu-effect')==='invert');
 assert.equal(await page.locator('#collapsed cg-zhihu-image-control').count(),0);
 assert.equal(await page.locator('#expanded cg-zhihu-image-control').count(),1);
 assert.equal(await page.locator('#sensitive').getAttribute('data-cg-zhihu-effect'),null);
 assert.equal(await page.locator('#confirm').count(),1);
 assert.equal(await page.locator('#sensitive').evaluate(e=>getComputedStyle(e).filter),'blur(12px)');
 await page.locator('#text').scrollIntoViewIfNeeded();
 const controlElement=async(selector,part)=>{const handle=await page.locator(selector).evaluateHandle((host,part)=>{const root=window.fixtureControls.get(host);return part==='toggle'?root.querySelector('button.toggle'):[...root.querySelectorAll('[role=menuitemradio]')].find(button=>button.textContent===part)},part);const element=handle.asElement();assert.ok(element,`Missing control: ${part}`);return element;};
 const control='#expanded cg-zhihu-image-control';
 const toggle=await controlElement(control,'toggle');
 assert.equal(await toggle.evaluate(e=>e.getRootNode().mode),'closed');
 await page.mouse.move(1000,900);
 assert.equal(await toggle.evaluate(e=>getComputedStyle(e).opacity),'0.4');
 const buttonBox=await toggle.boundingBox();
 await page.mouse.click(buttonBox.x-6,buttonBox.y+buttonBox.height/2,{button:'right'});
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 assert.equal(await page.evaluate(()=>window.nativeContextMenus),0,'owned hit margin captures before site document handlers');
 await page.screenshot({path:join(artifacts,'image-menu.png')});
 await page.keyboard.press('ArrowUp');
 assert.equal(await (await controlElement(control,'Original')).evaluate(e=>e===e.getRootNode().activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.equal(await toggle.evaluate(button=>button.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,composed:false,button:0,ctrlKey:true}))),false,'root-local Control-click context menus must be canceled');
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await page.keyboard.press('Escape');
 await toggle.click({button:'right'});await (await controlElement(control,'Hide')).click();
 assert.equal(await page.locator('#text').getAttribute('data-cg-zhihu-effect'),'hide-dark');
 await toggle.click();assert.equal(await page.locator('#text').getAttribute('data-cg-zhihu-effect'),'invert');
 assert.equal(await page.evaluate(()=>window.openCount),0,'control actions never open the native image');
 await toggle.click({button:'right'});await page.locator('#text').click({position:{x:8,y:120}});
 assert.equal(await page.evaluate(()=>window.openCount),0,'dismissing a menu must consume the underlying image click');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await page.mouse.click(1050,900,{button:'right'});
 assert.equal(await page.evaluate(()=>window.nativeContextMenus),0,'Any Copy continues shielding ordinary page context menus');
 assert.equal(await page.evaluate(()=>window.lastContextMenu.defaultPrevented),false,'the image controls never cancel ordinary browser context menus');
 await toggle.click({button:'right'});await (await controlElement(control,'Original')).click();
 await page.locator('#text').click();await page.waitForSelector('#big[data-cg-zhihu-viewer]');
 assert.equal(await page.locator('#big').getAttribute('data-cg-zhihu-effect'),'original');
 const bigToggle=await controlElement('body > cg-zhihu-image-control','toggle');
 await bigToggle.click();assert.equal(await page.locator('#text').getAttribute('data-cg-zhihu-effect'),'invert');
 assert.equal(await page.locator('#big').getAttribute('data-cg-zhihu-effect'),'invert');
 assert.ok((await page.locator('#big').boundingBox()).width>280,'native full-size image is not shrunk');
 assert.equal(await page.locator('#backdrop').getAttribute('data-cg-zhihu-backdrop'),'');
 await page.screenshot({path:join(artifacts,'dark-native-viewer.png')});
 await page.evaluate(()=>{document.getElementById('big').remove();document.getElementById('backdrop').remove()});
 await settings.locator('#zhihuSmallImages').uncheck();await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cg-zhihu-small'));
 assert.equal(await page.locator('#text').getAttribute('data-cg-zhihu-effect'),'invert');
 await settings.locator('#zhihuSmallImages').check();await settings.locator('#zhihuDarkImages').uncheck();
 await page.waitForFunction(()=>!document.getElementById('text').hasAttribute('data-cg-zhihu-effect'));
 assert.ok((await page.locator('#text').boundingBox()).width<=280);
 await settings.locator('#zhihuDarkImages').check();
 await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
 await page.waitForFunction(()=>!document.getElementById('text').hasAttribute('data-cg-zhihu-effect'));
 await settings.locator('#zhihuMatchPageTheme').uncheck();
 await page.waitForFunction(()=>document.getElementById('text').getAttribute('data-cg-zhihu-effect')==='invert');
 await settings.locator('#zhihuMatchPageTheme').check();
 await page.waitForFunction(()=>!document.getElementById('text').hasAttribute('data-cg-zhihu-effect'));
 await page.evaluate(()=>document.documentElement.setAttribute('data-darkreader-scheme','dark'));
 await page.waitForFunction(()=>document.getElementById('text').getAttribute('data-cg-zhihu-effect')==='invert');
 await page.evaluate(()=>{document.documentElement.removeAttribute('data-darkreader-scheme');document.documentElement.setAttribute('data-theme','dark')});
 await page.waitForFunction(()=>document.getElementById('text').getAttribute('data-cg-zhihu-effect')==='invert');
 await page.locator('#confirm').click();await page.waitForFunction(()=>document.getElementById('sensitive').getAttribute('data-cg-zhihu-effect')==='invert');
 await page.evaluate(()=>document.getElementById('collapsed').classList.remove('is-collapsed'));
 await page.waitForSelector('#collapsed cg-zhihu-image-control');
 await page.locator('#text').scrollIntoViewIfNeeded();await page.screenshot({path:join(artifacts,'compact-dark.png')});
 const png=Buffer.from(await page.locator('#text').evaluate(img=>img.src.split(',')[1]),'base64');
 let releaseCors; const corsGate=new Promise(resolve=>releaseCors=resolve);
 await context.route('https://pic1.zhimg.com/v2-dddddddd.png',async route=>{
   if(route.request().headers().origin)await corsGate;
   await route.fulfill({contentType:'image/png',body:png,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.evaluate(()=>{const figure=document.createElement('figure');const img=document.createElement('img');img.id='late';img.src='https://pic1.zhimg.com/v2-dddddddd.png';figure.append(img);document.querySelector('#expanded .RichText').prepend(figure)});
 await page.waitForFunction(()=>document.getElementById('late').naturalWidth>0&&document.getElementById('late').hasAttribute('data-cg-zhihu-pending'));
 assert.equal(await page.locator('#late').evaluate(e=>getComputedStyle(e).visibility),'hidden');
 releaseCors();await page.waitForFunction(()=>document.getElementById('late').getAttribute('data-cg-zhihu-effect')==='invert');
 assert.equal(await page.locator('#late').evaluate(e=>getComputedStyle(e).visibility),'visible');
 await page.evaluate(()=>{window.presentationChanges=0;const observer=new MutationObserver(changes=>{window.presentationChanges+=changes.length});observer.observe(document.getElementById('late'),{attributes:true,attributeFilter:['data-cg-zhihu-pending','data-cg-zhihu-effect']});window.fixtureObserver=observer;document.getElementById('expanded').classList.add('site-update')});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await page.evaluate(()=>window.presentationChanges),0,'unchanged image presentation must not flicker on an unrelated class update');
 await page.evaluate(()=>window.fixtureObserver.disconnect());

 // High-detail analysis is Zhihu-only; the shared classifier and XHS budgets stay unchanged.
 await page.evaluate(()=>{
   window.readingSamples=[];
   const getPixels=CanvasRenderingContext2D.prototype.getImageData;
   CanvasRenderingContext2D.prototype.getImageData=function(...args){const pixels=getPixels.apply(this,args);window.readingSamples.push(pixels.width*pixels.height);return pixels;};
 });
 const addReadingSample=async(id,source,expected)=>{
   await page.evaluate(({id,source})=>{
     window.readingSamples=[];
     const body=document.createElement('div');body.className='RichContent';
     const text=document.createElement('div');text.className='RichText ztext';
     const figure=document.createElement('figure'),image=document.createElement('img');image.id=id;image.src=source;
     figure.append(image);text.append(figure);body.append(text);document.body.append(body);
   },{id,source});
   const image=page.locator(`#${id}`);await image.scrollIntoViewIfNeeded();
   await page.waitForFunction(id=>{const image=document.getElementById(id);return image.hasAttribute('data-cg-zhihu-image')&&window.readingSamples.length>0&&!image.hasAttribute('data-cg-zhihu-pending')},id);
   assert.equal(await image.getAttribute('data-cg-zhihu-effect'),expected,`${id} classification`);
   const reads=await page.evaluate(()=>window.readingSamples);
   assert.ok(reads.length<=3&&reads.every(size=>size<=16384)&&reads.reduce((a,b)=>a+b,0)<=21504,'refinement remains bounded');
   return reads;
 };
 const samples=await page.evaluate(()=>{
   const make=kind=>{
     const canvas=document.createElement('canvas');canvas.width=900;canvas.height=680;const g=canvas.getContext('2d');
     g.fillStyle=kind==='faded'?'#f5f1e6':'white';g.fillRect(0,0,900,680);
     if(kind==='dense'||kind==='faded'){
       g.font='22px Georgia';g.fillStyle=kind==='faded'?'#555':'#161616';
       for(let y=25;y<680;y+=34)g.fillText('Reading example: dense printed text on a bright page with small letters.',24,y);
     }else if(kind==='object'){g.fillStyle='#222';g.beginPath();g.arc(450,340,26,0,Math.PI*2);g.fill();}
     else if(kind==='photo'){const gradient=g.createLinearGradient(0,0,900,680);gradient.addColorStop(0,'#8ad9f0');gradient.addColorStop(.5,'#d2a87c');gradient.addColorStop(1,'#254b2a');g.fillStyle=gradient;g.fillRect(0,0,900,680);}
     return canvas.toDataURL();
   };return Object.fromEntries(['dense','faded','object','photo','blank'].map(kind=>[kind,make(kind)]));
 });
 for(const name of ['dense','faded']){
   const reads=await addReadingSample(`reading-${name}`,samples[name],'invert');assert.ok(reads.length>1,'small print must exercise refinement');
 }
 for(const name of ['object','photo','blank'])await addReadingSample(`reading-${name}`,samples[name],null);
 if(process.env.ZHIHU_READING_SAMPLE){
   const bytes=await readFile(process.env.ZHIHU_READING_SAMPLE);let corsReads=0;
   const reference='https://pic4.zhimg.com/v2-eeeeeeeeeeee.jpg';
   await context.route(reference,route=>{if(route.request().headers().origin)corsReads++;return route.fulfill({contentType:'image/jpeg',body:bytes,headers:{'Access-Control-Allow-Origin':'*'}})});
   const reads=await addReadingSample('reading-reference',reference,'invert');assert.ok(corsReads>0&&reads.length>1,'the reference must use CDN-safe sampling and detail refinement');
   await page.locator('#reading-reference').screenshot({path:join(artifacts,'reading-reference-dark.png')});
 }

 // The history-navigation Settings view and first-frame cache must contain both options.
 await settings.reload();await settings.waitForFunction(()=>document.getElementById('zhihuImageAdjustmentEnabled').checked);
 assert.equal(await settings.locator('#zhihuDarkImages').isChecked(),true);
 await settings.locator('[data-feature-link="allSettings"]').first().click();
 await settings.locator('[data-feature-link="orbiters"]').first().click();await settings.waitForSelector('#zhihuImageAdjustmentEnabled');
 assert.equal(await settings.locator('#zhihuImageAdjustmentEnabled').isChecked(),true);
 await settings.locator('#zhihuImageAdjustmentEnabled').uncheck();await page.waitForFunction(()=>!document.querySelector('[data-cg-zhihu-image]'));
 assert.equal(await page.locator('cg-zhihu-image-control').count(),0);
 assert.equal(await page.evaluate(()=>window[Symbol.for('cosmic-gemini.any-copy.runtime')]?.active),true);
 await page.mouse.click(1050,900,{button:'right'});
 assert.equal(await page.evaluate(()=>window.lastContextMenu.defaultPrevented),false);
 await settings.locator('#zhihuImageAdjustmentEnabled').check();
 await page.goto('https://zhuanlan.zhihu.com/p/1');await page.waitForSelector('#text[data-cg-zhihu-image]');
 assert.ok((await page.locator('#text').boundingBox()).width<=280);
 assert.deepEqual(errors,[]);
 console.log('Passed: dense/faded reading images, preserved objects/photos/blank images, bounded Zhihu-only refinement, closed-root menus with coordinated Any Copy, native button/margin right-click, root-local Control-click, ordinary browser menus, actual injection, saved controls, scope, compact width, dark screenshots, collapsed/default-expanded states, native viewer, per-image choices, protection, themes, cleanup, and Settings history.');
}finally{await context.close();await rm(folder,{recursive:true,force:true});}
