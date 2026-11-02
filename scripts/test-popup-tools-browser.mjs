import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SETTINGS_KEY } from '../extension/core/config.js';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const artifacts = resolve('test-dist/popup-tools');
await mkdir(artifacts, { recursive: true });
const fixture = join(artifacts, 'page.html');
try {
  await writeFile(fixture, `<!doctype html><meta name="google" content="notranslate"><title>Tools fixture</title>
<symbol id="google" viewbox="0 0 20 20"><path id="symbol-child" d="M2 2h16v16H2z"></path></symbol>
<p id="copy" class="copy notranslate" translate="no">Website tools fixture.</p>
<a id="away" href="/outside">External page</a><a id="same" href="/same">Same website</a>`, { flag: 'wx' });
} catch (error) { if (error.code !== 'EEXIST') throw error; }
const html = await readFile(fixture, 'utf8');
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://tools.test:${server.address().port}`;
const outside = `http://outside.test:${server.address().port}/outside`;
const folder = await mkdtemp(join(tmpdir(), 'cg-popup-tools-'));
const extension = resolve('extension');
const context = await chromium.launchPersistentContext(join(folder, 'profile'), {
  executablePath: process.env.TEST_CHROME, headless: true, viewport: { width: 310, height: 440 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1']
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  const errors = [];
  const source = await context.newPage();
  await source.goto(origin);
  const popup = await context.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  const open = async () => {
    await source.bringToFront();
    await popup.goto(base + 'popup/index.html');
    await popup.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
    await popup.waitForFunction(() => !document.querySelector('#translateOverride-tool').disabled);
  };
  await open();
  const localBefore = await worker.evaluate(() => chrome.storage.local.get(null));
  const main = await popup.locator('.popup-shell').boundingBox();
  const centers = await popup.evaluate(() => {
    const center = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.x + r.width / 2; };
    return [center('nativeScroll-status'), center('tools-toggle')];
  });
  assert.ok(Math.abs(centers[0] - centers[1]) < 1, 'the toolbox aligns with the first column');
  await popup.locator('#tools-toggle').click();
  assert.equal(await popup.locator('#main-page').isVisible(), false);
  const toolsSize = await popup.locator('.popup-shell').boundingBox();
  assert.equal(toolsSize.width, main.width);
  assert.equal(toolsSize.height, main.height, 'the footer stays in the same position on both pages');
  await popup.locator('#tools-toggle').click();
  assert.equal(await popup.locator('#main-page').isVisible(), true);
  assert.equal((await popup.locator('.popup-shell').boundingBox()).height, main.height);
  await popup.locator('#tools-toggle').click();
  for (const scheme of ['light', 'dark']) {
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.locator('.popup-shell').screenshot({ path: join(artifacts, `tools-${scheme}.png`) });
  }

  await popup.locator('#translateOverride-tool').click();
  await popup.waitForFunction(() => document.querySelector('#translateOverride-tool').getAttribute('aria-pressed') === 'true');
  await source.waitForFunction(() => document.getElementById('google').constructor.name === 'SVGSymbolElement');
  assert.equal(await source.locator('meta[name="google"]').count(), 0);
  assert.equal(await source.locator('#copy').getAttribute('translate'), null);
  await popup.locator('#stayOnPage-tool').click();
  await popup.waitForFunction(() => document.querySelector('#stayOnPage-tool').getAttribute('aria-pressed') === 'true');
  await source.locator('#away').evaluate((node, target) => { node.href = target; }, outside);
  await source.locator('#away').click();
  assert.equal(source.url(), origin + '/');
  const guarded = await source.evaluate(() => window.open('https://external.test/') === null);
  assert.equal(guarded, true);

  await open();
  await popup.locator('#tools-toggle').click();
  assert.equal(await popup.locator('#translateOverride-tool').getAttribute('aria-pressed'), 'true');
  assert.equal(await popup.locator('#stayOnPage-tool').getAttribute('aria-pressed'), 'true');
  const subdomain = await context.newPage();
  await subdomain.goto(origin.replace('tools.test', 'sub.tools.test'));
  await subdomain.waitForFunction(() => document.getElementById('google').constructor.name === 'SVGSymbolElement');
  assert.equal(await subdomain.evaluate(() => window.open('https://external.test/') === null), true);
  await subdomain.close();
  await source.bringToFront();

  await popup.locator('#translateOverride-tool').click();
  await popup.waitForFunction(() => document.querySelector('#translateOverride-tool').getAttribute('aria-pressed') === 'false');
  await source.waitForFunction(() => document.getElementById('google').constructor.name === 'HTMLUnknownElement');
  assert.equal(await source.locator('meta[name="google"]').getAttribute('content'), 'notranslate');
  assert.equal(await source.locator('#copy').getAttribute('translate'), 'no');
  await popup.locator('#stayOnPage-tool').click();
  await popup.waitForFunction(() => document.querySelector('#stayOnPage-tool').getAttribute('aria-pressed') === 'false');
  await source.locator('#away').click();
  await source.waitForURL(outside);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), localBefore);
  assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()))
    .some(script => script.id.includes('-session')), false);
  await source.goto(origin);
  await open(); await popup.locator('#tools-toggle').click();
  for (const kind of ['translateOverride', 'stayOnPage']) {
    const button = popup.locator('#' + kind + '-tool');
    await button.click({ delay: 650 });
    await popup.waitForFunction(kind => document.getElementById(kind + '-tool').dataset.savedPolicy === 'true', kind);
    assert.equal(await button.getAttribute('data-policy-enabled'), 'false');
    await popup.waitForFunction(kind => document.getElementById(kind + '-tool').getAttribute('aria-pressed') === 'true', kind);
    const after = await worker.evaluate(() => chrome.storage.session.get('cosmicGeminiWebsiteFixerTools'));
    assert.deepEqual(after.cosmicGeminiWebsiteFixerTools[kind], [{ site: 'tools.test', enabled: true }]);
    const mutedBorder = await button.evaluate(node => {
      const style = getComputedStyle(node);
      return { shadow: style.boxShadow, muted: style.getPropertyValue('--muted').trim() };
    });
    assert.notEqual(mutedBorder.shadow, 'none');
    await button.click();
    await popup.waitForFunction(kind => document.getElementById(kind + '-tool').getAttribute('aria-pressed') === 'false', kind);
    // Turning on the corresponding Settings switch changes the border to purple.
    await worker.evaluate(async ({ key, kind }) => {
      const settings = (await chrome.storage.local.get(key))[key];
      settings.websiteFixer[kind].enabled = true;
      await chrome.storage.local.set({ [key]: settings });
    }, { key: SETTINGS_KEY, kind });
    await open(); await popup.locator('#tools-toggle').click();
    assert.equal(await button.getAttribute('data-policy-enabled'), 'true');
    assert.notEqual(await button.evaluate(node => getComputedStyle(node).boxShadow), mutedBorder.shadow);
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    const saved = await worker.evaluate(async ({ key, kind }) => (await chrome.storage.local.get(key))[key].websiteFixer[kind].whitelistDomains,
      { key: SETTINGS_KEY, kind });
    assert.deepEqual(saved, ['tools.test']);
    // A saved rule cannot reactivate a page while the explicit session override is off.
    await source.reload();
    if (kind === 'translateOverride') assert.equal(await source.locator('meta[name="google"]').getAttribute('content'), 'notranslate');
    else assert.equal(await source.evaluate(() => !!globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-bootstrap')]?.enabled), false);
    await open(); await popup.locator('#tools-toggle').click();
    const offBefore = await worker.evaluate(() => chrome.storage.session.get('cosmicGeminiWebsiteFixerTools'));
    await button.click({ delay: 650 });
    await popup.waitForFunction(kind => document.getElementById(kind + '-tool').dataset.savedPolicy === 'false', kind);
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get('cosmicGeminiWebsiteFixerTools')), offBefore);
  }
  const settingsPage = await context.newPage();
  await settingsPage.goto(base + 'settings/satellites.html');
  await settingsPage.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  assert.equal(await settingsPage.locator('#websiteFixerEnabled').count(), 0);
  assert.equal(await settingsPage.locator('#websiteFixerOptions').isDisabled(), false);
  await settingsPage.close();
  assert.deepEqual(errors, []);
  console.log('Popup tools: layout, stable height, live activation/restoration, reopening, subdomains, session cleanup, unchanged saved settings for clicks, hold-state transitions, grey/purple policy outlines, saved-rule overrides, and the frozen master passed.');
} finally {
  await context.close();
  await rm(folder, { recursive: true, force: true });
  await new Promise(resolve => server.close(resolve));
}
