// Source-domain policy and insecure HTTP regression, using only routed fixtures.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.CONTEXT_PLAYWRIGHT?pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href:'playwright');
const profile=await mkdtemp(join(tmpdir(),'cg-source-cleaner-')),folder=resolve('test-dist/url-tracking-cleaner/source-scope');await mkdir(folder,{recursive:true});
let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CONTEXT_CHROME,viewport:{width:1120,height:820},args:[`--disable-extensions-except=${resolve('extension')}`,`--load-extension=${resolve('extension')}`]});
 const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const requests=[];await context.route(/^https?:\/\/[^/]+\.(?:test|zhihu\.com|bilibili\.com)\//,route=>{
  requests.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Source scope fixture</title><a id="target" href="http://target.test/destination?utm_source=fixture&keep=1">Target</a><a id="listed-target" href="http://source.test/destination?utm_source=retained&keep=1">Listed target</a><a id="new" target="_blank" href="http://target.test/new?uTm_Source=fixture&keep=1">New tab</a><button id="script">Script navigation</button><script>document.querySelector("#script").onclick=()=>location.assign("http://target.test/script?utm_source=native&keep=1")</script>'});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),base=`chrome-extension://${new URL(worker.url()).host}/`;
 const settings=await context.newPage();await settings.goto(base+'settings/satellites.html');await settings.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 const card=settings.locator('#satellite-url-tracking-cleaner'),disclosure=card.locator('[data-card-disclosure]');if(await disclosure.getAttribute('aria-expanded')==='false')await disclosure.click();
 const master=settings.locator('#urlTrackingCleanerEnabled'),only=settings.locator('#urlTrackingOnlyListedSites'),list=settings.locator('#urlTrackingWebsites');
 assert.equal(await settings.locator('#urlTrackingScopeOption').isVisible(),false);
 await master.check();await only.waitFor({state:'visible'});await only.check();await list.waitFor({state:'visible'});
 await list.locator('input[type=text]').fill('http://news.source.test/story');await list.locator('button[type=submit]').click();await list.locator('code').filter({hasText:'source.test'}).waitFor();
 const inputBox=await list.locator('input[type=text]').boundingBox();assert.ok(inputBox.width>200&&inputBox.height>=32,'domain input retains the normal field dimensions inside the UTM row');
 await settings.waitForFunction(async()=>{const rule=(await chrome.declarativeNetRequest.getSessionRules()).find(rule=>rule.id===960001);return rule?.condition.initiatorDomains?.join()==='source.test';});
 const page=await context.newPage();
 const source=async(url='http://news.source.test/start')=>{await page.goto(url);await page.waitForFunction(()=>globalThis[Symbol.for('cosmic-gemini.url-tracking-cleaner.runtime')]?.active===true);};
 await source();assert.deepEqual(await page.evaluate(()=>[isSecureContext,typeof crypto.randomUUID]),[false,'undefined']);
 assert.match(await page.evaluate(()=>globalThis[Symbol.for('cosmic-gemini.url-tracking-cleaner.runtime')].token),/^[a-f0-9]{36}$/);
 requests.length=0;await page.locator('#target').click();await page.waitForURL('http://target.test/destination?keep=1');assert.equal(requests.some(url=>url.includes('utm_source=fixture')),false);
 await source('http://nested.news.source.test/start');const opening=context.waitForEvent('page');await page.locator('#new').click();const popup=await opening;await popup.waitForLoadState();assert.equal(popup.url(),'http://target.test/new?keep=1');await popup.close();
 await source();requests.length=0;await page.locator('#script').click();await page.waitForURL('http://target.test/script?keep=1');assert.equal(requests.some(url=>url.includes('utm_source=native')),false,'native initiator restriction cleans before the destination request');
 await page.goto('http://other.test/start');await page.locator('#target').click();await page.waitForURL('http://target.test/destination?utm_source=fixture&keep=1');
 await page.goto('http://other.test/start');await page.locator('#listed-target').click();await page.waitForURL('http://source.test/destination?utm_source=retained&keep=1');
 await page.goto('http://other.test/start');await page.evaluate(()=>location.assign('http://source.test/direct?utm_source=retained'));await page.waitForURL('http://source.test/direct?utm_source=retained');
 // UTM's child scope does not restrict the independently selected Bilibili rule.
 await settings.locator('#urlTrackingBilibiliParameters').check();
 await settings.waitForFunction(async()=>{const rule=(await chrome.declarativeNetRequest.getSessionRules()).find(rule=>rule.id===960003);return rule&&!rule.condition.initiatorDomains;});
 await page.goto('http://other.test/start');await page.evaluate(()=>window.open('http://www.bilibili.com/video/fixture?anything=remove','_self'));await page.waitForURL('http://www.bilibili.com/video/fixture');
 await settings.locator('#urlTrackingUtmParameters').uncheck();await settings.locator('#urlTrackingScopeOption').waitFor({state:'hidden'});assert.equal(await only.isChecked(),true);
 await settings.locator('#urlTrackingUtmParameters').check();await list.waitFor({state:'visible'});
 // Cache/reload keeps the normalized list and checkbox without exposing it off-master.
 await settings.reload();await settings.waitForFunction(()=>document.documentElement.dataset.localePending==='false');assert.equal(await only.isChecked(),true);assert.equal(await list.locator('code').textContent(),'source.test');
 await settings.locator('#language').selectOption('zh-CN');await settings.waitForFunction(()=>document.documentElement.lang==='zh-CN');await settings.emulateMedia({colorScheme:'dark'});await card.screenshot({path:join(folder,'scope-zh-dark.png')});
 await master.uncheck();await settings.locator('#urlTrackingScopeOption').waitFor({state:'hidden'});assert.equal(await only.isChecked(),true);
 await settings.waitForFunction(async()=>!(await chrome.declarativeNetRequest.getSessionRules()).some(rule=>[960001,960003].includes(rule.id)));
 await master.check();await list.waitFor({state:'visible'});await only.uncheck();await list.waitFor({state:'hidden'});
 await settings.waitForFunction(async()=>{const rule=(await chrome.declarativeNetRequest.getSessionRules()).find(rule=>rule.id===960001);return rule&&!rule.condition.initiatorDomains;});
 await page.goto('http://other.test/unrestricted?utm_source=removed&keep=1');assert.equal(page.url(),'http://other.test/unrestricted?keep=1');
 // The related image runtime also initializes without a secure-context UUID API.
 await settings.evaluate(async()=>{const response=await chrome.runtime.sendMessage({type:'UI_SET_ENABLED',featureId:'zhihuImageAdjustment',enabled:true});if(!response.ok)throw Error(response.error);});
 await page.goto('http://www.zhihu.com/question/fixture');await page.waitForFunction(()=>globalThis[Symbol.for('cosmic-gemini.zhihu-image-adjustment.runtime')]?.token);
 assert.equal(await page.evaluate(()=>typeof crypto.randomUUID),'undefined');assert.deepEqual(errors,[]);
 await writeFile(join(folder,'README.md'),'# Source-scoped URL cleaner\n\nRun scripts/browser/test-url-tracking-scope-browser.mjs using a disposable headless Chrome for Testing profile. All website requests are fulfilled from synthetic local route responses; no personal browser or external website is used. The HTTP fixture is genuinely nonsecure (randomUUID absent). Tests cover the cryptographic runtime fallback, UTM-only source eTLD+1/subdomains, independent Bilibili cleanup, nested checkbox/list UI and URL input, native initiator-domain transforms before the target request, scripted navigation/new tabs, unlisted sources/target-only matches, master/UTM hiding and saved choice, first-frame reload, unrestricted restoration, and the related HTTP image runtime. Keep the screenshot and this concise reference; no request logs are saved.\n');
 console.log('PASS: HTTP secure randomness, source-domain scope, native pre-navigation cleaning, script/new-tab links, unlisted-source exclusion, normalized list/cache, checkbox visibility, and master gating.');
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
