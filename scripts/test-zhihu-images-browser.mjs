// Real product injection and Settings in a disposable profile with synthetic page content.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
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
// Test-only access to the owned controls; production retains closed Shadow DOM.
const originalShadow=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return originalShadow.call(this,this.localName==='cg-zhihu-image-control'?{...options,mode:'open'}:options)};
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
 const settings=await context.newPage();settings.on('pageerror',e=>errors.push(e.message));await settings.goto(base+'settings/satellites.html');
 await settings.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 await settings.locator('#satellite-zhihu-image-adjustment').screenshot({path:join(artifacts,'settings.png')});
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
 const toggle=page.locator('#expanded cg-zhihu-image-control button.toggle');
 await toggle.click({button:'right'});await page.locator('#expanded cg-zhihu-image-control').getByRole('menuitemradio',{name:'Hide',exact:true}).click();
 assert.equal(await page.locator('#text').getAttribute('data-cg-zhihu-effect'),'hide-dark');
 await toggle.click();assert.equal(await page.locator('#text').getAttribute('data-cg-zhihu-effect'),'invert');
 assert.equal(await page.evaluate(()=>window.openCount),0,'control actions never open the native image');
 await toggle.click({button:'right'});await page.locator('#text').click({position:{x:8,y:120}});
 assert.equal(await page.evaluate(()=>window.openCount),0,'dismissing a menu must consume the underlying image click');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await toggle.click({button:'right'});await page.locator('#expanded cg-zhihu-image-control').getByRole('menuitemradio',{name:'Original',exact:true}).click();
 await page.locator('#text').click();await page.waitForSelector('#big[data-cg-zhihu-viewer]');
 assert.equal(await page.locator('#big').getAttribute('data-cg-zhihu-effect'),'original');
 const bigToggle=page.locator('body > cg-zhihu-image-control button.toggle');
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

 // The history-navigation Settings view and first-frame cache must contain both options.
 await settings.reload();await settings.waitForFunction(()=>document.getElementById('zhihuImageAdjustmentEnabled').checked);
 assert.equal(await settings.locator('#zhihuDarkImages').isChecked(),true);
 await settings.locator('[data-feature-link="allSettings"]').first().click();
 await settings.locator('[data-feature-link="satellites"]').first().click();await settings.waitForSelector('#zhihuImageAdjustmentEnabled');
 assert.equal(await settings.locator('#zhihuImageAdjustmentEnabled').isChecked(),true);
 await settings.locator('#zhihuImageAdjustmentEnabled').uncheck();await page.waitForFunction(()=>!document.querySelector('[data-cg-zhihu-image]'));
 assert.equal(await page.locator('cg-zhihu-image-control').count(),0);
 await settings.locator('#zhihuImageAdjustmentEnabled').check();
 await page.goto('https://zhuanlan.zhihu.com/p/1');await page.waitForSelector('#text[data-cg-zhihu-image]');
 assert.ok((await page.locator('#text').boundingBox()).width<=280);
 assert.deepEqual(errors,[]);
 console.log('Passed: actual injection, saved controls, scope, compact width, dark screenshots, collapsed/default-expanded states, native viewer, per-image choices, protection, themes, cleanup, and Settings history.');
}finally{await context.close();await rm(folder,{recursive:true,force:true});}
