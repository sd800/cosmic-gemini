// Focused split-incognito regression; uses a disposable Chrome profile and local fixture.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
const folder=await mkdtemp('/tmp/cg-context-qa-'), extension=resolve('extension');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="google" content="notranslate"><h1>Local context fixture</h1><a id="out" href="https://outside.test/">External</a>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port, host=name=>`http://${name}.example.test:${port}/`;
const context=await chromium.launchPersistentContext(folder,{headless:true,executablePath:process.env.CONTEXT_CHROME,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server']});
try {
 const prefs=await context.newPage();await prefs.goto('chrome://extensions');
 const id=await prefs.evaluate(()=>document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id);
 await prefs.evaluate(id=>new Promise(resolve=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,incognitoAccess:true},resolve)),id);
 await prefs.waitForFunction(id=>chrome.management.get(id).then(info=>!info.enabled),id);
 await prefs.evaluate(id=>new Promise((resolve,reject)=>chrome.management.setEnabled(id,true,()=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve())),id);
 await prefs.waitForFunction(id=>chrome.management.get(id).then(info=>info.enabled),id);
 console.log(await prefs.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},items=>resolve(items.map(i=>({state:i.state,runtime:i.runtimeErrors,manifest:i.manifestErrors})))))));
 await prefs.waitForTimeout(500); // Chrome rebuilds extension hosts after changing incognito access.
 await prefs.goto(`chrome-extension://${id}/settings/satellites.html`);
 const event=context.waitForEvent('page');await prefs.evaluate(()=>chrome.windows.create({incognito:true,url:chrome.runtime.getURL('settings/satellites.html')}));const privatePrefs=await event;await privatePrefs.waitForLoadState();
 for(const page of [prefs,privatePrefs])await page.waitForFunction(()=>document.querySelector('#websiteFixerEnabled'));
 const source={websiteFixer:{enabled:true,translateOverride:{enabled:true,whitelistDomains:['example.test']},stayOnPage:{enabled:true,whitelistDomains:['example.test']}},accessControl:{enabled:true,blockedDomains:['blocked.example.test']}};
 await prefs.evaluate(async value=>{const {normalizeSettings}=await import(chrome.runtime.getURL('core/config.js'));await chrome.storage.local.set({cosmicGeminiSettings:normalizeSettings(value)});},source);
 await prefs.waitForFunction(async()=>(await chrome.scripting.getRegisteredContentScripts()).length===3);
 const regularPage=await context.newPage();const created=context.waitForEvent('page');await privatePrefs.evaluate(()=>chrome.tabs.create({url:'about:blank'}));const privatePage=await created;
 await prefs.waitForFunction(async()=>{const r=(await chrome.declarativeNetRequest.getSessionRules()).find(r=>r.id===920001);return r?.condition.excludedTabIds?.length>=2;});
 const allowsLink=page=>page.evaluate(()=>{let reached=false;window.addEventListener('click',event=>{reached=true;event.preventDefault();},{capture:true,once:true});document.querySelector('#out').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,composed:true}));return reached;});
 await regularPage.goto(host('site'));await privatePage.goto(host('site'));
 assert.equal(await regularPage.locator('meta[name=google]').count(),0);
 assert.equal(await privatePage.locator('meta[name=google]').count(),1);
 assert.equal(await allowsLink(regularPage),false);assert.equal(await allowsLink(privatePage),true);
 await assert.rejects(regularPage.goto(host('blocked')),/ERR_BLOCKED_BY_CLIENT/);
 await privatePage.goto(host('blocked'));
 // Independent private policy must not unregister ordinary scripts or block ordinary tabs.
 await privatePrefs.evaluate(async()=>{const {normalizeSettings}=await import(chrome.runtime.getURL('core/config.js'));await chrome.storage.session.set({cosmicGeminiIncognitoSettings:normalizeSettings({websiteFixer:{enabled:true,translateOverride:{enabled:true,whitelistDomains:['example.test']}},accessControl:{enabled:true,blockedDomains:['private.example.test']}})});});
 await privatePrefs.waitForFunction(async()=>(await chrome.scripting.getRegisteredContentScripts()).some(s=>s.id.endsWith('-incognito')));
 await privatePage.goto(host('site'));await privatePage.waitForFunction(()=>!document.querySelector('meta[name=google]'));
 await regularPage.goto(host('site'));assert.equal(await regularPage.locator('meta[name=google]').count(),0);assert.equal(await allowsLink(regularPage),false);
 await assert.rejects(privatePage.goto(host('private')),/ERR_BLOCKED_BY_CLIENT/);await regularPage.goto(host('private'));
 const coldEvent=context.waitForEvent('page');await privatePrefs.evaluate(url=>chrome.tabs.create({url}),host('private'));const cold=await coldEvent;
 await cold.waitForFunction(()=>document.body&&location.href!=='about:blank');await cold.waitForLoadState().catch(()=>{});
 assert.doesNotMatch(await cold.locator('body').innerText(),/Local context fixture/,'a new private tab must also block its first navigation');await cold.close();
 const foreignEvent=context.waitForEvent('page');await privatePrefs.evaluate(url=>chrome.tabs.create({url}),host('blocked'));const foreign=await foreignEvent;
 await foreign.waitForFunction(()=>document.body&&location.href!=='about:blank');await foreign.waitForLoadState().catch(()=>{});
 await foreign.waitForFunction(()=>document.body?.innerText.includes('Local context fixture'));await foreign.close();
 const rules=await prefs.evaluate(()=>chrome.declarativeNetRequest.getSessionRules());
 assert.ok(rules.filter(r=>r.id>=930001&&r.id<932000).every(r=>r.condition.tabIds?.length));
 await privatePrefs.evaluate(()=>chrome.windows.getCurrent().then(w=>chrome.windows.remove(w.id))).catch(()=>{});
 const freshEvent=context.waitForEvent('page');await prefs.evaluate(url=>chrome.windows.create({incognito:true,url}),host('site'));const fresh=await freshEvent;await fresh.waitForLoadState();
 await prefs.waitForFunction(async()=>!(await chrome.storage.session.get('cosmicGeminiIncognitoSettings')).cosmicGeminiIncognitoSettings?.websiteFixer?.enabled);
 assert.equal(await fresh.locator('meta[name=google]').count(),1);assert.equal(await allowsLink(fresh),true);
 console.log('PASS: independent Website Fixer registrations/activation, scoped frame guards, Access Control ordinary/private isolation, first-navigation blocks, fresh private-session defaults.');
} finally {await context.close();server.close();await rm(folder,{recursive:true,force:true});}
