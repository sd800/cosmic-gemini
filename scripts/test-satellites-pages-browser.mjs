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
 await page.addInitScript(()=>{
   globalThis.settingsSwitchTransitions=[];
   document.addEventListener('transitionrun',event=>{
     if(event.target.matches?.('.switch span'))settingsSwitchTransitions.push(event.propertyName);
   },true);
 });
 await page.goto(base+'settings/all-settings.html');await page.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 assert.equal(await page.locator('[data-settings-card="orbiters"]').count(),1);
 await page.locator('[data-settings-card="orbiters"]').click();await page.waitForURL('**/orbiters.html');
 const disclosurePosition=button=>button.evaluate(node=>{
   const rect=node.getBoundingClientRect(),heading=node.parentElement.getBoundingClientRect();
   return{x:rect.x+rect.width/2,top:rect.top-heading.top};
 });
 const assertDisclosureColumn=async()=>{
   const points=await page.locator('[data-card-disclosure]').evaluateAll(nodes=>nodes.map(node=>{
     const rect=node.getBoundingClientRect(),heading=node.parentElement.getBoundingClientRect();
     const icon=node.parentElement.querySelector('.satellite-feature-icon')?.getBoundingClientRect();
     const title=node.parentElement.querySelector('.satellite-title h1')?.getBoundingClientRect();
     const control=node.parentElement.querySelector(':scope > .satellite-control > .switch, :scope > .context-label')?.getBoundingClientRect();
     return{x:rect.x+rect.width/2,top:rect.top-heading.top,iconOffset:icon&&title?title.y+title.height/2-icon.y-icon.height/2:0,controlOffset:control?rect.y+rect.height/2-control.y-control.height/2:0};
   }));
   assert.ok(points.every(point=>Math.abs(point.x-points[0].x)<1&&Math.abs(point.top-points[0].top)<1),'all disclosures share one column and header alignment');
   assert.ok(points.every(point=>Math.abs(point.iconOffset)<1&&Math.abs(point.controlOffset)<1),'title blocks align with icon centers, and switches align with chevrons');
 };
 const checkedCards=new Set();
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
   assert.equal(await page.locator('[data-card-disclosure]').count(),id==='satellites'?9:8);
   await assertDisclosureColumn();
   if(checkedCards.has(id))return;
   assert.equal(await page.locator('[data-card-disclosure][aria-expanded="false"]').count(),id==='satellites'?9:8);
   checkedCards.add(id);
   for(const button of await page.locator('[data-card-disclosure]').all()){
     const before=await disclosurePosition(button);
     await button.click();
     const after=await disclosurePosition(button);
     assert.ok(Math.abs(before.x-after.x)<1&&Math.abs(before.top-after.top)<1,'folding keeps the disclosure in its reserved position');
     const card=page.locator('#'+await button.getAttribute('data-card-disclosure'));
     assert.equal(await card.locator(':scope > .section-heading h1').first().isVisible(),true);
     assert.equal(await card.locator(':scope > .satellite-privacy').isVisible(),await card.locator(':scope > .satellite-privacy').count()>0);
     await button.click();
     assert.equal(await card.locator(':scope > .satellite-privacy').isVisible(),false);
   }
 };
 await assertPage('orbiters','Orbiters','#zhihuImageAdjustmentEnabled','#websiteFixerEnabled');
 assert.equal(await page.locator('#orbiter-chinese-response-claude .satellite-feature-icon svg').count(),1);
 const xhs=page.locator('#orbiter-xhs-image-dark-mode'),xhsDisclosure=xhs.locator(':scope > .section-heading > [data-card-disclosure]');
 const navigation=page.locator('#orbiter-xhs-navigation'),navigationDisclosure=navigation.locator('[data-card-disclosure]');
 assert.equal(await xhsDisclosure.getAttribute('aria-expanded'),'false');
 assert.equal(await xhs.locator('h1').first().isVisible(),true);assert.equal(await page.locator('#xhsImageDarkModeEnabled').isVisible(),true);
 assert.equal(await navigation.isVisible(),true);assert.equal(await page.locator('#xhsNavigationEnabled').isVisible(),true);
 assert.equal(await navigation.locator('[data-i18n="xhsNavigationHelp"]').isVisible(),false);
 await page.locator('[data-feature-target="orbiter-xhs-navigation"]').click();
 assert.equal(await xhsDisclosure.getAttribute('aria-expanded'),'false');assert.equal(await navigationDisclosure.getAttribute('aria-expanded'),'true');
 assert.equal(await navigation.locator('[data-i18n="xhsNavigationHelp"]').isVisible(),true);
 await xhs.screenshot({path:join(artifacts,'xhs-independent-folding.png')});
 await navigationDisclosure.click();
 const separatorGaps=await xhs.evaluate(card=>{
   const first=card.querySelector(':scope > .section-heading').getBoundingClientRect();
   const section=card.querySelector('.xhs-navigation-item'),divider=section.getBoundingClientRect();
   const second=section.querySelector('.section-heading').getBoundingClientRect();
   return{above:divider.top-first.bottom,below:second.top-divider.top-parseFloat(getComputedStyle(section).borderTopWidth)};
 });
 assert.ok(Math.abs(separatorGaps.above-separatorGaps.below)<1,'folded peer headers have balanced separator spacing');
 await page.emulateMedia({colorScheme:'dark'});await xhs.screenshot({path:join(artifacts,'xhs-both-folded-dark.png')});
 await page.emulateMedia({colorScheme:'light'});await navigationDisclosure.click();
 await xhsDisclosure.focus();await page.keyboard.press('Space');assert.equal(await xhsDisclosure.getAttribute('aria-expanded'),'true');
 await page.keyboard.press('Enter');assert.equal(await xhsDisclosure.getAttribute('aria-expanded'),'false');
 await xhsDisclosure.click();
 await page.locator('#zhihuImageAdjustmentEnabled').check();await page.waitForFunction(()=>!document.querySelector('#zhihuImageAdjustmentEnabled').disabled);
 await page.locator('[data-feature-target="orbiter-leetcode-dark-mode"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-feature-target="orbiter-leetcode-dark-mode"]').getAttribute('aria-current')==='location');
 await page.locator('[data-feature-link="satellites"]').click();await page.waitForURL('**/satellites.html');
 await assertPage('satellites','Satellites','#websiteFixerEnabled','#zhihuImageAdjustmentEnabled');
 const documentCard=page.locator('#satellite-document-preview'),documentDisclosure=documentCard.locator('[data-card-disclosure]');
 assert.equal(await page.locator('#documentPreviewEnabled').isVisible(),true);assert.equal(await page.locator('#documentOpenFile').isVisible(),false);
 assert.equal(await documentCard.locator('[data-i18n="documentPreviewDescription"]').isVisible(),false);
 assert.equal(await documentCard.locator('.satellite-privacy').isVisible(),false);
 assert.equal(await documentDisclosure.evaluate(button=>button.getAttribute('aria-controls').split(' ').every(id=>!!document.getElementById(id))),true);
 await page.keyboard.press('1');await page.waitForSelector('[data-developer-mode]');
 assert.equal(await documentCard.locator('[data-developer-feature="documentPreview"]').isVisible(),false);
 await page.keyboard.press('1');await page.waitForSelector('[data-developer-mode]',{state:'detached'});
 // Collapsing is presentation-only; even disabled products retain a usable master.
 await page.locator('#documentPreviewEnabled').check();await page.waitForFunction(()=>!document.querySelector('#documentPreviewEnabled').disabled);
 assert.equal(await documentDisclosure.getAttribute('aria-expanded'),'false');
 await page.locator('#documentPreviewEnabled').uncheck();await page.waitForFunction(()=>!document.querySelector('#documentPreviewEnabled').disabled);
 assert.equal(await page.locator('.satellite-category-heading').count(),0);
 await page.locator('#mailtoCaptureEnabled').check();await page.waitForFunction(()=>!document.querySelector('#mailtoCaptureEnabled').disabled);
 await page.goBack();await page.waitForURL('**/orbiters.html');
 await assertPage('orbiters','Orbiters','#zhihuImageAdjustmentEnabled','#websiteFixerEnabled');
 assert.equal(await page.locator('#zhihuImageAdjustmentEnabled').isChecked(),true);
 await page.goForward();await page.waitForURL('**/satellites.html');
 assert.equal(await documentDisclosure.getAttribute('aria-expanded'),'false','in-page navigation keeps the current document layout choice');
 await page.goBack();await page.waitForURL('**/orbiters.html');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#zhihuImageAdjustmentEnabled').checked);
 await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-settings-hydrating'));
 assert.deepEqual(await page.evaluate(()=>settingsSwitchTransitions),[],'restoring saved switches does not animate');
 await page.locator('#zhihuImageAdjustmentEnabled').uncheck();
 await page.waitForFunction(()=>!document.querySelector('#zhihuImageAdjustmentEnabled').disabled&&settingsSwitchTransitions.length>0);
 await page.locator('#zhihuImageAdjustmentEnabled').check();await page.waitForFunction(()=>!document.querySelector('#zhihuImageAdjustmentEnabled').disabled);
 for(const locale of ['en-US','zh-CN']){
   await page.evaluate(async locale=>{const response=await chrome.runtime.sendMessage({type:'UI_SET_LOCALE',locale});if(!response.ok)throw Error(response.error);},locale);
   await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
   for(const scheme of ['light','dark']){
     await page.emulateMedia({colorScheme:scheme});await page.evaluate(()=>scrollTo(0,0));
     assert.equal(await page.locator('[data-feature-link="orbiters"] svg').count(),1);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await assertDisclosureColumn();
     await page.screenshot({path:join(artifacts,`site-${locale}-${scheme}.png`)});
   }
 }
 await page.evaluate(async()=>{await chrome.runtime.sendMessage({type:'UI_SET_LOCALE',locale:'en-US'})});
 await page.waitForFunction(()=>document.documentElement.lang==='en-US');
 await navigationDisclosure.click();
 await page.locator('[data-feature-link="satellites"]').click();await page.waitForFunction(()=>document.querySelector('#mailtoCaptureEnabled').checked);
 assert.equal(await documentDisclosure.getAttribute('aria-expanded'),'false','refresh retains the other collection’s saved layout');
 await page.locator('[data-feature-target="satellite-document-preview"]').click();
 assert.equal(await documentDisclosure.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#documentOpenFile').isVisible(),true);
 await documentDisclosure.click();
 for(const locale of ['en-US','zh-CN']){
   await page.evaluate(async locale=>{await chrome.runtime.sendMessage({type:'UI_SET_LOCALE',locale})},locale);
   await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
   assert.equal(await documentDisclosure.getAttribute('title'),locale==='zh-CN'?'展开内容':'Expand details');
   for(const colorScheme of ['light','dark']){
     await page.emulateMedia({colorScheme});await documentCard.screenshot({path:join(artifacts,`collapsed-${locale}-${colorScheme}.png`)});
     await assertDisclosureColumn();
   }
 }
 // The synchronous first frame must restore folding even before the controller loads.
 await page.route('**/settings/page.js',route=>route.abort());
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 assert.equal(await documentCard.getAttribute('data-card-collapsed'),'true');
 assert.equal(await documentCard.locator('[data-i18n="documentPreviewDescription"]').isVisible(),false);
 await page.unroute('**/settings/page.js');
 await page.reload();await page.waitForFunction(()=>document.querySelector('[data-card-disclosure="satellite-document-preview"]')?.getAttribute('aria-expanded')==='false');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(artifacts,'general-dark.png')});
 // A direct new-page open must participate in the existing single-Settings-tab policy.
 const closed=page.waitForEvent('close'),next=await context.newPage();await next.goto(base+'settings/orbiters.html');await closed;page=next;
 await page.waitForFunction(()=>document.querySelector('#zhihuImageAdjustmentEnabled').checked);
 assert.equal(await page.locator('[data-card-disclosure="orbiter-xhs-navigation"]').getAttribute('aria-expanded'),'false','reopening Settings retains the independent XHS layout');
 const settingsTabs=await worker.evaluate(async()=>(await chrome.runtime.getContexts({contextTypes:['TAB']})).filter(c=>c.documentUrl?.includes('/settings/')).length);
 assert.equal(settingsTabs,1);
 await page.setViewportSize({width:420,height:850});await page.screenshot({path:join(artifacts,'site-narrow.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await assertDisclosureColumn();
 // Reset clears layout choices together with the other Settings preferences.
 await page.locator('[data-feature-link="allSettings"]').click();
 await page.locator('#reset-settings-card button').click();
 await page.locator('#reset-settings-dialog .danger-button').click();
 await page.waitForFunction(()=>localStorage.getItem('cosmicGeminiSettingsCardLayout')===null);
 await page.waitForFunction(()=>document.documentElement.dataset.localePending==='false');
 await page.locator('[data-feature-link="satellites"]').click();
 await page.waitForFunction(()=>document.body.dataset.feature==='satellites');
 assert.equal(await page.locator('[data-card-disclosure][aria-expanded="false"]').count(),9);
 assert.deepEqual(errors,[]);
 await writeFile(join(artifacts,'README.md'),'# Satellites and Orbiters Settings pages\n\nRun scripts/test-satellites-pages-browser.mjs with PDF_VIEWER_PLAYWRIGHT and PDF_VIEWER_CHROME. It loads the actual extension in a disposable profile, verifies independent destinations/directories, collection branding, smooth scrolling, saved choices, reload/history navigation, language/theme rendering, narrow layout, and the single-Settings-tab policy. Card checks cover folded defaults, pointer/keyboard disclosure, accessible content targets, available master switches while collapsed, hidden descriptions/privacy/Open file, independently folded XHS products, stable disclosure coordinates across cards/locales/widths, centered title/icon blocks, balanced XHS separator spacing, Claude heading artwork, directory-driven expansion, persistence after reload/reopening, reset, and a first-frame test with the controller deliberately blocked. Startup switch transitions are absent, while manual toggles retain animations. Pure storage bounds, private-session separation, failure handling, and UI labels are checked in test/settings-card-layout.test.mjs. Screenshots contain only the test profile’s settings; no live browsing content or full logs are stored.\n');
 console.log('Passed: split destinations, exact headings, scoped directories, smooth navigation, independent preferences, history/reload, locale/themes, narrow layout, and one Settings tab.');
}finally{await context?.close();await rm(folder,{recursive:true,force:true});}
