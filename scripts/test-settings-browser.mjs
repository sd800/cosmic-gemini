// Real extension-surface QA in a disposable profile; never uses the user's Chrome.
import assert from 'node:assert/strict';
import {cp,mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const dropdownsOnly=process.env.SETTINGS_QA==='dropdowns';
const folder=await mkdtemp(join(tmpdir(),'cg-settings-qa-')),extension=join(folder,'extension');if(!dropdownsOnly)await cp(resolve('extension'),extension,{recursive:true});
const context=await chromium.launchPersistentContext(join(folder,'profile'),{executablePath:process.env.PDF_VIEWER_CHROME,headless:true,viewport:{width:1000,height:850},args:dropdownsOnly?[]:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
 if(dropdownsOnly){
  const page=await context.newPage(),artifacts=resolve('test-dist/settings-dropdowns');await mkdir(artifacts,{recursive:true});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  const css=await readFile('extension/shared/ui.css','utf8')+await readFile('extension/settings/settings.css','utf8');
  const dropdowns=await readFile('extension/settings/dropdowns.js','utf8');
  assert.equal(await page.evaluate(()=>CSS.supports('appearance','base-select')),true,'test browser must support anchored select pickers');
  const result=[];
  for(const locale of ['en-US','zh-CN'])for(const scheme of ['light','dark'])for(const width of [1000,360]){
   await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:scheme});
   const labels=locale==='en-US'?['Light warm ivory (default)','Warm ivory','Warm ivory +1','Warm ivory +2','Cool blue-white']:['轻微暖白（默认）','暖米白','柔和米白','柔暖米白','冷蓝白'];
   const options=labels.map((text,i)=>`<option value="${i}">${text}</option>`).join('');
   await page.setContent(`<html lang="${locale}" data-white-softer-tone="warm-minus-1"><head><style>${css}</style><style>main{width:min(290px,calc(100% - 40px));margin:70px 20px 0 auto}select{width:100%;font-size:13px}.menu{margin-bottom:24px}#short{width:122px}#edge{position:fixed;right:20px;bottom:12px;width:122px}</style></head><body><main><div class="menu"><select id="tone">${options}</select></div><div class="menu"><select id="long">${Array.from({length:60},(_,i)=>`${i===6?'<hr>':''}<option value="${i}">America/Zone ${i}</option>`).join('')}</select></div><div class="menu"><select id="short"><option value="en">English</option><option value="zh">简体中文</option></select></div><select id="disabled" disabled>${options}</select></main><select id="edge">${options}</select><script>${dropdowns}</script></body></html>`);
   for(const id of ['tone','long','short','edge']){
    const select=page.locator('#'+id);await select.click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=await select.evaluate(s=>{const a=s.getBoundingClientRect(),o=s.options[0].getBoundingClientRect(),p=getComputedStyle(s,'::picker(select)');return{open:s.matches(':open'),left:a.left,width:a.width,top:a.top,pickerLeft:parseFloat(p.left),pickerTop:parseFloat(p.top),pickerWidth:parseFloat(p.width),pickerHeight:parseFloat(p.height),optionLeft:o.left}});
    assert.equal(box.open,true,id+' did not open');
    assert.ok(Math.abs(box.pickerLeft-box.left)<1,id+' picker is not left-aligned');
    assert.ok(Math.abs(box.pickerWidth-box.width)<1,id+' picker width differs from control');
    assert.ok(Math.abs(box.optionLeft-5-box.left)<1,id+' rendered option is not inside the aligned panel');
    assert.ok(box.pickerTop>=0&&box.pickerTop+box.pickerHeight<=720,id+' picker overflows the viewport');
    if(id==='edge')assert.ok(box.pickerTop<box.top,'bottom-edge picker must flip above its control');
    if(id==='long')assert.ok(await select.evaluate(s=>s.options[59].getBoundingClientRect().bottom>720||s.options[59].getBoundingClientRect().bottom>parseFloat(getComputedStyle(s,'::picker(select)').top)+parseFloat(getComputedStyle(s,'::picker(select)').height)),'long list must be scrollable');
    if(id==='tone'&&width===1000)await page.screenshot({path:join(artifacts,`${locale}-${scheme}.png`)});
    await page.keyboard.press('Escape');assert.equal(await select.evaluate(s=>s.matches(':open')),false);
   }
   await page.evaluate(()=>{window.qaChanges=[];document.querySelector('#short').addEventListener('change',event=>qaChanges.push(event.target.value))});
   await page.locator('#short').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await page.locator('#short').inputValue(),'zh','keyboard selection failed');
   assert.deepEqual(await page.evaluate(()=>qaChanges),['zh'],'native change event must fire once');
   await page.locator('#tone').click();await page.mouse.click(10,10);assert.equal(await page.locator('#tone').evaluate(s=>s.matches(':open')),false,'outside click must dismiss');
   assert.equal(await page.locator('#disabled').isDisabled(),true);
   await page.locator('#disabled').click({force:true});assert.equal(await page.locator('#disabled').evaluate(s=>s.matches(':open')),false,'disabled controls must not open');
   assert.ok(await page.locator('#edge selectedcontent').evaluate(s=>s.getBoundingClientRect().height<22&&s.getBoundingClientRect().right<=s.closest('select').getBoundingClientRect().right-32),'long selected labels must stay on one line before the arrow');
   await page.evaluate(()=>{const s=document.querySelector('#tone');s.replaceChildren(new Option('Replacement A','a'),new Option('Replacement B','b'));s.value='b';const d=document.createElement('select');d.id='dynamic';d.append(new Option('Dynamic','dynamic'));document.querySelector('main').append(d)});
   await page.waitForFunction(()=>document.querySelector('#tone > button selectedcontent')?.textContent==='Replacement B'&&document.querySelector('#dynamic')?.hasAttribute('data-settings-picker'));
   assert.equal(await page.locator('#tone > button').count(),1,'option repopulation must not duplicate the select button');
   result.push({locale,scheme,width,aligned:true});
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({dropdowns:result,screenshots:artifacts},null,2));
 }else{
 const basePage=await context.newPage();await basePage.goto('chrome://extensions');const id=await basePage.evaluate(()=>document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id);
 const base=`chrome-extension://${id}/`,worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 let page=await context.newPage();await page.goto(base+'settings/all-settings.html');await page.waitForSelector('#version');
 for(const path of ['satellites.html','any-copy.html','all-settings.html']){
  const closed=page.waitForEvent('close'),next=await context.newPage();await next.goto(base+'settings/'+path);await closed;page=next;await page.waitForSelector('#version');assert.equal(basePage.isClosed(),false);
 }
 await page.locator('[data-feature-link=pageDisplay]').click();await page.waitForURL('**/settings/page-display.html');await page.reload();await page.waitForSelector('#version');
 const closed=page.waitForEvent('close'),opened=context.waitForEvent('page');await worker.evaluate(()=>chrome.windows.create({url:chrome.runtime.getURL('settings/satellites.html'),focused:false}));page=await opened;await closed;await page.waitForSelector('#version');
 const ids=await worker.evaluate(async()=>{const a=await chrome.tabs.create({url:chrome.runtime.getURL('settings/native-scroll.html'),active:false});const b=await chrome.tabs.create({url:chrome.runtime.getURL('settings/no-autoplay.html'),active:false});return[a.id,b.id]});
 await worker.evaluate(async ids=>{for(let i=0;i<100;i++){const all=(await chrome.runtime.getContexts({contextTypes:['TAB']})).filter(c=>c.documentUrl?.includes('/settings/'));if(all.length===1&&all[0].tabId===ids[1])return;await new Promise(r=>setTimeout(r,30));}throw Error('Settings not deduplicated')},ids);
 page=context.pages().find(p=>!p.isClosed()&&p.url().endsWith('settings/no-autoplay.html'));assert.ok(page);await page.waitForSelector('#version');
 // Failed confirmation must not be replayed when the user later presses Escape.
 await page.goto(base+'settings/all-settings.html');await page.waitForSelector('#reset-settings-card');
 await page.evaluate(()=>{const send=chrome.runtime.sendMessage;window.qaResetSend=send;window.qaResetCount=0;chrome.runtime.sendMessage=(message,...args)=>{
  if(message.type==='UI_RESET_ALL_SETTINGS'){window.qaResetCount++;return Promise.resolve({ok:false,error:'QA storage unavailable'});}return send(message,...args);
 };});
 await page.locator('#reset-settings-card button').click();await page.locator('#reset-settings-dialog .danger-button').click();
 await page.waitForFunction(()=>qaResetCount===1&&!document.querySelector('#reset-settings-card button').disabled);
 await page.locator('#reset-settings-card button').click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('#reset-settings-dialog').open);
 assert.equal(await page.evaluate(()=>qaResetCount),1,'Escape must not repeat an earlier confirmed reset');
 await page.evaluate(()=>{chrome.runtime.sendMessage=qaResetSend;delete window.qaResetSend;});
 const result={settings:'newest tab only across features/windows/rapid creation; same-tab navigation and reload preserved',progress:[]};
 // Invoke the actual injected choice renderer, replacing only the privileged
 // transport so no document is fetched/downloaded and no real tab is opened.
 for(const locale of ['en-US','zh-CN'])for(const scheme of ['light','dark'])for(const width of [1000,360]){
  await page.setViewportSize({width,height:850});await page.emulateMedia({colorScheme:scheme});
  const before=await page.evaluate(async locale=>{
   const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=attach.call(this,options);window.qaRoot=root;return root};
   window.qaSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=()=>new Promise(resolve=>window.qaChoice=resolve);
   const {showDocumentChoice}=await import('../content/document-preview/document-preview-dialog.js');const zh=locale==='zh-CN';
   showDocumentChoice({id:'qa',filename:'Example document.docx',labels:{title:'Document Preview',close:zh?'关闭':'Close',preview:zh?'预览':'Preview',download:zh?'下载':'Download',remember:zh?'本网站本次均执行所选操作':'Use this action for this website visit',failed:'Could not prepare',loading:zh?'正在准备文档…':'Preparing the document…'}});
   Element.prototype.attachShadow=attach;const dialog=qaRoot.querySelector('dialog');await Promise.all(dialog.getAnimations().map(animation=>animation.finished));const r=dialog.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};
  },locale);
  await page.evaluate(()=>qaRoot.querySelector('.primary').click());
  const loading=await page.evaluate(()=>{const d=qaRoot.querySelector('dialog').getBoundingClientRect(),p=qaRoot.querySelector('.progress'),b=qaRoot.querySelector('.primary').getBoundingClientRect();return{x:d.x,y:d.y,width:d.width,height:d.height,visible:getComputedStyle(p).visibility,progressRight:p.getBoundingClientRect().right,previewLeft:b.left,status:qaRoot.querySelector('.error').textContent}});
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(loading[key]-before[key])<1,key+' changed while loading');assert.equal(loading.visible,'visible');assert.ok(loading.progressRight<loading.previewLeft);assert.equal(loading.status,'');
  if(width===360&&scheme==='dark')await page.screenshot({path:join(folder,'progress-'+locale+'.png')});
  await page.evaluate(()=>{qaChoice({ok:false});chrome.runtime.sendMessage=qaSend});await page.waitForFunction(()=>qaRoot.querySelector('.error').textContent==='Could not prepare');assert.equal(await page.evaluate(()=>qaRoot.querySelector('.primary').disabled),false);
  await page.evaluate(()=>{qaRoot.host.remove();delete globalThis[Symbol.for('cosmic-gemini.document-preview.dialog')];});result.progress.push({locale,scheme,width,stable:true});
 }
 console.log(JSON.stringify({...result,screenshots:folder},null,2));
 }
}finally{await context.close();await rm(join(folder,'profile'),{recursive:true,force:true})}
