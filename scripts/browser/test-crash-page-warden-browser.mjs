import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { WHITE_TONES } from '../../extension/core/config.js';

function brightest(buffer) {
  const result = spawnSync('python3', ['-c', 'from PIL import Image\nimport sys,io,json\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")\nprint(json.dumps(max(im.getdata(),key=sum)))'], { input: buffer });
  assert.equal(result.status, 0, String(result.stderr)); return JSON.parse(result.stdout);
}
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const artifacts = resolve('test-dist/crash-page-warden'); await mkdir(artifacts, { recursive: true });
const paragraph = 'A useful reading page keeps the complete article, its illustrations, and the surrounding explanation. The reader should be able to follow an argument without an advertising player or a recurring reporting task consuming the page. Ordinary links, lists, quotations, and tables remain available, with clear typography and space for captions.';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reading without the heavy page</title>
<meta name="author" content="Example Author"><meta property="article:published_time" content="2026-11-01T12:00:00Z">
<link rel="stylesheet" href="/source.css"><script src="/source.js"></script></head><body>
<nav><a href="/account">Account</a><a href="/ads">Promotions</a></nav>
<article><h1>Reading without the heavy page</h1><p>${paragraph}</p><p>${paragraph}</p>
<figure><img data-src="/image.svg" alt="An article illustration"><figcaption>A caption belongs with its illustration.</figcaption></figure>
<h2 id="next-section">An ordinary section</h2><p>${paragraph}</p><p>${paragraph}</p><blockquote>A useful quotation.</blockquote>
<pre><code>const reading = true;</code></pre><ul><li>First reading point</li><li>Second reading point</li></ul><table><tr><th>Item</th><th>Result</th></tr><tr><td>Reading</td><td>Available</td></tr></table>
<p><a href="#next-section">Section link</a> <a href="/next">Next article</a> <a href="mailto:contact@example.edu">Email contact</a></p>
<a href="javascript:window.injectionRan=true" onclick="window.injectionRan=true">Unsafe action</a>
<form><input value="private input"><button>Submit</button></form><iframe src="/frame" title="Advertisement"></iframe>
<script>window.originalRan=true;setInterval(()=>{window.originalTicks=(window.originalTicks||0)+1},30);</script></article><footer>Promotional footer</footer></body></html>`;
const fixture = join(artifacts, 'static-article.html');
if (await readFile(fixture, 'utf8').catch(() => '') !== html) await writeFile(fixture, html);
let scripts = 0, frames = 0, styles = 0; const views = new Map();
const server = createServer((req, res) => {
  if (req.url === '/source.js') { scripts++; res.setHeader('Content-Type', 'text/javascript'); res.end('window.externalSourceRan=true;'); return; }
  if (req.url === '/source.css') { styles++; res.setHeader('Content-Type', 'text/css'); res.end('body{background:red}'); return; }
  if (req.url === '/frame') { frames++; res.setHeader('Content-Type', 'text/html'); res.end('<p>Advertising frame</p>'); return; }
  if (req.url === '/image.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="450"><rect width="900" height="450" fill="#20324b"/><rect x="20" y="20" width="100" height="100" fill="white"/><circle cx="650" cy="120" r="60" fill="#e6c98b"/><path d="M0 400 230 160 500 450M350 450 660 220 900 450" fill="#628c9c"/></svg>'); return; }
  views.set(req.url, (views.get(req.url) || 0) + 1); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://warden.test:${server.address().port}`, url = origin + '/article?view=1';
