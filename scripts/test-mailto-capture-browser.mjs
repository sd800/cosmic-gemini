// Narrow integration QA: a disposable extension profile and local, inert mail links.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'cg-mailto-qa-'));
const extension = resolve('extension');
const artifacts = resolve('test-dist/univ-domains/browser');
await mkdir(artifacts, { recursive: true });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta name="color-scheme" content="light dark"><title>Mailto Capture fixture</title><style>body{font:16px system-ui;padding:70px}a{display:inline-block;margin:14px}</style><h1>University email fixture</h1><a id="mail" href="mailto:fixture+sample@uchicago.edu,unknown@example.com?cc=fixture%40pku.edu.cn&amp;bcc=fixture%40ntu.edu.tw&amp;subject=Fixture">Email</a><button id="outside">Outside</button>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
const errors = [], externalRequests = [], results = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, executablePath: process.env.CONTEXT_CHROME, viewport: { width: 1040, height: 760 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--disable-component-update']
  });
  await context.route(/^https?:/, route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings/all-settings.html`);
  const send = message => settings.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ type: 'UI_SET_ENABLED', featureId: 'mailtoCapture', enabled: true })).ok, true);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')]?.active);
  for (const [locale, scheme] of [['en-US', 'light'], ['zh-CN', 'dark']]) {
    await page.emulateMedia({ colorScheme: scheme });
    assert.equal((await send({ type: 'UI_SET_LOCALE', locale })).ok, true);
    await page.waitForFunction(locale => globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')]?.locale === locale, locale);
    await page.locator('#mail').click();
    await page.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')]?.shadow?.querySelector('.university-name'));
    await page.evaluate(async () => {
      const popover = globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')].shadow.querySelector('.popover');
      await Promise.allSettled(popover.getAnimations().map(animation => animation.finished));
    });
    const snapshot = await page.evaluate(() => {
      const runtime = globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')];
      const shadow = runtime.shadow;
      const fields = [...shadow.querySelectorAll('.field')].map(field => ({
        label: field.firstElementChild.textContent,
        entries: [...field.querySelectorAll('.phone-entry')].map(entry => [...entry.children].map(child => child.textContent))
      }));
      const school = shadow.querySelector('.university-name');
      const address = school.previousElementSibling;
      return { fields, actions: [...shadow.querySelectorAll('.actions button')].map(button => button.textContent), copied: runtime.messageText(), schoolFont: getComputedStyle(school).fontSize, addressFont: getComputedStyle(address).fontSize, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(snapshot.fields[0].entries, [['fixture+sample@uchicago.edu', 'University of Chicago', 'Illinois, USA'], ['unknown@example.com']]);
    assert.deepEqual(snapshot.fields[1].entries, [['fixture@pku.edu.cn', '北京大学', ...(locale === 'en-US' ? ['Peking University'] : []), locale === 'zh-CN' ? '中国' : 'China']]);
    assert.deepEqual(snapshot.fields[2].entries, [['fixture@ntu.edu.tw', '国立台湾大学', ...(locale === 'en-US' ? ['National Taiwan University'] : []), locale === 'zh-CN' ? '中华台北' : 'Chinese Taipei']]);
    assert.deepEqual(snapshot.actions, [locale === 'zh-CN' ? '复制邮件内容' : 'Copy message']);
    assert.equal(snapshot.schoolFont, snapshot.addressFont);
    assert.equal(await page.evaluate(() => globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')].shadow.querySelectorAll('.university-english-name').length), locale === 'en-US' ? 2 : 0);
    assert.equal(snapshot.overflow, false);
    assert.doesNotMatch(snapshot.copied, /University|Illinois|北京大学|中华台北/);
    await page.screenshot({ path: join(artifacts, `${locale}-${scheme}.png`) });
    if (locale === 'en-US') {
      assert.equal((await send({ type: 'UI_SET_LOCALE', locale: 'zh-CN' })).ok, true);
      await page.waitForFunction(() => {
        const runtime = globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')];
        return runtime.locale === 'zh-CN' && !runtime.shadow.querySelector('.university-english-name');
      });
      assert.equal((await send({ type: 'UI_SET_LOCALE', locale: 'en-US' })).ok, true);
      await page.waitForFunction(() => globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')].shadow.querySelectorAll('.university-english-name').length === 2);
    }
    await page.locator('#outside').click();
    await page.waitForFunction(() => !globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')]?.host?.isConnected);
    results.push({ locale, scheme, ...snapshot });
  }
  assert.equal((await send({ type: 'UI_SET_ENABLED', featureId: 'mailtoCapture', enabled: false })).ok, true);
  await page.waitForFunction(() => !globalThis[Symbol.for('cosmic-gemini.mailto-capture.runtime')]?.active);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  await writeFile(join(artifacts, 'report.json'), JSON.stringify({ results, errors, externalRequests, disabledCleanup: true }, null, 2));
  await writeFile(join(artifacts, 'README.md'), '# Mailto Capture browser QA\n\nDisposable Chrome profile; local fixture addresses only. Screenshots/report cover actual product injection, Chinese/English/region order in English UI and Chinese/region order in Chinese UI, live locale changes, English/light and Chinese/dark, copy-only controls, unchanged copied mail data, outside dismissal and disabled cleanup. No real mailbox, external website or operating-system mail application was opened.\n');
  console.log('PASS: university metadata injection/rendering, both locales/themes, unchanged mail fields, copy-only actions, dismissal, cleanup; no external requests/page errors.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
