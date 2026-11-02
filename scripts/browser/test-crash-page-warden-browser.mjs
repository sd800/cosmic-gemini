import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
<ul><li>First reading point</li><li>Second reading point</li></ul><table><tr><th>Item</th><th>Result</th></tr><tr><td>Reading</td><td>Available</td></tr></table>
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
  if (req.url === '/image.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="450"><rect width="900" height="450" fill="#20324b"/><circle cx="650" cy="120" r="60" fill="#e6c98b"/><path d="M0 400 230 160 500 450M350 450 660 220 900 450" fill="#628c9c"/></svg>'); return; }
  views.set(req.url, (views.get(req.url) || 0) + 1); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://warden.test:${server.address().port}`, url = origin + '/article?view=1';
const profile = await mkdtemp(join(tmpdir(), 'cg-warden-static-')); let context;
try {
  const extension = resolve('extension');
  const extensionPaths = [extension, process.env.TEST_DARK_READER_EXTENSION].filter(Boolean).join(',');
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.TEST_CHROME, headless: true,
    viewport: { width: 1150, height: 900 }, args: [`--disable-extensions-except=${extensionPaths}`, `--load-extension=${extensionPaths}`,
      '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1'] });
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith('/background/central.js')) || await context.waitForEvent('serviceworker', { predicate: worker => worker.url().endsWith('/background/central.js') });
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.permissions.includes('debugger'), false); assert.equal(manifest.permissions.includes('webNavigation'), false);
  const page = await context.newPage(); const policies = [];
  page.on('response', response => { if (response.url() === url) policies.push(response.headers()['content-security-policy'] || ''); });
  await page.goto(url); await page.waitForFunction(() => window.originalRan === true);
  if (process.env.TEST_DARK_READER_EXTENSION) {
    const darkWorker = context.serviceWorkers().find(worker => worker.url().endsWith('/background/index.js'))
      || await context.waitForEvent('serviceworker', { predicate: worker => worker.url().endsWith('/background/index.js') });
    assert.equal(await darkWorker.evaluate(() => chrome.runtime.getManifest().name), 'Dark Reader');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-darkreader-mode'));
  }
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
  assert.equal(await page.locator('meta[name=darkreader-lock]').count(), 1);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-darkreader-mode'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(250, 249, 247)', 'the reader follows light appearance without a second Dark Reader pass');
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
  await page.waitForFunction(() => document.querySelector('#dark-reader-style')?.media === 'not all' && !document.documentElement.hasAttribute('data-darkreader-mode'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).filter), 'none');
  await page.screenshot({ path: join(artifacts, 'static-light.png') });

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
  await writeFile(join(artifacts, 'README.md'), '# Crash Page Warden\n\nCurrent check: scripts/browser/test-crash-page-warden-browser.mjs (PLAYWRIGHT_MODULE and TEST_CHROME point to local installations). static-article.html exercises original-address static conversion, one automatic reload, blocked source scripts/styles/frames, article metadata and images, sanitization, text sizing, automatic themes and Dark Reader isolation (TEST_DARK_READER_EXTENSION optionally loads its installed code in the isolated test profile), file-response exclusion, exact rules, repeat-activation idempotence, off/reload behavior, and popup click/hold. static-light.png and static-dark.png show the reader. probe-static.mjs verifies isolated extension code/style operation under response sandbox CSP. Earlier article.html and probe-rescue.mjs concern the retired watchdog and are not current feature checks. No request/content logs or browser profiles are retained.\n');
  console.log('Warden static reader: original URL, one automatic reload, source-code blocking, article/images, sanitization, themes, file exclusion, lifecycle, and popup policies passed.');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); await new Promise(resolve => server.close(resolve)); }
