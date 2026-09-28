// Isolated real-extension checks for rendered whites, including white text and page UI.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
if (process.env.WHITE_SOFTER_QA === 'documents') {
  await checkDocumentSurfaces();
  process.exit(0);
}
const folder = await mkdtemp(join(tmpdir(), 'cg-white-softer-'));
const artifacts = resolve('test-dist/white-softer');
await mkdir(artifacts, { recursive: true });
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true, viewport: { width: 1000, height: 720 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-features=ElasticOverscroll', '--enable-unsafe-extension-debugging']
});
const colors = { 'warm-minus-1': [236,235,233], warm: [232,230,227], 'warm-plus-1': [216,214,211], 'warm-plus-2': [208,206,203], cool: [206,224,242] };
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
  }
  await page.locator('#input').fill('Input still works');
  await settings.locator('#whiteSofterTone').selectOption('warm');
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
  console.log('PASS: five exact white tones, distinct near-white surfaces and borders, all 256 monotone gray levels, document-start light/dark navigation and single-layer handoff, elastic overscroll, base URL, text/canvas/icons/cross-origin frame, localized choices, CSP, HTTP, input/focus, popovers/dialogs/fullscreen/inversion, persistence, Page Display popup visibility and coexistence, disabled cleanup');
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
    '/html': ['text/html', html],
    '/frame.html': ['text/html', '<!doctype html><body style="margin:0;background:white"></body>']
  };
  const browser = await chromium.launch({ executablePath: process.env.PDF_VIEWER_CHROME, headless: true });
  const errors = [];
  try {
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
      await page.locator('#white > ' + layer + ':popover-open').waitFor({ state: 'attached', timeout: 5000 });
      assert.equal(await page.locator('#white > ' + layer + ':popover-open').count(), 1, 'fullscreen reuses the same filter');
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [206,224,242]);
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => !document.fullscreenElement);
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
      await page.evaluate(() => configureWhite(false));
      assert.equal(await page.locator(layer).count(), 0);
      assert.deepEqual(brightest(await page.locator('#white').screenshot()), [255,255,255]);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: light/dark XML native viewer, sitemap/RSS/plain-text, XHTML controls and real HTML namespace, authored XML/SVG untouched, canceled prepaint, five tones/dark pixels, focus, child frames, base URL, dialogs/popovers/fullscreen/inversion, independent cap coexistence, root replacement, disable/re-enable, no page errors');
  } finally { await browser.close(); }
}
