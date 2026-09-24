// Isolated real-extension checks for rendered whites, including white text and page UI.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder = await mkdtemp(join(tmpdir(), 'cg-white-softer-'));
const artifacts = resolve('test-dist/white-softer');
await mkdir(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 1000, height: 720 },
  args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`]
});
const colors = { warm: [232,230,227], 'warm-plus-1': [216,214,211], 'warm-plus-2': [208,206,203], cool: [206,224,242] };
function brightest(buffer) {
  const result = spawnSync('python3', ['-c', 'from PIL import Image\nimport sys,io,json\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")\nprint(json.dumps(max(im.getdata(),key=sum)))'], { input: buffer });
  assert.equal(result.status, 0, String(result.stderr));
  return JSON.parse(result.stdout);
}
const errors = [];
try {
  context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  const css = `body{margin:0;background:#101010;color:white;font:18px Arial}header{padding:20px}main{display:grid;grid-template-columns:repeat(4,160px);gap:20px;padding:20px}.tile{width:160px;height:100px}.white,.near-white,.modal-white{background:white}.near-white{background:#f5f5f5}.black{background:black}.mid{background:#888}.text{font:bold 80px/100px monospace;background:black;color:white}.icon{background:black}iframe{width:160px;height:100px;border:0}dialog,#site-popover{border:0;padding:20px}dialog .modal-white,#site-popover .modal-white{width:240px;height:150px}#full{padding:20px}#full:fullscreen{background:white;color:black}.inverted{filter:invert(1) hue-rotate(180deg)}`;
  await context.route(/^https?:\/\/(?:frame\.)?white-softer\.test\//, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
    const child = url.hostname.startsWith('frame.');
    return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'none'; style-src 'self'; frame-src https://frame.white-softer.test" }, body: child
      ? '<!doctype html><link rel="stylesheet" href="/fixture.css"><div class="tile white"></div>'
      : '<!doctype html><meta charset="utf-8"><title>White Softer fixture</title><link rel="stylesheet" href="/fixture.css"><header><input id="input" aria-label="Type here"><button id="click">Click</button><button id="fullscreen">Full screen</button></header><main><div class="tile white"></div><div class="tile near-white"></div><div class="tile text">HH</div><div class="tile mid"></div><div class="tile black"></div><canvas class="tile canvas" width="160" height="100"></canvas><svg class="tile icon" viewBox="0 0 160 100"><rect x="10" y="10" width="100" height="80" fill="white"/></svg><iframe src="https://frame.white-softer.test/"></iframe></main><div id="full">Fullscreen area</div><dialog><div class="modal-white"></div><button>Dialog action</button></dialog><div id="site-popover" popover="auto"><div class="modal-white"></div></div>' });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const settings = await context.newPage(); await settings.goto(base + '/settings/satellites.html');
  const toggle = settings.locator('#whiteSofterEnabled');
  await toggle.waitFor({ state: 'attached' });
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await settings.locator('#whiteSofterTone').isDisabled(), true);
  const page = await context.newPage(); await page.goto('http://white-softer.test/');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,160,100);
    document.querySelector('#click').onclick = () => { document.querySelector('#click').textContent = 'Clicked'; };
    document.querySelector('#fullscreen').onclick = () => document.querySelector('#full').requestFullscreen();
  });
  const layer = '[data-cosmic-gemini-white-softer]';
  const screenshotColor = async selector => brightest(await page.locator(selector).screenshot());
  assert.deepEqual(await screenshotColor('.white'), [255,255,255]);
  assert.equal(await page.locator(layer).count(), 0);
  await settings.locator('.switch:has(#whiteSofterEnabled)').click();
  await page.locator(layer + ':popover-open').waitFor();
  for (const [tone, rgb] of Object.entries(colors)) {
    await settings.locator('#whiteSofterTone').selectOption(tone);
    await page.waitForFunction(({layer,tone}) => document.querySelector(layer)?.getAttribute('data-tone') === tone, {layer,tone});
    for (const selector of ['.white','.near-white','.text','.canvas','.icon','iframe']) assert.deepEqual(await screenshotColor(selector), rgb, `${tone}: ${selector}`);
    assert.deepEqual(await screenshotColor('.black'), [0,0,0]);
    assert.deepEqual(await screenshotColor('.mid'), [136,136,136]);
    assert.equal(await page.frameLocator('iframe').locator(layer).count(), 0);
  }
  await page.locator('#input').fill('Input still works');
  await settings.locator('#whiteSofterTone').selectOption('warm');
  await page.waitForFunction(layer => document.querySelector(layer)?.getAttribute('data-tone') === 'warm', layer);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'input');
  await page.locator('#click').click(); assert.equal(await page.locator('#click').textContent(), 'Clicked');
  await page.evaluate(() => document.querySelector('dialog').showModal());
  assert.deepEqual(await screenshotColor('dialog .modal-white'), colors.warm);
  assert.equal(await page.locator('dialog').evaluate(n => n.open), true);
  await page.evaluate(() => document.querySelector('dialog').close());
  await page.evaluate(() => document.querySelector('#site-popover').showPopover());
  assert.deepEqual(await screenshotColor('#site-popover .modal-white'), colors.warm);
  assert.equal(await page.locator('#site-popover').evaluate(n => n.matches(':popover-open')), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#site-popover').matches(':popover-open'));
  assert.equal(await page.locator(layer + ':popover-open').count(), 1, 'Escape only closes the page popover');
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  assert.deepEqual(await screenshotColor('#full'), colors.warm);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(() => document.documentElement.classList.add('inverted'));
  assert.deepEqual(await screenshotColor('.black'), colors.warm, 'top layer acts after page inversion');
  assert.deepEqual(await screenshotColor('.white'), [0,0,0]);
  await page.evaluate(() => document.documentElement.classList.remove('inverted'));
  await settings.reload();
  await settings.waitForFunction(() => document.querySelector('#whiteSofterEnabled')?.checked);
  assert.equal(await settings.locator('#whiteSofterTone').inputValue(), 'warm');
  const card = settings.locator('[data-product="white-softer"]');
  await card.screenshot({ path: join(artifacts, 'settings-en.png') });
  await settings.selectOption('#language', 'zh-CN');
  await settings.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await card.screenshot({ path: join(artifacts, 'settings-zh.png') });
  await page.screenshot({ path: join(artifacts, 'warm.png') });
  const command = message => settings.evaluate(async message => {
    const response = await chrome.runtime.sendMessage(message); if (!response.ok) throw Error(response.error);
  }, message);
  await command({type:'UI_SET_PAGE_DISPLAY_SETTING',name:'reduceWhitePointEnabled',value:true});
  await page.locator('[data-cosmic-gemini-page-display]').waitFor();
  await settings.locator('.switch:has(#whiteSofterEnabled)').click();
  await page.locator(layer).waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-cosmic-gemini-page-display]').count(), 1);
  assert.equal(await settings.locator('#whiteSofterTone').isDisabled(), true);
  await command({type:'UI_SET_ENABLED',featureId:'pageDisplay',enabled:false});
  await page.locator('[data-cosmic-gemini-page-display]').waitFor({ state: 'detached' });
  assert.deepEqual(await screenshotColor('.white'), [255,255,255]);
  assert.deepEqual(await screenshotColor('.text'), [255,255,255]);
  assert.deepEqual(errors, []);
  console.log('PASS: four exact tones on backgrounds/text/canvas/icons/cross-origin frame, CSP, HTTP, input/focus, popovers/dialogs/fullscreen/inversion, persistence/localization, Page Display coexistence, disabled cleanup');
} finally { await context.close(); await rm(folder, { recursive: true, force: true }); }
