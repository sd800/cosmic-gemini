// Product inactivity and cleanup in a disposable headless browser.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStandingProvince } from '../../extension/background/provinces/standing.js';
import { createOperationsProvince } from '../../extension/background/provinces/operations.js';

// Read actual product declarations without initializing background services.
globalThis.chrome = { webRequest: {} };
const products = Object.values({ ...createStandingProvince({}).products, ...createOperationsProvince({}).products })
  .filter(product => product.bridge && product.runtime);
delete globalThis.chrome;
const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'cg-feature-inactive-'));
const html = '<!doctype html><html translate="no"><head><meta name="google" content="notranslate"><title>Feature boundary</title><style>html{scroll-snap-type:y mandatory}</style><p>Readable content.</p><a id="link" href="https://outside.test/?utm_source=test">Link</a><form></form>';
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CONTEXT_CHROME,
    args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`] });
  context.setDefaultTimeout(12000);
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:/, route => route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).pathname === '/with-child' ? html + '<iframe src="https://child.test/child"></iframe>' : html }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  const settings = await context.newPage(); await settings.goto(base + 'settings/all-settings.html');
  await settings.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  await worker.evaluate(() => {
    globalThis.productInjections = new Map();
    for (const name of ['executeScript', 'insertCSS', 'removeCSS']) {
      const original = chrome.scripting[name].bind(chrome.scripting);
      chrome.scripting[name] = details => {
        if (details.func?.name !== 'syncForTest') productInjections.set(details.target.tabId,
          (productInjections.get(details.target.tabId) || 0) + 1);
        return original(details);
      };
    }
  });
  const settle = async page => worker.evaluate(async url => {
    const tabId = (await chrome.tabs.query({})).find(tab => tab.url === url)?.id;
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED',
      func: function syncForTest() { return globalThis[Symbol.for('cosmic-gemini.central')]?.sync(); } });
    return tabId;
  }, page.url());
  const locations = {
    xhsImageDarkMode: 'https://www.xiaohongshu.com/explore/fixture', xhsNavigation: 'https://www.xiaohongshu.com/explore/fixture',
    zhihuImageAdjustment: 'https://www.zhihu.com/question/fixture', leetcodeDarkMode: 'https://leetcode.com/explore/featured/card/fixture/',
    chineseResponseClaude: 'https://claude.ai/new', adMarshal: 'https://www.qq.com/fixture'
  };
  for (const url of new Set(['https://inactive.test/with-child', ...Object.values(locations), 'https://www.google.com/search?q=fixture', 'https://www.instagram.com/fixture/'])) {
    const page = await context.newPage(); await page.goto(url); const tabId = await settle(page);
    assert.equal(await worker.evaluate(id => productInjections.get(id) || 0, tabId), 0, 'disabled defaults inject no product code, CSS, or cleanup probes');
    await page.close();
  }
  console.log('PASS: disabled products inject nothing on general and supported site routes.');

  // MAIN runtimes are exercised directly so policy-specific start behavior and
  // the document-open failure can be checked without changing saved settings.
  for (const product of products.filter(product => product.id !== 'websiteKnowledgeControl')) {
    const page = await context.newPage(); await page.goto(locations[product.id] || 'https://inactive.test/'); await settle(page);
    // Initialize the automation helper before tracking product-owned listeners.
    await page.addScriptTag({ content: '/* automation helper initialization */' });
    await page.evaluate(() => {
      const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
      window.ownedListeners = []; window.trackProductListeners = true;
      EventTarget.prototype.addEventListener = function (type, callback, options) {
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        if (trackProductListeners && !ownedListeners.some(item => !item.removed && item.target === this && item.type === type && item.callback === callback && item.capture === capture))
          ownedListeners.push({ target: this, type, callback, capture, removed: false });
        return Reflect.apply(add, this, arguments);
      };
      EventTarget.prototype.removeEventListener = function (type, callback, options) {
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        for (const item of ownedListeners) if (item.target === this && item.type === type && item.callback === callback && item.capture === capture) item.removed = true;
        return Reflect.apply(remove, this, arguments);
      };
    });
    for (const path of [...(product.runtimeDependencies || []), product.runtime]) await page.addScriptTag({ content: await readFile(resolve('extension', path), 'utf8') });
    const name = product.id.replace(/[A-Z]/g, match => '-' + match.toLowerCase());
    const result = await page.evaluate(({ name, html }) => {
      const key = Symbol.for(`cosmic-gemini.${name}.runtime`), runtime = globalThis[key];
      if (!runtime?.onDispose) throw Error('Missing owned disposer for ' + name);
      if (name === 'leetcode-dark-mode') document.documentElement.style.colorScheme = 'dark';
      const configure = { detail: JSON.stringify({ token: runtime.token, config: { active: true, responseDisplay: true,
        browserIdentityActive: false, overrideDarkMode: true, reduceWhitePoint: true, reduction: 0.25,
        greyscale: true, smallImages: true, darkImages: false, matchPageTheme: false, siteId: 'wwwQqCom', tone: 'warm-minus-1' } }) };
      if (runtime.onConfigure) runtime.onConfigure(configure);
      else window.dispatchEvent(new CustomEvent(`cosmic-gemini:${name}:configure`, configure));
      trackProductListeners = false;
      document.open(); document.write(html); document.close();
      trackProductListeners = true;
      runtime.onDispose({ detail: runtime.token });
      // Previously queued/saved configuration and announcement cannot resurrect it.
      runtime.onConfigure?.(configure); runtime.announce();
      return { absent: !globalThis[key], listeners: ownedListeners.filter(item => !item.removed && (item.target === window || item.target === document
          || item.target === window.navigation || item.target === window.visualViewport || item.target.isConnected
          || item.target instanceof MediaQueryList)).map(item => item.type),
        snap: getComputedStyle(document.documentElement).scrollSnapType,
        overflow: document.documentElement.style.overflow };
    }, { name, html });
    assert.deepEqual(result, { absent: true, listeners: [], snap: 'y mandatory', overflow: '' }, product.id);
    await page.close();
  }
  console.log(`PASS: ${products.length - 1} hosted runtimes release listeners after document.open and reject stale configuration/announcement.`);

  const command = async message => {
    const result = await settings.evaluate(message => chrome.runtime.sendMessage(message), { ...message, featureId: 'websiteFixer' });
    assert.equal(result.ok, true, result.error);
  };
  for (const kind of ['translateOverride', 'stayOnPage']) {
    await command({ type: 'UI_ADD_RULE', settingGroup: kind, listName: 'whitelistDomains', rule: 'policy.test' });
    await command({ type: kind === 'translateOverride' ? 'UI_SET_WEBSITE_FIXER_TRANSLATE_OVERRIDE' : 'UI_SET_WEBSITE_FIXER_STAY_ON_PAGE', enabled: true });
  }
  const policy = await context.newPage(); await policy.goto('https://deep.policy.test/');
  await policy.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-bootstrap')]?.enabled === true);
  await policy.waitForFunction(() => !document.documentElement.hasAttribute('translate') && !document.querySelector('meta[name="google"]'));
  await command({ type: 'UI_SET_WEBSITE_FIXER_TRANSLATE_OVERRIDE', enabled: false });
  await policy.waitForFunction(() => document.documentElement.getAttribute('translate') === 'no' && !!document.querySelector('meta[name="google"]'));
  // Clearing/removing the saved site must clean an existing guard even when
  // document.open has erased the MAIN deactivate listener.
  await policy.evaluate(html => { document.open(); document.write(html); document.close(); }, html);
  await command({ type: 'UI_DELETE_RULE', settingGroup: 'stayOnPage', listName: 'whitelistDomains', rule: 'policy.test' });
  await policy.waitForFunction(() => !globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-bootstrap')]?.enabled
    && /\[native code\]/.test(Function.prototype.toString.call(window.open)));
  await policy.close();
  console.log('PASS: Settings shutdown/removal restores live Translate/Stay effects, including rebuilt documents.');

  // A retained Stay wrapper remains native after off, including after reactivation.
  const stay = await context.newPage(); await stay.goto('https://stay.test/'); await settle(stay);
  for (const file of ['website-fixer-site-key.js', 'website-fixer-stay.js']) await stay.addScriptTag({ content: await readFile(resolve('extension/content/website-fixer', file), 'utf8') });
  assert.deepEqual(await stay.evaluate(() => {
    const nativeOpen = window.open, nativeSubmit = HTMLFormElement.prototype.submit, nativeGo = History.prototype.go;
    let nativeCalls = 0;
    const fixtureGo = function () { nativeCalls++; };
    History.prototype.go = fixtureGo;
    const key = Symbol.for('cosmic-gemini.website-fixer.stay-bootstrap'), state = globalThis[key];
    window.dispatchEvent(new CustomEvent('cosmic-gemini:website-fixer:stay:activate'));
    const retainedGo = History.prototype.go;
    const blocked = window.open('https://outside.test/') === null;
    state.deactivate();
    const restored = window.open === nativeOpen && HTMLFormElement.prototype.submit === nativeSubmit && History.prototype.go === fixtureGo;
    retainedGo.call(history, 1);
    state.reconnect();
    window.dispatchEvent(new CustomEvent('cosmic-gemini:website-fixer:stay:activate'));
    retainedGo.call(history, 1);
    state.deactivate(); History.prototype.go = nativeGo;
    const native = /\[native code\]/.test(Function.prototype.toString.call(window.open));
    return { blocked, restored, native, nativeCalls };
  }), { blocked: true, restored: true, native: true, nativeCalls: 2 });
  await stay.close();
  assert.deepEqual(errors, []);
  const folder = resolve('test-dist/feature-inactive'); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'README.md'), '# Feature inactivity\n\nRun scripts/browser/test-feature-inactive-browser.mjs with CONTEXT_PLAYWRIGHT and CONTEXT_CHROME. All web responses are routed local fixtures in a disposable headless profile.\n\nChecks: default-off product injection counters, supported site routes, owned-listener cleanup after document.open, stale configuration/announcement rejection, native scroll/overflow restoration, Stay API restoration/reactivation, and live saved-setting/site-removal cleanup. Website Knowledge Control retains its established per-document policy; Crash Page Warden remains sticky. Counters stay in RAM. No request logs or personal browser profiles are retained.\n');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
