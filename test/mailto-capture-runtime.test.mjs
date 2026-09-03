import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}

class FakeAnchor {
  constructor(href) { this.href = href; this.isConnected = true; }
  getAttribute(name) { return name === 'href' ? this.href : null; }
  focus() {}
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; }
}

async function runtimeFixture() {
  const window = new SimpleEventTarget();
  const context = {
    window,
    document: {},
    navigator: {},
    HTMLAnchorElement: FakeAnchor,
    CustomEvent: FakeCustomEvent,
    Uint8Array,
    WeakMap,
    Map,
    Set,
    Symbol,
    JSON,
    Reflect,
    Number,
    String,
    Math,
    Object,
    Promise,
    decodeURIComponent,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    crypto: { getRandomValues: values => { values.fill(9); return values; } }
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/mailto-capture-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return { context, runtime: context[Symbol.for('cosmic-gemini.mailto-capture.runtime')] };
}

test('Mailto Capture preserves recipients, message fields, repeated values, and literal plus signs', async () => {
  const { runtime } = await runtimeFixture();
  const parsed = runtime.parseMailto(
    'mailto:alice+label@example.com,bob@example.com?to=carol%40example.com&cc=copy1%40example.com&cc=copy2%40example.com&bcc=private%40example.com&subject=Quarter%20Review&body=Line%201%0D%0ALine%202&reply-to=team%40example.com'
  );

  assert.deepEqual([...parsed.to], ['alice+label@example.com', 'bob@example.com', 'carol@example.com']);
  assert.deepEqual([...parsed.cc], ['copy1@example.com', 'copy2@example.com']);
  assert.deepEqual([...parsed.bcc], ['private@example.com']);
  assert.equal(parsed.subject, 'Quarter Review');
  assert.equal(parsed.body, 'Line 1\nLine 2');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.otherFields.map(field => [field.name, [...field.values]]))), [
    ['reply-to', ['team@example.com']]
  ]);
  assert.equal(runtime.messageText(parsed), [
    'To: alice+label@example.com, bob@example.com, carol@example.com',
    'CC: copy1@example.com, copy2@example.com',
    'BCC: private@example.com',
    'Subject: Quarter Review',
    'reply-to: team@example.com',
    '',
    'Line 1',
    'Line 2'
  ].join('\n'));
  assert.equal(parsed.simpleAddressOnly, false);

  const simple = runtime.parseMailto('mailto:hello@example.com');
  assert.equal(simple.simpleAddressOnly, true);
  assert.equal(simple.addressText, 'hello@example.com');
});

test('Mailto Capture intercepts trusted mailto activation and releases every listener when disabled', async () => {
  const { context, runtime } = await runtimeFixture();
  runtime.onConfigure({
    detail: JSON.stringify({ token: runtime.token, config: { active: true, locale: 'zh-CN' } })
  });
  const anchor = new FakeAnchor('MAILTO:person@example.com?subject=Hello');
  let shown = null;
  runtime.show = (target, href) => { shown = { target, href }; };
  const stopped = [];
  runtime.onActivate({
    type: 'click',
    button: 0,
    isTrusted: true,
    composedPath: () => [anchor],
    preventDefault: () => stopped.push('default'),
    stopPropagation: () => stopped.push('propagation'),
    stopImmediatePropagation: () => stopped.push('immediate')
  });
  assert.deepEqual(shown, { target: anchor, href: anchor.href });
  assert.deepEqual(stopped, ['default', 'propagation', 'immediate']);
  assert.equal(runtime.locale, 'zh-CN');
  assert.equal(context.window.listeners.get('click').includes(runtime.onActivate), true);

  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(context.window.listeners.get('click').includes(runtime.onActivate), false);
  runtime.onDispose({ detail: runtime.token });
  assert.equal(context[Symbol.for('cosmic-gemini.mailto-capture.runtime')], undefined);
});

test('Mailto Capture closes only for outside activation or Escape', async () => {
  const { runtime } = await runtimeFixture();
  const host = {};
  runtime.host = host;
  const closes = [];
  runtime.close = restoreFocus => closes.push(restoreFocus === true);

  runtime.onPointerDown({ composedPath: () => [host] });
  assert.deepEqual(closes, []);
  runtime.onPointerDown({ composedPath: () => [{}] });
  assert.deepEqual(closes, [false]);

  let prevented = false;
  let stopped = false;
  runtime.onKeyDown({
    key: 'Escape',
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  });
  assert.deepEqual(closes, [false, true]);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});
