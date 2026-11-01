// Compare actual Dark Reader with/without White Softer in a disposable browser.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
const { chromium } = await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
assert.ok(process.env.DARK_READER_EXTENSION, 'Provide the public unpacked Dark Reader package, not a browser profile.');
const folder = await mkdtemp(join(tmpdir(), 'cg-white-navigation-'));
const profile = join(folder, 'profile'); await mkdir(profile);
const args = ['--user-data-dir=' + profile, '--remote-debugging-port=0', '--window-size=1000,850',
  '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--force-dark-mode'];
if (process.env.WHITE_SOFTER_HEADED !== '1') args.push('--headless=new');
const processHandle = spawn(process.env.PDF_VIEWER_CHROME, args, { stdio: 'ignore' });
const exited = new Promise(resolve => { processHandle.once('exit', resolve); processHandle.once('error', resolve); });
let browser;
const findings = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let endpoint;
  for (let i = 0; i < 60; i++) {
    try { endpoint = 'http://127.0.0.1:' + (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await pause(100); }
  }
  assert.ok(endpoint);
  browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const context = browser.contexts()[0]; context.setDefaultTimeout(10000);
  if (process.env.WHITE_SOFTER_LAYER_REF) {
    const baseline = spawnSync('git', ['show', process.env.WHITE_SOFTER_LAYER_REF + ':extension/content/shared/white-cap-layer.js'], {encoding:'utf8'});
    assert.equal(baseline.status, 0);
    await context.addInitScript({content:baseline.stdout});
  }
  if (process.env.WHITE_SOFTER_DIAGNOSE === '1') await context.addInitScript(() => {
    const roots = new WeakMap(), attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(...args) {
      const root = Reflect.apply(attach, this, args);
      if (this.hasAttribute('data-cg-white-cap')) roots.set(this, root);
      return root;
    };
    window.__cgAppearanceSamples = [];
    const sample = () => {
      const root = document.documentElement, host = document.querySelector('[data-cosmic-gemini-white-softer]');
      const surface = host && roots.get(host)?.querySelector('[data-cg-filter-surface]');
      const color = node => node ? getComputedStyle(node).backgroundColor : null;
      window.__cgAppearanceSamples.push({epoch:performance.timeOrigin+performance.now(),ready:document.readyState,
        root:color(root),body:color(document.body),dark:root?.getAttribute('data-darkreader-scheme'),
        fallback:document.querySelector('.darkreader--fallback')?.textContent.length||0,
        capOpen:host?.matches(':popover-open')||false, capColor:color(host), surfaceColor:color(surface)});
      if (window.__cgAppearanceSamples.length<30) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'white-navigation.test') return route.abort('blockedbyclient');
    if (url.pathname === '/style.css') {
      await pause(180);
      return route.fulfill({ contentType: 'text/css', body: 'html,body{margin:0;min-height:100vh;background:white;color:black;font:18px system-ui}main{padding:80px}#pulse{position:fixed;right:0;bottom:0;width:4px;height:4px;animation:pulse 50ms step-end infinite}@keyframes pulse{from{background:#222}to{background:#223}}' });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><title>Navigation fixture</title><link rel="stylesheet" href="/style.css"></head><body><main><h1>Authored reading surface</h1><a href="/next">Next document</a></main><div id="pulse"></div></body></html>' });
  });
  const loader = await browser.newBrowserCDPSession();
  const { id: drId } = await loader.send('Extensions.loadUnpacked', { path: resolve(process.env.DARK_READER_EXTENSION) });
  const dr = await context.newPage(); await dr.goto(`chrome-extension://${drId}/ui/popup/index.html`);
  await dr.evaluate(() => chrome.runtime.sendMessage({ type: 'ui-bg-change-settings', data: {
    enabled: true, enabledByDefault: true, fetchNews: false, syncSettings: false, detectDarkTheme: false,
    enabledFor: [], disabledFor: []
  } }));
  await dr.waitForFunction(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'ui-bg-get-data' });
    return result?.data?.settings?.enabled === true && result.data.settings.fetchNews === false;
  });
  const { id } = await loader.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/settings/satellites.html`);
  const configure = enabled => settings.evaluate(async enabled => {
    const result = await chrome.runtime.sendMessage({ type: 'UI_SET_ENABLED', featureId: 'whiteSofter', enabled });
    if (!result?.ok) throw Error(result?.error); return result.result;
  }, enabled);
  const receiving = await context.newPage();
  async function settle(page, enabled) {
    await page.waitForFunction(enabled => document.documentElement.getAttribute('data-darkreader-scheme') === 'dark'
      && (!!document.querySelector('[data-cosmic-gemini-white-softer]:popover-open') === enabled), enabled);
    await pause(100);
  }
  async function capture(kind, enabled, action) {
    const session = await context.newCDPSession(receiving), frames = [];
    session.on('Page.screencastFrame', ({ sessionId, data, metadata }) => {
      void session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (frames.length < 80) frames.push({data,epoch:metadata.timestamp*1000});
    });
    await session.send('Page.startScreencast', { format: 'png', maxWidth: 320, maxHeight: 240, everyNthFrame: 1 });
    await action(); await pause(350);
    await session.send('Page.stopScreencast'); await session.detach();
    const pixels = spawnSync('python3', ['-c', 'from PIL import Image\nimport io,json,sys,base64\nframes=json.load(sys.stdin)\npixels=[list(Image.open(io.BytesIO(base64.b64decode(frame))).convert("RGB").getpixel((2,2))) for frame in frames]\nprint(json.dumps(pixels))'], { input: JSON.stringify(frames.map(frame=>frame.data)), encoding: 'utf8' });
    assert.equal(pixels.status, 0, pixels.stderr);
    const corner = JSON.parse(pixels.stdout), bright = corner.filter(rgb => Math.min(...rgb) > 180).length;
    const samples = process.env.WHITE_SOFTER_DIAGNOSE === '1' ? await receiving.evaluate(()=>window.__cgAppearanceSamples||[]) : [];
    const critical = corner.flatMap((rgb,index)=>Math.min(...rgb)>180 ? [{rgb,near:samples.toSorted((a,b)=>Math.abs(a.epoch-frames[index].epoch)-Math.abs(b.epoch-frames[index].epoch)).slice(0,2)}] : []).slice(0,3);
    findings.push({ kind, whiteSofter: enabled, frames: frames.length, brightFrames: bright, ...(critical.length?{critical}:{}),
      maxCorner: corner.reduce((a,b) => b.reduce((sum,v)=>sum+v,0) > a.reduce((sum,v)=>sum+v,0) ? b : a, [0,0,0]) });
    assert.ok(frames.length >= 2, 'capture actual transition frames');
  }
  for (const enabled of [false, true]) {
    await configure(enabled);
    await receiving.goto('https://white-navigation.test/first'); await receiving.bringToFront(); await settle(receiving, enabled);
    for (let cycle=0;cycle<3;cycle++) await capture('navigation-'+cycle, enabled, async () => {
      await receiving.goto('https://white-navigation.test/next?cycle='+cycle); await settle(receiving, enabled);
    });
    await capture('history-return',enabled,async()=>{await receiving.goBack({waitUntil:'commit'});await settle(receiving,enabled);});
    await receiving.bringToFront();
    const foreground = await context.newPage(); await foreground.goto('https://white-navigation.test/foreground');
    await foreground.bringToFront(); await settle(foreground, enabled);
    assert.equal(await receiving.evaluate(() => document.visibilityState), 'hidden');
    await capture('close-tab-return', enabled, async () => {
      await foreground.close();
      await receiving.waitForFunction(() => document.visibilityState === 'visible');
      await settle(receiving, enabled);
    });
    const pending = await context.newPage(); await pending.goto('https://white-navigation.test/foreground-pending');
    await pending.bringToFront(); await settle(pending, enabled);
    await receiving.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await receiving.evaluate(() => document.visibilityState), 'hidden');
    await capture('close-tab-return-to-background-load', enabled, async () => {
      await pending.close();
      await receiving.waitForFunction(() => document.visibilityState === 'visible');
      await settle(receiving, enabled);
    });

  }
  const artifacts = resolve('test-dist/white-softer'); await mkdir(artifacts, { recursive: true });
  const version = JSON.parse(await readFile('extension/manifest.json','utf8')).version;
  const providerVersion = JSON.parse(await readFile(join(process.env.DARK_READER_EXTENSION,'manifest.json'),'utf8')).version;
  await writeFile(join(artifacts, 'navigation-close-results.json'), JSON.stringify({version,providerVersion,findings}, null, 2) + '\n');
  console.log(JSON.stringify(findings));
  if (process.env.WHITE_SOFTER_NAV_BASELINE !== '1') assert.ok(findings.filter(result => result.whiteSofter).every(result => result.brightFrames === 0), 'a bright frame appeared during navigation or close-tab return');
} finally {
  await browser?.close().catch(() => {});
  if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
  await exited; await rm(folder, { recursive: true, force: true });
}
