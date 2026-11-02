// Focused DOM and isolated-world checks in a disposable browser.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = resolve('test-dist/website-fixer/translate');
await mkdir(directory, { recursive: true });
const fixture = resolve(directory, 'namespace.html');
try {
  await writeFile(fixture, `<!doctype html><html translate="no"><head>
<meta name="google" content="notranslate"><title>Translation fixture</title></head><body>
<symbol id="google" viewbox="0 0 20 20" data-fixture="retained">
<script>queueMicrotask(() => { window.parserNamespace = document.currentScript?.namespaceURI || document.getElementById('google').namespaceURI; });</script>
<path id="retained-path" d="M2 2h16v16H2z"></path></symbol>
<svg width="20" height="20"><use href="#google"></use><symbol id="valid-symbol"></symbol></svg>
<p class="copy notranslate">A readable document.</p>
</body></html>`, { flag: 'wx' });
} catch (error) { if (error.code !== 'EEXIST') throw error; }
const html = await readFile(fixture, 'utf8');
const source = await readFile(resolve('extension/content/website-fixer/website-fixer-translate.js'), 'utf8');
const activate = "globalThis[Symbol.for('cosmic-gemini.website-fixer.translate-activate')]()";
const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME, headless: true });
try {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  const address = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  await page.goto(address);
  assert.equal(await page.evaluate(() => window.google.constructor.name), 'HTMLUnknownElement');
  assert.equal(await page.evaluate(() => typeof window.google.translate), 'boolean');

  // Run the real content script in an extension-like isolated world at document start.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: source + ';' + activate, worldName: 'translate-override-fixture'
  });
  await page.goto('about:blank');
  await page.goto(address);
  assert.deepEqual(await page.evaluate(() => ({
    namespace: document.getElementById('google').namespaceURI,
    constructor: document.getElementById('google').constructor.name,
    viewBox: document.getElementById('google').getAttribute('viewBox'),
    marker: document.getElementById('google').dataset.fixture,
    childrenRetained: document.getElementById('retained-path').parentElement.id,
    reference: document.querySelector('use').getAttribute('href'),
    parserNamespace: window.parserNamespace,
    optOut: document.querySelector('[translate="no"],.notranslate,meta[name="google"]') !== null,
    validNamespace: document.getElementById('valid-symbol').namespaceURI
  })), {
    namespace: 'http://www.w3.org/2000/svg', constructor: 'SVGSymbolElement',
    viewBox: '0 0 20 20', marker: 'retained', childrenRetained: 'google', reference: '#google',
    parserNamespace: 'http://www.w3.org/1999/xhtml', optOut: false,
    validNamespace: 'http://www.w3.org/2000/svg'
  });

  // Chrome's separate world must be able to create an object, rather than
  // silently assigning it to HTMLElement.translate's boolean setter.
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id, worldName: 'translation-namespace-fixture'
  });
  const namespace = await cdp.send('Runtime.evaluate', {
    contextId: executionContextId,
    expression: 'var google = window.google || {}; google.translate = { ready: true }; google.translate.ready === true',
    returnByValue: true
  });
  assert.equal(namespace.result.value, true);
  assert.equal(await page.evaluate(() => typeof window.google.translate), 'undefined',
    'the translator namespace stays isolated from page JavaScript');

  await page.evaluate(() => {
    document.getElementById('google').remove();
    const symbol = document.createElement('symbol');
    symbol.id = 'later-symbol';
    symbol.appendChild(document.createElement('path'));
    document.body.appendChild(symbol);
  });
  await page.evaluate(() => { document.getElementById('later-symbol').id = 'google'; });
  assert.equal(await page.evaluate(() => document.getElementById('google').constructor.name), 'SVGSymbolElement');
  assert.equal(await page.evaluate(() => document.getElementById('google').firstChild.localName), 'path');
  await page.evaluate(() => {
    document.getElementById('google').remove();
    const widget = document.createElement('div');
    widget.id = 'google';
    document.body.appendChild(widget);
  });
  assert.equal(await page.evaluate(() => document.getElementById('google').constructor.name), 'HTMLDivElement',
    'interactive HTML widgets are not replaced or renamed');
  console.log('Translate Override: parser timing, SVG identity, references, opt-outs, delayed IDs, and isolated namespaces passed.');
} finally {
  await browser.close();
}
