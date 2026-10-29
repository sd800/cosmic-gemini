// Focused real-extension website controls; disposable profile and authored pages.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder = await mkdtemp(join(tmpdir(), 'cg-page-display-'));
const artifacts = resolve('test-dist/page-display');
await mkdir(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 1100, height: 950 },
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
});
context.setDefaultTimeout(10000);
const version = JSON.parse(await readFile('extension/manifest.json','utf8')).version;
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
try {
  await context.route(/^https?:\/\/(?:[a-z]+\.)?(?:example\.co\.uk|other\.test)\//, route => route.fulfill({
    contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" },
    body: '<!doctype html><title>Page Display fixture</title><style>body{margin:0;background:white;color:black;font:18px system-ui}main{padding:30px}#color{position:fixed;left:0;top:0;width:24px;height:24px;background:rgb(255,0,0)}</style><main>Website controls fixture</main><div id="color"></div>'
  }));
  const loader = await context.browser().newBrowserCDPSession();
  const { id } = await loader.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const base = `chrome-extension://${id}/`;
  const a = await context.newPage(); await a.goto('https://a.example.co.uk/one');
  const b = await context.newPage(); await b.goto('https://b.example.co.uk/two');
  const other = await context.newPage(); await other.goto('https://other.test/');
  const layer = '[data-cosmic-gemini-page-display]';
  const settings = await context.newPage(); await settings.goto(base + 'settings/page-display.html');
  await settings.locator('#version').filter({ hasText: version }).waitFor();
  const saved = () => settings.evaluate(async () => (await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings.pageDisplay);
  const command = async message => {
    const response = await settings.evaluate(message => chrome.runtime.sendMessage(message), message);
    assert.equal(response.ok, true, response.error); return response.result;
  };
  const waitLayer = (page, present) => page.waitForFunction(({layer,present}) => !!document.querySelector(layer) === present, { layer, present });
  if (process.env.PAGE_DISPLAY_QA === 'cleanup') {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const tab=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(tab=>tab.url==='https://a.example.co.uk/one'));
    const pixels=page=>page.screenshot({clip:{x:2,y:2,width:12,height:12}});
    const baseline=await pixels(a);
    const master=settings.locator('#enabled'),rwp=settings.locator('#pageDisplayReduceWhitePointEnabled'),grey=settings.locator('#pageDisplayGreyscaleEnabled');
    const settled=()=>settings.waitForFunction(()=>!document.querySelector('#enabled').disabled);
    const appearance=async(reduction,greyscale)=>a.waitForFunction(({layer,reduction,greyscale})=>{
      const host=document.querySelector(layer);return host?.dataset.reduction===reduction&&host.dataset.greyscale===String(greyscale);
    },{layer,reduction,greyscale});
    const restored=async()=>{
      await Promise.all([a,b,other].map(page=>waitLayer(page,false)));
      assert.ok((await pixels(a)).equals(baseline),'actual page colors return immediately');
      assert.equal(await a.evaluate(()=>!!window[Symbol.for('cosmic-gemini.page-display.runtime')]),false);
    };
    await master.check();await settled();
    await rwp.check();await appearance('25',false);
    const reduced=await pixels(a);assert.equal(reduced.equals(baseline),false);
    await grey.check();await appearance('25',true);
    assert.equal((await pixels(a)).equals(reduced),false);
    // A controller that no longer synchronizes must not strand visual effects.
    await worker.evaluate(tabId=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>{
      globalThis[Symbol.for('cosmic-gemini.central')].sync=async()=>{};
    }}),tab.id);
    await grey.uncheck();await appearance('25',false);
    assert.ok((await pixels(a)).equals(reduced),'turning off Greyscale preserves reduction only');
    await grey.check();await appearance('25',true);
    await rwp.uncheck();await appearance('0',true);
    const greyscaleOnly=await pixels(a);
    assert.equal(greyscaleOnly.equals(baseline),false);
    await grey.uncheck();await restored();
    await rwp.check();await appearance('25',false);
    await grey.check();await appearance('25',true);
    await master.uncheck();await settled();await restored();
    assert.equal((await saved()).reduceWhitePoint.enabled,true);
    assert.equal((await saved()).greyscale.enabled,true);
    await master.check();await appearance('25',true);
    const popup=await context.newPage();
    await popup.addInitScript(tab=>{
      const send=chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage=message=>message.type==='UI_GET_ACTIVE_PAGE_STATE'
        ?chrome.tabs.update(tab.id,{active:true}).then(()=>send(message)):send(message);
    },tab);
    await popup.goto(base+'popup/index.html');
    await popup.waitForFunction(()=>document.querySelector('#reduceWhitePoint-status').getAttribute('aria-pressed')==='true');
    await popup.locator('#reduceWhitePoint-status').click();await appearance('0',true);
    assert.ok((await pixels(a)).equals(greyscaleOnly),'popup reduction-off removes only the shade');
    await popup.waitForFunction(()=>!document.querySelector('#greyscale-status').disabled);
    await popup.locator('#greyscale-status').click();await restored();
    await popup.close();await settings.bringToFront();
    await command({type:'UI_SET_PAGE_DISPLAY_SETTING',name:'reduceWhitePointEnabled',value:true});
    await command({type:'UI_SET_PAGE_DISPLAY_SETTING',name:'greyscaleEnabled',value:true});
    await appearance('25',true);
    // Simulate lost Window listeners and an unavailable bridge, retaining the old main runtime.
    await a.evaluate(()=>{
      const runtime=window[Symbol.for('cosmic-gemini.page-display.runtime')];
      for(const [event,handler]of [['configure',runtime.onConfigure],['dispose',runtime.onDispose],['bridge-ready',runtime.onBridgeReady]])
        window.removeEventListener('cosmic-gemini:page-display:'+event,handler,true);
    });
    await worker.evaluate(tabId=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>{
      globalThis[Symbol.for('cosmic-gemini.page-display.bridge')].dispose();
    }}),tab.id);
    assert.equal(await a.locator(layer).count(),1,'orphaned display layer is retained before the explicit stop');
    await command({type:'UI_SET_ENABLED',featureId:'pageDisplay',enabled:false});
    await restored();
    await command({type:'UI_SET_ENABLED',featureId:'pageDisplay',enabled:true});
    await appearance('25',true);
    assert.equal(await a.locator(layer).count(),1,'re-enable creates exactly one layer');
    await master.uncheck();await settled();await restored();
    await a.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.id='fullscreen-color';canvas.width=100;canvas.height=100;
      const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(255,0,0)';ctx.fillRect(0,0,100,100);
      const button=document.createElement('button');button.id='enter-fullscreen';button.textContent='Full screen';
      button.onclick=()=>canvas.requestFullscreen();document.body.append(canvas,button);
    });
    await a.bringToFront();await a.locator('#enter-fullscreen').click();
    await a.waitForFunction(()=>document.fullscreenElement?.id==='fullscreen-color');
    // Sample inside the fullscreen canvas, not its black letterbox margins.
    const fullscreenPixels=()=>a.screenshot({clip:{x:540,y:465,width:12,height:12}});
    const fullscreenBaseline=await fullscreenPixels();
    await command({type:'UI_SET_ENABLED',featureId:'pageDisplay',enabled:true});
    await appearance('25',true);
    await a.waitForFunction(layer=>document.querySelector(layer)?.matches(':popover-open'),layer);
    assert.equal((await fullscreenPixels()).equals(fullscreenBaseline),false);
    await command({type:'UI_SET_ENABLED',featureId:'pageDisplay',enabled:false});
    await waitLayer(a,false);
    assert.ok((await fullscreenPixels()).equals(fullscreenBaseline),'fullscreen top-layer pixels also restore without leaving full screen');
    await a.evaluate(()=>document.exitFullscreen());await restored();
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'cleanup.md'),'# Immediate Page Display changes\n\nRun PAGE_DISPLAY_QA=cleanup with scripts/test-page-display-browser.mjs and the shared local Playwright/Chrome variables. Tests compare the rendered color patch against its original pixels and against each single effect. Coverage includes Settings and popup toggles, multi-tab changes, master authorization with saved child choices, a non-synchronizing controller, missing bridge/Window listeners, orphan cleanup, clean reactivation, and Canvas fullscreen top-layer cleanup. It uses authored pages and an isolated disposable profile; no browser logs or user content are retained.\n');
    console.log('PASS: Settings/popup changes immediately restore actual pixels, preserve the remaining child effect, recover orphaned layers, and reactivate cleanly across open tabs.');
  } else if (process.env.PAGE_DISPLAY_QA === 'slider') {
    const slider=settings.locator('#reduceWhitePointReduction');
    const master=settings.locator('#enabled'),global=settings.locator('#pageDisplayReduceWhitePointEnabled'),site=settings.locator('#reduceWhitePointSiteSpecific');
    const settled=()=>settings.waitForFunction(()=>!document.querySelector('#enabled').disabled
      &&(!document.querySelector('#enabled').checked||(!document.querySelector('#pageDisplayReduceWhitePointEnabled').disabled
      &&!document.querySelector('#reduceWhitePointSiteSpecific').disabled)));
    const availability=disabled=>settings.waitForFunction(disabled=>document.querySelector('#reduceWhitePointReduction').disabled===disabled,disabled);
    await master.check();await settled();await availability(true);
    await site.check();await settled();await availability(false);
    await slider.fill('40');await slider.dispatchEvent('change');await settled();
    await settings.waitForFunction(async()=>((await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings.pageDisplay.reduceWhitePoint.reduction===.4));
    await settings.reload();await settings.locator('#version').waitFor();await settled();await availability(false);
    await global.check();await settled();await site.uncheck();await settled();await availability(false);
    await site.check();await settled();await global.uncheck();await settled();await availability(false);
    await site.uncheck();await settled();await availability(true);
    await site.check();await settled();await availability(false);
    await master.uncheck();await settled();await availability(true);
    await master.check();await settled();await availability(false);
    assert.equal(await slider.inputValue(),'40');
    assert.equal((await saved()).reduceWhitePoint.enabled,false,'editing Reduction must not enable its page effect');
    assert.deepEqual(errors,[]);
    console.log('PASS: Reduction availability follows either child switch, master disable/restore, saved strength, and reload.');
  } else {
  assert.equal(await settings.locator('#reduceWhitePointSiteSpecific').isDisabled(), true);
  assert.equal(await settings.locator('#reduceWhitePointWebsites').isVisible(), false);
  await settings.locator('#enabled').check();
  await settings.waitForFunction(() => !document.querySelector('#reduceWhitePointSiteSpecific').disabled);
  await settings.locator('#reduceWhitePointSiteSpecific').check();
  const list = settings.locator('#reduceWhitePointWebsites'); await list.waitFor();
  await list.locator('input').fill('https://www.EXAMPLE.co.uk/path?q=1');
  await list.locator('button[type=submit]').click();
  await list.locator('code').filter({ hasText: /^example.co.uk$/ }).waitFor();
  await settings.locator('#pageDisplayReduceWhitePointEnabled').check();
  await waitLayer(a, true); await waitLayer(b, true); await waitLayer(other, false);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const tab = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://a.example.co.uk/one'));
  const popup = await context.newPage();
  // A real popup leaves its webpage active. Restore that active tab before reads.
  await popup.addInitScript(tab => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = message => message.type === 'UI_GET_ACTIVE_PAGE_STATE'
      ? chrome.tabs.update(tab.id, { active: true }).then(() => send(message)) : send(message);
  }, tab);
  await popup.goto(base + 'popup/index.html');
  await popup.waitForFunction(() => document.querySelector('#reduceWhitePoint-status').getAttribute('aria-pressed') === 'true');
  await popup.locator('#reduceWhitePoint-status').click();
  await waitLayer(a, false); await waitLayer(b, false); await waitLayer(other, false);
  assert.deepEqual((await saved()).reduceWhitePoint.siteRules, []);
  await popup.locator('#reduceWhitePoint-status').click();
  await waitLayer(a, true); await waitLayer(b, true);
  assert.deepEqual((await saved()).reduceWhitePoint.siteRules, ['example.co.uk']);
  await popup.close();
  await settings.bringToFront();
  await settings.locator('#reduceWhitePointSiteSpecific').uncheck();
  await waitLayer(other, true);
  assert.deepEqual((await saved()).reduceWhitePoint.siteRules, ['example.co.uk']);
  await settings.locator('#reduceWhitePointSiteSpecific').check();
  await waitLayer(other, false);
  await settings.locator('#pageDisplayGreyscaleEnabled').check();
  await waitLayer(other, true);
  await other.waitForFunction(layer => {
    const host = document.querySelector(layer); return host?.dataset.greyscale === 'true' && host.dataset.reduction === '0';
  }, layer);
  await settings.locator('#pageDisplayGreyscaleEnabled').uncheck(); await waitLayer(other, false);
  await settings.locator('#enabled').uncheck(); await waitLayer(a, false); await waitLayer(b, false);
  await settings.waitForFunction(() => document.querySelector('#reduceWhitePointWebsites').disabled);
  assert.equal(await list.locator('input').isDisabled(), true);
  await settings.locator('#enabled').check(); await waitLayer(a, true);
  await settings.locator('[data-feature-link=allSettings]').click();
  await settings.locator('[data-settings-card=pageDisplay]').click();
  await settings.waitForFunction(() => document.querySelector('#reduceWhitePointSiteSpecific')?.checked === true);
  await list.locator('code').filter({ hasText: /^example.co.uk$/ }).waitFor();
  await settings.reload(); await list.locator('code').filter({ hasText: /^example.co.uk$/ }).waitFor();
  const bottomGap = () => settings.evaluate(() => {
    const panel = document.querySelector('#reduceWhitePointWebsites'), card = panel.closest('.card');
    const last = [...panel.children].filter(node => getComputedStyle(node).display !== 'none').at(-1);
    return card.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  });
  const gaps = [];
  for (const locale of ['en-US', 'zh-CN']) for (const scheme of ['light', 'dark']) {
    await command({ type: 'UI_SET_LOCALE', locale });
    await settings.emulateMedia({ colorScheme: scheme });
    await settings.waitForFunction(locale => document.documentElement.lang === locale, locale);
    await settings.setViewportSize({ width: 1100, height: 950 });
    await settings.screenshot({ path: join(artifacts, `${locale}-${scheme}.png`) });
    const gap = await bottomGap();
    assert.ok(gap >= 16 && gap <= 32, 'website list has excess or insufficient bottom space: ' + gap);
    gaps.push({locale,scheme,gap});
  }
  await list.locator('button[aria-label]').click();
  await list.locator('.empty').waitFor(); await waitLayer(a, false);
  const emptyGap = await bottomGap();
  assert.ok(emptyGap >= 16 && emptyGap <= 32, 'empty list bottom space: ' + emptyGap);
  await settings.setViewportSize({ width: 390, height: 850 });
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await settings.screenshot({ path: join(artifacts, 'empty-zh-narrow.png') });
  await settings.locator('#reduceWhitePointSiteSpecific').uncheck();
  assert.equal(await list.isVisible(), false);
  await settings.waitForFunction(() => { const control = document.querySelector('#reduceWhitePointSiteSpecific'); return !control.checked && !control.disabled; });
  const globalGap = await settings.evaluate(() => { const row = document.querySelector('[for=reduceWhitePointSiteSpecific]'); return row.closest('.card').getBoundingClientRect().bottom-row.getBoundingClientRect().bottom; });
  assert.ok(globalGap >= 16 && globalGap <= 28, 'hidden list bottom space: ' + globalGap);
  await settings.screenshot({ path: join(artifacts, 'global-zh-narrow.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'README.md'), '# Page Display website controls\n\nRun `scripts/test-page-display-browser.mjs` with the shared local Playwright and Chrome for Testing paths in `PDF_VIEWER_PLAYWRIGHT` and `PDF_VIEWER_CHROME`. The script uses an isolated temporary profile and authored pages, then deletes the profile. Screenshots show both languages and themes, plus the empty list and global mode at a narrow width. No personal browser, account, documents, or network downloads are used.\n\nVerified: eTLD+1 list editing, subdomain-wide popup toggles, live multi-tab updates, global mode restoration, Greyscale independence, master disable/restore, Settings navigation and reload, readable layout, and compact bottom spacing.\n');
  console.log(JSON.stringify({passed:true,gaps,emptyGap,globalGap,screenshots:artifacts}));
  }
} finally { await context.close(); await rm(folder, { recursive: true, force: true }); }
