// Focused Settings navigation and persistence checks in a disposable browser profile.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder=await mkdtemp(join(tmpdir(),'cg-satellites-pages-')),artifacts=resolve('test-dist/satellites-pages');
await mkdir(artifacts,{recursive:true});let context;
try{
 context=await chromium.launchPersistentContext(join(folder,'profile'),{executablePath:process.env.PDF_VIEWER_CHROME,headless:true,viewport:{width:1100,height:850},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${resolve('extension')}`,`--load-extension=${resolve('extension')}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const base=`chrome-extension://${new URL(worker.url()).host}/`;
 let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'settings/all-settings.html');await page.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 assert.equal(await page.locator('[data-settings-card="orbiters"]').count(),1);
 await page.locator('[data-settings-card="orbiters"]').click();await page.waitForURL('**/orbiters.html');
 const assertPage=async(id,heading,present,absent)=>{
   await page.waitForFunction(id=>document.body.dataset.feature===id,id);
   assert.equal(await page.locator('.primary > .card:first-child h1').textContent(),heading);
   assert.equal(await page.locator('.wordmark strong').textContent(),heading);
   assert.equal(await page.locator('#feature-directory h3').count(),0);
   assert.equal(await page.locator('.satellite-category-heading').count(),0);
   assert.equal(await page.locator(present).count(),1);assert.equal(await page.locator(absent).count(),0);
   assert.equal(await page.locator('#feature-directory [data-feature-target]').count(),id==='satellites'?9:8);
   assert.equal(await page.locator('#feature-directory').getAttribute('data-directory-page'),id);
   assert.equal(await page.locator(`[data-feature-link="${id}"]`).getAttribute('aria-current'),'page');
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[data-feature-target]')].every(b=>!!document.getElementById(b.dataset.featureTarget))),true);
 };
 await assertPage('orbiters','Orbiters','#zhihuImageAdjustmentEnabled','#websiteFixerEnabled');
 await page.locator('#zhihuImageAdjustmentEnabled').check();await page.waitForFunction(()=>!document.querySelector('#zhihuImageAdjustmentEnabled').disabled);
 await page.locator('[data-feature-target="orbiter-leetcode-dark-mode"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-feature-target="orbiter-leetcode-dark-mode"]').getAttribute('aria-current')==='location');
 await page.locator('[data-feature-link="satellites"]').click();await page.waitForURL('**/satellites.html');
 await assertPage('satellites','Satellites','#websiteFixerEnabled','#zhihuImageAdjustmentEnabled');
 assert.equal(await page.locator('.satellite-category-heading').count(),0);
 await page.locator('#mailtoCaptureEnabled').check();await page.waitForFunction(()=>!document.querySelector('#mailtoCaptureEnabled').disabled);
 await page.goBack();await page.waitForURL('**/orbiters.html');
 await assertPage('orbiters','Orbiters','#zhihuImageAdjustmentEnabled','#websiteFixerEnabled');
 assert.equal(await page.locator('#zhihuImageAdjustmentEnabled').isChecked(),true);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#zhihuImageAdjustmentEnabled').checked);
 for(const locale of ['en-US','zh-CN']){
   await page.evaluate(async locale=>{const response=await chrome.runtime.sendMessage({type:'UI_SET_LOCALE',locale});if(!response.ok)throw Error(response.error);},locale);
   await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
   for(const scheme of ['light','dark']){
     await page.emulateMedia({colorScheme:scheme});await page.evaluate(()=>scrollTo(0,0));
     assert.equal(await page.locator('[data-feature-link="orbiters"] svg').count(),1);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await page.screenshot({path:join(artifacts,`site-${locale}-${scheme}.png`)});
   }
 }
 await page.evaluate(async()=>{await chrome.runtime.sendMessage({type:'UI_SET_LOCALE',locale:'en-US'})});
 await page.waitForFunction(()=>document.documentElement.lang==='en-US');
 await page.locator('[data-feature-link="satellites"]').click();await page.waitForFunction(()=>document.querySelector('#mailtoCaptureEnabled').checked);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(artifacts,'general-dark.png')});
 // A direct new-page open must participate in the existing single-Settings-tab policy.
 const closed=page.waitForEvent('close'),next=await context.newPage();await next.goto(base+'settings/orbiters.html');await closed;page=next;
 await page.waitForFunction(()=>document.querySelector('#zhihuImageAdjustmentEnabled').checked);
 const settingsTabs=await worker.evaluate(async()=>(await chrome.runtime.getContexts({contextTypes:['TAB']})).filter(c=>c.documentUrl?.includes('/settings/')).length);
 assert.equal(settingsTabs,1);
 await page.setViewportSize({width:420,height:850});await page.screenshot({path:join(artifacts,'site-narrow.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 await writeFile(join(artifacts,'README.md'),'# Satellites and Orbiters Settings pages\n\nRun scripts/test-satellites-pages-browser.mjs with PDF_VIEWER_PLAYWRIGHT and PDF_VIEWER_CHROME. It loads the actual extension in a disposable profile, verifies independent destinations/directories, collection branding without category subheadings, smooth scrolling, saved choices, reload/history navigation, language/theme rendering, narrow layout, and the single-Settings-tab policy. Screenshots contain only the test profile’s settings; no live browsing content or full logs are stored.\n');
 console.log('Passed: split destinations, exact headings, scoped directories, smooth navigation, independent preferences, history/reload, locale/themes, narrow layout, and one Settings tab.');
}finally{await context?.close();await rm(folder,{recursive:true,force:true});}
