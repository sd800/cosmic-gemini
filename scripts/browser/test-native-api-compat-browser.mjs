// Browser API compatibility checks. Every request is fulfilled locally.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const browser = await chromium.launch({ headless: true, executablePath: process.env.PDF_VIEWER_CHROME });
const root = resolve('extension/content');
const suites=[
 ['video-download/video-download-page.js','https://fixture.test',null,()=>({
   frozen:()=>{const x=Object.preventExtensions(new XMLHttpRequest());x.open('GET','/ok');x.send();return x.readyState;},
   shadowed:()=>{const x=new XMLHttpRequest();x.addEventListener=null;x.open('GET','/ok');x.send();return x.readyState;},
   urlCoercion:()=>{const x=new XMLHttpRequest();let n=0;x.open('GET',{toString(){if(++n>1)throw Error('URL converted twice');return '/ok';}});x.send();return n;}
 })],
 ['ad-marshal/ad-marshal-runtime.js','https://www.qq.com',["cosmic-gemini.ad-marshal.runtime","enable","wwwQqCom"],()=>({
   xhr:()=>{const x=new XMLHttpRequest();let n=0;x.open('GET',{toString(){if(++n>1)throw Error('URL converted twice');return '/ok';}});x.send();return n;},
   fetch:async()=>{let n=0;const r=await fetch({toString(){if(++n>1)throw Error('URL converted twice');return '/ok';}});return [r.status,n];},
   attribute:()=>{const image=new Image();let n=0;image.setAttribute({toString(){if(++n>1)throw Error('Name converted twice');return 'src';}},'/ok');return n;},
   beacon:()=>{let n=0;const result=navigator.sendBeacon({toString(){if(++n>1)throw Error('URL converted twice');return '/ok';}});return [result,n];}
 })],
 ['website-fixer/website-fixer-stay.js','https://fixture.test','stay',()=>({
   form:()=>{const f=document.createElement('form'),button=document.createElement('button');f.addEventListener('submit',e=>e.preventDefault());button.hasAttribute=null;f.append(button);document.body.append(f);f.requestSubmit(button);return true;},
   go:()=>{let n=0;history.go({valueOf(){if(++n>1)throw Error('Delta converted twice');return 0;}});return n;},
   open:()=>{let n=0;const child=window.open({toString(){if(++n>1)throw Error('URL converted twice');return 'about:blank';}},'_blank');child?.close();return n;}
 })],
 ['shared/browser-identity.js','https://fixture.test','identity',()=>({
   dateRead:()=>{const d=new Date('2026-01-15T12:00:00Z');d.valueOf=()=>{throw Error('valueOf should not be called');};return d.getHours();},
   dateString:()=>{const d=new Date('2026-01-15T12:00:00Z');d.valueOf=()=>{throw Error('valueOf should not be called');};return /GMT/.test(d.toString());},
   dateWrite:()=>{const d=new Date('2026-01-15T12:00:00Z');d.getUTCMilliseconds=null;return Number.isFinite(d.setHours(9));}
 })],
 ['native-scroll/runtime.js','https://fixture.test',["cosmic-gemini.native-scroll.runtime","enable","standard"],()=>({
   synthetic:()=>{class AppEvent extends Event {get type(){throw Error('type should not be read');}} new AppEvent('app').preventDefault();return true;}
 })],
 ['clipboard-protect/clipboard-protect-runtime.js','https://fixture.test',["cosmic-gemini.clipboard-protect.runtime","enable"],()=>({
   synthetic:()=>{class AppEvent extends Event {get type(){throw Error('type should not be read');}} new AppEvent('app').stopImmediatePropagation();return true;}
 })],
 ['no-autoplay/no-autoplay-runtime.js','https://fixture.test','noAutoplay',()=>({
   audioNode:async()=>{const ctx=new AudioContext();try{class Node extends MediaElementAudioSourceNode{get context(){return 42;}} return new Node(ctx,{mediaElement:new Audio()}) instanceof AudioNode;}finally{await ctx.close();}},
   context:async()=>{class Context extends AudioContext{get state(){throw Error('state should not be read');}}const ctx=new Context();await ctx.close();return true;}
 })],
];
try{
 for(const [script,origin,activate,factory] of suites){
  let baseline;
  for(const active of [false,true]){
   const page=await browser.newPage({ timezoneId: 'UTC' });
   await page.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/manifest')return route.fulfill({json:{url:'https://media.test/clip.mp4'}});
    return route.fulfill({contentType:path==='/ok'?'text/plain':'text/html',body:'OK'});
   });
   await page.goto(origin);
   if(active){
    if(activate==='stay')await page.evaluate(()=>{window[Symbol.for('cosmic-gemini.stay-site-key')]=url=>new URL(url).hostname;});
    await page.addScriptTag({path:resolve(root,script)});
    await page.evaluate(activate=>{
      if(Array.isArray(activate))window[Symbol.for(activate[0])][activate[1]](activate[2]);
      if(activate==='stay')window.dispatchEvent(new Event('cosmic-gemini:website-fixer:stay:activate'));
      if(activate==='identity')window[Symbol.for('cosmic-gemini.browser-identity')].set('test',{timeZone:'Asia/Tokyo'},1);
      if(activate==='noAutoplay'){const r=window[Symbol.for('cosmic-gemini.no-autoplay.runtime')];r.onConfigure({detail:JSON.stringify({token:r.token,config:{active:true,mode:'standard',audioAllowed:true}})});}
    },activate);
   }
   const result=await page.evaluate(async source=>{
    const tests=eval('('+source+')')(),results={};
    for(const [name,run] of Object.entries(tests)){try{results[name]=await run();}catch(e){results[name]={error:e.message};}}
    return results;
   },factory.toString());
   for (const value of Object.values(result)) assert.ok(!value?.error, script + ': ' + JSON.stringify(result));
   if (!active) baseline = result;
   else {
    // Configuring the time zone changes the reported hour, with the same Date API.
    const expected = activate === 'identity' ? { ...baseline, dateRead: 21 } : baseline;
    assert.deepEqual(result, expected, script);
   }
   if (active && script.startsWith('video-download/')) {
    await page.evaluate(() => {
      window.discovered = false;
      window.addEventListener('message', event => {
        if (event.data?.candidates?.some(candidate => candidate.url === 'https://media.test/clip.mp4')) window.discovered = true;
      });
      const xhr = Object.preventExtensions(new XMLHttpRequest());
      xhr.open('GET', '/manifest'); xhr.responseType = 'json'; xhr.send();
    });
    await page.waitForFunction(() => window.discovered, null, { timeout: 3000 });
   }
   await page.close();
  }
 }
 console.log('PASS: native API compatibility across seven runtimes and media discovery from a real XHR.');
}finally{await browser.close();}
