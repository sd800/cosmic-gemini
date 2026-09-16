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
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    this.observations = [];
    FakeMutationObserver.instances.push(this);
  }
  observe(target, options) { this.observations.push({ target, options }); }
  disconnect() { this.disconnected = true; }
}

async function runtimeFixture() {
  FakeMutationObserver.instances = [];
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
  const source = await readFile(new URL('../extension/content/chinese-response-claude-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return { context, runtime: context[Symbol.for('cosmic-gemini.chinese-response-claude.runtime')] };
}

test('Claude response observation limits character changes to assistant roots', async () => {
  const { runtime } = await runtimeFixture();
  runtime.enable();
  assert.equal(FakeMutationObserver.instances.length, 1);
  const discoveryOptions = FakeMutationObserver.instances[0].observations[0].options;
  assert.equal(discoveryOptions.subtree, true);
  assert.equal(discoveryOptions.childList, true);
  assert.equal(discoveryOptions.characterData, undefined);

  const root = { isConnected: true };
  runtime.observeRoot(root);
  assert.equal(FakeMutationObserver.instances.length, 2);
  const responseObservation = FakeMutationObserver.instances[1].observations[0];
  assert.equal(responseObservation.target, root);
  assert.equal(responseObservation.options.subtree, true);
  assert.equal(responseObservation.options.childList, true);
  assert.equal(responseObservation.options.characterData, true);

  runtime.disable();
  assert.equal(FakeMutationObserver.instances.every(observer => observer.disconnected), true);
});

test('Claude response observation ignores the runtime own recorded text writes', async () => {
  const { runtime } = await runtimeFixture();
  const root = {};
  const block = {};
  const parentElement = {
    closest(selector) { return selector.includes('assistant') ? root : block; }
  };
  root.contains = candidate => candidate === block;
  const node = { data: '价格是 $45', parentElement };
  const queued = [];
  runtime.active = true;
  runtime.queueTarget = target => queued.push(target);
  runtime.records.set(node, { original: '价格是$45', transformed: '价格是 $45' });

  runtime.onResponseMutations([{ type: 'characterData', target: node }]);
  assert.deepEqual(queued, []);

  node.data = '价格是$46';
  runtime.onResponseMutations([{ type: 'characterData', target: node }]);
  assert.deepEqual(queued, [block]);
});

test('Claude response optimization reports live activity only when transformed text remains', async () => {
  const { context, runtime } = await runtimeFixture();
  const reports = [];
  context.window.addEventListener('cosmic-gemini:chinese-response-claude:activity', event => {
    const detail = JSON.parse(event.detail);
    assert.equal(detail.token, runtime.token);
    reports.push(detail.active);
  });
  const first = { data: '中文,', isConnected: true };
  const second = { data: '价格$45', isConnected: true };
  runtime.transformNode(first, true, { double: false, single: false });
  runtime.transformNode(second, true, { double: false, single: false });
  runtime.syncActivity();
  assert.equal(first.data, '中文，');
  assert.equal(second.data, '价格 $45');
  assert.deepEqual(reports, [true]);

  first.isConnected = false;
  second.isConnected = false;
  runtime.syncActivity(false, true);
  assert.deepEqual(reports, [true, false]);
});

test('Claude response optimization reaffirms live activity after configuration refresh', async () => {
  const { context, runtime } = await runtimeFixture();
  const reports = [];
  context.window.addEventListener('cosmic-gemini:chinese-response-claude:activity', event => {
    reports.push(JSON.parse(event.detail).active);
  });
  const node = { data: '中文,', isConnected: true };
  runtime.transformNode(node, true, { double: false, single: false });
  runtime.syncActivity();
  runtime.active = true;
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true } }) });
  assert.deepEqual(reports, [true, true]);
});

