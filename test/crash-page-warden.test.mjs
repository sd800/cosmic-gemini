import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeSettings } from '../extension/core/config.js';
import { websiteToolEnabled } from '../extension/background/products/standing/website-fixer-tools.js';
import { createCrashPageWarden } from '../extension/background/products/standing/website-fixer-warden.js';
import { normalizeCrashPageWardenRuleInput } from '../extension/core/website-rule-input.js';

const runtime = readFileSync(new URL('../extension/content/crash-page-warden/runtime.js', import.meta.url), 'utf8');
const choices = () => ({ translateOverride: [], stayOnPage: [], crashPageWarden: [] });
const enabled = rules => normalizeSettings({ websiteFixer: { crashPageWarden: { enabled: true, whitelistDomains: rules } } });

test('Warden preserves exact versus wildcard host policies and session overrides', () => {
  const settings = enabled(['www.example.test', '*.second.test']);
  assert.equal(websiteToolEnabled(settings, choices(), 'crashPageWarden', 'https://www.example.test/a'), true);
  assert.equal(websiteToolEnabled(settings, choices(), 'crashPageWarden', 'https://other.example.test/a'), false);
  assert.equal(websiteToolEnabled(settings, choices(), 'crashPageWarden', 'https://deep.second.test/a'), true);
  assert.equal(websiteToolEnabled(settings, choices(), 'crashPageWarden', 'https://second.test.evil.test/a'), false);
  const temporary = { ...choices(), crashPageWarden: [{ site: 'second.test', enabled: false }] };
  assert.equal(websiteToolEnabled(settings, temporary, 'crashPageWarden', 'https://second.test/a'), false);
});

function pageFixture(frames = [], activate = true) {
  let now = 0, timerId = 0, rafId = 0;
  const timers = new Map(), animations = new Map(), events = new Map();
  const schedule = (fn, _delay, ...args) => { timers.set(++timerId, { fn, args }); return timerId; };
  const document = { contentType: 'text/html', hidden: false, activeElement: null, querySelectorAll: () => frames };
  const context = vm.createContext({ URL, location: { protocol: 'https:', href: 'https://example.test/' }, document,
    innerHeight: 1000, performance: { now: () => now }, work: cost => { now += cost; },
    setTimeout: schedule, setInterval: schedule, clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    requestAnimationFrame: fn => { animations.set(++rafId, { fn, args: [now] }); return rafId; },
    cancelAnimationFrame: id => animations.delete(id),
    addEventListener: (type, fn) => { events.set(type, [...events.get(type) || [], fn]); },
    MutationObserver: class { observe() {} disconnect() {} },
    PerformanceObserver: class { static supportedEntryTypes = ['longtask']; observe() {} disconnect() {} }
  });
  vm.runInContext(runtime, context);
  if (activate) vm.runInContext("globalThis[Symbol.for('cosmic-gemini.crash-page-warden')].activate()", context);
  return { context, timers, animations, events,
    invoke(id, map = timers, receiver = context) { const task = map.get(id); if (task) return task.fn.apply(receiver, task.args); },
    state: () => vm.runInContext("globalThis[Symbol.for('cosmic-gemini.crash-page-warden')].state()", context)
  };
}

test('URL input keeps exact scope and accepts an explicit wildcard without executable URL data', () => {
  assert.equal(normalizeCrashPageWardenRuleInput('https://news.example.test/story?q=1'), 'news.example.test');
  assert.equal(normalizeCrashPageWardenRuleInput('*.Example.test'), '*.example.test');
  assert.equal(normalizeCrashPageWardenRuleInput('https//news.example.test/story'), 'news.example.test');
  for (const value of ['javascript:alert(1)', 'https://user:secret@example.test/', 'https:\\example.test/a', '192.0.2.1']) {
    assert.throws(() => normalizeCrashPageWardenRuleInput(value));
  }
});

