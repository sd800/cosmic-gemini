// Native fragment and scripted anchor scrolling in an isolated browser.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder = await mkdtemp(join(tmpdir(), 'cg-native-anchors-'));
const artifacts = resolve('test-dist/native-scroll'); await mkdir(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 1000, height: 720 },
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
});
context.setDefaultTimeout(10000);
const key = 'cosmic-gemini.native-scroll.runtime';
const errors = [], results = [];
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
try {
  await context.route('https://native-scroll.test/**', route => {
    const path = new URL(route.request().url()).pathname;
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
      results.push({mode,link,smooth:true,scrollMargin:true});
      await page.locator('#reset').click();
      await page.waitForFunction(()=>Math.abs(scrollY)<=1);
    }
  }
  await command({ type: 'UI_SET_BEHAVIOR_RULE', featureId: 'nativeScroll', rule: 'native-scroll.test', behavior: 'inactive' });
  await page.waitForFunction(key => !window[Symbol.for(key)], key);
  assert.equal(await page.evaluate(()=>Event.prototype.preventDefault===originalCancel&&window.scrollTo===originalScroll),true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'smooth');
  assert.deepEqual(errors,[]);
  await writeFile(join(artifacts,'anchor-results.json'),JSON.stringify({passed:true,results},null,2)+'\n');
  console.log('PASS: Standard/Enhanced authored smooth fragments, scroll margins, scripted anchors immediately after guarded wheels, nested smooth CSS, and cleanup.');
} finally { await context.close(); await rm(folder,{recursive:true,force:true}); }
