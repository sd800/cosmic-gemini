// Focused real-extension website controls; disposable profile and authored pages.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
try {
  await context.route(/^https?:\/\/(?:[a-z]+\.)?(?:example\.co\.uk|other\.test)\//, route => route.fulfill({
    contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" },
    body: '<!doctype html><title>Page Display fixture</title><style>body{margin:0;background:white;color:black;font:18px system-ui}main{padding:30px}</style><main>Website controls fixture</main>'
  }));
  const loader = await context.browser().newBrowserCDPSession();
  const { id } = await loader.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const base = `chrome-extension://${id}/`;
  const a = await context.newPage(); await a.goto('https://a.example.co.uk/one');
  const b = await context.newPage(); await b.goto('https://b.example.co.uk/two');
  const other = await context.newPage(); await other.goto('https://other.test/');
  const layer = '[data-cosmic-gemini-page-display]';
  const settings = await context.newPage(); await settings.goto(base + 'settings/page-display.html');
  await settings.locator('#version').filter({ hasText: '26.10.23.1' }).waitFor();
  const saved = () => settings.evaluate(async () => (await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings.pageDisplay);
  const command = async message => {
    const response = await settings.evaluate(message => chrome.runtime.sendMessage(message), message);
    assert.equal(response.ok, true, response.error); return response.result;
  };
  const waitLayer = (page, present) => page.waitForFunction(({layer,present}) => !!document.querySelector(layer) === present, { layer, present });
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
} finally { await context.close(); await rm(folder, { recursive: true, force: true }); }