test('dormant bootstrap preserves calls and brings existing intervals under control after authorization', () => {
  const f = pageFixture([], false);
  const timer = vm.runInContext("setInterval(function collect(){ const analytics = 'local', userAgent = 'device'; work(70); }, 1)", f.context);
  for (let i = 0; i < 5; i++) f.invoke(timer);
  assert.equal(f.timers.has(timer), true); assert.equal(f.state().stoppedTasks, 0);
  vm.runInContext("globalThis[Symbol.for('cosmic-gemini.crash-page-warden')].activate()", f.context);
  for (let i = 0; i < 5; i++) f.invoke(timer);
  assert.equal(f.timers.has(timer), false); assert.equal(f.state().stoppedTasks, 1);
});

test('ordinary callback churn does not exhaust protection for later runaway work', () => {
  const f = pageFixture();
  vm.runInContext('for(let i=0;i<300;i++) { const id=setTimeout(()=>{},0); clearTimeout(id); }', f.context);
  const timer = vm.runInContext("setInterval(function collect(){ const analytics = 'local', userAgent = 'device'; work(70); }, 1)", f.context);
  for (let i = 0; i < 5; i++) f.invoke(timer);
  assert.equal(f.state().stoppedTasks, 1);
});

test('repeated costly callbacks cannot evade the budget by crossing its time-window boundary', () => {
  const f = pageFixture();
  const timer = vm.runInContext('setInterval(function heavy(){ work(800); }, 1)', f.context);
  for (let i = 0; i < 3; i++) f.invoke(timer);
  assert.equal(f.timers.has(timer), false);
});

test('printing disarms immediately even with an older heartbeat response still pending', async () => {
  const source = readFileSync(new URL('../extension/content/crash-page-warden/bridge.js', import.meta.url), 'utf8');
  const events = new Map(), messages = [], root = {};
  let release, first = true;
  const context = vm.createContext({ window: root, top: root,
    document: { hidden: false, addEventListener: (type, fn) => events.set(type, fn) },
    addEventListener: (type, fn) => events.set(type, fn), setInterval: () => 1, clearInterval() {},
    chrome: { runtime: { sendMessage(message) {
      messages.push(message);
      if (message.type === 'CG_WEBSITE_FIXER_ACTIVATE') return Promise.resolve({ ok: true, result: { active: true } });
      if (first) { first = false; return new Promise(resolve => { release = resolve; }); }
      return Promise.resolve({ ok: true });
    } } }
  });
  vm.runInContext(source, context);
  await vm.runInContext("globalThis[Symbol.for('cosmic-gemini.crash-page-warden.bridge')].activate()", context);
  events.get('beforeprint')({ isTrusted: true });
  assert.deepEqual(messages.filter(message => message.type.endsWith('HEARTBEAT')).map(message => message.visible), [true, false]);
  release({ ok: true }); await new Promise(resolve => setImmediate(resolve));
  events.get('afterprint')({ isTrusted: true });
  assert.equal(messages.at(-1).visible, true);
});

test('scheduler budgets stop runaway callbacks without suppressing ordinary reading work', () => {
  const f = pageFixture();
  const noisy = vm.runInContext("setInterval(function collect() { const analytics = 'local', userAgent = 'device'; work(70); }, 0)", f.context);
  for (let i = 0; i < 5; i++) f.invoke(noisy);
  assert.equal(f.timers.has(noisy), false);
  assert.equal(f.state().stoppedTasks, 1);
  const reading = vm.runInContext("setInterval(function fillParagraph() { const textContent = 'article'; work(70); }, 30)", f.context);
  for (let i = 0; i < 5; i++) f.invoke(reading);
  assert.equal(f.timers.has(reading), true);
  assert.equal(f.state().stoppedTasks, 1);
  vm.runInContext(runtime, f.context);
  assert.equal(f.state().stoppedTasks, 1, 'reinjection does not reset or restore stopped work');
});

test('timer and animation IDs do not interfere, and callback arguments, receivers, and exceptions survive', () => {
  const f = pageFixture();
  const timer = vm.runInContext('setTimeout(function(...args) { this.received = args; }, 10, 3, 4)', f.context);
  const animation = vm.runInContext('requestAnimationFrame(function() {})', f.context);
  assert.equal(timer, animation, 'the browser APIs may have overlapping numeric ID spaces');
  vm.runInContext(`cancelAnimationFrame(${animation})`, f.context);
  const receiver = {}; f.invoke(timer, f.timers, receiver);
  assert.deepEqual(Array.from(receiver.received), [3, 4]);
  const failure = vm.runInContext("setTimeout(function() { throw Error('page failure'); }, 0)", f.context);
  assert.throws(() => f.invoke(failure), /page failure/);
});

