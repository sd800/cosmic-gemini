// Native navigation and Settings checks in a disposable profile; no external sites.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const dir=await mkdtemp(join(tmpdir(),'cg-url-cleaner-')),artifacts=resolve('test-dist/url-tracking-cleaner');await mkdir(artifacts,{recursive:true});
const requests=[];const server=createServer((req,res)=>{
 requests.push({url:req.url,method:req.method});
 if(req.url.startsWith('/redirect')){res.writeHead(302,{Location:'/destination?utm_source=redirect&keep=1'});res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Cleaner fixture</title><h1>Navigation fixture</h1><a id="open" target="_blank" href="/opened?utm_campaign=new&keep=1">Open</a><form id="post" method="post" action="/submitted?utm_source=form&keep=1"><button>Submit</button></form>');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));let context;
try{
 context=await chromium.launchPersistentContext(join(dir,'profile'),{executablePath:process.env.PDF_VIEWER_CHROME,headless:true,viewport:{width:1100,height:850},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${resolve('extension')}`,`--load-extension=${resolve('extension')}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${new URL(worker.url()).host}/`,origin=`http://127.0.0.1:${server.address().port}`;
 const settings=await context.newPage();const errors=[];settings.on('pageerror',error=>errors.push(error.message));await settings.goto(base+'settings/satellites.html');
 await settings.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 const master=settings.locator('#urlTrackingCleanerEnabled'),utm=settings.locator('#urlTrackingUtmParameters'),bilibili=settings.locator('#urlTrackingBilibiliParameters');
 assert.equal(await master.isChecked(),false);assert.equal(await utm.isChecked(),true);assert.equal(await utm.isDisabled(),true);assert.equal(await bilibili.isChecked(),false);
 const page=await context.newPage();await page.goto(origin+'/?utm_source=off');assert.match(page.url(),/utm_source=off/);
 await master.check();await settings.waitForFunction(()=>!document.querySelector('#urlTrackingCleanerEnabled').disabled);
 await settings.waitForFunction(async()=>(await chrome.declarativeNetRequest.getSessionRules()).some(rule=>rule.id===960001));
 const input='/?utm_source=one&utm_medium=mail&utm_campaign=launch&utm_source=two&utm_id=123&utm_content=card&keep=a%20b&keep=c+q&gclid=keep#chapter';
 requests.length=0;await page.goto(origin+input);assert.equal(page.url(),origin+'/?keep=a%20b&keep=c+q&gclid=keep#chapter');
 assert.equal(requests.find(request=>request.method==='GET'&&request.url.startsWith('/?')).url,'/?keep=a%20b&keep=c+q&gclid=keep');
 await page.goto(origin+'/?UTM_SOURCE=upper&keep=1');assert.equal(page.url(),origin+'/?keep=1');
 await page.goto(origin+'/?utm_custom=keep&keep=1');assert.equal(page.url(),origin+'/?utm_custom=keep&keep=1');
 await page.goto(origin+'/?utm_source&keep=1');assert.equal(page.url(),origin+'/?keep=1');
 await page.goto(origin+'/redirect');assert.equal(page.url(),origin+'/destination?keep=1');
 await page.locator('#post button').click();await page.waitForURL('**/submitted?utm_source=form&keep=1');assert.equal(requests.find(request=>request.method==='POST').url,'/submitted?utm_source=form&keep=1');
 // Subresources retain their original queries.
 await page.evaluate(()=>{const frame=document.createElement('iframe');frame.id='embedded';frame.src='/frame?utm_source=embedded';document.body.append(frame)});
 await page.waitForFunction(()=>document.querySelector('#embedded').contentDocument?.title==='Cleaner fixture');
 assert.equal(requests.some(request=>request.url==='/frame?utm_source=embedded'),true);
 // A newly opened tab is included before its first network navigation.
 await page.goto(origin+'/launch');await page.waitForFunction(()=>globalThis[Symbol.for('cosmic-gemini.url-tracking-cleaner.runtime')]?.active===true);
 const linkGuards=await page.evaluate(()=>{
   const make=()=>{const link=document.createElement('a');link.href='/guard?utm_source=guard&keep=1';document.body.append(link);return link};
   const download=make();download.download='fixture';download.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}));
   const canceled=make(),event=new MouseEvent('click',{bubbles:true,cancelable:true});event.preventDefault();canceled.dispatchEvent(event);
   return {download:download.getAttribute('href'),canceled:canceled.getAttribute('href')};
 });
 assert.match(linkGuards.download,/utm_source=guard/);assert.match(linkGuards.canceled,/utm_source=guard/);
 const opened=context.waitForEvent('page');await page.locator('#open').click();const newTab=await opened;
 await newTab.waitForLoadState();assert.equal(newTab.url(),origin+'/opened?keep=1');assert.equal(requests.some(request=>request.url==='/opened?utm_campaign=new&keep=1'),false);await newTab.close();
 await page.evaluate(()=>history.pushState({test:true},'', '?utm_source=client-state#part'));assert.equal(page.url(),origin+'/launch?utm_source=client-state#part','in-page URL changes are not monitored or rewritten');
 // Bilibili handling is explicit, destination-scoped, and covers every subdomain.
 const biliRequests=[];
 await context.route(/^https:\/\/(?:[^/]+\.)?bilibili\.com\//,route=>{biliRequests.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Bilibili query fixture</title><p>Local routed fixture</p>'})});
 await bilibili.check();await settings.waitForFunction(()=>!document.querySelector('#urlTrackingBilibiliParameters').disabled);
 for(const target of ['https://www.bilibili.com/video/BV1test000001?trackid=test&spm_id_from=333','https://account.bilibili.com/account/home?spm_id_from=333#section','https://space.bilibili.com/12345678?spm_id_from=333','https://bilibili.com/?anything=yes']){
   await page.goto(target);assert.equal(page.url(),target.split('?')[0]);
 }
 assert.equal(biliRequests.every(url=>!url.includes('?')),true,'query removal precedes the destination request');
 await page.goto(origin+'/launch');
 // Independent master/suboption choices and first-frame cache survive history/reload.
 await utm.uncheck();await settings.waitForFunction(()=>!document.querySelector('#urlTrackingUtmParameters').disabled);
 await page.goto(origin+'/?utm_source=suboff');assert.match(page.url(),/utm_source=suboff/);
 await master.uncheck();await settings.reload();await settings.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 assert.equal(await utm.isChecked(),false);assert.equal(await utm.isDisabled(),true);
 await master.check();await settings.waitForFunction(()=>!document.querySelector('#urlTrackingCleanerEnabled').disabled);await utm.check();await settings.waitForFunction(()=>!document.querySelector('#urlTrackingUtmParameters').disabled);
 // Native navigation blocks remain effective after cleanup; temporary allowances do not suppress cleaning.
 await worker.evaluate(async()=>chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:9900011,priority:100,action:{type:'block'},condition:{urlFilter:'/blocked',resourceTypes:['main_frame']}},{id:9900012,priority:200,action:{type:'allow'},condition:{urlFilter:'/allowed',resourceTypes:['main_frame']}}]}));
 const blocked=await context.newPage();await assert.rejects(blocked.goto(origin+'/blocked?utm_source=blocked'),/ERR_BLOCKED_BY_CLIENT/);await blocked.close();
 const allowed=await context.newPage();await allowed.goto('about:blank#cleaner-allowed');await settings.waitForFunction(async()=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url==='about:blank#cleaner-allowed');return tab&&(await chrome.declarativeNetRequest.getSessionRules()).find(rule=>rule.id===960001)?.condition.tabIds.includes(tab.id)});await allowed.goto(origin+'/allowed?utm_source=permitted&keep=1');assert.equal(allowed.url(),origin+'/allowed?keep=1');await allowed.close();
 for(const locale of ['en-US','zh-CN']){
   await settings.evaluate(async locale=>{const result=await chrome.runtime.sendMessage({type:'UI_SET_LOCALE',locale});if(!result.ok)throw Error(result.error)},locale);
   await settings.waitForFunction(locale=>document.documentElement.lang===locale,locale);
   for(const scheme of ['light','dark']){await settings.emulateMedia({colorScheme:scheme});await settings.locator('#satellite-url-tracking-cleaner').screenshot({path:join(artifacts,`settings-${locale}-${scheme}.png`)});}
 }
 await settings.locator('[data-feature-link="allSettings"]').click();await settings.locator('[data-feature-link="satellites"]').click();assert.equal(await master.isChecked(),true);assert.equal(await utm.isChecked(),true);assert.equal(await bilibili.isChecked(),true);
 // Reset removes only owned native rules and restores both saved defaults.
 await settings.evaluate(async()=>{const result=await chrome.runtime.sendMessage({type:'UI_RESET_ALL_SETTINGS'});if(!result.ok)throw Error(result.error)});
 await settings.waitForFunction(async()=>!(await chrome.declarativeNetRequest.getSessionRules()).some(rule=>[960001,960003].includes(rule.id)));
 assert.equal(await worker.evaluate(async()=>(await chrome.declarativeNetRequest.getSessionRules()).some(rule=>rule.id===9900012)),true);
 await page.goto(origin+'/?utm_source=reset');assert.match(page.url(),/utm_source=reset/);assert.deepEqual(errors,[]);
 await writeFile(join(artifacts,'README.md'),'# URL Tracking Cleaner fixtures\n\nRun scripts/test-url-tracking-cleaner-browser.mjs with PDF_VIEWER_PLAYWRIGHT and PDF_VIEWER_CHROME. It uses the actual extension and a local HTTP server in a disposable profile. Coverage includes default/master/UTM/Bilibili state, native removal across Bilibili subdomains, preserved query encoding and fragments, repeated/bare/uppercase tags, redirects, new tabs, POST/iframe exclusion, navigation blocks/allowances, locale/theme screenshots, Settings history/cache, and reset. Unit coverage in test/url-tracking-cleaner.test.mjs includes native failure/readback/storage rollback, context scoping, lifecycle, and sibling-rule preservation. No external page content or full logs are retained.\n');
 console.log('Passed: native UTM/Bilibili cleaning, query/fragment preservation, redirect/new-tab navigation, POST/frame exclusion, blocks/allowances, independent option persistence, locale/themes, and reset.');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