test('Claude bridge forwards both live activity transitions to the governed product', async () => {
  const window = new SimpleEventTarget();
  const messages = [];
  const runtimeListeners = new Set();
  const context = {
    window,
    top: window,
    location: { href: 'https://claude.ai/chat/example' },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    setTimeout,
    clearTimeout,
    Symbol,
    JSON,
    chrome: { runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'CG_PAGE_STATE') {
          return { ok: true, result: { chineseResponseClaude: { active: true } } };
        }
        return { ok: true };
      },
      onMessage: {
        addListener(listener) { runtimeListeners.add(listener); },
        removeListener(listener) { runtimeListeners.delete(listener); }
      }
    } }
  };
  vm.createContext(context);
  const bridgeSource = await readFile(new URL('../extension/content/chinese-response-claude-bridge.js', import.meta.url), 'utf8');
  vm.runInContext(bridgeSource, context);
  window.dispatchEvent({ type: 'cosmic-gemini:chinese-response-claude:main-ready', detail: 'page-token' });
  await Promise.resolve();
  await Promise.resolve();
  for (const active of [true, false]) {
    window.dispatchEvent({
      type: 'cosmic-gemini:chinese-response-claude:activity',
      detail: JSON.stringify({ token: 'page-token', active })
    });
  }
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(
    messages.filter(message => message.type === 'CG_FEATURE_ACTIVITY')
  )), [
    {
      type: 'CG_FEATURE_ACTIVITY', featureId: 'chineseResponseClaude', active: true,
      pageUrl: 'https://claude.ai/chat/example'
    },
    {
      type: 'CG_FEATURE_ACTIVITY', featureId: 'chineseResponseClaude', active: false,
      pageUrl: 'https://claude.ai/chat/example'
    }
  ]);
});

test('Claude Chinese punctuation optimization preserves structured ASCII content', async () => {
  const { runtime } = await runtimeFixture();
  const state = { double: false, single: false };
  assert.equal(
    runtime.optimizeText('他说, "你好!" (version 1.2), Claude\'s URL: https://example.com/a?x=1.', true, state),
    '他说， “你好！” （version 1.2）， Claude\'s URL: https://example.com/a?x=1.'
  );
  assert.equal(runtime.optimizeText('English, punctuation!', false), 'English, punctuation!');
  assert.equal(runtime.optimizeText('稍后...再说, 可以吗?', true), '稍后...再说， 可以吗？');
  assert.equal(runtime.optimizeText('联系 me@example.com, 时间 12:30.', true), '联系 me@example.com， 时间 12:30。');
  assert.equal(runtime.optimizeText('电话 (312) 285-2968, 明天联系.', true), '电话 (312) 285-2968， 明天联系。');
  assert.equal(runtime.optimizeText('国际号码 +1 (312) 285-2968, 请记录.', true), '国际号码 +1 (312) 285-2968， 请记录。');
  assert.equal(
    runtime.optimizeText('地址是 30 E Hubbard St, Chicago, IL 60611, 请按时到达.', true),
    '地址是 30 E Hubbard St, Chicago, IL 60611， 请按时到达。'
  );
  assert.equal(
    runtime.optimizeText('办公地点: 30 E Hubbard St, Chicago, IL 60611', true),
    '办公地点： 30 E Hubbard St, Chicago, IL 60611'
  );
});

test('Claude Chinese response optimization inserts stable Chinese, Latin, and numeric spacing', async () => {
  const { runtime } = await runtimeFixture();
  assert.equal(runtime.optimizeText('使用Claude3回答, 共2项.', true), '使用 Claude3 回答， 共 2 项。');
  assert.equal(runtime.optimizeText('支持GPT-5模型和v2版本.', true), '支持 GPT-5 模型和 v2 版本。');
  assert.equal(runtime.optimizeText('访问https://example.com查看.', true), '访问 https://example.com 查看。');
  assert.equal(runtime.optimizeText('价格是$45, 增长45%以后.', true), '价格是 $45， 增长 45% 以后。');
  assert.equal(runtime.optimizeText('标签#Claude和中文&英文.', true), '标签 #Claude 和中文 & 英文。');
  assert.equal(runtime.optimizeText('English3 only.', false), 'English3 only.');
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