const profile = await mkdtemp(join(tmpdir(), 'cg-warden-static-')); let context;
try {
  const extension = resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.TEST_CHROME, headless: true,
    viewport: { width: 1150, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1'] });
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith('/background/central.js')) || await context.waitForEvent('serviceworker', { predicate: worker => worker.url().endsWith('/background/central.js') });
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.permissions.includes('debugger'), false); assert.equal(manifest.permissions.includes('webNavigation'), false);
  const page = await context.newPage(); const policies = [];
  page.on('response', response => { if (response.url() === url) policies.push(response.headers()['content-security-policy'] || ''); });
  await page.goto(url); await page.waitForFunction(() => window.originalRan === true);
  const settings = await context.newPage(); const errors = [];
  settings.on('pageerror', error => errors.push(error.message));
  await settings.goto(base + 'settings/satellites.html'); await settings.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  await settings.locator('[data-card-disclosure="satellite-website-fixer"]').click();
  await settings.locator('#crashPageWardenEnabled').check();
  const list = settings.locator('[data-setting-group="crashPageWarden"]');
  scripts = frames = styles = 0;
  await list.locator('input[type=text]').fill(url); await list.locator('button[type=submit]').click();
  await page.waitForFunction(() => document.documentElement.dataset.cgWarden === 'ready');
  assert.equal(page.url(), url, 'static conversion retains the original address');
  assert.equal(views.get('/article?view=1'), 2, 'enabling protection reloads the current page exactly once');
  assert.equal(await page.evaluate(() => !!window.originalRan || !!window.externalSourceRan), false);
  assert.equal(scripts, 0); assert.equal(frames, 0); assert.equal(styles, 0);
  assert.ok(policies.some(policy => policy.includes('sandbox allow-same-origin')), 'the native response policy is applied before parsing');
  assert.equal(await page.locator('#cg-warden-root h1').innerText(), 'Reading without the heavy page');
  assert.equal(await page.locator('.cg-warden-site').innerText(), 'warden.test');
  assert.doesNotMatch(await page.locator('.cg-warden-toolbar').innerText(), /Crash Page Warden/);
  assert.equal(await page.locator('meta[name=darkreader-lock]').count(), 0, 'the reader does not opt out of Dark Reader');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-darkreader-mode'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(250, 249, 247)', 'the reader follows light appearance');
  assert.match(await page.locator('#cg-warden-content').innerText(), /complete article/);
  assert.match(await page.locator('.cg-warden-metadata').innerText(), /Example Author/);
  assert.equal(await page.locator('#cg-warden-content table').count(), 1);
  assert.equal(await page.locator('script,iframe,form,object,embed').count(), 0);
  assert.equal(await page.locator('[onclick],a[href^="javascript:"]').count(), 0);
  await page.locator('#cg-warden-content img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#cg-warden-content img')?.naturalWidth === 900);
  await page.getByText('Section link', { exact: true }).click();
  assert.equal(new URL(page.url()).hash, '#next-section', 'rebuilt anchors retain original fragment names');
  await page.getByText('Email contact', { exact: true }).click();
  assert.equal(await page.locator('.cg-warden-contact').isVisible(), true); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Larger text' }).click();
  assert.equal(await page.locator('body').getAttribute('data-text-size'), 'large');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(23, 24, 25)');
  await page.screenshot({ path: join(artifacts, 'static-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.split('#')[0] === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => {
      const style = document.createElement('style'); style.className = 'darkreader'; style.id = 'dark-reader-style';
      style.textContent = 'html {filter: invert(1) !important}'; document.head.append(style);
      document.documentElement.setAttribute('data-darkreader-mode', 'filter');
    } });
  }, url);
  assert.equal(await page.locator('meta[name=darkreader-lock]').count(), 0);
  assert.equal(await page.locator('#dark-reader-style').getAttribute('media'), null, 'frozen interop leaves other extension styles alone');
  assert.equal(await page.locator('html').getAttribute('data-darkreader-mode'), 'filter');
  await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.split('#')[0] === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => {
      document.getElementById('dark-reader-style')?.remove(); document.documentElement.removeAttribute('data-darkreader-mode');
    } });
  }, url);
  await page.screenshot({ path: join(artifacts, 'static-light.png') });

  // Check the complete palette/appearance combination, not only the canvas.
  const luminance = rgb => rgb.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const channels = color => color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
  await page.bringToFront();
  const heading = await page.locator('#cg-warden-root h1').elementHandle();
  const paletteViews = views.get('/article?view=1');
  for (const tone of [null, ...WHITE_TONES.tones]) {
    const replies = await settings.evaluate(async tone => {
      const replies = [];
      if (tone) replies.push(await chrome.runtime.sendMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', featureId: 'whiteSofter', tone: tone.id }));
      replies.push(await chrome.runtime.sendMessage({ type: 'UI_SET_ENABLED', featureId: 'whiteSofter', enabled: !!tone }));
      return replies;
    }, tone);
    assert.ok(replies.every(reply => reply.ok), 'palette preferences are saved');
    await page.waitForFunction(rgb => document.documentElement.style.getPropertyValue('--cg-warden-white') === rgb
      && document.querySelectorAll('[data-cg-warden-white-softer]:popover-open').length === (rgb ? 1 : 0)
      && document.querySelectorAll('[data-cosmic-gemini-white-softer]').length === 0, tone?.rgb || '');
    assert.equal(await heading.evaluate(node => node === document.querySelector('#cg-warden-root h1')), true, 'palette changes retain the article DOM');
    assert.equal(views.get('/article?view=1'), paletteViews, 'palette changes never reload the page');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      // Contact click behavior was checked above; invoke it directly here so the
      // palette matrix measures colors independently of scroll positioning.
      await page.evaluate(() => document.querySelector('a[href^="mailto:"]').click());
      const colors = await page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        text: ['h1', '#cg-warden-content h2', '#cg-warden-content p', '#cg-warden-content li', 'th', 'td', 'pre', 'code',
          '.cg-warden-metadata', '.cg-warden-site', 'figcaption', 'blockquote', '#cg-warden-content a', '.cg-warden-actions button', '.cg-warden-contact p', '.cg-warden-contact button']
          .map(selector => ({ selector, color: getComputedStyle(document.querySelector(selector)).color }))
      }));
      const expectedPaper = colorScheme === 'dark' ? [23, 24, 25] : tone ? tone.rgb.split(' ').map(Number) : [250, 249, 247];
      assert.deepEqual(channels(colors.background), tone && colorScheme === 'light' ? [255, 255, 255] : expectedPaper, `${tone?.id || 'off'} / ${colorScheme}: native paper color`);
      const expectedWhite = tone ? tone.rgb.split(' ').map(Number) : colorScheme === 'dark' ? [227, 229, 232] : [250, 249, 247];
      assert.deepEqual(brightest(await page.locator('#cg-warden-root h1').screenshot()), expectedWhite, 'rendered text/paper matches the selected tone exactly');
      await page.locator('#cg-warden-content img').evaluate(img => img.scrollIntoView({ behavior: 'instant', block: 'center' }));
      // Let the compositor settle after an instant scroll; background/sandbox
      // documents cannot be used as a requestAnimationFrame timing source.
      await page.waitForTimeout(40);
      const imageBounds = await page.locator('#cg-warden-content img').boundingBox();
      const capture = await page.screenshot();
      const sampled = spawnSync('python3', ['-c', 'from PIL import Image\nimport sys,io,json\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")\nprint(json.dumps(im.getpixel((int(sys.argv[1]),int(sys.argv[2])))))',
        String(Math.round(imageBounds.x + imageBounds.width * .05)), String(Math.round(imageBounds.y + imageBounds.height * .1))], { input: capture });
      assert.equal(sampled.status, 0, String(sampled.stderr));
      assert.deepEqual(JSON.parse(sampled.stdout), tone ? tone.rgb.split(' ').map(Number) : [255, 255, 255], 'white image pixels follow the same tone exactly');
      const paper = luminance(expectedPaper);
      for (const text of colors.text) {
        const nativeInk = channels(text.color);
        const ink = luminance(tone && nativeInk.every(value => value === 255) ? tone.rgb.split(' ').map(Number) : nativeInk);
        const contrast = (Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05);
        assert.ok(contrast >= 4.5, `${tone?.id || 'off'} / ${colorScheme}: ${text.selector} contrast ${contrast.toFixed(2)} (${text.color})`);
      }
      await page.keyboard.press('Escape');
      if (tone?.id === 'warm-minus-1') await page.screenshot({ path: join(artifacts, `static-white-softer-${colorScheme}.png`) });
      if (tone?.id === 'warm-minus-1' && colorScheme === 'dark') {
        await page.emulateMedia({ media: 'print' });
        await page.waitForFunction(() => !document.querySelector('[data-cg-warden-white-softer]'));
        const print = await page.evaluate(() => ({ paper: getComputedStyle(document.body).backgroundColor,
          ink: getComputedStyle(document.querySelector('h1')).color, link: getComputedStyle(document.querySelector('#cg-warden-content a')).color }));
        assert.deepEqual(print, { paper: 'rgb(255, 255, 255)', ink: 'rgb(0, 0, 0)', link: 'rgb(11, 79, 180)' });
        await page.emulateMedia({ media: 'screen' });
      }
    }
  }
  assert.equal((await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'UI_SET_ENABLED', featureId: 'whiteSofter', enabled: false }))).ok, true);
  await page.waitForFunction(() => !document.documentElement.style.getPropertyValue('--cg-warden-white') && !document.querySelector('[data-cg-warden-white-softer]'));

  const binary = await context.newPage(); const response = await binary.goto(origin + '/image.svg');
  assert.equal(response.headers()['content-security-policy'], undefined, 'native HTML guards do not apply to image documents');
  await binary.close();
  const other = await context.newPage(); await other.goto(url.replace('warden.test', 'other.warden.test'));
  assert.equal(await other.evaluate(() => window.originalRan === true), true, 'an exact rule does not affect subdomains'); await other.close();

  // Reading state can be queried repeatedly without another automatic reload.
  const before = views.get('/article?view=1');
  const repeated = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'UI_SET_CRASH_PAGE_WARDEN', featureId: 'websiteFixer', enabled: true }));
  assert.equal(repeated.ok, true);
  assert.equal(views.get('/article?view=1'), before);
  await settings.locator('#crashPageWardenEnabled').uncheck();
  await worker.evaluate(async () => {
    for (let n = 0; n < 60; n++) {
      if (!(await chrome.declarativeNetRequest.getSessionRules()).some(r => r.id >= 940001 && r.id < 940201)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Static response rules were not removed.');
  });
  assert.equal(await page.locator('#cg-warden-root').count(), 1, 'off keeps the current static page');
  await page.reload(); await page.waitForFunction(() => window.originalRan === true);
  assert.equal(await page.locator('#cg-warden-root').count(), 0, 'manual reload applies the off policy');

  const popup = await context.newPage(); popup.on('pageerror', error => errors.push(error.message));
  await page.bringToFront(); await popup.goto(base + 'popup/index.html');
  await popup.waitForFunction(() => document.documentElement.dataset.localePending === 'false'); await popup.locator('#tools-toggle').click();
  await popup.locator('#crashPageWarden-tool').click();
  await page.waitForFunction(() => document.documentElement.dataset.cgWarden === 'ready');
  await popup.locator('#crashPageWarden-tool').click();
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.locator('#cg-warden-root').count(), 1);
  await popup.locator('#crashPageWarden-tool').click({ delay: 650 });
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').dataset.savedPolicy === 'false');
  await popup.locator('#crashPageWarden-tool').click({ delay: 650 });
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').dataset.savedPolicy === 'true');
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings);
  assert.deepEqual(saved.websiteFixer.crashPageWarden.whitelistDomains, ['*.warden.test']);
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'README.md'), '# Crash Page Warden\n\nCurrent check: scripts/browser/test-crash-page-warden-browser.mjs (PLAYWRIGHT_MODULE and TEST_CHROME point to local installations). static-article.html exercises original-address static conversion, one automatic reload, blocked source scripts/styles/frames, article metadata and images, sanitization, text sizing, automatic themes, dormant Dark Reader interop, and no forced theme lock, live White Softer on/off and all tones without reloading or replacing the article, one reader-owned cap with the ordinary-page layer inactive, and text/link/control contrast in both appearances, file-response exclusion, exact rules, repeat-activation idempotence, off/reload behavior, and popup click/hold. static-light.png and static-dark.png show the reader. static-white-softer-light.png and static-white-softer-dark.png show its owned palette; rendered heading and image pixels are checked in RAM for exact tone values. probe-static.mjs verifies isolated extension code/style operation under response sandbox CSP. Earlier article.html and probe-rescue.mjs concern the retired watchdog and are not current feature checks. No request/content logs or browser profiles are retained.\n');
  console.log('Warden static reader: original URL, one automatic reload, source-code blocking, article/images, sanitization, themes, file exclusion, lifecycle, and popup policies passed.');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); await new Promise(resolve => server.close(resolve)); }
