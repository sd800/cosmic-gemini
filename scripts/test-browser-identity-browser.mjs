// Browser API and request consistency using a local server and disposable profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder = await mkdtemp(join(tmpdir(), 'cg-browser-identity-'));
const artifacts = resolve('test-dist/website-knowledge-control'); await mkdir(artifacts,{recursive:true});
const requests=[],results=[],errors=[];
const server=createServer((request,response)=>{
  const headers={language:request.headers['accept-language']||'',gpc:request.headers['sec-gpc']||''};
  if(request.headers['sec-fetch-dest']==='document')requests.push({url:request.url,...headers});
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'; base-uri 'none'");
  if(request.url.startsWith('/headers')){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(headers));return;}
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end('<!doctype html><title>Browser information fixture</title><main>Local browser information fixture</main>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let context;
try{
  context=await chromium.launchPersistentContext(join(folder,'profile'),{
    executablePath:process.env.PDF_VIEWER_CHROME,headless:true,viewport:{width:1000,height:800},
    ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']
  });
  context.setDefaultTimeout(10000);
  context.on('page',page=>page.on('pageerror',error=>errors.push(String(error))));
  const loader=await context.browser().newBrowserCDPSession();
  const {id}=await loader.send('Extensions.loadUnpacked',{path:resolve('extension')});
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/settings/satellites.html`);
  await settings.locator('#version').waitFor();
  const command=async message=>{
    const response=await settings.evaluate(message=>chrome.runtime.sendMessage(message),message);
    assert.equal(response.ok,true,response.error);return response.result;
  };
  const page=await context.newPage();
  await page.addInitScript(()=>{
    globalThis.fixture={locale:new Intl.DateTimeFormat().resolvedOptions().locale,zone:new Intl.DateTimeFormat().resolvedOptions().timeZone,
      nav:Object.getOwnPropertyDescriptors(Navigator.prototype),intl:Object.getOwnPropertyDescriptors(Intl),
      date:Object.getOwnPropertyDescriptors(Date.prototype),number:Object.getOwnPropertyDescriptors(Number.prototype),
      string:Object.getOwnPropertyDescriptors(String.prototype),Date,parse:Date.parse,fnToString:Function.prototype.toString,
      ua:navigator.userAgent,platform:navigator.platform,webdriver:navigator.webdriver};
  });
  const waitPolicy=()=>page.waitForFunction(()=>globalThis[Symbol.for('cosmic-gemini.website-knowledge-control.runtime')]
    &&navigator.globalPrivacyControl===true);
  const nativeUnselected=()=>page.evaluate(()=>{
    const unchanged=(owner,before)=>Object.entries(before).every(([key,d])=>{const now=Object.getOwnPropertyDescriptor(owner,key);return now?.value===d.value&&now?.get===d.get&&now?.set===d.set;});
    return {locale:fixture.locale,zone:fixture.zone,date:Date===fixture.Date&&unchanged(Date.prototype,fixture.date),
      intl:unchanged(Intl,fixture.intl),number:unchanged(Number.prototype,fixture.number),string:unchanged(String.prototype,fixture.string),
      navigatorLanguage:Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get===fixture.nav.language.get,
      legacy:['userLanguage','browserLanguage','systemLanguage'].filter(key=>key in navigator),
      otherSignals:navigator.userAgent===fixture.ua&&navigator.platform===fixture.platform&&navigator.webdriver===fixture.webdriver,
      functionToString:Function.prototype.toString===fixture.fnToString};
  });
  await command({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'globalPrivacyControl',enabled:true});
  await command({type:'UI_SET_ENABLED',featureId:'websiteKnowledgeControl',enabled:true});
  await page.goto(origin+'/?case=gpc');await waitPolicy();
  const baseline=await nativeUnselected();
  for(const name of ['date','intl','number','string','navigatorLanguage','otherSignals','functionToString'])assert.equal(baseline[name],true,name);
  assert.deepEqual(baseline.legacy,[]);
  let headers=await page.evaluate(()=>fetch('/headers').then(response=>response.json()));
  assert.equal(headers.gpc,'1');results.push({case:'gpc-only',unselectedNative:true});
  await command({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'languages',enabled:true,value:'de-DE'});
  await page.evaluate(()=>{history.pushState(null,'','/?case=same-document#section');});
  headers=await page.evaluate(()=>fetch('/headers').then(response=>response.json()));
  assert.notEqual(headers.language,'de-DE','saved language must not change current-document requests');
  assert.equal((await nativeUnselected()).navigatorLanguage,true);
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/frame?case=retained';document.body.append(frame);});
  await page.frameLocator('iframe').locator('main').waitFor();
  const frame=page.frames().find(frame=>frame.url().includes('/frame?case=retained'));
  await frame.waitForFunction(()=>navigator.globalPrivacyControl===true&&globalThis[Symbol.for('cosmic-gemini.website-knowledge-control.runtime')]);
  assert.notEqual(await frame.evaluate(()=>navigator.language),'de-DE','a late frame must not mix new Settings with the old tab profile');
  await page.goto(origin+'/?case=language');await waitPolicy();
  await page.waitForFunction(()=>navigator.language==='de-DE');
  assert.equal(requests.findLast(request=>request.url==='/?case=language').language,'de-DE','next-navigation header must be prepared before loading');
  headers=await page.evaluate(()=>fetch('/headers').then(response=>response.json()));
  assert.equal(headers.language,'de-DE');assert.equal(headers.gpc,'1');
  const contract=await page.evaluate(()=>{
    const getter=Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get;
    let illegal=false,constructible=false;
    try{getter.call({});}catch(error){illegal=error instanceof TypeError;}
    try{new Number.prototype.toLocaleString();constructible=true;}catch{}
    return {language:navigator.language,languages:[...navigator.languages],locale:new Intl.NumberFormat().resolvedOptions().locale,
      getterName:getter.name===fixture.nav.language.get.name,getterLength:getter.length===fixture.nav.language.get.length,illegal,constructible,
      numberLength:Number.prototype.toLocaleString.length===fixture.number.toLocaleString.value.length,
      stringLength:String.prototype.localeCompare.length===fixture.string.localeCompare.value.length,
      explicit:new Intl.NumberFormat('ja-JP').resolvedOptions().locale,zone:new Intl.DateTimeFormat().resolvedOptions().timeZone};
  });
  assert.equal(contract.locale,'de-DE');assert.equal(contract.zone,baseline.zone);
  for(const name of ['getterName','getterLength','illegal','numberLength','stringLength'])assert.equal(contract[name],true,name);
  assert.equal(contract.constructible,false);assert.equal(contract.explicit,'ja-JP');
  assert.deepEqual((await nativeUnselected()).legacy,[]);results.push({case:'language-and-gpc',navigationAndRequestsAligned:true,contracts:true});
  await command({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'languages',value:baseline.locale});
  await page.goto(origin+'/?case=matching');await waitPolicy();await page.waitForFunction(locale=>navigator.language===locale,baseline.locale);
  assert.equal((await nativeUnselected()).intl,true,'matching locale does not wrap native Intl');
  assert.equal((await nativeUnselected()).number,true);assert.equal((await nativeUnselected()).string,true);
  results.push({case:'matching-native-locale',unnecessaryWrappers:false});
  await command({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'languages',enabled:false});
  await command({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'globalPrivacyControl',enabled:false});
  await command({type:'UI_SET_WEBSITE_KNOWLEDGE_SETTING',category:'timeZone',enabled:true,value:'Asia/Tokyo'});
  await page.goto(origin+'/?case=timezone');
  await page.waitForFunction(()=>new Intl.DateTimeFormat().resolvedOptions().timeZone==='Asia/Tokyo');
  const dateContract=await page.evaluate(()=>{
    const options=new class{#year='numeric';get year(){return this.#year;}get timeZone(){return undefined;}};
    const methods=Object.entries(fixture.date).filter(([,d])=>typeof d.value==='function');
    return {navigatorUnchanged:Object.entries(fixture.nav).every(([key,d])=>Object.getOwnPropertyDescriptor(Navigator.prototype,key)?.get===d.get),
      names:methods.every(([key,d])=>Date.prototype[key].name===d.value.name&&Date.prototype[key].length===d.value.length),
      parse:Date.parse.length===fixture.parse.length&&Date.parse.name===fixture.parse.name,
      optionReceiver:new Intl.DateTimeFormat('en-US',Object.freeze(options)).resolvedOptions().timeZone,
      epoch:new Date('2026-01-15T12:00:00Z').getTime(),year:new Date('2026-01-15T12:00:00Z').getFullYear()};
  });
  assert.equal(dateContract.navigatorUnchanged,true);assert.equal(dateContract.names,true);assert.equal(dateContract.parse,true);
  assert.equal(dateContract.optionReceiver,'Asia/Tokyo');assert.equal(dateContract.epoch,Date.parse('2026-01-15T12:00:00Z'));assert.equal(dateContract.year,2026);
  headers=await page.evaluate(()=>fetch('/headers').then(response=>response.json()));assert.equal(headers.gpc,'');assert.notEqual(headers.language,'de-DE');
  results.push({case:'timezone-only',unselectedNavigatorNative:true,contracts:true});
  // Dedicated identity shares the same mechanism, but only on its authorized sites.
  const dedicated=await context.newPage();
  await context.route('https://claude.ai/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Dedicated identity fixture</title>'}));
  await command({type:'UI_SET_ENABLED',featureId:'websiteKnowledgeControl',enabled:false});
  await command({type:'UI_SET_CLAUDE_BROWSER_IDENTITY',featureId:'chineseResponseClaude',enabled:true});
  await dedicated.goto('https://claude.ai/fixture');
  await dedicated.waitForFunction(()=>navigator.language==='en-US'&&globalThis[Symbol.for('cosmic-gemini.chinese-response-claude.runtime')]);
  assert.deepEqual(await dedicated.evaluate(()=>['userLanguage','browserLanguage','systemLanguage'].filter(key=>key in navigator)),[]);
  assert.equal(await dedicated.evaluate(()=>{try{Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get.call({});return false;}catch(error){return error instanceof TypeError;}}),true);
  await dedicated.close();
  await command({type:'UI_SET_CLAUDE_BROWSER_IDENTITY',featureId:'chineseResponseClaude',enabled:false});
  await page.goto(origin+'/?case=disabled');
  assert.equal((await nativeUnselected()).intl,true);assert.equal((await nativeUnselected()).navigatorLanguage,true);
  assert.equal(requests.findLast(request=>request.url==='/?case=disabled').gpc,'');
  assert.deepEqual(errors,[]);
  await writeFile(join(artifacts,'results.json'),JSON.stringify({passed:true,results},null,2)+'\n');
  console.log('PASS: actual Chrome APIs, selected-category isolation, native no-ops, getter/method contracts, local main-frame/subresource headers, retained SPA profile, and dedicated-policy compatibility.');
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});}
