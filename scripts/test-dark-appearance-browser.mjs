// Authored surfaces isolate product-owned changes from website/browser rendering.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder = await mkdtemp(join(tmpdir(), 'cg-dark-appearance-'));
let browser;
const results = [];
const source = file => readFile(resolve('extension', file), 'utf8');
const pixels = async (page, x = 5, y = 5) => {
  const png = await page.screenshot({ clip: { x, y, width: 2, height: 2 } });
  const parsed = spawnSync('python3', ['-c', 'from PIL import Image\nimport io,sys,json\nprint(json.dumps(Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB").getpixel((0,0))))'], { input: png });
  assert.equal(parsed.status, 0); return JSON.parse(String(parsed.stdout));
};
try {
  browser = await chromium.launchPersistentContext(join(folder, 'profile'), {
    executablePath: process.env.PDF_VIEWER_CHROME, headless: true,
    viewport: { width: 800, height: 600 }, colorScheme: 'dark'
  });
  await browser.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><title>Authored appearance fixture</title><style>html,body{margin:0;min-height:100vh;background:#111;color:#eee}article{padding:80px} .transition{transition:filter 160ms linear}</style></head><body><article><h1>Sample heading</h1><p>Authored reading content.</p></article></body></html>' }));
  const page = await browser.newPage();
  // Reduce White Point must never brighten a final dark surface after a root filter transition.
  await page.goto('https://appearance.test/');
  await page.addStyleTag({ content: await source('content/page-display/page-display.css') });
  await page.addScriptTag({ content: await source('content/page-display/page-display-runtime.js') });
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.filter = 'invert(1)';
    const runtime = window[Symbol.for('cosmic-gemini.page-display.runtime')];
    runtime.enable({ reduceWhitePoint: { enabled: true, reduction: .8 } });
    getComputedStyle(root).filter;
  });
  await page.evaluate(() => {
    const root = document.documentElement; root.classList.add('transition');
    getComputedStyle(root).filter; root.style.filter = 'invert(0)';
  });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).filter === 'invert(0)');
  const reduction = await pixels(page);
  results.push({ check: 'root-filter-transition', pixel: reduction, dark: reduction.every(channel => channel <= 17) });
  await page.close();
  // Non-cache page departure must not strip the outgoing LeetCode dark surface.
  const leetcode = await browser.newPage();
  await leetcode.goto('https://leetcode.com/explore/featured/card/fixture/');
  await leetcode.addStyleTag({ content: 'body{background:white!important}' });
  await leetcode.evaluate(() => document.documentElement.style.colorScheme = 'dark');
  await leetcode.addStyleTag({ content: await source('content/leetcode-dark-mode/leetcode-dark-mode.css') });
  for (const file of ['shared/white-tones.js', 'content/shared/dark-transition-guard.js', 'content/shared/white-cap-layer.js', 'content/leetcode-dark-mode/leetcode-dark-mode-runtime.js']) {
    await leetcode.addScriptTag({ content: await source(file) });
  }
  await leetcode.evaluate(() => {
    const runtime = window[Symbol.for('cosmic-gemini.leetcode-dark-mode.runtime')];
    dispatchEvent(new CustomEvent('cosmic-gemini:leetcode-dark-mode:configure', {
      detail: JSON.stringify({ token: runtime.token, config: { active: true, tone: 'off' } })
    }));
  });
  const before = await pixels(leetcode);
  await leetcode.evaluate(() => {
    addEventListener('pagehide', event => {
      sessionStorage.setItem('cg-fixture-departure', JSON.stringify({ persisted: event.persisted, background: getComputedStyle(document.body).backgroundColor,
        marker: document.documentElement.hasAttribute('data-cg-leetcode-dark') }));
    });
  });
  await leetcode.locator('h1').click();
  await leetcode.goto('https://leetcode.com/explore/featured/card/next/');
  const departure = await leetcode.evaluate(() => JSON.parse(sessionStorage.getItem('cg-fixture-departure') || 'null'));
  assert.ok(departure, 'capture the actual outgoing document before it is released');
  results.push({ check: 'outgoing-appearance', before, departure,
    stable: departure.background === 'rgb(26, 26, 26)' && departure.marker });
  assert.equal(departure.persisted, false, 'exercise a real departure outside BFCache');
  await leetcode.close();
  // White Softer's cap must preserve already-dark and inverted-dark pixels.
  const white = await browser.newPage(); await white.goto('https://appearance.test/white-cap');
  await white.addStyleTag({ content: await source('content/white-softer/white-softer.css') });
  for (const file of ['shared/white-tones.js', 'content/shared/dark-transition-guard.js', 'content/shared/white-cap-layer.js', 'content/white-softer/white-softer-runtime.js']) {
    await white.addScriptTag({ content: await source(file) });
  }
  await white.evaluate(() => {
    const runtime = window[Symbol.for('cosmic-gemini.white-softer.runtime')];
    runtime.onConfigure({ detail: JSON.stringify({token:runtime.token,config:{active:true,tone:'warm-minus-1'}}) });
  });
  const cappedDark = await pixels(white);
  await white.evaluate(() => {
    document.documentElement.style.filter = 'invert(1)';
    document.documentElement.style.background = 'white'; document.body.style.background = 'white';
  });
  const cappedInverted = await pixels(white);
  results.push({ check: 'white-softer-dark-pixels', pixel: cappedDark, inverted: cappedInverted,
    dark: cappedDark.every(value => value === 17) && cappedInverted.every(value => value === 0) });
  await white.close();
  // Registered document-start CSS is AUTHOR origin before the formal USER
  // stylesheet arrives. A site's generic popover theme must not paint the cap.
  const prepaint = await browser.newPage(); await prepaint.goto('https://appearance.test/prepaint');
  await prepaint.addStyleTag({ content: 'html [popover]:popover-open{background:linear-gradient(white,white)!important;filter:brightness(2)!important;transition:all 100ms!important}html [popover]::backdrop{display:block!important;background:white!important}' });
  await prepaint.evaluate(() => {
    const patch = document.createElement('div'); patch.style.cssText = 'position:fixed;left:100px;top:0;width:20px;height:20px;background:white'; document.body.append(patch);
  });
  for (const file of ['shared/white-tones.js', 'content/shared/dark-transition-guard.js', 'content/shared/white-cap-layer.js', 'content/white-softer/white-softer-prepaint.js']) {
    await prepaint.addScriptTag({ content: await source(file) });
  }
  const early = await pixels(prepaint);
  const earlyWhite = await pixels(prepaint, 105);
  await prepaint.evaluate(() => history.pushState(null, '', '/other/path?view=1#item'));
  const afterHistory = await pixels(prepaint, 105);
  results.push({ check: 'white-softer-prepaint-style-isolation', pixel: early, white: earlyWhite, afterHistory,
    dark: early.every(value => value === 17) && String(earlyWhite) === '236,235,233' && String(afterHistory) === String(earlyWhite) });
  await prepaint.close();
  const artifacts = resolve('test-dist/dark-appearance'); await mkdir(artifacts, { recursive: true });
  const version = JSON.parse(await source('manifest.json')).version;
  await writeFile(join(artifacts, 'findings.json'), JSON.stringify({ version, checks: results }, null, 2) + '\n');
  console.log(JSON.stringify(results));
  if (process.env.DARK_APPEARANCE_BASELINE !== '1') {
    assert.ok(results.every(result => result.dark ?? result.stable), 'a product brightened the authored dark surface');
  }
} finally { await browser?.close(); await rm(folder, { recursive: true, force: true }); }
