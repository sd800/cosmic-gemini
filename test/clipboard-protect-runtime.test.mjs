import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { clipboardProtectState, normalizeSettings, DEFAULT_INCOGNITO_SETTINGS } from '../extension/core/config.js';
import { createStandingProvince } from '../extension/background/provinces/standing.js';
import { createClipboardProtectProduct } from '../extension/background/products/standing/clipboard-protect.js';

const source = await readFile(new URL('../extension/content/clipboard-protect-runtime.js', import.meta.url), 'utf8');
const key = Symbol.for('cosmic-gemini.clipboard-protect.runtime');

function fixture() {
  class Event {
    constructor(type, options = {}) { Object.assign(this, { type, isTrusted: true, eventPhase: 0 }, options); }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
    composedPath() { return this.path || [article]; }
  }
  class CustomEvent extends Event { constructor(type, options) { super(type, { ...options, isTrusted: false }); } }
  class DataTransfer {
    constructor() { this.values = new Map(); }
    setData(type, value) { this.values.set(type, value); }
    clearData() { this.values.clear(); }
  }
  class ClipboardEvent extends Event {
    constructor(type, options) { super(type, options); this.transfer = new DataTransfer(); }
    get clipboardData() { return this.transfer; }
  }
  class Element {
    constructor(editable = false) { this.editable = editable; }
    closest() { return this.editable ? this : null; }
    getRootNode() { return this.root || document; }
  }
  const article = new Element();
  const document = { activeElement: null, designMode: 'off' };
  let text = 'Original selected text\n原文';
  const selection = { toString: () => text, rangeCount: 0, anchorNode: article, focusNode: article };
  const listeners = new Map();
  const context = vm.createContext({
    Event, CustomEvent, ClipboardEvent, DataTransfer, Element, document,
    crypto: { getRandomValues(bytes) { bytes.fill(17); return bytes; } },
    getSelection: () => selection,
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
    dispatchEvent(event) {
      event.eventPhase = 1;
      for (const listener of [...(listeners.get(event.type) || [])]) {
        listener(event);
        if (event.stopped) break;
      }
      event.eventPhase = 0;
    }
  });
  context.window = context;
  const clipboardGetter = Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, 'clipboardData').get;
  const stop = Event.prototype.stopImmediatePropagation;
  const start = () => { vm.runInContext(source, context); return context[key]; };
  const copy = options => { const event = new ClipboardEvent('copy', options); context.dispatchEvent(event); return event; };
  return { context, document, selection, article, Element, Event, ClipboardEvent, listeners, start, copy, stop, clipboardGetter, setText(value) { text = value; } };
}

test('Clipboard Protect stays inert until authorized and protects a trusted selected-text copy', () => {
  const f = fixture();
  const runtime = f.start();
  assert.equal(f.listeners.has('copy'), false);
  runtime.onConfigure({ detail: JSON.stringify({ token: 'wrong', config: { active: true } }) });
  assert.equal(runtime.active, false);
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true } }) });
  let siteCalls = 0;
  f.context.addEventListener('copy', () => { siteCalls += 1; });
  const event = f.copy();
  assert.equal(event.transfer.values.get('text/plain'), 'Original selected text\n原文');
  assert.equal(event.defaultPrevented, true);
  assert.equal(siteCalls, 0);
  assert.equal(runtime.token.length, 36); // HTTP without randomUUID remains supported.
});

