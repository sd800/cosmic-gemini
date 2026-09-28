// Isolated real-extension checks for rendered whites, including white text and page UI.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const colors = { 'warm-minus-1': [236,235,233], warm: [232,230,227], 'warm-plus-1': [216,214,211], 'warm-plus-2': [208,206,203], cool: [206,224,242] };
if (['documents', 'xml', 'native'].includes(process.env.WHITE_SOFTER_QA)) {
  await checkDocumentSurfaces();
  process.exit(0);
}
if (process.env.WHITE_SOFTER_QA === 'scroll') {
  await checkScrollingSurfaces();
  process.exit(0);
}
if (process.env.WHITE_SOFTER_QA === 'tabs') {
  await checkTabSwitching();
  process.exit(0);
}
const folder = await mkdtemp(join(tmpdir(), 'cg-white-softer-'));
const artifacts = resolve('test-dist/white-softer');
await mkdir(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 1000, height: 720 },
  ignoreDefaultArgs: ['--disable-extensions', '--disable-back-forward-cache'],
  args: ['--enable-features=ElasticOverscroll', '--enable-unsafe-extension-debugging']
});
function brightest(buffer) {
  const result = spawnSync('python3', ['-c', 'from PIL import Image\nimport sys,io,json\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")\nprint(json.dumps(max(im.getdata(),key=sum)))'], { input: buffer });
  assert.equal(result.status, 0, String(result.stderr));
  return JSON.parse(result.stdout);
}
function pixelRow(buffer, y = 0) {
  const result = spawnSync('python3', ['-c', 'from PIL import Image\nimport sys,io,json\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")\nprint(json.dumps([im.getpixel((x,int(sys.argv[1]))) for x in range(im.width)]))', String(y)], { input: buffer });
  assert.equal(result.status, 0, String(result.stderr)); return JSON.parse(result.stdout);
}
function softened(value, cap) {
  const shoulder = Math.max(0, cap - 32);
  if (value <= shoulder) return value;
  const progress = (value - shoulder) / (255 - shoulder);
  return Math.round(value - (255 - cap) * progress * progress * (3 - 2 * progress));
}
function near(actual, expected, label) {
  assert.ok(actual.every((channel, index) => Math.abs(channel - expected[index]) <= 1),
    `${label}: expected ${expected.join(',')}, received ${actual.join(',')}`);
}
const errors = [];
try {
  context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  const css = `body{margin:0;background:#101010;color:white;font:18px Arial}header{padding:20px}main{display:grid;grid-template-columns:repeat(4,160px);gap:20px;padding:20px}.tile{width:160px;height:100px}.white,.modal-white{background:white}.near-white{background:#f5f5f5}.panel{box-sizing:border-box;background:white;border:2px solid #f0f0f0}.black{background:black}.mid{background:#888}.text{font:bold 80px/100px monospace;background:black;color:white}.icon{background:black}iframe{width:160px;height:100px;border:0}dialog,#site-popover{border:0;padding:20px}dialog .modal-white,#site-popover .modal-white{width:240px;height:150px}#full{padding:20px}#full:fullscreen{background:white;color:black}.inverted{filter:invert(1) hue-rotate(180deg)}`;
  await context.route(/^https?:\/\/(?:frame\.)?white-softer\.test\//, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
    if (url.pathname === '/prepaint-light' || url.pathname === '/prepaint-dark') {
      const dark = url.pathname === '/prepaint-dark';
      return route.fulfill({ contentType: 'text/html',
        headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" },
        body: `<!doctype html><html><head><script>window.cgPrepaintAtParse=!!document.querySelector('[data-cosmic-gemini-white-softer]:popover-open')</script></head><body style="margin:0;background:${dark ? '#111' : '#fff'}"><div id="prepaint-surface" style="height:100px;background:${dark ? '#111' : '#fff'};color:white">${dark ? 'Light text on a dark page' : ''}</div></body></html>` });
    }
    const child = url.hostname.startsWith('frame.');
    return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'none'; style-src 'self'; frame-src https://frame.white-softer.test" }, body: child
      ? '<!doctype html><link rel="stylesheet" href="/fixture.css"><div class="tile white"></div>'
      : '<!doctype html><meta charset="utf-8"><title>White Softer fixture</title><link rel="stylesheet" href="/fixture.css"><header><input id="input" aria-label="Type here"><button id="click">Click</button><button id="fullscreen">Full screen</button></header><main><div class="tile white"></div><div class="tile near-white"></div><div class="tile panel"></div><div class="tile text">HH</div><div class="tile mid"></div><div class="tile black"></div><canvas class="tile canvas" width="160" height="100"></canvas><svg class="tile icon" viewBox="0 0 160 100"><rect x="10" y="10" width="100" height="80" fill="white"/></svg><iframe src="https://frame.white-softer.test/"></iframe></main><div id="full">Fullscreen area</div><dialog><div class="modal-white"></div><button>Dialog action</button></dialog><div id="site-popover" popover="auto"><div class="modal-white"></div></div>' });
  });
  // Installed Chrome ignores --load-extension. Use its debugging loader only
  // in this disposable profile, without enabling a personal browser debugger.
  const loader = await context.browser().newBrowserCDPSession();
  const { id: extensionId } = await loader.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const base = `chrome-extension://${extensionId}`;
  const settings = await context.newPage(); await settings.goto(base + '/settings/satellites.html');
  const toggle = settings.locator('#whiteSofterEnabled');
  await toggle.waitFor({ state: 'attached' });
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await settings.locator('#whiteSofterTone').isDisabled(), true);
  assert.equal(await settings.locator('#whiteSofterTone').inputValue(), 'warm-minus-1');
  const page = await context.newPage(); await page.goto('http://white-softer.test/');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,160,100);
    document.querySelector('#click').onclick = () => { document.querySelector('#click').textContent = 'Clicked'; };
    document.querySelector('#fullscreen').onclick = () => document.querySelector('#full').requestFullscreen();
    const ramp = document.createElement('canvas'); ramp.id = 'gray-ramp'; ramp.width = 256; ramp.height = 2;
    const rampContext = ramp.getContext('2d');
    for (let n = 0; n < 256; n++) { rampContext.fillStyle = `rgb(${n},${n},${n})`; rampContext.fillRect(n,0,1,2); }
    document.body.append(ramp);
  });
  const layer = '[data-cosmic-gemini-white-softer]';
  const screenshotColor = async selector => brightest(await page.locator(selector).screenshot());
  assert.deepEqual(await screenshotColor('.white'), [255,255,255]);
  assert.equal(await page.locator(layer).count(), 0);
  await settings.locator('.switch:has(#whiteSofterEnabled)').click();
  await page.locator(layer + ':popover-open').waitFor();
  await settings.emulateMedia({ colorScheme: 'dark' });
  for (const [tone, rgb] of Object.entries(colors)) {
    await settings.locator('#whiteSofterTone').selectOption(tone);
    await page.waitForFunction(({layer,tone}) => document.querySelector(layer)?.getAttribute('data-tone') === tone, {layer,tone});
    for (const selector of ['.white','.text','.canvas','.icon','iframe']) assert.deepEqual(await screenshotColor(selector), rgb, `${tone}: ${selector}`);
    const nearWhite = await screenshotColor('.near-white');
    near(nearWhite, rgb.map(cap => softened(245,cap)), `${tone}: near-white surface`);
    assert.ok(nearWhite.some((value,index) => value < rgb[index] - 1), `${tone}: near-white surface remains distinct from white`);
    const panel = pixelRow(await page.locator('.panel').screenshot(), 50);
    near(panel[0], rgb.map(cap => softened(240,cap)), `${tone}: border`);
    near(panel[10], rgb, `${tone}: panel interior`);
    assert.deepEqual(await screenshotColor('.black'), [0,0,0]);
    assert.deepEqual(await screenshotColor('.mid'), [136,136,136]);
    const ramp = pixelRow(await page.locator('#gray-ramp').screenshot());
    for (let n = 0; n < 256; n++) {
      near(ramp[n], rgb.map(cap => softened(n,cap)), `${tone}: gray ${n}`);
      if (n) assert.ok(ramp[n].every((value,index) => value >= ramp[n-1][index]), `${tone}: grayscale order at ${n}`);
    }
    assert.equal(await page.frameLocator('iframe').locator(layer).count(), 0);
    const settingsAppearance = await settings.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches,
      background: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme }));
    assert.equal(settingsAppearance.dark, true);
    assert.ok(settingsAppearance.background.match(/[\d.]+/g).slice(0,3).every(channel => Number(channel) < 70), tone + ': Settings keep a dark background');
  }
  await settings.emulateMedia({ colorScheme: 'light' });
  await page.locator('#input').fill('Input still works');
  await settings.locator('#whiteSofterTone').selectOption('warm');
  await page.waitForFunction(layer => document.querySelector(layer)?.getAttribute('data-tone') === 'warm', layer);
  const rewritePage = await context.newPage(); await rewritePage.goto('http://white-softer.test/rewrite');
  await rewritePage.locator(layer + ':popover-open').waitFor();
  await rewritePage.evaluate(() => {
    document.open(); document.write('<!doctype html><body style="margin:0;background:white"><button id="fullscreen">Fullscreen</button><canvas id="full-canvas" width="1000" height="720"></canvas></body>'); document.close();
    const canvas = document.querySelector('canvas'), context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0,0,1000,720);
    document.querySelector('#fullscreen').onclick = () => canvas.requestFullscreen();
  });
  await settings.locator('#whiteSofterTone').selectOption('cool');
  await rewritePage.waitForFunction(layer => document.querySelector(layer)?.getAttribute('data-tone') === 'cool', layer);
  assert.equal(await rewritePage.locator(layer).count(), 1, 'document.open reconnects the existing runtime, without a second layer');
  await rewritePage.locator('#fullscreen').click(); await rewritePage.waitForFunction(() => !!document.fullscreenElement);
  assert.deepEqual(brightest(await rewritePage.locator('canvas').screenshot()), colors.cool, 'document.open reconnects fullscreen promotion');
  await rewritePage.close();
  await settings.locator('#whiteSofterTone').selectOption('warm');
  await page.waitForFunction(layer => document.querySelector(layer)?.getAttribute('data-tone') === 'warm', layer);
  const historyPage = await context.newPage();
  await historyPage.goto('http://white-softer.test/history-a');
  await historyPage.locator(layer + ':popover-open').waitFor();
  await historyPage.goto('http://white-softer.test/history-b');
  await historyPage.locator(layer + ':popover-open').waitFor();
  await settings.locator('#whiteSofterTone').selectOption('cool');
  await historyPage.waitForFunction(layer => document.querySelector(layer)?.getAttribute('data-tone') === 'cool', layer);
  await historyPage.goBack({ waitUntil: 'commit' });
  try {
    await historyPage.waitForFunction(layer => document.querySelector(layer)?.getAttribute('data-tone') === 'cool', layer, { timeout: 5000 });
  } catch (error) {
    console.log('History restore diagnostic:', await historyPage.evaluate(() => ({ url: location.href, ready: document.readyState,
      layers: [...document.querySelectorAll('[data-cosmic-gemini-white-softer]')].map(node => ({ tone: node.getAttribute('data-tone'), open: node.matches(':popover-open') })),
      runtime: !!globalThis[Symbol.for('cosmic-gemini.white-softer.runtime')] })));
    const worker = context.serviceWorkers()[0];
    if (worker) console.log('Isolated restore diagnostic:', await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://white-softer.test/history-a' });
      if (!tab) return 'No matching tab';
      const values = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => ({
        central: !!globalThis[Symbol.for('cosmic-gemini.central')], bridge: !!globalThis[Symbol.for('cosmic-gemini.white-softer.bridge')],
        receipt: globalThis[Symbol.for('cosmic-gemini.page-runtime-styles')]?.whiteSofter,
        check: !!globalThis[Symbol.for('cosmic-gemini.white-softer.prepaint-check')]
      }) });
      return values;
    }));
    throw error;
  }
  assert.equal(await historyPage.locator(layer + ':popover-open').count(), 1, 'history return uses the current tone and one layer');
  await historyPage.goForward({ waitUntil: 'commit' });
  await settings.locator('.switch:has(#whiteSofterEnabled)').click();
  await historyPage.locator(layer).waitFor({ state: 'detached' });
  await historyPage.goBack({ waitUntil: 'commit' });
  await historyPage.locator(layer).waitFor({ state: 'detached' });
  assert.deepEqual(brightest(await historyPage.locator('.white').screenshot()), [255,255,255], 'returning after disable cannot revive an older cap');
  await historyPage.close();
  // Tone selection is disabled with the feature; restore the saved tone through
  // its normal command before enabling again.
  await settings.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', featureId: 'whiteSofter', tone: 'warm' });
    if (!response?.ok) throw Error(response?.error || 'Could not restore the fixture tone.');
  });
  await settings.locator('.switch:has(#whiteSofterEnabled)').click();
  await page.waitForFunction(layer => document.querySelector(layer)?.getAttribute('data-tone') === 'warm', layer);
  await page.evaluate(() => { const base = document.createElement('base'); base.href = 'https://unrelated.invalid/'; document.head.append(base); });
  assert.deepEqual(await screenshotColor('.white'), colors.warm, 'a page base URL must not redirect the local filter');
  await page.evaluate(() => document.querySelector('base').remove());
  for (const appearance of ['light', 'dark']) {
    const navigation = await context.newPage();
    await navigation.goto(`http://white-softer.test/prepaint-${appearance}`);
    assert.equal(await navigation.evaluate(() => window.cgPrepaintAtParse), true,
      `${appearance}: the filter exists before the page's first script`);
    assert.equal(await navigation.locator(layer + ':popover-open').count(), 1,
      `${appearance}: runtime handoff keeps one filter`);
    if (appearance === 'dark') {
      const surface = await navigation.locator('#prepaint-surface').screenshot();
      assert.deepEqual(pixelRow(surface)[0], [17,17,17], 'dark background remains dark');
      assert.deepEqual(brightest(surface), colors.warm, 'white text on a dark background is softened');
    }
    await navigation.close();
  }
  const overscroll = await context.newCDPSession(page);
  await page.evaluate(() => { document.body.style.minHeight = '200vh'; window.scrollTo(0,0); });
  const gesture = overscroll.send('Input.synthesizeScrollGesture', { x:950, y:100, yDistance:450, speed:250, gestureSourceType:'mouse', preventFling:false });
  await new Promise(resolve => setTimeout(resolve,150));
  const edge = await page.screenshot({path:join(artifacts,'overscroll.png')});
  assert.deepEqual(pixelRow(edge)[950], [16,16,16], 'elastic overscroll keeps the dark browser backdrop');
  await gesture; await overscroll.detach();
  await page.evaluate(() => document.body.style.removeProperty('min-height'));
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
  assert.equal(await settings.locator('#whiteSofterTone option[value="warm-minus-1"]').textContent(), 'Light warm ivory (default)');
  assert.equal(await settings.locator('#whiteSofterTone option[value="warm"]').textContent(), 'Warm ivory');
  const card = settings.locator('[data-product="white-softer"]');
  await card.screenshot({ path: join(artifacts, 'settings-en.png') });
  await settings.selectOption('#language', 'zh-CN');
  await settings.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await settings.locator('#whiteSofterTone option[value="warm-minus-1"]').textContent(), '轻微暖白（默认）');
  assert.equal(await settings.locator('#whiteSofterTone option[value="warm"]').textContent(), '暖米白');
  await card.screenshot({ path: join(artifacts, 'settings-zh.png') });
  await page.screenshot({ path: join(artifacts, 'warm.png') });
  const command = message => settings.evaluate(async message => {
    const response = await chrome.runtime.sendMessage(message); if (!response.ok) throw Error(response.error);
  }, message);
  const popup = await context.newPage(); await popup.goto(base + '/popup/index.html');
  await popup.waitForFunction(() => document.querySelector('#reduceWhitePoint-status')?.hasAttribute('aria-pressed'));
  assert.equal(await popup.locator('#page-display-row').isVisible(), false);
  await command({type:'UI_SET_PAGE_DISPLAY_SETTING',name:'reduceWhitePointEnabled',value:true});
  await popup.reload();
  await popup.locator('#page-display-row').waitFor({ state: 'visible' });
  await page.locator('[data-cosmic-gemini-page-display]').waitFor();
  await settings.locator('.switch:has(#whiteSofterEnabled)').click();
  await page.locator(layer).waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-cosmic-gemini-page-display]').count(), 1);
  assert.equal(await settings.locator('#whiteSofterTone').isDisabled(), true);
  await command({type:'UI_SET_ENABLED',featureId:'pageDisplay',enabled:false});
  await popup.reload();
  await popup.waitForFunction(() => document.querySelector('#reduceWhitePoint-status')?.hasAttribute('aria-pressed'));
  assert.equal(await popup.locator('#page-display-row').isVisible(), false);
  await page.locator('[data-cosmic-gemini-page-display]').waitFor({ state: 'detached' });
  assert.deepEqual(await screenshotColor('.white'), [255,255,255]);
  assert.deepEqual(await screenshotColor('.text'), [255,255,255]);
  assert.deepEqual(errors, []);
  console.log('PASS: five exact white tones, distinct near-white surfaces and borders, all 256 monotone gray levels, document-start light/dark navigation and single-layer handoff, history return with changed tone/disabled feature, document.open reconfiguration/fullscreen, elastic overscroll, base URL, text/canvas/icons/cross-origin frame, localized choices, CSP, HTTP, input/focus, popovers/dialogs/fullscreen/inversion, persistence, Page Display popup visibility and coexistence, disabled cleanup');
} finally { await context.close(); await rm(folder, { recursive: true, force: true }); }

