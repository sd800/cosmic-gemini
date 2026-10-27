import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const helper = readFileSync(new URL('../extension/core/url-tracking-parameters.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../extension/content/url-tracking-cleaner/url-tracking-cleaner-runtime.js', import.meta.url), 'utf8');
const key = Symbol.for('cosmic-gemini.url-tracking-cleaner.runtime');
const prefix = 'cosmic-gemini:url-tracking-cleaner:';

function fixture({ writable = true } = {}) {
  const events = new EventTarget(), calls = [], result = {};
  const original = function (...args) {
    calls.push({ receiver: this, args });
    if (args[0] === 'throw') throw new TypeError('native failure');
    return result;
  };
  const context = createContext({ URL, crypto, CustomEvent, document: { baseURI: 'https://example.test/base/' },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events) });
  context.window = context;
  Object.defineProperty(context, 'open', { value: original, configurable: true, enumerable: true, writable });
  runInContext(helper, context);
  runInContext(source, context);
  const configure = (active, options = {}) => context.dispatchEvent(new CustomEvent(prefix + 'configure', {
    detail: JSON.stringify({ token: context[key].token, config: { active, ...options } })
  }));
  const dispose = () => context.dispatchEvent(new CustomEvent(prefix + 'dispose', { detail: context[key].token }));
  return { context, calls, original, result, configure, dispose };
}

test('scripted navigation cleans its original URL before delegating and preserves the open contract', () => {
  const f = fixture(), receiver = {};
  assert.equal(f.context.open, f.original);
  f.configure(true);
  assert.equal(f.context.open.call(receiver, 'https://example.test/?utm_source=assistant&keep=a%20b#part', '_blank', 'noopener'), f.result);
  assert.equal(f.calls[0].receiver, receiver);
  assert.deepEqual(Array.from(f.calls[0].args), ['https://example.test/?keep=a%20b#part', '_blank', 'noopener']);
  f.context.open('../relative?uTm_Source=test&keep=1');
  assert.equal(f.calls[1].args[0], 'https://example.test/relative?keep=1');
  f.context.open('?utm_medium=mail');
  assert.equal(f.calls[2].args[0], 'https://example.test/base/');
  assert.throws(() => f.context.open('throw'), /native failure/);
  f.dispose();
  assert.equal(f.context.open, f.original);
  assert.equal(f.context[key], undefined);
});

test('open leaves nontracking URLs, native coercion, protocols, and disabled options unchanged', () => {
  const f = fixture();
  f.configure(true);
  const object = { toString() { throw Error('must not coerce early'); } };
  for (const value of [undefined, object, '', '#section', '/same?keep=1', 'mailto:test@example.test?utm_source=keep', 'javascript:void(0)']) {
    f.context.open(value);
    assert.equal(f.calls.at(-1).args[0], value);
  }
  f.configure(true, { utmParameters: false, bilibiliParameters: true });
  f.context.open('https://example.test/?utm_source=keep');
  assert.equal(f.calls.at(-1).args[0], 'https://example.test/?utm_source=keep');
  f.context.open('https://space.bilibili.com/123?spm_id_from=fixture#part');
  assert.equal(f.calls.at(-1).args[0], 'https://space.bilibili.com/123');
  f.configure(false);
  assert.equal(f.context.open, f.original);
  f.context.open('https://example.test/?utm_source=off');
  assert.equal(f.calls.at(-1).args[0], 'https://example.test/?utm_source=off');
});

test('cleanup preserves later wrappers, and stale retained wrappers remain pass-through after reactivation', () => {
  const f = fixture();
  f.configure(true);
  const first = f.context.open;
  f.configure(true);
  assert.equal(f.context.open, first);
  const later = function (...args) { return Reflect.apply(first, this, args); };
  f.context.open = later;
  f.configure(false);
  assert.equal(f.context.open, later);
  first('https://example.test/?utm_source=off');
  assert.equal(f.calls.at(-1).args[0], 'https://example.test/?utm_source=off');
  f.configure(true);
  first('https://example.test/?utm_source=stale');
  assert.equal(f.calls.at(-1).args[0], 'https://example.test/?utm_source=stale');
  f.context.open('https://example.test/?utm_source=active&keep=1');
  assert.equal(f.calls.at(-1).args[0], 'https://example.test/?keep=1');
  f.dispose();
  assert.equal(f.context.open, later);
});

test('locked page properties are respected without preventing runtime activation or disposal', () => {
  const f = fixture({ writable: false });
  f.configure(true);
  assert.equal(f.context[key].active, true);
  assert.equal(f.context.open, f.original);
  f.dispose();
  assert.equal(f.context.open, f.original);
});