test('frame cleanup preserves article media and authentication while removing marked heavy additions', () => {
  const frame = (title, width, height) => ({ title, id: '', name: '', className: '', isConnected: true,
    getAttribute: () => '/component', closest: () => null,
    getBoundingClientRect: () => ({ width, height, top: 0, bottom: height }),
    remove() { this.isConnected = false; } });
  const advert = frame('Advertisement', 300, 250), login = frame('Login authentication', 1, 1), article = frame('Article video', 640, 360);
  const f = pageFixture([advert, login, article]);
  f.invoke([...f.timers.keys()][0]);
  assert.equal(advert.isConnected, false);
  assert.equal(login.isConnected, true);
  assert.equal(article.isConnected, true);
});

function backgroundFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const previous = globalThis.chrome, stored = {}, commands = [];
  const tab = { id: 7, active: true, incognito: false, url: 'https://example.test/article' };
  const frame = { documentId: 'doc-one', url: tab.url, documentLifecycle: 'active' };
  let attachHook = async () => {}, onDetach, onEvent;
  globalThis.chrome = {
    tabs: { get: async () => ({ ...tab }), query: async () => [{ ...tab }] },
    webNavigation: { getFrame: async () => ({ ...frame }) },
    scripting: { executeScript: async () => [], getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    debugger: {
      onDetach: { addListener: fn => { onDetach = fn; } },
      onEvent: { addListener: fn => { onEvent = fn; } },
      attach: async () => { commands.push('attach'); await attachHook(); },
      sendCommand: async (_target, name) => { commands.push(name); },
      detach: async () => { commands.push('detach'); }
    }
  };
  const platform = { isIncognitoContext: () => false, sessionStorage: {
    get: async key => ({ [key]: structuredClone(stored[key]) }),
    set: async values => Object.assign(stored, structuredClone(values)), remove: async key => { delete stored[key]; }
  } };
  const product = createCrashPageWarden(platform);
  const sender = () => ({ tab: { ...tab }, frameId: 0, documentId: frame.documentId, url: frame.url });
  t.after(() => { globalThis.chrome = previous; });
  const tick = async ms => {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(ms); await new Promise(resolve => setImmediate(resolve));
  };
  return { product, platform, stored, sender, frame, tab, commands, tick, hook: fn => { attachHook = fn; },
    cancel: () => onDetach({ tabId: tab.id }, 'canceled_by_user'),
    dialog: open => onEvent({ tabId: tab.id }, 'Page.javascriptDialog' + (open ? 'Opening' : 'Closed')) };
}

test('the independent watchdog prepares a session, interrupts a stall, and releases it when the tab closes', async t => {
  const f = backgroundFixture(t);
  assert.equal((await f.product.activate(enabled(['example.test']), choices(), f.sender())).active, true);
  await f.tick(12_000);
  assert.deepEqual(f.commands, ['attach', 'Runtime.disable', 'Page.enable', 'Runtime.terminateExecution']);
  await f.product.handleTabRemoved(7);
  assert.equal(f.commands.at(-1), 'detach');
});

test('healthy, hidden, replaced, and sleep-restored pages are not interrupted', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender());
  await f.tick(6000); await f.product.heartbeat(f.sender(), true); await f.tick(6000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.heartbeat(f.sender(), false); await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.heartbeat(f.sender(), true); f.frame.documentId = 'replacement'; await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.handleTabRemoved(7);
});

test('sticky document authorization survives policy-off but does not transfer to a reload or private tab', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender());
  assert.equal((await f.product.activate(normalizeSettings(), choices(), f.sender())).active, true);
  f.frame.documentId = 'reload';
  assert.equal((await f.product.activate(normalizeSettings(), choices(), f.sender())).active, false);
  f.tab.incognito = true;
  assert.equal((await f.product.activate(enabled(['example.test']), choices(), f.sender())).active, false);
  await f.product.handleTabRemoved(7);
});