// Browser-engine regressions do not need extension loading or any personal
// profile. Execute the packaged prepaint/runtime code at document_start.
async function checkDocumentSurfaces() {
  const artifacts = resolve('test-dist/white-softer');
  await mkdir(artifacts, { recursive: true });
  const files = ['shared/white-tones.js', 'content/shared/white-cap-layer.js',
    'content/white-softer/white-softer-prepaint.js', 'content/white-softer/white-softer-runtime.js'];
  const code = (await Promise.all(files.map(file => readFile(resolve('extension', file), 'utf8')))).join('\n');
  const css = await readFile(resolve('extension/content/white-softer/white-softer.css'), 'utf8');
  const layer = '[data-cosmic-gemini-white-softer]';
  const htmlNS = 'http://www.w3.org/1999/xhtml';
  const xml = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://example.invalid/</loc></url></urlset>';
  const html = '<!doctype html><html><head><script>window.prepaintAtParse=!!document.querySelector("[data-cosmic-gemini-white-softer]:popover-open")</script></head><body style="margin:0;background:white"><input id="input"><button id="fullscreen">Fullscreen</button><div id="white" style="width:100px;height:80px;background:white"></div><div id="dark" style="width:100px;height:80px;background:#111"></div><iframe src="https://frame.white-softer.test/frame.html" style="width:100px;height:80px;border:0"></iframe><dialog><div style="width:100px;height:80px;background:white"></div></dialog><div id="site-popup" popover="auto"><div style="width:100px;height:80px;background:white"></div></div></body></html>';
  const fixtures = {
    '/sitemap.xml': ['text/xml', xml],
    '/feed.xml': ['application/xml', '<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture feed</title></channel></rss>'],
    '/view.xhtml': ['application/xhtml+xml', `<html xmlns="${htmlNS}"><head><title>XHTML fixture</title></head><body style="margin:0;background:white"><input id="input"/><div id="white" style="width:100px;height:80px;background:white"/></body></html>`],
    '/authored.xml': ['application/xml', '<?xml version="1.0"?><?xml-stylesheet type="text/css" href="/authored.css"?><document><line>Authored XML</line></document>'],
    '/authored.css': ['text/css', 'document{display:block;background:#222;color:#eee}line{display:block}'],
    '/drawing.svg': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="white"/></svg>'],
    '/text.txt': ['text/plain', 'Plain text fixture'],
    '/data.json': ['application/json', '{"fixture":"JSON document","value":42}'],
    '/source.js': ['application/javascript', 'const fixture = "Source text";'],
    '/white.png': ['image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAN0lEQVR4nO3RwQ0AMAjDwJT9d05HMB9+vgGCZF7bXJrT9XhgwR8gEyETIRMhEyETIRMhEyEThXzH8QM9OMM6fAAAAABJRU5ErkJggg==', 'base64')],
    '/theme.html': ['text/html', '<!doctype html><style>:root{color-scheme:light dark;background:#fafafa}body{margin:0;height:100vh;background:white;color:#111}@media(prefers-color-scheme:dark){:root,body{background:#111;color:white}}</style><body>Theme fixture</body>'],
    '/html': ['text/html', html],
    '/frame.html': ['text/html', '<!doctype html><body style="margin:0;background:white"></body>']
  };
  const browser = await chromium.launch({ executablePath: process.env.PDF_VIEWER_CHROME, headless: true });
  const errors = [];
  try {
    if (['xml', 'native'].includes(process.env.WHITE_SOFTER_QA)) {
      await checkXmlRelatedSurfaces(browser, code, css, htmlNS, layer, fixtures);
      return;
    }
    for (const scheme of ['dark', 'light']) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1000, height: 720 } });
      context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
      await context.route(/^https:\/\/(?:frame\.)?white-softer\.test\//, route => {
        const fixture = fixtures[new URL(route.request().url()).pathname];
        return route.fulfill(fixture ? { contentType: fixture[0], body: fixture[1] } : { status: 404, body: '' });
      });
      await context.addInitScript({ content: `(() => { if(window.top !== window) return;\n` + code + `\nwindow.configureWhite = (active, tone = 'warm-minus-1') => {
        const runtime = globalThis[Symbol.for('cosmic-gemini.white-softer.runtime')];
        window.dispatchEvent(new CustomEvent('cosmic-gemini:white-softer:configure', {detail:JSON.stringify({token:runtime.token,config:{active,tone}})}));
      }; if(location.search === '?disabled') configureWhite(false); })();` });
      const page = await context.newPage();
      const styleSurface = async () => page.evaluate(({ css, htmlNS }) => {
        const style = document.createElementNS(htmlNS, 'style');
        style.textContent = css; document.head.append(style);
      }, { css, htmlNS });
      for (const path of ['/sitemap.xml', '/feed.xml', '/view.xhtml', '/text.txt', '/authored.xml', '/drawing.svg']) {
        await page.goto('https://white-softer.test' + path);
        const authored = path === '/authored.xml' || path === '/drawing.svg';
        if (authored) {
          assert.equal(await page.locator(layer).count(), 0, path + ': non-HTML views remain untouched');
          assert.equal(await page.locator('svg').count(), path.endsWith('.svg') ? 1 : 0);
          continue;
        }
        await page.locator(layer + ':popover-open').waitFor({ state: 'attached', timeout: 5000 });
        assert.equal(await page.locator(layer).count(), 1, path + ': prepaint hands off exactly one layer');
        assert.equal(await page.locator(layer).evaluate(node => node.namespaceURI), htmlNS);
        if (path.endsWith('.xml')) {
          assert.equal(await page.locator('#xml-viewer-style').count(), 1, path + ': Chrome still builds the XML viewer');
          assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light dark');
        }
        await styleSurface();
        const screenshot = await page.screenshot({ path: join(artifacts, `document-${scheme}-${path.slice(1)}.png`) });
        assert.deepEqual(pixelRow(screenshot, 700)[950], scheme === 'dark' && path !== '/view.xhtml' ? [18,18,18] : [236,235,233], path + ': page backdrop');
        if (path === '/view.xhtml') {
          await page.locator('#input').fill('XHTML input still works');
          assert.deepEqual(brightest(await page.locator('#white').screenshot()), [236,235,233]);
        }
        await page.evaluate(() => configureWhite(false));
        assert.equal(await page.locator(layer).count(), 0);
        await page.evaluate(() => configureWhite(true, 'cool'));
        assert.equal(await page.locator(layer + ':popover-open').count(), 1, path + ': enable after completion');
      }
      await page.goto('https://white-softer.test/sitemap.xml?disabled');
      assert.equal(await page.locator('#xml-viewer-style').count(), 1, 'disabled pending prepaint still permits the native viewer');
      assert.equal(await page.locator(layer).count(), 0, 'disabled during parsing does not remount later');
      for (const path of ['/data.json', '/source.js', '/white.png']) {
        await page.goto('https://white-softer.test' + path);
        await page.locator(layer + ':popover-open').waitFor({ state: 'attached', timeout: 5000 });
        assert.equal(await page.evaluate(() => document.documentElement.namespaceURI), htmlNS, path + ': browser generates the native HTML surface');
        await styleSurface();
        if (path.endsWith('.png')) {
          await page.locator('img').evaluate(image => image.decode());
          assert.deepEqual(brightest(await page.locator('img').screenshot()), [236,235,233], 'native image viewer softens white image pixels');
        } else assert.match(await page.locator('body').textContent(), path.endsWith('.json') ? /JSON document/ : /Source text/);
        const capped = pixelRow(await page.screenshot(), 700)[950];
        await page.evaluate(() => configureWhite(false));
        const original = pixelRow(await page.screenshot(), 700)[950];
        near(capped, original.map((value, index) => softened(value, [236,235,233][index])), path + ': native backdrop is only softened, never recolored into another appearance');
        await page.evaluate(() => configureWhite(true));
        assert.equal(await page.locator(layer + ':popover-open').count(), 1);
      }
      await page.goto('https://white-softer.test/html');
      assert.equal(await page.evaluate(() => window.prepaintAtParse), true, 'HTML retains document-start softening');
      await styleSurface();
      await page.locator('#input').fill('Focus remains here');
      for (const tone of ['warm-minus-1', 'warm', 'warm-plus-1', 'warm-plus-2', 'cool']) {
        await page.evaluate(tone => configureWhite(true, tone), tone);
        const rgb = ({ 'warm-minus-1':[236,235,233], warm:[232,230,227], 'warm-plus-1':[216,214,211], 'warm-plus-2':[208,206,203], cool:[206,224,242] })[tone];
        assert.deepEqual(brightest(await page.locator('#white').screenshot()), rgb);
        assert.deepEqual(brightest(await page.locator('#dark').screenshot()), [17,17,17]);
      }
      assert.equal(await page.evaluate(() => document.activeElement.id), 'input');
      assert.equal(await page.frameLocator('iframe').locator(layer).count(), 0, 'child frames have no duplicate filter');
      assert.deepEqual(brightest(await page.locator('iframe').screenshot()), [206,224,242]);
      await page.evaluate(() => { const base=document.createElement('base'); base.href='https://unrelated.invalid/'; document.head.append(base); });
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [206,224,242], 'base URL does not redirect the local filter');
      await page.evaluate(() => document.querySelector('base').remove());
      for (const target of ['dialog', '#site-popup']) {
        await page.evaluate(target => { const popup=document.querySelector(target); target==='dialog'?popup.showModal():popup.showPopover(); }, target);
        assert.deepEqual(brightest(await page.locator(target + ' div').screenshot()), [206,224,242]);
        await page.evaluate(target => { const popup=document.querySelector(target); target==='dialog'?popup.close():popup.hidePopover(); }, target);
      }
      await page.evaluate(() => { document.querySelector('#fullscreen').onclick=()=>document.querySelector('#white').requestFullscreen(); });
      await page.locator('#fullscreen').click();
      await page.waitForFunction(() => !!document.fullscreenElement);
      await page.locator('html > ' + layer + ':popover-open').waitFor({ state: 'attached', timeout: 5000 });
      assert.equal(await page.locator('html > ' + layer + ':popover-open').count(), 1, 'fullscreen keeps the same root-mounted filter');
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [206,224,242]);
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => !document.fullscreenElement);
      await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.id = 'full-canvas'; canvas.width = 1000; canvas.height = 720;
        const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1000, 720);
        const image = document.createElement('img'); image.id = 'full-image'; image.src = canvas.toDataURL();
        document.body.append(canvas, image);
      });
      for (const selector of ['#full-canvas', '#full-image', 'iframe']) {
        await page.evaluate(selector => { document.querySelector('#fullscreen').onclick = () => document.querySelector(selector).requestFullscreen(); }, selector);
        await page.locator('#fullscreen').click();
        await page.waitForFunction(() => !!document.fullscreenElement);
        assert.deepEqual(brightest(await page.locator(selector).screenshot()), [206,224,242], selector + ': fullscreen replaced elements remain softened');
        assert.equal(await page.locator('html > ' + layer + ':popover-open').count(), 1);
        await page.evaluate(() => document.exitFullscreen()); await page.waitForFunction(() => !document.fullscreenElement);
      }
      await page.evaluate(() => { document.querySelector('#full-canvas').remove(); document.querySelector('#full-image').remove(); });
      await page.evaluate(() => { document.documentElement.style.filter='invert(1)'; document.querySelector('#dark').style.background='black'; });
      assert.deepEqual(brightest(await page.locator('#dark').screenshot()), [206,224,242], 'filter caps pixels after a Dark Reader style inversion');
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [0,0,0]);
      await page.evaluate(() => document.documentElement.style.removeProperty('filter'));
      await page.evaluate(() => {
        const Layer=globalThis[Symbol.for('cosmic-gemini.white-cap-layer')];
        window.secondCap=new Layer('data-cosmic-gemini-leetcode-white-tone'); secondCap.enable('cool');
        const style=document.createElement('style');
        style.textContent='[data-cosmic-gemini-leetcode-white-tone]{all:initial;display:none;position:fixed;inset:0;pointer-events:none;backdrop-filter:var(--cg-white-cap-filter)}[data-cosmic-gemini-leetcode-white-tone]:popover-open{display:block}';
        document.head.append(style);
        document.querySelector('#site-popup').showPopover();
      });
      await page.waitForFunction(() => document.querySelector('[data-cosmic-gemini-white-softer]').matches(':popover-open') && document.querySelector('[data-cosmic-gemini-leetcode-white-tone]').matches(':popover-open'));
      await page.evaluate(() => { document.querySelector('#site-popup').hidePopover(); secondCap.disable(); });
      assert.equal(await page.locator(layer + ':popover-open').count(), 1, 'independent cap cleanup leaves White Softer active');
      await page.evaluate(() => {
        const root = document.createElement('html');
        root.innerHTML = '<head></head><body style="margin:0;background:white"><div id="white" style="width:100px;height:80px;background:white"></div></body>';
        document.replaceChild(root, document.documentElement);
      });
      await page.locator('html > ' + layer + ':popover-open').waitFor({ state: 'attached', timeout: 5000 });
      await styleSurface();
      assert.equal(await page.locator(layer).count(), 1, 'root replacement reuses one filter');
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [206,224,242]);
      await page.evaluate(layer => {
        window.ownedWhiteLayer = document.querySelector(layer);
        ownedWhiteLayer.remove();
      }, layer);
      await page.locator(layer + ':popover-open').waitFor({ state: 'attached', timeout: 5000 });
      assert.equal(await page.locator(layer).evaluate(node => node === window.ownedWhiteLayer), true, 'direct shell removal remounts the existing layer');
      await page.evaluate(() => { document.documentElement.innerHTML = '<head></head><body style="margin:0;background:white"><div id="white" style="width:100px;height:80px;background:white"></div></body>'; });
      await page.locator(layer + ':popover-open').waitFor({ state: 'attached', timeout: 5000 });
      await styleSurface();
      assert.equal(await page.locator(layer).count(), 1, 'replacing the HTML shell retains one filter');
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [206,224,242]);
      await page.evaluate(() => configureWhite(false));
      assert.equal(await page.locator(layer).count(), 0);
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [255,255,255]);
      if (scheme === 'dark') {
        await page.goto('https://white-softer.test/theme.html'); await styleSurface();
        const appearance = () => page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme:dark)').matches,
          scheme: getComputedStyle(document.documentElement).colorScheme,
          root: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor,
          rootStyle: document.documentElement.getAttribute('style'), bodyStyle: document.body.getAttribute('style') }));
        for (const tone of Object.keys(colors)) {
          for (const mode of ['dark', 'light', 'dark']) {
            await page.emulateMedia({ colorScheme: mode });
            await page.evaluate(() => configureWhite(false)); const original = await appearance();
            await page.evaluate(tone => configureWhite(true, tone), tone);
            assert.deepEqual(await appearance(), original, tone + ': filtering cannot alter the page theme, scheme or backgrounds');
            assert.deepEqual(pixelRow(await page.screenshot(), 700)[950], mode === 'dark' ? [17,17,17] : colors[tone], tone + ': dark stays dark through theme transitions');
          }
        }
        await page.evaluate(() => { document.documentElement.style.filter = 'invert(1)'; document.body.style.background = 'white'; });
        assert.deepEqual(pixelRow(await page.screenshot(), 700)[950], [0,0,0], 'inverted white stays black with a transparent cap');
        await page.evaluate(() => configureWhite(false));
        assert.deepEqual(pixelRow(await page.screenshot(), 700)[950], [0,0,0], 'disabled cleanup also keeps the inverted dark background');
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: light/dark XML/JSON/source/image native viewers, sitemap/RSS/plain-text, XHTML controls and real HTML namespace, authored XML/SVG untouched, canceled prepaint, five tones/dark pixels, theme transitions without scheme/style changes or dark brightening, focus, child frames, base URL, dialogs/popovers/container/canvas/image/iframe fullscreen/inversion, independent cap coexistence, root/shell replacement and layer removal, disable/re-enable, no page errors');
  } finally { await browser.close(); }
}

