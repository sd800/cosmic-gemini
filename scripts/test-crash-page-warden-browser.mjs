import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const artifacts = resolve('test-dist/crash-page-warden');
await mkdir(artifacts, { recursive: true });
const fixture = join(artifacts, 'article.html');
const html = `<!doctype html><meta charset="utf-8"><title>Reading fixture</title>
<style>body{font:18px system-ui;max-width:700px;margin:40px auto}img{width:100px;height:60px}iframe{border:0}</style>
<article><h1>Reading remains available</h1><p id="paragraph">An ordinary article paragraph.</p>
<img id="lazy" alt="Local illustration"><button id="expand">Expand full text</button><p id="extra" hidden>Expanded paragraph.</p>
<button id="next">Next page</button><p id="next-text"></p><a href="/next">Ordinary link</a></article>
<iframe title="Advertisement" src="/frame" width="300" height="250"></iframe>
<iframe title="Login authentication" src="/auth" width="1" height="1"></iframe>
<iframe title="Article video" src="/video" width="320" height="180"></iframe>
<script>
window.telemetryTicks=0;
setInterval(function collect(){const analytics=navigator.userAgent;window.telemetryTicks++;},1);
setTimeout(()=>{document.querySelector('#lazy').src='/image.svg';},100);
document.querySelector('#expand').onclick=()=>{document.querySelector('#extra').hidden=false;};
document.querySelector('#next').onclick=()=>setTimeout(()=>{document.querySelector('#next-text').textContent='Next paragraph.';},30);
if(location.search.includes('stall=1'))setInterval(()=>{const start=performance.now();while(performance.now()-start<20000){}window.stallCompleted=true;},1200);
</script>`;
if (await readFile(fixture, 'utf8').catch(() => '') !== html) await writeFile(fixture, html);
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/image.svg' ? 'image/svg+xml' : 'text/html');
  response.end(request.url === '/image.svg' ? '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#946800"/></svg>'
    : /^\/(?:frame|auth|video)/.test(request.url) ? '<!doctype html><p>Embedded component</p>' : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://warden.test:${server.address().port}`;
const folder = await mkdtemp(join(tmpdir(), 'cg-warden-'));
let context;
try {
  const extension = resolve('extension');
  context = await chromium.launchPersistentContext(join(folder, 'profile'), { executablePath: process.env.TEST_CHROME,
    headless: true, viewport: { width: 1100, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1'] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.wardenDiagnostics = [];
    chrome.debugger.onEvent.addListener((target, method) => {
      if (method === 'Page.javascriptDialogOpening' || method === 'Page.javascriptDialogClosed') globalThis.wardenDiagnostics.push({ name: method, tabId: target.tabId });
    });
    for (const name of ['attach', 'sendCommand', 'detach']) {
      const invoke = chrome.debugger[name].bind(chrome.debugger);
      chrome.debugger[name] = async (...args) => {
        try { const value = await invoke(...args); globalThis.wardenDiagnostics.push({ name, method: args[1], tabId: args[0]?.tabId, ok: true }); return value; }
        catch (error) { globalThis.wardenDiagnostics.push({ name, method: args[1], tabId: args[0]?.tabId, error: error.message }); throw error; }
      };
    }
  });
  const errors = [];
  context.on('page', page => { if (page.url().startsWith('chrome-extension:')) page.on('pageerror', error => errors.push(error.message)); });
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  const settings = await context.newPage(); settings.on('pageerror', error => errors.push(error.message)); await settings.goto(base + 'settings/satellites.html');
  await settings.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  await settings.locator('[data-card-disclosure="satellite-website-fixer"]').click();
  assert.equal(await settings.locator('#crashPageWardenEnabled').isChecked(), false);
  await settings.locator('#crashPageWardenEnabled').check();
  const rules = settings.locator('[data-setting-group="crashPageWarden"]');
  await rules.locator('input[type=text]').fill(origin + '/article'); await rules.locator('button[type=submit]').click();
  await rules.locator('code').getByText('warden.test', { exact: true }).waitFor();
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await chrome.scripting.getRegisteredContentScripts()).some(s => s.id === 'cosmic-gemini-crash-page-warden')) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Warden registration was not installed.');
  });
  const page = await context.newPage(); await page.goto(origin);
  await page.waitForFunction(() => !!globalThis[Symbol.for('cosmic-gemini.crash-page-warden')]);
  await page.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.crash-page-warden')].state().stoppedTasks > 0);
  assert.ok(await page.evaluate(() => telemetryTicks < 160));
  assert.equal(await page.locator('iframe[title="Advertisement"]').count(), 0);
  assert.equal(await page.locator('iframe[title="Login authentication"]').count(), 1);
  assert.equal(await page.locator('iframe[title="Article video"]').count(), 1);
  await page.waitForFunction(() => document.querySelector('#lazy').naturalWidth === 100);
  await page.locator('#expand').click(); assert.equal(await page.locator('#extra').isVisible(), true);
  await page.locator('#next').click(); await page.getByText('Next paragraph.', { exact: true }).waitFor();
  await worker.evaluate(async origin => {
    const tab = (await chrome.tabs.query({})).find(t => t.url === origin + '/');
    for (let i = 0; i < 40; i++) {
      if (globalThis.wardenDiagnostics.some(event => event.tabId === tab.id && event.method === 'Page.enable' && event.ok)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('The rescue session was not prepared.');
  }, origin);
  const dialogEvent = page.waitForEvent('dialog');
  const dialogTask = page.evaluate(() => alert('Reading fixture confirmation'));
  const dialog = await dialogEvent;
  await worker.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      if (globalThis.wardenDiagnostics.some(event => event.name === 'Page.javascriptDialogOpening')) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Native dialog lifecycle was not delivered.');
  });
  await dialog.dismiss(); await dialogTask;
  const other = await context.newPage(); await other.goto(origin.replace('warden.test', 'other.warden.test'));
  assert.equal(await other.evaluate(() => !!globalThis[Symbol.for('cosmic-gemini.crash-page-warden')]), false, 'an exact rule must not become a wildcard');
  await other.close();

  if (process.env.WARDEN_UI_ONLY !== '1') {
  // A recurring synchronous stall verifies native rescue and callback retirement.
  await page.bringToFront(); await page.goto(origin + '/?stall=1', { waitUntil: 'domcontentloaded' });
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(t => t.url?.startsWith(origin + '/?stall=1')).id, origin);
  await worker.evaluate(async tabId => {
    for (let attempt = 0; attempt < 360; attempt++) {
      const values = await chrome.storage.session.get('cosmicGeminiCrashPageWardenDocuments');
      if (values.cosmicGeminiCrashPageWardenDocuments?.some(d => d.tabId === tabId && d.frameId === 0 && d.interruptions > 0)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const values = await chrome.storage.session.get('cosmicGeminiCrashPageWardenDocuments');
    throw Error('Watchdog did not interrupt: ' + JSON.stringify({ attempts: values.cosmicGeminiCrashPageWardenDocuments?.filter(d => d.tabId === tabId).map(d => ({frameId:d.frameId,attempts:d.attempts,interruptions:d.interruptions})), commands: globalThis.wardenDiagnostics }));
  }, tabId);
  assert.equal(await page.evaluate(() => globalThis.stallCompleted === true), false, 'rescue must interrupt before the fixture naturally completes');
  await page.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.crash-page-warden')].state().stoppedTasks >= 2);
  await page.locator('#expand').click(); assert.equal(await page.locator('#extra').isVisible(), true);
  assert.equal(await worker.evaluate(async tabId => (await chrome.debugger.getTargets()).find(t => t.tabId === tabId)?.attached === true, tabId), true, 'rescue connection stays ready for this document');
  }

  await settings.locator('#crashPageWardenEnabled').uncheck();
  await worker.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      if (!(await chrome.scripting.getRegisteredContentScripts()).some(s => s.id.startsWith('cosmic-gemini-crash-page-warden'))) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Off policy registrations were not removed.');
  });
  assert.equal(await page.evaluate(() => globalThis[Symbol.for('cosmic-gemini.crash-page-warden')].state().active), true);
  await page.goto(origin + '/after-off');
  assert.equal(await page.evaluate(() => !!globalThis[Symbol.for('cosmic-gemini.crash-page-warden')]), false);
  await worker.evaluate(async origin => {
    for (let i = 0; i < 40; i++) {
      const tab = (await chrome.tabs.query({})).find(t => t.url === origin + '/after-off');
      const owned = await chrome.debugger.sendCommand({ tabId: tab?.id }, 'Runtime.disable').then(() => true, () => false);
      if (!owned) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Navigation did not release the rescue connection.');
  }, origin);

  const popup = await context.newPage(); popup.on('pageerror', error => errors.push(error.message)); await page.bringToFront(); await popup.goto(base + 'popup/index.html');
  await popup.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  await popup.locator('#tools-toggle').click(); await popup.locator('#crashPageWarden-tool').click();
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => !!globalThis[Symbol.for('cosmic-gemini.crash-page-warden')]);
  await popup.locator('#crashPageWarden-tool').click();
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.evaluate(() => globalThis[Symbol.for('cosmic-gemini.crash-page-warden')].state().active), true);
  const tool = popup.locator('#crashPageWarden-tool');
  await tool.click({ delay: 650 });
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').dataset.savedPolicy === 'false');
  assert.equal(await tool.getAttribute('aria-pressed'), 'false', 'removing a saved rule preserves temporary off');
  await tool.click({ delay: 650 });
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').dataset.savedPolicy === 'true');
  assert.equal(await tool.getAttribute('aria-pressed'), 'true', 'adding an unlisted inactive site also activates the session');
  assert.equal(await tool.getAttribute('data-policy-enabled'), 'false', 'a hold leaves the saved child switch off');
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('cosmicGeminiSettings')).cosmicGeminiSettings);
  assert.deepEqual(saved.websiteFixer.crashPageWarden.whitelistDomains, ['*.warden.test']);
  await tool.click();
  await popup.waitForFunction(() => document.querySelector('#crashPageWarden-tool').getAttribute('aria-pressed') === 'false');
  assert.equal(await tool.getAttribute('data-saved-policy'), 'true');
  await popup.mouse.move(145, 310); await popup.waitForTimeout(180);
  await popup.locator('.popup-shell').screenshot({ path: join(artifacts, 'tools.png') });
  await settings.bringToFront();
  await rules.locator('code').getByText('*.warden.test', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await settings.locator('#crashPageWardenEnabled').check();
  await settings.waitForTimeout(180);
  await settings.locator('#satellite-website-fixer').screenshot({ path: join(artifacts, 'settings.png') });
  await writeFile(join(artifacts, 'README.md'), '# Crash Page Warden\n\nRun scripts/test-crash-page-warden-browser.mjs with PLAYWRIGHT_MODULE and TEST_CHROME. article.html is the reusable local reading fixture. Checks Settings save and exact-host matching, bounded callback budgets, preservation of images/expand/pagination/authentication and native dialog lifecycle, marked frame removal, one bounded main-thread stall interrupted by the independent debugger watchdog, prepared attachment lifetime and navigation cleanup, sticky page control after switch-off, next-load release, and popup click/hold transitions. probe-rescue.mjs compares cold, detached, and prepared debugger sessions with bounded local execution. settings.png and tools.png show the current UI. Uses a disposable browser profile; no request or content logs are retained. Unit tests use a simulated clock for thresholds and lifecycle races. WARDEN_UI_ONLY=1 repeats policy/UI checks without the interruption fixture.\n');
  console.log('Warden: reading, exact scope, runtime budgets, ' + (process.env.WARDEN_UI_ONLY === '1' ? '' : 'real stalled-script rescue, ') + 'sticky lifecycle, and popup click/hold controls passed.');
} finally {
  await context?.close(); await rm(folder, { recursive: true, force: true });
  await new Promise(resolve => server.close(resolve));
}
