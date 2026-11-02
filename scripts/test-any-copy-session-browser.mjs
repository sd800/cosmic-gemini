import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SETTINGS_KEY } from '../extension/core/config.js';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const artifacts = resolve('test-dist/any-copy-session');
await mkdir(artifacts, { recursive: true });
const html = '<!doctype html><title>Copy fixture</title><p style="user-select:none">Selectable fixture text.</p>';
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html'); response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://copy.test:${server.address().port}`;
const folder = await mkdtemp(join(tmpdir(), 'cg-any-copy-'));
const extension = resolve('extension');
let context;
const errors = [];
try {
  context = await chromium.launchPersistentContext(join(folder, 'profile'), {
    executablePath: process.env.TEST_CHROME, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1']
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  const source = await context.newPage(); await source.goto(origin);
  const sibling = await context.newPage(); await sibling.goto(origin.replace('copy.test', 'sub.copy.test'));
  const other = await context.newPage(); await other.goto(origin.replace('copy.test', 'other.test'));
  const popup = await context.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  const open = async (page = source) => {
    await page.bringToFront();
    await popup.goto(base + 'popup/index.html');
    await popup.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
    await popup.waitForFunction(() => !document.querySelector('#anyCopy-status').disabled);
  };
  const active = (page, expected) => page.waitForFunction(expected =>
    Boolean(globalThis[Symbol.for('cosmic-gemini.any-copy.runtime')]?.active) === expected, expected);
  await open();
  const saved = await worker.evaluate(() => chrome.storage.local.get(null));
  const button = popup.locator('#anyCopy-status');
  await button.click();
  await popup.waitForFunction(() => document.querySelector('#anyCopy-status').getAttribute('aria-pressed') === 'true');
  assert.match(await button.getAttribute('title'), /copy.test.*subdomains.*Chrome/);
  assert.equal(await button.getAttribute('data-saved-policy'), 'false');
  assert.equal(await button.evaluate(node => getComputedStyle(node).boxShadow), 'none');
  await active(source, true); await active(sibling, true); await active(other, false);
  await source.reload(); await active(source, true);
  await open(sibling);
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await button.click();
  await popup.waitForFunction(() => document.querySelector('#anyCopy-status').getAttribute('aria-pressed') === 'false');
  await active(source, false); await active(sibling, false);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), saved);

  // A persistent wildcard may be disabled for this session without deleting it.
  await worker.evaluate(async SETTINGS_KEY => {
    const settings = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    settings.anyCopy.siteRules = ['*.copy.test'];
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    await chrome.storage.session.remove('anyCopySite:copy.test');
  }, SETTINGS_KEY);
  await source.reload(); await active(source, true);
  await open();
  assert.equal(await button.getAttribute('data-saved-policy'), 'true');
  await button.click(); await active(source, false); await active(sibling, false);
  await popup.waitForFunction(() => document.querySelector('#anyCopy-status').getAttribute('aria-pressed') === 'false');
  assert.equal(await button.getAttribute('data-saved-policy'), 'true');
  assert.notEqual(await button.evaluate(node => getComputedStyle(node).boxShadow), 'none');
  const rules = await worker.evaluate(async SETTINGS_KEY => {
    return (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY].anyCopy.siteRules;
  }, SETTINGS_KEY);
  assert.deepEqual(rules, ['*.copy.test']);
  await source.close(); await sibling.close();
  const reopened = await context.newPage(); await reopened.goto(origin);
  await open(reopened);
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await active(reopened, false);
  // Holds preserve temporary state except when adding an inactive, unlisted site.
  const temporaryBefore = await worker.evaluate(() => chrome.storage.session.get('anyCopySite:copy.test'));
  await button.click({ delay: 650 });
  await popup.waitForFunction(() => document.querySelector('#anyCopy-status').dataset.savedPolicy === 'false');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get('anyCopySite:copy.test')), temporaryBefore);
  await button.click({ delay: 650 });
  await popup.waitForFunction(() => document.querySelector('#anyCopy-status').dataset.savedPolicy === 'true'
    && document.querySelector('#anyCopy-status').getAttribute('aria-pressed') === 'true');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get('anyCopySite:copy.test')),
    { 'anyCopySite:copy.test': { active: true } });
  await active(reopened, true);
  await button.click();
  await popup.waitForFunction(() => document.querySelector('#anyCopy-status').getAttribute('aria-pressed') === 'false');
  await active(reopened, false);
  const offBefore = await worker.evaluate(() => chrome.storage.session.get('anyCopySite:copy.test'));
  await button.click({ delay: 650 });
  await popup.waitForFunction(() => document.querySelector('#anyCopy-status').dataset.savedPolicy === 'false');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get('anyCopySite:copy.test')), offBefore);
  // Page Display keeps its original global Reduce White Point indicator; Greyscale has no policy outline.
  await worker.evaluate(async key => {
    const settings = (await chrome.storage.local.get(key))[key];
    settings.pageDisplay.enabled = true;
    settings.pageDisplay.reduceWhitePoint.enabled = true;
    settings.pageDisplay.greyscale.enabled = true;
    await chrome.storage.local.set({ [key]: settings });
  }, SETTINGS_KEY);
  await open(reopened);
  const reduction = popup.locator('#reduceWhitePoint-status');
  const greyscale = popup.locator('#greyscale-status');
  assert.equal(await reduction.getAttribute('data-global'), 'true');
  assert.equal(await greyscale.getAttribute('data-global'), 'true');
  assert.notEqual(await reduction.evaluate(node => getComputedStyle(node).boxShadow), 'none');
  assert.equal(await greyscale.evaluate(node => getComputedStyle(node).boxShadow), 'none');
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'README.md'), `# Any Copy session checks\n\nRun scripts/test-any-copy-session-browser.mjs with PLAYWRIGHT_MODULE and TEST_CHROME set. Uses a disposable Chrome for Testing profile and local fixtures.\n\nVerified actual popup clicks, immediate same-domain and subdomain activation and restoration, isolation from unrelated domains, reload and reopen continuity, saved-rule preservation, and no persistent settings writes from ordinary clicks, a colored saved-policy outline that remains while temporarily off, and actual holds with automatic activation and no following release click. Unit tests cover all four hold-state transitions. Unit coverage in test/any-copy-session.test.mjs also checks browser-session clearing, worker recreation, coordinated activation, concurrent commands, private contexts, failed writes, and stale pages. No browsing logs are retained.\n`);
  console.log('Any Copy: popup, live pages, subdomains, reload/reopen, and unchanged saved rules passed.');
} catch (error) {
  console.error('Popup errors:', errors);
  throw error;
} finally {
  await context?.close();
  await rm(folder, { recursive: true, force: true });
  await new Promise(resolve => server.close(resolve));
}