async function checkXmlRelatedSurfaces(browser, code, css, htmlNS, layer, fixtures) {
  Object.assign(fixtures, {
    '/atom.xml': ['application/atom+xml', '<feed xmlns="http://www.w3.org/2005/Atom"><title>订阅 &amp; feed</title><entry><title>Entry</title></entry></feed>'],
    '/rss.xml': ['application/rss+xml', '<rss version="2.0"><channel><title>RSS fixture</title></channel></rss>'],
    '/vendor.xml': ['application/vnd.cosmic+xml', '<envelope><value>Vendor XML</value></envelope>'],
    '/index.xml': ['application/xml', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.invalid/sitemap.xml</loc></sitemap></sitemapindex>'],
    '/namespaced.xml': ['text/xml', '<s:root xmlns:s="urn:cosmic-test"><!-- comment --><s:value><![CDATA[<raw>文字 & text]]></s:value></s:root>'],
    '/entities.xml': ['application/xml', '<!DOCTYPE root [<!ENTITY local "Local entity">]><root><value>&local;</value></root>'],
    '/schema.xsd': ['application/xml', '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="root" type="xs:string"/></xs:schema>'],
    '/search.xml': ['application/opensearchdescription+xml', '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Search fixture</ShortName></OpenSearchDescription>'],
    '/broken.xml': ['application/xml', '<root><value>Unclosed root'],
    '/empty.xml': ['application/xml', ''],
    '/missing-style.xml': ['application/xml', '<?xml-stylesheet type="text/css" href="/absent.css"?><document>Missing stylesheet</document>'],
    '/light-authored.xml': ['application/xml', '<?xml-stylesheet type="text/css" href="/light.css"?><document><line>Styled XML</line></document>'],
    '/light.css': ['text/css', 'document{display:block;min-height:100vh;background:#fff;color:#111}line{display:block}'],
    '/dark-authored.xml': ['application/xml', '<?xml-stylesheet type="text/css" href="/dark.css"?><document><line>Styled XML</line></document>'],
    '/dark.css': ['text/css', 'document{display:block;min-height:100vh;background:#111;color:#eee}line{display:block}'],
    '/foreign.svg': ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="720"><rect width="1000" height="720" fill="#111"/><foreignObject x="0" y="0" width="100" height="100"><div xmlns="${htmlNS}" style="color:white">SVG HTML text</div></foreignObject></svg>`],
    '/headless.xhtml': ['application/xhtml+xml', `<html xmlns="${htmlNS}"><body style="margin:0;min-height:100vh;background:#111;color:white">No head</body></html>`],
    '/prefixed.xhtml': ['application/xhtml+xml', `<x:html xmlns:x="${htmlNS}"><x:head/><x:body style="margin:0;min-height:100vh;background:#111;color:white">Prefixed XHTML</x:body></x:html>`],
    '/broken.xhtml': ['application/xhtml+xml', `<html xmlns="${htmlNS}"><body>Unclosed body`],
    '/transformed.xml': ['application/xml', '<?xml-stylesheet type="text/xsl" href="/transform.xsl"?><document><line>Transformed XML</line></document>'],
    '/transform.xsl': ['application/xml', `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"><xsl:template match="/"><html xmlns="${htmlNS}"><head><title>Transform fixture</title></head><body style="margin:0;min-height:100vh;background:#111;color:white"><xsl:value-of select="document/line"/></body></html></xsl:template></xsl:stylesheet>`]
  });
  const paths = Object.keys(fixtures).filter(path => /\.(xml|xsd|xhtml|svg)$/.test(path));
  if (process.env.WHITE_SOFTER_QA === 'native') {
    Object.assign(fixtures, {
      '/robots.txt': ['text/plain', 'User-agent: *\nDisallow: /private\n<literal>中文 & text</literal>'],
      '/style.css': ['text/css', 'body { background: white; color: black; } /* stylesheet text */'],
      '/module.mjs': ['text/javascript', 'export const source = "Plain source; no execution";'],
      '/unicode.json': ['application/json; charset=utf-8', '{"标题":"JSON 示例","value":null}'],
      '/manifest.webmanifest': ['application/manifest+json', '{"name":"Synthetic manifest","start_url":"/"}'],
      '/table.csv': ['text/csv', 'Name,Value\nFixture,42\n'],
      '/readme.md': ['text/markdown', '# Synthetic Markdown\n\nText fixture.'],
      '/download.bin': ['application/octet-stream', 'Synthetic binary download'],
      '/xhtml-as-html.html': ['text/html', `<html xmlns="${htmlNS}"><body style="margin:0;min-height:100vh;background:#111;color:white">XHTML served as HTML</body></html>`]
    });
    paths.splice(0, paths.length, '/text.txt', '/data.json', '/source.js', '/white.png', '/html',
      '/robots.txt', '/style.css', '/module.mjs', '/unicode.json', '/manifest.webmanifest', '/table.csv', '/readme.md', '/download.bin', '/xhtml-as-html.html');
    const assets = resolve('test-dist/white-softer/native-assets');
    await mkdir(assets, {recursive:true});
    const images = spawnSync('python3', ['-c', `from PIL import Image, ImageDraw
from pathlib import Path
import sys
folder=Path(sys.argv[1]); image=Image.new('RGB',(256,128),'white')
ImageDraw.Draw(image).rectangle((128,0,255,127),fill='black')
for suffix,fmt in [('jpg','JPEG'),('gif','GIF'),('bmp','BMP'),('webp','WEBP'),('avif','AVIF'),('ico','ICO')]:
    path=folder/('contrast.'+suffix)
    if not path.exists(): image.save(path,format=fmt)`, assets]);
    assert.equal(images.status, 0, String(images.stderr));
    for (const [suffix, mime] of [['jpg','image/jpeg'],['gif','image/gif'],['bmp','image/bmp'],['webp','image/webp'],['avif','image/avif'],['ico','image/x-icon']]) {
      const path = '/contrast.' + suffix;
      fixtures[path] = [mime, await readFile(join(assets, 'contrast.' + suffix))]; paths.push(path);
    }
    const wav = Buffer.alloc(44 + 44100);
    wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(22050,24); wav.writeUInt32LE(44100,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
    wav.write('data',36); wav.writeUInt32LE(44100,40);
    fixtures['/silence.wav'] = ['audio/wav', wav]; paths.push('/silence.wav');
    const videoPage = await browser.newPage();
    try {
      for (const [suffix, mime] of [['webm','video/webm'], ['mp4','video/mp4']]) {
        const file = join(assets, 'white.' + suffix);
        let bytes;
        try { bytes = await readFile(file); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const recorded = await videoPage.evaluate(async mime => {
            if (!MediaRecorder.isTypeSupported(mime)) return null;
            const canvas = document.createElement('canvas'); canvas.width=canvas.height=64;
            const ctx = canvas.getContext('2d'); ctx.fillStyle='white'; ctx.fillRect(0,0,64,64);
            const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, {mimeType:mime});
            try {
              const chunks = [];
              await new Promise((resolve, reject) => {
                recorder.ondataavailable = event => chunks.push(event.data);
                recorder.onstop = resolve; recorder.onerror = reject;
                recorder.start(); setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 200);
              });
              return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
            } finally { stream.getTracks().forEach(track => track.stop()); }
          }, mime);
          if (!recorded) continue;
          bytes = Buffer.from(recorded); await writeFile(file, bytes);
        }
        const path = '/white.' + suffix; fixtures[path] = [mime, bytes]; paths.push(path);
      }
    } finally { await videoPage.close(); }
  }
  const errors = [];
  const opened = [];
  const navigate = async (page, url) => {
    let download, timer, resolveDownload;
    const started = new Promise(resolve => { resolveDownload = resolve; });
    const onDownload = item => { download = item; resolveDownload(item); };
    page.on('download', onDownload);
    try { await page.goto(url); }
    catch (error) {
      if (!/Download is starting|ERR_ABORTED/.test(error.message)) throw error;
      download ||= await Promise.race([started, new Promise((_, reject) => {
        timer = setTimeout(() => reject(error), 5000);
      })]);
    } finally { clearTimeout(timer); page.off('download', onDownload); }
    if (!download) return 'view';
    const name = download.suggestedFilename(); await download.cancel();
    return 'download:' + name;
  };
  const snapshot = page => page.evaluate(() => {
    const root = document.documentElement, body = document.body;
    return { type: document.contentType, name: root?.localName || null, ns: root?.namespaceURI || null,
      viewer: !!document.querySelector('#xml-viewer-style'), error: !!document.querySelector('parsererror'),
      text: body?.innerText ?? root?.textContent ?? '',
      scheme: root ? getComputedStyle(root).colorScheme : null,
      background: root ? getComputedStyle(root).backgroundColor : null,
      bodyBackground: body ? getComputedStyle(body).backgroundColor : null,
      rootStyle: root?.getAttribute('style') ?? null, bodyStyle: body?.getAttribute('style') ?? null };
  });
  for (const scheme of ['dark', 'light']) {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1000, height: 720 } });
    try {
      context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
      await context.route('https://white-softer.test/**', route => {
        const fixture = fixtures[new URL(route.request().url()).pathname];
        return route.fulfill(fixture ? { contentType: fixture[0], body: fixture[1] } : { status: 404, body: '' });
      });
      const original = await context.newPage(), active = await context.newPage();
      await active.addInitScript({ content: `if (window.top === window) {\n${code}\n}` });
      for (const path of paths) {
        const url = 'https://white-softer.test' + path;
        const previous = await snapshot(active);
        const ordinaryMode = await navigate(original, url), activeMode = await navigate(active, url);
        assert.equal(activeMode, ordinaryMode, path + ': preserve Chrome view/download decision');
        opened.push({scheme, path, mode:ordinaryMode});
        if (ordinaryMode !== 'view') {
          assert.deepEqual(await snapshot(active), previous, path + ': a download does not mutate the previous document');
          assert.equal(await active.locator(layer).count(), 0, path + ': download navigation does not leave a cap behind');
          continue;
        }
        const expected = await snapshot(original);
        assert.deepEqual(await snapshot(active), expected, scheme + path + ': preserve native/authored content, errors and theme');
        const htmlSurface = expected.ns === htmlNS && expected.name === 'html';
        assert.equal(await active.locator(layer).count(), htmlSurface ? 1 : 0, path + ': HTML-only mounting');
        if (htmlSurface) await active.evaluate(({css, htmlNS}) => {
          const style = document.createElementNS(htmlNS, 'style'); style.textContent = css; style.dataset.testWhiteStyle = '';
          (document.head || document.documentElement).append(style);
        }, {css, htmlNS});
        const before = pixelRow(await original.screenshot(), 700), after = pixelRow(await active.screenshot(), 700);
        for (let x = 0; x < before.length; x++) {
          if (!htmlSurface) assert.deepEqual(after[x], before[x], path + ': authored non-HTML pixels untouched');
          else assert.ok(after[x].every((value, channel) => value <= before[x][channel] + 1), scheme + path + ': backdrop never brightens');
        }
        await active.evaluate(() => {
          const rt = globalThis[Symbol.for('cosmic-gemini.white-softer.runtime')];
          rt?.onDispose({ detail: rt.token });
          document.querySelector('[data-test-white-style]')?.remove();
        });
        assert.equal(await active.locator(layer).count(), 0, path + ': dispose removes owned nodes');
        assert.deepEqual(await snapshot(active), expected, path + ': disposal preserves original content/theme');
      }
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(opened));
  const coverage = process.env.WHITE_SOFTER_QA === 'native'
    ? 'text/JSON/source/styles/Markdown, manifest, HTML, JPEG/PNG/GIF/BMP/WebP/AVIF/ICO, WAV/WebM/MP4 and download-only types (PDF excluded)'
    : 'MIME variants, Atom/RSS/sitemap index, namespaces/CDATA/entities/schema, malformed/empty XML/XHTML, CSS/XSLT, missing styles, headless/prefixed XHTML and SVG foreignObject';
  console.log(`PASS: ${paths.length} surfaces in dark/light; ${coverage}; native/authored content, theme and view/download decisions preserved, HTML-only mounting, no backdrop brightening or page errors, clean disposal`);
}