test('earlier website copy handlers cannot append content or prevent the final clean copy', () => {
  const f = fixture();
  f.context.addEventListener('copy', event => {
    event.clipboardData.setData('text/plain', 'Original selected text\nsource: unwanted link');
    event.clipboardData.setData('text/html', '<p>Promotion</p>');
    f.setText('replacement selection');
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  f.start().enable();
  const event = f.copy();
  assert.equal(event.transfer.values.get('text/plain'), 'Original selected text\n原文');
  assert.equal(event.transfer.values.has('text/html'), false);
  assert.equal(event.defaultPrevented, true);
});

test('Clipboard Protect preserves editable selections, design mode and shadow editor hosts', () => {
  for (const position of ['focus', 'event path', 'anchor', 'design mode', 'shadow host']) {
    const f = fixture();
    const editor = new f.Element(true);
    const options = {};
    if (position === 'focus') f.document.activeElement = editor;
    if (position === 'event path') options.path = [editor];
    if (position === 'anchor') f.selection.anchorNode = { parentElement: editor };
    if (position === 'design mode') f.document.designMode = 'on';
    if (position === 'shadow host') f.article.root = { host: editor };
    f.start().enable();
    f.context.addEventListener('copy', event => {
      event.clipboardData.setData('text/html', '<table><tr><td>editor data</td></tr></table>');
      event.clipboardData.setData('application/x-editor', 'custom data');
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    const event = f.copy(options);
    assert.equal(event.transfer.values.get('application/x-editor'), 'custom data', position);
    assert.equal(event.transfer.values.has('text/plain'), false, position);
    assert.equal(event.stopped, true, position);
  }
});

test('no-selection copy buttons, synthetic copy and other events retain their normal handlers', () => {
  const f = fixture();
  f.start().enable();
  let calls = 0;
  const siteHandler = event => { calls += 1; event.stopImmediatePropagation(); };
  for (const type of ['copy', 'cut', 'paste', 'click']) f.context.addEventListener(type, siteHandler);
  f.setText('');
  assert.equal(f.copy().defaultPrevented, undefined);
  f.setText('selected');
  assert.equal(f.copy({ isTrusted: false }).defaultPrevented, undefined);
  for (const type of ['cut', 'paste', 'click']) f.context.dispatchEvent(new f.Event(type));
  assert.equal(calls, 5);
});

test('disabling and disposing restore hooks, while cached page wrappers become inert', () => {
  const f = fixture();
  const runtime = f.start();
  runtime.enable();
  runtime.enable();
  assert.equal(f.listeners.get('copy').length, 1);
  const retainedStop = f.Event.prototype.stopImmediatePropagation;
  const retainedGetter = Object.getOwnPropertyDescriptor(f.ClipboardEvent.prototype, 'clipboardData').get;
  runtime.disable();
  assert.equal(f.Event.prototype.stopImmediatePropagation, f.stop);
  assert.equal(Object.getOwnPropertyDescriptor(f.ClipboardEvent.prototype, 'clipboardData').get, f.clipboardGetter);
  const event = new f.ClipboardEvent('copy', { eventPhase: 1 });
  assert.equal(retainedGetter.call(event), event.transfer);
  retainedStop.call(event);
  assert.equal(event.stopped, true);
  assert.equal(f.listeners.get('copy').length, 0);
  runtime.enable();
  assert.equal(f.copy().defaultPrevented, true);
  runtime.onDispose({ detail: runtime.token });
  assert.equal(f.context[key], undefined);
  for (const list of f.listeners.values()) assert.equal(list.length, 0);
});

test('Clipboard Protect has an independent Standing authorization and saved switch', async () => {
  let settings = normalizeSettings({ nsna: { whitelistRules: ['*.example.com'] } });
  assert.equal(clipboardProtectState(settings, 'https://example.com').active, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.clipboardProtect.enabled, false);
  const province = createStandingProvince({ async mutateSettings(update) { settings = normalizeSettings(update(settings)); return settings; } });
  const previousAnyCopy = structuredClone(settings.anyCopy);
  const result = await province.handleMessage('clipboardProtect', { type: 'UI_SET_ENABLED', enabled: true }, { sender: {} });
  assert.equal(result.enabled, true);
  assert.deepEqual(settings.anyCopy, previousAnyCopy);
  for (const url of ['http://example.com', 'https://example.com', 'https://frame.example.net']) {
    assert.equal((await province.getProductState('clipboardProtect', { settings, url })).active, true);
  }
  assert.equal(clipboardProtectState(settings, 'chrome-extension://example/settings').active, false);
  await assert.rejects(province.handleMessage('clipboardProtect', { type: 'UI_TOGGLE_PAGE_FEATURE' }, { sender: {} }), /does not support/);
});

test('Clipboard Protect synchronizes eligible child frames and forwards deactivation to its own host', async () => {
  const syncs = [];
  const product = createClipboardProtectProduct({ async sync(descriptor, context, active) {
    syncs.push({ id: descriptor.id, documentId: context.documentId, active });
  } }, {});
  const context = { tabId: 5, frameId: 3, documentId: 'child', topUrl: 'https://example.com/' };
  const enabled = normalizeSettings({ clipboardProtect: { enabled: true } });
  assert.equal(await product.sync(context, enabled), true);
  assert.equal(await product.sync(context, normalizeSettings()), false);
  assert.equal(await product.sync({ ...context, documentId: 'unsupported', topUrl: 'chrome://settings/' }, enabled), false);
  assert.deepEqual(syncs, [
    { id: 'clipboardProtect', documentId: 'child', active: true },
    { id: 'clipboardProtect', documentId: 'child', active: false },
    { id: 'clipboardProtect', documentId: 'unsupported', active: false }
  ]);
});
