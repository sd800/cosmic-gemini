// Explicit NS/NA exclusions and live deactivation, using local routed fixtures.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SETTINGS_KEY } from '../../extension/core/config.js';

const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT
  ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'cg-nsna-inactive-'));
let context;
const fixture = frame => `<!doctype html><title>Inactive boundary</title>
<style>html{scroll-snap-type:y mandatory;scroll-behavior:smooth}body{min-height:1800px}</style>
<p>Native behavior</p><video id="clip" muted></video>${frame ? '<iframe src="https://child.test/child"></iframe>' : ''}`;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, executablePath: process.env.CONTEXT_CHROME,
    args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`]
  });
  context.setDefaultTimeout(12000);
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\/[^/]+\.test\//, route => route.fulfill({ contentType: 'text/html',
    body: fixture(new URL(route.request().url()).hostname !== 'child.test') }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}/`;
  const settings = await context.newPage(); await settings.goto(base + 'settings/all-settings.html');
  await settings.waitForFunction(() => document.documentElement.dataset.localePending === 'false');
  const command = async message => {
    const result = await settings.evaluate(message => chrome.runtime.sendMessage(message), message);
    assert.equal(result.ok, true, result.error);
  };
  // Retain only per-tab counters in worker RAM; never retain request details.
  await worker.evaluate(() => {
    globalThis.inactiveCounts = new Map();
    const owns = details => details.files?.some(file => /^content\/(?:native-scroll|no-autoplay)\//.test(file))
      || ['nativeScroll', 'noAutoplay', 'native-scroll', 'no-autoplay'].includes(details.args?.[0]);
    for (const name of ['executeScript', 'insertCSS', 'removeCSS']) {
      const original = chrome.scripting[name].bind(chrome.scripting);
      chrome.scripting[name] = details => {
        if (owns(details)) {
          const tabId = details.target.tabId;
          inactiveCounts.set(tabId, (inactiveCounts.get(tabId) || 0) + 1);
        }
        return original(details);
      };
    }
  });
  const tabIdFor = page => worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
  const settle = async page => {
    const tabId = await tabIdFor(page); assert.ok(Number.isInteger(tabId));
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED',
      func: () => globalThis[Symbol.for('cosmic-gemini.central')]?.sync() }), tabId);
    return tabId;
  };
  const inspect = async page => {
    for (const frame of page.frames()) {
      const status = await frame.evaluate(() => ({
        runtime: ['native-scroll', 'no-autoplay'].some(name => !!globalThis[Symbol.for(`cosmic-gemini.${name}.runtime`)]),
        native: [EventTarget.prototype.addEventListener, EventTarget.prototype.removeEventListener,
          Event.prototype.preventDefault, HTMLMediaElement.prototype.play, AudioContext.prototype.resume,
          AudioContext.prototype.createMediaElementSource, window.scrollTo].every(fn => /\[native code\]/.test(Function.prototype.toString.call(fn))),
        snap: getComputedStyle(document.documentElement).scrollSnapType,
        marker: !!document.querySelector('[data-native-scroll-normalized]')
      }));
      assert.deepEqual(status, { runtime: false, native: true, snap: 'y mandatory', marker: false });
    }
  };
  const enabled = value => Promise.all(['nativeScroll', 'noAutoplay'].map(featureId => command({ type: 'UI_SET_ENABLED', featureId, enabled: value })));
  await enabled(true);
  for (const featureId of ['nativeScroll', 'noAutoplay']) {
    await command({ type: 'UI_SET_BEHAVIOR_RULE', featureId, rule: 'excluded.test', behavior: 'inactive' });
  }
  const fresh = async url => {
    const page = await context.newPage(); await page.goto(url); const tabId = await settle(page);
    await inspect(page);
    assert.equal(await worker.evaluate(tabId => inactiveCounts.get(tabId) || 0, tabId), 0,
      'no NS/NA code, cleanup probe, or stylesheet is injected into an excluded fresh document');
    await page.close();
  };
  await fresh('https://deep.excluded.test/main');
  await command({ type: 'UI_ADD_NSNA_WHITELIST_RULE', rule: 'whitelisted.test' });
  await fresh('https://deep.whitelisted.test/main');
  await enabled(false); await fresh('https://default-off.test/main');

  // Live shutdown must restore native APIs without replaying a rejected play.
  await enabled(true);
  const active = await context.newPage(); await active.goto('https://active.test/main'); await settle(active);
  await active.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.native-scroll.runtime')]?.active
    && globalThis[Symbol.for('cosmic-gemini.no-autoplay.runtime')]?.active);
  assert.equal(await active.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const video = document.querySelector('#clip'); video.srcObject = canvas.captureStream(2);
    canvas.getContext('2d').fillRect(0, 0, 2, 2);
    window.retainedPlay = HTMLMediaElement.prototype.play;
    window.starts = 0; video.addEventListener('play', () => starts++);
    try { await video.play(); return 'played'; } catch (error) { return error.name; }
  }), 'NotAllowedError');
  for (const featureId of ['nativeScroll', 'noAutoplay']) {
    await command({ type: 'UI_SET_BEHAVIOR_RULE', featureId, rule: 'active.test', behavior: 'inactive' });
  }
  await settle(active); await inspect(active);
  assert.deepEqual(await active.evaluate(() => ({ paused: document.querySelector('#clip').paused, starts })), { paused: true, starts: 0 });
  await active.evaluate(() => retainedPlay.call(document.querySelector('#clip')));
  await active.waitForFunction(() => !document.querySelector('#clip').paused);
  await active.close();

  // document.open keeps prototype hooks but erases their Window listeners.
  const rebuilt = await context.newPage(); await rebuilt.goto('https://rebuilt.test/main'); await settle(rebuilt);
  await rebuilt.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.native-scroll.runtime')]?.active
    && globalThis[Symbol.for('cosmic-gemini.no-autoplay.runtime')]?.active);
  await rebuilt.evaluate(html => { document.open(); document.write(html); document.close(); }, fixture(false));
  await settings.evaluate(async key => {
    const saved = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({ [key]: { ...saved,
      nativeScroll: { ...saved.nativeScroll, enabled: false }, noAutoplay: { ...saved.noAutoplay, enabled: false } } });
  }, SETTINGS_KEY);
  await settle(rebuilt); await inspect(rebuilt);
  await rebuilt.close();
  assert.deepEqual(errors, []);
  const folder = resolve('test-dist/nsna-inactive'); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'README.md'), '# NS/NA inactive boundary\n\nRun scripts/browser/test-nsna-inactive-browser.mjs with CONTEXT_PLAYWRIGHT and CONTEXT_CHROME pointing to the local test runtime. It uses a disposable headless profile and routed synthetic pages, including a child frame. No personal browser or external website is used.\n\nPassed: main-domain inactive policies and subdomains; shared whitelist; global-off defaults; zero corresponding script/style/cleanup injection on fresh excluded pages; native API identities and authored snap style in main/child frames; live off restores native behavior without replaying a blocked HTML play; retained play wrappers pass through; document.open shutdown confirms cleanup of surviving prototype hooks. Only per-tab counts exist in RAM. The live video is a two-pixel canvas stream; no media file or request log is generated.\n');
  console.log('PASS: fresh exclusions/whitelist/default-off inject no NS/NA code or CSS; main/child native APIs; live shutdown without replay; retained hooks; document.open cleanup.');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
