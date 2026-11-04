// Dynamic DOM and cleanup checks with synthetic documents in headless Chrome.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imagePageDiscovery } from '../../extension/core/image-page.js';
const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT
  ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CONTEXT_CHROME });
const source = file => readFile(resolve('extension/content', file), 'utf8');
const errors = [];
const page = await browser.newPage();
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => route.fulfill({ contentType: 'text/html',
  body: '<!doctype html><title>Runtime fixture</title><main><p id="text">Readable text</p><div id="other"></div></main>' }));
try {
  await page.goto('https://runtime.test/');
  await page.addScriptTag({ content: await source('any-copy/any-copy-runtime.js') });
  const copy = await page.evaluate(async () => {
    const runtime = globalThis[Symbol.for('cosmic-gemini.any-copy.runtime')];
    runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true } }) });
    const text = document.querySelector('#text');
    let deliveries = 0;
    const watch = new MutationObserver(() => { deliveries++; });
    watch.observe(text, { attributes: true, attributeFilter: ['style'] });
    runtime.startObserver(); runtime.forceSelectable(text);
    await new Promise(resolve => setTimeout(resolve, 40));
    const settled = deliveries;
    document.querySelector('#other').className = 'changed';
    await new Promise(resolve => setTimeout(resolve, 40));
    const afterUnrelated = deliveries;
    text.style.setProperty('user-select', 'none', 'important');
    await new Promise(resolve => setTimeout(resolve, 40));
    const repaired = text.style.getPropertyValue('user-select');
    runtime.onDispose({ detail: runtime.token }); watch.disconnect();
    return { settled, afterUnrelated, repaired, saved: runtime.savedStyles.size };
  });
  assert.equal(copy.settled, 1, 'own style writes settle in one observer delivery');
  assert.equal(copy.afterUnrelated, copy.settled);
  assert.equal(copy.repaired, 'text'); assert.equal(copy.saved, 0);

  await page.goto('https://runtime.test/video');
  await page.evaluate(() => {
    globalThis.chrome = { runtime: { onMessage: { addListener() {}, removeListener() {} },
      sendMessage: async () => ({ ok: true }) } };
    globalThis.firstScanQueries = 0;
    const query = document.querySelectorAll.bind(document);
    document.querySelectorAll = selector => {
      if (selector === 'video,audio') firstScanQueries++;
      return query(selector);
    };
  });
  await page.addScriptTag({ content: await source('video-download/video-download-scanner.js') });
  const scanner = await page.evaluate(async () => {
    const runtime = globalThis[Symbol.for('cosmic-gemini.video-download.scanner')];
    const first = firstScanQueries;
    const roots = [];
    runtime.collect = (root, includePerformance) => { roots.push(root.id); return []; };
    const branch = document.createElement('section'); branch.id = 'branch';
    const child = document.createElement('div'); child.id = 'child';
    document.body.append(branch); branch.append(child); child.append(document.createElement('video'));
    await new Promise(resolve => setTimeout(resolve, 220));
    const disjoint = roots.splice(0);
    child.remove();
    await Promise.resolve();
    const removedTimer = runtime.scanTimer;
    const stream = document.createElement('div'); stream.id = 'stream'; document.body.append(stream);
    await new Promise(resolve => setTimeout(resolve, 220)); roots.length = 0;
    stream.setAttribute('data-stream-url', 'https://media.test/stream.m3u8');
    await new Promise(resolve => setTimeout(resolve, 220));
    const streamRoots = roots.splice(0);
    const transient = document.createElement('div'); document.body.append(transient); transient.remove();
    await Promise.resolve(); const transientTimer = runtime.scanTimer;
    runtime.stop();
    return { first, disjoint, removedTimer, streamRoots, transientTimer,
      timer: runtime.scanTimer, pending: runtime.pendingRoots.size };
  });
  assert.equal(scanner.first, 1, 'only one initial document scan');
  assert.deepEqual(scanner.disjoint, ['branch'], 'nested mutation roots are scanned once');
  assert.equal(scanner.removedTimer, 0);
  assert.deepEqual(scanner.streamRoots, ['stream']);
  assert.equal(scanner.transientTimer, 0);
  assert.equal(scanner.timer, 0); assert.equal(scanner.pending, 0);

  await page.goto('https://runtime.test/translate');
  await page.addScriptTag({ content: await source('website-fixer/website-fixer-translate.js') });
  const translate = await page.evaluate(async () => {
    globalThis[Symbol.for('cosmic-gemini.website-fixer.translate-activate')]();
    const outer = document.createElement('article'), inner = document.createElement('section');
    let scans = 0;
    for (const element of [outer, inner]) {
      const query = element.querySelectorAll.bind(element);
      element.querySelectorAll = selector => { scans++; return query(selector); };
    }
    document.body.append(outer); outer.append(inner);
    inner.setAttribute('translate', 'no'); inner.className = 'notranslate content';
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = { scans, translate: inner.getAttribute('translate'), classes: inner.className };
    globalThis[Symbol.for('cosmic-gemini.website-fixer.translate')].dispose();
    return result;
  });
  assert.deepEqual(translate, { scans: 1, translate: null, classes: 'content' });

  await page.goto('https://runtime.test/images');
  await page.evaluate(() => {
    document.body.innerHTML = '<picture><source srcset="/wide.png 1800w"><img src="/photo.png" data-original="/original.png"></picture>'
      + '<div style="background-image:url(/background.png)"></div><div id="shadow"></div>';
    document.querySelector('#shadow').attachShadow({ mode: 'open' }).innerHTML = '<img src="/shadow.png">';
    // Exercise cooperative scheduling with a short fixture rather than a large
    // page. Advancing the test clock crosses the ordinary eight-ms slice.
    let clock = 0; Object.defineProperty(performance, 'now', { configurable: true, value: () => (clock += 3) });
  });
  await page.addScriptTag({ content: `globalThis.discoverImages = ${imagePageDiscovery.toString()}` });
  const images = await page.evaluate(async () => {
    let inputTaskRan = false;
    const input = () => { inputTaskRan = true; };
    if (globalThis.scheduler?.postTask) void scheduler.postTask(input, { priority: 'user-blocking' });
    else setTimeout(input, 0);
    const result = await globalThis.discoverImages(); return { ...result, inputTaskRan };
  });
  assert.equal(images.inputTaskRan, true, 'image enrichment yields to input-priority work');
  const urls = new Set(images.candidates.map(candidate => candidate.url));
  for (const path of ['photo.png', 'wide.png', 'original.png', 'background.png', 'shadow.png']) {
    assert.ok(urls.has(`https://runtime.test/${path}`), path);
  }
  assert.deepEqual(errors, []);
  const folder = resolve('test-dist/runtime-efficiency'); await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, 'README.md'), '# Runtime efficiency checks\n\nRun `scripts/browser/test-runtime-efficiency-browser.mjs` with CONTEXT_PLAYWRIGHT and CONTEXT_CHROME pointing to Playwright and Chrome for Testing. It runs headless with synthetic routed documents and never uses the personal Chrome profile. Checks cover real MutationObserver settling for Any Copy, unrelated DOM changes, restoration/cleanup, one initial video document scan, overlapping subtree coalescing, removed/transient nodes, stream URL updates, stop cleanup, and overlapping translation opt-out repairs, and cooperative image enrichment with original, responsive, CSS, and open shadow-root sources.\n\nResult: passed. One initial video scan; one scan for overlapping inserted subtrees; no timer on removed-only or detached-only changes; Any Copy self-writes settle in one delivery. No request or browsing logs are retained. Unit tests in test/ cover byte-budgeted response reads, stop cancellation, unchanged configuration, toolbar writes, and frame-coalesced scrolling.\n');
  console.log('PASS: Any Copy observer settling; video scan coalescing and idle paths; stream updates; Translate Override batching; cooperative image discovery with shadow/CSS sources; cleanup.');
} finally { await browser.close(); }