test('navigation during debugger attachment cancels rescue without interrupting the new page', async t => {
  const f = backgroundFixture(t);
  f.hook(async () => { f.frame.documentId = 'new-page'; f.product.handleTabUpdated(7, { status: 'loading' }); });
  await f.product.activate(enabled(['example.test']), choices(), f.sender());
  await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.handleTabRemoved(7);
});

test('old-document heartbeats cannot disarm or replace the new document watch', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  const old = f.sender();
  f.product.handleTabUpdated(7, { status: 'loading' });
  f.frame.documentId = 'replacement';
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  await f.product.heartbeat(old, false);
  assert.equal((await f.product.heartbeat(old, true)).active, false);
  await f.tick(12_000);
  assert.equal(f.commands.filter(name => name === 'Runtime.terminateExecution').length, 1);
  await f.product.handleTabRemoved(7);
});

test('pending or failed navigation keeps readiness, and a committed replacement releases the connection', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  await f.product.handleTabUpdated(7, { status: 'loading' });
  assert.equal(f.commands.includes('detach'), false);
  await f.product.handleTabUpdated(7, { status: 'complete' });
  assert.equal(f.commands.includes('detach'), false);
  f.frame.documentId = 'replacement';
  await f.product.handleTabUpdated(7, { status: 'complete' });
  assert.equal(f.commands.at(-1), 'detach');
  await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.handleTabRemoved(7);
});

test('a new document waits for a retiring attachment instead of competing for the same tab', async t => {
  const f = backgroundFixture(t);
  let release, first = true;
  f.hook(() => {
    if (!first) return;
    first = false; return new Promise(resolve => { release = resolve; });
  });
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  f.frame.documentId = 'replacement';
  const closing = f.product.handleTabUpdated(7, { status: 'complete' });
  await f.tick(0);
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  assert.deepEqual(f.commands, ['attach']);
  release(); await closing; await f.tick(0);
  assert.deepEqual(f.commands, ['attach', 'detach', 'attach', 'Runtime.disable', 'Page.enable']);
  await f.product.handleTabRemoved(7);
});

test('browser cancellation is respected without retrying the same document attachment', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  f.cancel();
  await f.product.heartbeat(f.sender(), true); await f.tick(12_000);
  assert.equal(f.commands.filter(name => name === 'attach').length, 1);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.handleTabRemoved(7);
});

test('a native JavaScript dialog suspends rescue even if a heartbeat arrives while it is open', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  f.dialog(true); await f.product.heartbeat(f.sender(), true); await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  f.dialog(false); await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), true);
  await f.product.handleTabRemoved(7);
});

test('a delayed visible heartbeat cannot re-arm after a newer print or hidden notification', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  await f.product.heartbeat(f.sender(), false);
  let release;
  const original = chrome.webNavigation.getFrame;
  chrome.webNavigation.getFrame = () => new Promise(resolve => { release = resolve; });
  const old = f.product.heartbeat(f.sender(), true);
  await new Promise(resolve => setImmediate(resolve));
  await f.product.heartbeat(f.sender(), false);
  release({ ...f.frame }); await old;
  chrome.webNavigation.getFrame = original;
  await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.handleTabRemoved(7);
});

test('worker restart recovers sticky authorized documents with the saved switch off', async t => {
  const f = backgroundFixture(t);
  f.stored.cosmicGeminiCrashPageWardenDocuments = [{ tabId: 7, documentId: 'doc-one', frameId: 0,
    url: f.tab.url, attempts: 0, interruptions: 0, visible: true }];
  await f.product.reconcile(normalizeSettings(), choices()); await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), true);
  await f.product.handleTabRemoved(7);
});

test('sleep or a worker delay grants a new heartbeat window instead of treating it as a stuck page', async t => {
  const f = backgroundFixture(t);
  await f.product.activate(enabled(['example.test']), choices(), f.sender()); await f.tick(0);
  t.mock.timers.setTime(Date.now() + 30_000);
  await f.tick(12_000);
  assert.equal(f.commands.includes('Runtime.terminateExecution'), false);
  await f.product.handleTabRemoved(7);
});
