// Native fragment and scripted anchor scrolling in an isolated browser.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder = await mkdtemp(join(tmpdir(), 'cg-native-anchors-'));
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 1000, height: 720 },
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
});
context.setDefaultTimeout(10000);
const key = 'cosmic-gemini.native-scroll.runtime';
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
try {
  await context.route('https://native-scroll.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/observers') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Native interaction fixture</title>
      <style>body{margin:0}#content{height:9000px}button{position:fixed;top:10px;padding:12px}#key{left:10px}#pointer{left:190px}#panel{position:fixed;right:10px;bottom:10px;width:180px;height:90px;overflow-x:auto}#panel div{width:1000px;height:40px}#conversation{position:fixed;left:20px;bottom:20px;width:260px;height:180px;overflow-y:auto;overscroll-behavior:contain}#conversation article{height:260px}</style>
      <main id="content"></main><button id="key">Keyboard action</button><button id="pointer">Pointer action</button><div id="panel"><div>Horizontal content</div></div>
      <section id="conversation"><article>Earlier message</article><article id="anchor-message">Current message</article><article>Latest message</article></section>` });
    if (path === '/style.css') return route.fulfill({ contentType: 'text/css', body: `
      html{scroll-behavior:smooth}body{margin:0;font:16px system-ui}nav{position:fixed;top:0;left:0;background:#eee;padding:12px;z-index:10}
      nav a{margin-right:20px}section{height:2200px;padding-top:1px}h2{scroll-margin-top:80px}
      #nested{position:fixed;right:10px;top:50px;width:180px;height:100px;overflow:auto;scroll-behavior:smooth}#nested div{height:500px}` });
    if (path === '/page.js') return route.fulfill({ contentType: 'text/javascript', body: `
      window.originalCancel=Event.prototype.preventDefault;window.originalScroll=window.scrollTo;window.wheelCancelled=[];
      window.addEventListener('wheel',event=>{event.preventDefault();wheelCancelled.push(event.defaultPrevented);
        requestAnimationFrame(()=>{document.documentElement.scrollTop+=event.deltaY;});},{capture:true,passive:false});
      document.querySelector('#reset').onclick=event=>{event.preventDefault();history.replaceState(null,'','/');scrollTo({top:0,behavior:'instant'});};
      document.querySelector('#scripted').onclick=event=>{event.preventDefault();document.querySelector('#two').scrollIntoView({behavior:'smooth'});};` });
    return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; object-src 'none'" }, body: `
      <!doctype html><title>Native Scroll anchor fixture</title><link rel="stylesheet" href="/style.css">
      <nav><a id="native" href="#one">Native anchor</a><a id="scripted" href="#two">Scripted anchor</a><a id="reset" href="#">Top</a></nav>
      <section>Start</section><section><h2 id="one">First section</h2></section><section><h2 id="two">Second section</h2></section>
      <aside id="nested"><div>Nested smooth scrolling</div></aside><script src="/page.js"></script>` });
  });
  const loader = await context.browser().newBrowserCDPSession();
  const { id } = await loader.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/settings/native-scroll.html`);
  const page = await context.newPage(); await page.goto('https://native-scroll.test/');
  const command = async message => {
    const response = await settings.evaluate(message => chrome.runtime.sendMessage(message), message);
    assert.equal(response.ok, true, response.error);
  };
  for (const mode of ['standard', 'enhanced']) {
    await command({ type: 'UI_SET_BEHAVIOR_RULE', featureId: 'nativeScroll', rule: 'native-scroll.test', behavior: mode });
    await page.waitForFunction(({key,mode}) => window[Symbol.for(key)]?.active && window[Symbol.for(key)].mode === mode, {key,mode});
    assert.deepEqual(await page.evaluate(() => [document.documentElement,document.querySelector('#nested')].map(n=>getComputedStyle(n).scrollBehavior)), ['smooth','smooth']);
    await page.locator('#reset').click();
    for (const [link,target,wheel] of [['native','one',false],['scripted','two',true]]) {
      if (wheel) {
        await page.mouse.move(500,140); await page.mouse.wheel(0,45);
        await page.waitForFunction(key => window[Symbol.for(key)].gestureUntil > performance.now(), key);
        assert.equal(await page.evaluate(()=>wheelCancelled.at(-1)), false, 'native wheel default is not cancelled');
      }
      const destination = await page.locator('#'+target).evaluate(n => n.getBoundingClientRect().top+scrollY-80);
      await page.locator('#'+link).click();
      await page.waitForFunction(destination => scrollY > 5 && scrollY < destination-5, destination, { polling: 'raf', timeout: 2000 });
      await page.waitForFunction(target => Math.abs(document.getElementById(target).getBoundingClientRect().top-80)<2, target);
      await page.locator('#reset').click();
      await page.waitForFunction(()=>Math.abs(scrollY)<=1);
    }
  }
  for (const mode of ['standard', 'enhanced']) {
    await command({ type: 'UI_SET_BEHAVIOR_RULE', featureId: 'nativeScroll', rule: 'native-scroll.test', behavior: mode });
    await page.goto('https://native-scroll.test/observers');
    await page.waitForFunction(({key,mode}) => window[Symbol.for(key)]?.active && window[Symbol.for(key)].mode === mode, {key,mode});
    await page.evaluate(() => {
      window.passiveCount=0;window.observerCount=0;
      window.passive=()=>passiveCount++;window.observer=()=>observerCount++;
      window.addEventListener('wheel',passive,{passive:true});
    });
    await page.mouse.move(500,300);await page.mouse.wheel(0,100);
    await page.waitForFunction(()=>passiveCount>0&&scrollY>0);
    assert.equal(await page.evaluate(key=>window[Symbol.for(key)].gestureUntil,key),0);
    await page.evaluate(()=>window.addEventListener('wheel',observer,{passive:false}));
    await page.mouse.wheel(0,100);await page.waitForFunction(()=>observerCount>0);
    assert.equal(await page.evaluate(key=>window[Symbol.for(key)].reported,key),false,'observers alone do not report takeover');
    await page.evaluate(()=>{
      window.layoutPosition = null;
      window.addEventListener('wheel',()=>requestAnimationFrame(()=>{
        scrollTo({top:1000,behavior:'instant'}); window.layoutPosition=scrollY;
      }),{once:true});
    });
    await page.mouse.wheel(0,80);await page.waitForFunction(()=>layoutPosition!==null);
    assert.equal(await page.evaluate(()=>layoutPosition),1000,'a non-canceling listener must not suppress later position restoration');

    await page.evaluate(()=>{
      const panel=document.querySelector('#conversation');panel.scrollTop=panel.scrollHeight;
      panel.addEventListener('wheel',event=>{
        event.preventDefault();window.panelCancelled=event.defaultPrevented;
        requestAnimationFrame(()=>{document.querySelector('#anchor-message').scrollIntoView({behavior:'instant',block:'start'});window.panelPosition=panel.scrollTop;});
      },{passive:false,once:true});
    });
    await page.mouse.move(150,625);await page.mouse.wheel(0,80);
    await page.waitForFunction(()=>typeof window.panelPosition==='number');
    assert.deepEqual(await page.evaluate(()=>[panelCancelled,panelPosition]),[true,260],'conversation scrollers own edge gestures and preserve local positioning');
    await page.mouse.move(500,300);
    await page.evaluate(()=>{
      window.canceller=event=>{event.returnValue=false;window.cancelled=event.defaultPrevented;requestAnimationFrame(()=>document.documentElement.scrollTop=0);};
      window.addEventListener('wheel',canceller,{passive:false});
      document.querySelector('#key').onkeydown=event=>{if(event.key==='Enter')scrollTo({top:1600,behavior:'instant'});};
      document.querySelector('#pointer').onpointerdown=()=>scrollTo({top:2200,behavior:'instant'});
    });
    const before=await page.evaluate(()=>scrollY);
    await page.mouse.wheel(0,100);await page.waitForFunction(before=>window.cancelled===false&&scrollY>before,before);
    await page.locator('#key').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>scrollY===1600);
    await page.mouse.move(500,300);await page.mouse.wheel(0,80);
    await page.waitForFunction(key=>window[Symbol.for(key)].gestureUntil>performance.now(),key);
    await page.locator('#pointer').click();await page.waitForFunction(()=>scrollY===2200);
    const nested=await page.evaluate(()=>{
      const panel=document.querySelector('#panel');
      window[Symbol.for('cosmic-gemini.native-scroll.runtime')].beginGesture();panel.scrollTo({left:100,behavior:'instant'});return panel.scrollLeft;
    });
    assert.equal(nested,100);
    await page.evaluate(()=>{
      window.removeEventListener('wheel',observer);window.removeEventListener('wheel',canceller);
      window.onceCount=0;window.abortedCount=0;window.optionReads=0;
      const callback=()=>{};const options={get capture(){optionReads++;return false;},passive:false};
      window.addEventListener('wheel',callback,options);window.removeEventListener('wheel',callback,options);
      window.addEventListener('wheel',()=>onceCount++,{once:true,passive:false});
      const controller=new AbortController();window.addEventListener('wheel',()=>abortedCount++,{signal:controller.signal,passive:false});controller.abort();
    });
    assert.equal(await page.evaluate(()=>optionReads),2,'native add/remove each read capture once');
    await page.mouse.click(500,300);await page.mouse.wheel(0,80);await page.waitForFunction(()=>onceCount===1);
    await page.mouse.wheel(0,80);
    assert.deepEqual(await page.evaluate(key=>[onceCount,abortedCount,window[Symbol.for(key)].gestureUntil],key),[1,0,0]);
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    await page.evaluate(()=>{window.touchMoves=0;window.addEventListener('touchmove',event=>{event.preventDefault();window.touchCancelled=event.defaultPrevented;window.touchTrusted=event.isTrusted;touchMoves++;},{passive:false});});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:500,y:500}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:500,y:400}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>touchMoves>0&&touchTrusted===true&&touchCancelled===false);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});await cdp.detach();
  }
  await command({ type: 'UI_SET_BEHAVIOR_RULE', featureId: 'nativeScroll', rule: 'native-scroll.test', behavior: 'inactive' });
  await page.waitForFunction(key => !window[Symbol.for(key)], key);
  assert.equal(await page.evaluate(()=>/\[native code\]/.test(Function.prototype.toString.call(Event.prototype.preventDefault))&&/\[native code\]/.test(Function.prototype.toString.call(window.scrollTo))),true);
  assert.deepEqual(errors,[]);

  console.log('PASS: Standard/Enhanced smooth anchors; native observer delivery and deferred layout position; local conversation scrolling; cancellation/root takeover protection; keyboard/pointer actions; horizontal APIs; native listener option counts, once/abort cleanup; trusted touch; deactivation.');
} finally { await context.close(); await rm(folder,{recursive:true,force:true}); }