// Capture actual compositor frames while a long page changes, rather than only
// taking a settled screenshot that would miss one-frame unfiltered popovers.
async function checkScrollingSurfaces() {
  const folder = await mkdtemp(join(tmpdir(), 'cg-white-scroll-'));
  const artifacts = resolve('test-dist/white-softer');
  await mkdir(artifacts, { recursive: true });
  const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
    executablePath: process.env.PDF_VIEWER_CHROME, headless: true,
    viewport: { width: 1000, height: 720 }, deviceScaleFactor: 2,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
  });
  const errors = [], results = [];
  try {
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('https://white-scroll.test/**', route => {
      const mode = new URL(route.request().url()).pathname.slice(1);
      const nested = mode === 'nested', dark = mode === 'dark';
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
        html,body{margin:0;background:${dark ? '#111' : '#fff'};color:${dark ? '#fff' : '#111'};font:18px Arial}
        .page{height:${nested ? '100vh' : 'auto'};overflow:${nested ? 'auto' : 'visible'}}
        section{height:700px;border:1px solid #aaa;contain:content}section:nth-child(2n){background:#111;color:white}
        header{position:sticky;top:0;background:inherit;padding:16px}.composer{position:fixed;bottom:0;left:0;width:100%;background:inherit;height:50px}
        #popup{position:fixed;left:500px;top:200px;margin:0;background:white;color:black;width:300px;height:180px}
        </style><div class="page"><header>Long page</header><main>${Array.from({length:45}, (_,i) => '<section>Content '+i+'<details><summary>Details</summary>Expanded content</details></section>').join('')}</main></div>
        <div class="composer"><input aria-label="Composer"></div><div id="popup" popover="manual">Popover</div><dialog>Modal dialog</dialog>` });
    });
    const loader = await context.browser().newBrowserCDPSession();
    const { id } = await loader.send('Extensions.loadUnpacked', { path: resolve('extension') });
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/settings/satellites.html`);
    await settings.locator('#whiteSofterEnabled').check();
    const page = await context.newPage();
    for (const mode of ['light', 'dark', 'nested']) {
      await page.goto('https://white-scroll.test/' + mode);
      await page.locator('[data-cosmic-gemini-white-softer]:popover-open').waitFor();
      await page.evaluate(mode => {
        const cap = document.querySelector('[data-cosmic-gemini-white-softer]'), hide = cap.hidePopover;
        window.scrollStats = { hides: 0, opens: 0, closedFrames: 0, events: 0, samples: 0 };
        cap.hidePopover = function (...args) { scrollStats.hides += 1; return Reflect.apply(hide, this, args); };
        const area = mode === 'nested' ? document.querySelector('.page') : window;
        area.addEventListener('scroll', () => {
          scrollStats.events += 1;
          const details = document.querySelector('details:not([open])'); if (details) details.open = true;
          if (scrollStats.events % 10 === 0) {
            scrollStats.opens += 1; document.querySelector('#popup').showPopover();
            setTimeout(() => document.querySelector('#popup').hidePopover(), 60);
          }
        }, { passive: true });
        window.recordScrollFrames = true;
        const sample = () => {
          if (!recordScrollFrames) return;
          scrollStats.samples += 1; if (!cap.matches(':popover-open')) scrollStats.closedFrames += 1;
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, mode);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const cdp = await context.newCDPSession(page), frames = [];
      cdp.on('Page.screencastFrame', ({ sessionId, data }) => {
        void cdp.send('Page.screencastFrameAck', { sessionId });
        if (frames.length < 180) frames.push(data);
      });
      await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1000, maxHeight: 720, everyNthFrame: 1 });
      await cdp.send('Input.synthesizeScrollGesture', { x: 800, y: 400, yDistance: -6500, speed: 2600, gestureSourceType: 'mouse', preventFling: false });
      await page.waitForTimeout(100);
      // Keep recording through the modal's first paint too, not just a settled
      // screenshot after its later toggle task has run.
      await page.evaluate(() => { scrollStats.opens += 1; document.querySelector('dialog').showModal(); });
      await page.waitForTimeout(60);
      assert.deepEqual(brightest(await page.locator('dialog').screenshot()), colors['warm-minus-1']);
      await page.evaluate(() => document.querySelector('dialog').close());
      await cdp.send('Page.stopScreencast'); await cdp.detach();
      const stats = await page.evaluate(mode => {
        recordScrollFrames = false;
        return { ...scrollStats, y: mode === 'nested' ? document.querySelector('.page').scrollTop : scrollY };
      }, mode);
      const check = spawnSync('python3', ['-c', 'from PIL import Image\nimport io,sys,json,base64\nframes=json.load(sys.stdin)\nbad=[]\nfor n,data in enumerate(frames):\n im=Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")\n if any(maximum>cap+1 for (_,maximum),cap in zip(im.getextrema(),[236,235,233])):bad.append(n)\nprint(json.dumps(bad))'], { input: JSON.stringify(frames), encoding: 'utf8', maxBuffer: 1024 * 1024 });
      assert.equal(check.status, 0, check.stderr); const bad = JSON.parse(check.stdout);
      if (bad.length) await writeFile(join(artifacts, `scroll-${mode}-flash.png`), Buffer.from(frames[bad[0]], 'base64'));
      assert.ok(frames.length > 20 && stats.y > 6000, mode + ': capture a real long scroll');
      assert.ok(stats.opens > 3, mode + ': open floating layers during scrolling');
      assert.equal(bad.length, 0, mode + ': no unfiltered white frame');
      assert.equal(stats.closedFrames, 0, mode + ': keep the same cap open');
      assert.equal(stats.hides, stats.opens, mode + ': disclosures must not rebuild the cap, and a popup has one promotion');
      results.push({ mode, frames: frames.length, ...stats, unfilteredFrames: bad.length });
    }
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'scroll-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('PASS: real extension, light/dark/nested long-page scrolling at 2×; every captured frame softened, no disclosure rebuilds or duplicate popup promotion; modal first-paint colors; no page errors.');
  } finally { await context.close(); await rm(folder, { recursive: true, force: true }); }
}

// Playwright's normal focus emulation makes every tab appear visible. Connect
// without those overrides so the regression exercises real hidden/visible tabs.
async function checkTabSwitching() {
  const folder = await mkdtemp(join(tmpdir(), 'cg-white-tabs-'));
  const artifacts = resolve('test-dist/white-softer');
  const profile = join(folder, 'profile');
  await mkdir(profile); await mkdir(artifacts, { recursive: true });
  const chromeProcess = spawn(process.env.PDF_VIEWER_CHROME, [
    '--user-data-dir=' + profile, '--remote-debugging-port=0', '--headless=new',
    '--window-size=1000,850', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'
  ], { stdio: 'ignore' });
  const exited = new Promise(resolve => { chromeProcess.once('exit', resolve); chromeProcess.once('error', resolve); });
  let browser, loader;
  const errors = [], results = [];
  try {
    let endpoint;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
        endpoint = 'http://127.0.0.1:' + port; break;
      } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(endpoint, 'temporary Chrome debugging endpoint');
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    const context = browser.contexts()[0];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('https://white-tabs.test/**', route => {
      const dark = new URL(route.request().url()).pathname === '/dark';
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
        html,body{margin:0;background:${dark ? '#111' : '#fff'};color:${dark ? '#fff' : '#111'};scrollbar-width:none}
        main{height:50000px}aside{background:#111;color:white;height:150px;position:fixed;bottom:0;width:100%}
        #popup{background:white;color:black;position:fixed;right:20px;top:180px;margin:0;width:260px;height:150px}
        </style><main>Long page<details><summary>Details</summary>Expanded</details></main><aside>White text</aside><div id="popup" popover="manual">Popover</div>` });
    });
    loader = await browser.newBrowserCDPSession();
    const { id } = await loader.send('Extensions.loadUnpacked', { path: resolve('extension') });
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/settings/satellites.html`);
    await settings.locator('#whiteSofterEnabled').check();
    const page = await context.newPage(), other = await context.newPage();
    await other.goto('https://white-tabs.test/other');
    for (const mode of ['light', 'dark']) {
      await page.goto('https://white-tabs.test/' + mode);
      await page.locator('[data-cosmic-gemini-white-softer]:popover-open').waitFor();
      await page.evaluate(() => {
        const cap = document.querySelector('[data-cosmic-gemini-white-softer]'), hide = cap.hidePopover;
        window.tabStats = { hides: 0, opens: 0, resumed: 0, sameCap: true };
        window.resumePopup = false;
        cap.hidePopover = function (...args) { tabStats.hides += 1; return Reflect.apply(hide, this, args); };
        document.addEventListener('visibilitychange', () => {
          const popup = document.querySelector('#popup');
          if (document.hidden) { popup.hidePopover(); return; }
          tabStats.resumed += 1;
          tabStats.sameCap &&= document.querySelector('[data-cosmic-gemini-white-softer]') === cap;
          document.querySelector('details').open = true;
          if (resumePopup) { tabStats.opens += 1; popup.showPopover(); }
        });
      });
      const cdp = await context.newCDPSession(page), frames = [];
      cdp.on('Page.screencastFrame', ({ sessionId, data }) => {
        void cdp.send('Page.screencastFrameAck', { sessionId });
        if (frames.length < 180) frames.push(data);
      });
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      for (let cycle = 0; cycle < 12; cycle += 1) {
        await other.bringToFront();
        assert.equal(await page.evaluate(() => document.visibilityState), 'hidden', 'actually background the tab');
        await page.evaluate(cycle => {
          scrollTo(0, cycle * 800); resumePopup = cycle % 3 === 2;
          document.querySelector('details').open = false;
          if (cycle % 3 === 1) { tabStats.opens += 1; document.querySelector('#popup').showPopover(); }
        }, cycle);
        await page.waitForTimeout(120); await page.bringToFront();
        assert.equal(await page.evaluate(() => document.visibilityState), 'visible', 'actually restore the tab');
        await page.waitForTimeout(70);
      }
      await cdp.send('Page.stopScreencast'); await cdp.detach();
      const stats = await page.evaluate(() => tabStats);
      const check = spawnSync('python3', ['-c', 'from PIL import Image\nimport io,sys,json,base64\nbad=[]\nfor n,data in enumerate(json.load(sys.stdin)):\n im=Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")\n if any(b>c+1 for (_,b),c in zip(im.getextrema(),[236,235,233])):bad.append(n)\nprint(json.dumps(bad))'], { input: JSON.stringify(frames), encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr); const bad = JSON.parse(check.stdout);
      if (bad.length) await writeFile(join(artifacts, `tabs-${mode}-flash.png`), Buffer.from(frames[bad[0]], 'base64'));
      assert.ok(frames.length >= 10 && stats.resumed >= 12 && stats.sameCap, mode + ': cover repeated real tab restoration');
      assert.equal(bad.length, 0, mode + ': no unfiltered return frame');
      assert.equal(stats.hides, stats.opens, mode + ': tab changes and disclosures do not rebuild the cap');
      results.push({ mode, frames: frames.length, ...stats, unfilteredFrames: bad.length });
    }
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'tabs-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('PASS: real hidden/visible tabs in light/dark pages, stable layer during plain return, background mutations and resume popovers; no unfiltered frames, redundant rebuilds or page errors.');
  } finally {
    await loader?.send('Browser.close').catch(() => {});
    await browser?.close().catch(() => {});
    if (chromeProcess.exitCode === null) chromeProcess.kill();
    await exited; await rm(folder, { recursive: true, force: true });
  }
}
