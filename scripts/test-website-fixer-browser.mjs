// Focused navigation/UI regression in a disposable browser, never the user's profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const fixtureDir = resolve('test-dist/website-fixer');
await mkdir(fixtureDir, { recursive: true });
const fixturePath = join(fixtureDir, 'navigation.html');
try { await writeFile(fixturePath, '<!doctype html><title>Navigation fixture</title><body><h1>Website Fixer QA</h1><button id="go">go</button><a id="link">link</a><form id="form"><button>submit</button></form>', { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const fixtureHtml = await readFile(fixturePath, 'utf8');
const hits = [];
const server = createServer((req, res) => {
  hits.push({ host: req.headers.host, path: req.url });
  if (req.url === '/redirect') { res.writeHead(302, { Location: `http://outside.test:${server.address().port}/escaped` }); res.end(); return; }
  if (req.url === '/photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(fixtureHtml);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port, origin = `http://stay.test:${port}`, outside = `http://outside.test:${port}/escaped`;
const folder = await mkdtemp(join(tmpdir(), 'cg-stay-qa-'));
const extension = resolve('extension');
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.PDF_VIEWER_CHROME, headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1']
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  context.setDefaultTimeout(8_000);
  const settings = await context.newPage();
  settings.on('pageerror', error => console.error('Settings error:', error.message));
  settings.on('console', message => { if (message.type() === 'error') console.error('Settings console:', message.text()); });
  await settings.goto(base + '/settings/satellites.html');
  await settings.waitForSelector('#websiteFixerStayOnPageEnabled', { state: 'attached' });
  await settings.locator('.switch:has(#websiteFixerEnabled)').click();
  await settings.locator('.switch:has(#websiteFixerStayOnPageEnabled)').click();
  const section = settings.locator('[data-setting-group="stayOnPage"]');
  assert.equal(await section.locator('.website-fixer-count').textContent(), '0 websites saved.');
  await section.locator('input').fill('https://deep.stay.test/path'); await section.locator('button[type=submit]').click();
  await section.locator('.website-fixer-saved').filter({ hasText: 'Website saved.' }).waitFor();
  assert.equal(await section.locator('.website-fixer-count').textContent(), '1 website saved.');
  assert.equal(await section.locator('.rule-list').count(), 0);
  assert.equal(await section.getByText('stay.test', { exact: true }).count(), 0);
  assert.deepEqual(await settings.evaluate(async () => (await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings.websiteFixer.stayOnPage.whitelistDomains), ['stay.test']);
  await settings.emulateMedia({ colorScheme: 'dark' });
  await settings.locator('.website-fixer-card').screenshot({ path: resolve('test-dist/website-fixer/card-dark.png') });
  await settings.emulateMedia({ colorScheme: 'light' });
  await settings.locator('.website-fixer-card').screenshot({ path: resolve('test-dist/website-fixer/card-light.png') });
  await settings.waitForFunction(() => !document.querySelector('[data-setting-group="stayOnPage"] .website-fixer-saved').textContent, null, { timeout: 4_500 });
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.equal(scripts.filter(s => s.id.includes('website-fixer-stay')).length, 2);
  const page = await context.newPage(); await page.goto(`http://outside.test:${port}/prior`); await page.goto(origin);
  const guard = await page.evaluate(() => ({ active: !!window[Symbol.for('cosmic-gemini.website-fixer.stay')], navigation: !!window.navigation }));
  assert.deepEqual(guard, { active: true, navigation: true });
  const manualPage = context.waitForEvent('page');
  const manualTabInfo = await worker.evaluate(() => chrome.tabs.create({ active: true }));
  const manualTab = await manualPage;
  assert.equal(manualTabInfo.openerTabId, undefined, 'browser-created new tabs have no website opener');
  await manualTab.goto(`http://outside.test:${port}/manual`);
  assert.equal(manualTab.url(), `http://outside.test:${port}/manual`, 'a user-created tab can load an external address');
  await manualTab.close();
  const sourceTabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs =>
    tabs.find(tab => tab.url === url)?.id), origin + '/');
  assert.ok(Number.isInteger(sourceTabId));
  const chosenUrl = `http://outside.test:${port}/chosen`;
  await worker.evaluate(() => {
    globalThis.__contextMessages = [];
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'CG_WEBSITE_FIXER_CONTEXT_MENU') globalThis.__contextMessages.push(message);
    });
  });
  await page.locator('#link').evaluate((link, url) => { link.href = url; }, chosenUrl);
  await page.locator('#link').click({ button: 'right' });
  await page.waitForTimeout(80);
  assert.ok((await worker.evaluate(() => globalThis.__contextMessages)).some(message => message.urls.includes(chosenUrl)),
    'a native link context menu reports its exact target');
  const chosenPage = context.waitForEvent('page');
  await worker.evaluate(({ url, openerTabId }) => chrome.tabs.create({ url, openerTabId, active: false }),
    { url: chosenUrl, openerTabId: sourceTabId });
  const chosenTab = await chosenPage;
  await chosenTab.waitForURL(chosenUrl);
  await chosenTab.close();
  const imageUrl = `http://outside.test:${port}/photo.svg`;
  await page.evaluate(url => {
    const image = document.createElement('img'); image.id = 'photo'; image.src = url; document.body.append(image);
  }, imageUrl);
  await page.locator('#photo').click({ button: 'right' });
  await page.waitForTimeout(80);
  assert.ok((await worker.evaluate(() => globalThis.__contextMessages)).some(message => message.image && message.urls.includes(imageUrl)),
    'right-clicking an image records its browser-menu target');
  await page.locator('#photo').evaluate(image => image.addEventListener('contextmenu', event => event.preventDefault()));
  const beforeCustomMenu = await worker.evaluate(() => globalThis.__contextMessages.length);
  await page.locator('#photo').click({ button: 'right' });
  await page.waitForTimeout(80);
  assert.equal(await worker.evaluate(() => globalThis.__contextMessages.length), beforeCustomMenu,
    'a page-owned context menu does not authorize browser actions');
  await page.evaluate(() => {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('h1'));
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator('h1').click({ button: 'right' });
  await page.waitForTimeout(80);
  assert.ok((await worker.evaluate(() => globalThis.__contextMessages)).some(message => message.search),
    'right-clicking selected text reports a browser search target');
  const googleUrl = 'https://www.google.com/search?q=Website+Fixer+QA';
  await context.route('https://www.google.com/search**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Search fixture</title>'
  }));
  const searchPage = context.waitForEvent('page');
  await worker.evaluate(({ url, openerTabId }) => chrome.tabs.create({ url, openerTabId, active: false }),
    { url: googleUrl, openerTabId: sourceTabId });
  const searchTab = await searchPage;
  await searchTab.waitForURL(googleUrl);
  await searchTab.close();
  const extensionPage = context.waitForEvent('page');
  await worker.evaluate(({ url, openerTabId }) => chrome.tabs.create({ url, openerTabId, active: false }),
    { url: `http://outside.test:${port}/extension-open`, openerTabId: sourceTabId });
  const extensionTab = await extensionPage;
  await extensionTab.waitForURL(`http://outside.test:${port}/extension-open`);
  await extensionTab.close();
  const attempts = [
    ['script history escape', () => history.back()],
    ['location assignment', url => { location.href = url; }],
    ['location replace', url => { location.replace(url); }],
    ['Navigation API', url => { navigation.navigate(url).finished.catch(() => {}); }],
    ['anchor', url => { const a = document.querySelector('#link'); a.href = url; a.click(); }],
    ['new-tab anchor', url => { const a = document.querySelector('#link'); a.href = url; a.target = '_blank'; a.click(); }],
    ['script form', url => { const f = document.querySelector('#form'); f.action = url; f.submit(); }],
    ['submitter override', url => { const f = document.querySelector('#form'), b = f.querySelector('button'); b.formAction = url; f.requestSubmit(b); }],
    ['meta refresh', url => { const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=' + url; document.head.append(m); }],
    ['external blob', () => { location.href = 'blob:https://outside.test/not-ours'; }],
    ['external protocol', () => { location.href = 'testapp://escape'; }],
    ['popup', url => { if (window.open(url, '_blank', 'width=400,height=400') !== null) throw Error('Popup opened'); }]
  ];
  for (const [name, run] of attempts) {
    await page.evaluate(run, outside); await page.waitForTimeout(70);
    assert.equal(page.url(), origin + '/', name);
    assert.equal(context.pages().length, 3, name + ' left a popup'); // startup + Settings + fixture
  }
  await page.evaluate(origin => { const a = document.querySelector('#link'); a.target = '_self'; a.href = origin + '/allowed'; a.click(); }, `http://sub.stay.test:${port}`);
  await page.waitForURL('**/allowed');
  await page.goto(origin);
  // Third-party resources still load, while nested embeds cannot launch popups.
  const frame = await page.evaluate(async url => {
    const iframe = document.createElement('iframe'); iframe.src = url; document.body.append(iframe);
    await new Promise(r => iframe.onload = r); return iframe.src;
  }, `http://embed.test:${port}/frame`);
  const child = page.frames().find(f => f.url() === frame); assert.ok(child);
  assert.equal(await child.evaluate(url => window.open(url) === null, outside), true);
  await child.evaluate(url => { try { top.location = url; } catch {} }, outside);
  assert.equal(page.url(), origin + '/');
  const popupPromise = context.waitForEvent('page');
  await page.evaluate(() => window.open(URL.createObjectURL(new Blob(['<title>Blob fixture</title>'], { type: 'text/html' }))));
  const blob = await popupPromise; await blob.waitForLoadState();
  await blob.evaluate(url => { location.href = url; }, outside); await blob.waitForTimeout(80);
  assert.ok(blob.url().startsWith('blob:'), 'same-site blob cannot escape'); await blob.close();
  // Server redirects can only be denied at the network layer (Chrome may show its blocked-page UI).
  await page.evaluate(url => { location.href = url; }, origin + '/redirect');
  await page.waitForTimeout(200);
  assert.equal(hits.filter(hit => hit.host.startsWith('outside.test') && hit.path === '/escaped').length, 0, 'no external navigation request reaches its server');
  const clearButton = section.locator('[data-reset-websites]');
  await clearButton.click();
  assert.equal(await clearButton.textContent(), 'Confirm');
  assert.equal(await clearButton.getAttribute('data-confirming'), 'true');
  assert.equal(await section.locator('.website-fixer-count').textContent(), '1 website saved.');
  await section.locator('.website-fixer-count').click();
  assert.equal(await clearButton.textContent(), 'Clear website list');
  await clearButton.click();
  await clearButton.click();
  await settings.waitForFunction(async () => !(await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings.websiteFixer.stayOnPage.whitelistDomains.length);
  await settings.waitForFunction(() => document.querySelector('[data-setting-group="stayOnPage"] .website-fixer-count').textContent === '0 websites saved.');
  assert.equal(await section.locator('.website-fixer-count').textContent(), '0 websites saved.');
  await page.goto(origin); await page.evaluate(url => { location.href = url; }, outside); await page.waitForURL(outside);
  console.log('PASS: settings, page-navigation guards, manual/context-menu/extension-created tabs, same-site navigation, embedded resources and cleanup.');
} finally { await context.close(); server.close(); await rm(folder, { recursive: true, force: true }); }
