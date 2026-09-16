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
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; this.disconnected = false; }
  observe() {}
  disconnect() { this.disconnected = true; }
}

async function runtimeFixture() {
  const window = new SimpleEventTarget();
  const document = {
    documentElement: {},
    querySelectorAll() { return []; }
  };
  const context = {
    window,
    document,
    MutationObserver: FakeMutationObserver,
    Node: { ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Uint8Array, Map, Set, Symbol, JSON, Number, String, Math, Object, Array, RegExp,
    queueMicrotask,
    crypto: { getRandomValues: values => { values.fill(5); return values; } }
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/chinese-punctuation-claude-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return { context, runtime: context[Symbol.for('cosmic-gemini.chinese-punctuation-claude.runtime')] };
}

test('Claude Chinese punctuation optimization preserves structured ASCII content', async () => {
  const { runtime } = await runtimeFixture();
  const state = { double: false, single: false };
  assert.equal(
    runtime.optimizeText('他说, "你好!" (version 1.2), Claude\'s URL: https://example.com/a?x=1.', true, state),
    '他说， “你好！” （version 1.2）， Claude\'s URL： https://example.com/a?x=1.'
  );
  assert.equal(runtime.optimizeText('English, punctuation!', false), 'English, punctuation!');
  assert.equal(runtime.optimizeText('稍后...再说, 可以吗?', true), '稍后...再说， 可以吗？');
  assert.equal(runtime.optimizeText('联系 me@example.com, 时间 12:30.', true), '联系 me@example.com， 时间 12:30。');
});

test('Claude punctuation changes are reversible without overwriting newer page text', async () => {
  const { runtime } = await runtimeFixture();
  const restored = { data: '已转换，', isConnected: true };
  const replaced = { data: 'Claude supplied newer text.', isConnected: true };
  runtime.records.set(restored, { original: '已转换,', transformed: '已转换，' });
  runtime.records.set(replaced, { original: '旧内容,', transformed: '旧内容，' });
  runtime.restore();
  assert.equal(restored.data, '已转换,');
  assert.equal(replaced.data, 'Claude supplied newer text.');
  assert.equal(runtime.records.size, 0);
});

test('Claude punctuation runtime excludes links, code, formulas, controls, and editable content', async () => {
  const { runtime } = await runtimeFixture();
  const excludedParent = { closest: selector => selector.includes('pre') ? {} : null };
  const ordinaryParent = { closest: () => null };
  assert.equal(runtime.shouldExclude({ parentElement: excludedParent }), true);
  assert.equal(runtime.shouldExclude({ parentElement: ordinaryParent }), false);
});
