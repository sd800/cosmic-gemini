import assert from 'node:assert/strict';
import test from 'node:test';
import { createPageRuntimeHost } from '../extension/background/features/page-runtime-host.js';
import { createNativeScrollProduct } from '../extension/background/products/standing/native-scroll.js';
import { DEFAULT_SETTINGS } from '../extension/core/config.js';

const product = {
  id: 'nativeScroll',
  bridge: 'content/native-scroll-bridge.js',
  runtime: 'content/runtime.js'
};

test('page runtimes stay bound to the document that requested synchronization', async () => {
  const executions = [];
  const messages = [];
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        executions.push(details);
        return [{ frameId: 0, result: true }];
      }
    }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage(tabId, message, options) { messages.push({ tabId, message, options }); },
    async setFeatureActivity() {}
  });
  await host.sync(product, { tabId: 9, frameId: 0, documentId: 'document-a' }, true);
  assert.deepEqual(executions.map(item => item.target), [
    { tabId: 9, documentIds: ['document-a'] },
    { tabId: 9, documentIds: ['document-a'] }
  ]);
  assert.deepEqual(messages[0].options, { documentId: 'document-a' });
});

test('partially injected page runtimes are rolled back in the same document', async () => {
  const executions = [];
  const messages = [];
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        executions.push(details);
        if (executions.length === 2) throw new Error('runtime injection failed');
        return [{ frameId: 0, result: true }];
      }
    }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage(tabId, message, options) { messages.push({ tabId, message, options }); },
    async setFeatureActivity() {}
  });
  await assert.rejects(
    host.sync(product, { tabId: 9, frameId: 0, documentId: 'document-b' }, true),
    /runtime injection failed/
  );
  assert.equal(executions.length, 3);
  assert.deepEqual(executions[2].target, { tabId: 9, documentIds: ['document-b'] });
  assert.equal(messages.at(-1).message.type, 'CG_STOP_CENTRAL_FEATURE');
  assert.deepEqual(messages.at(-1).options, { documentId: 'document-b' });
});

test('an inactive product does not inject cleanup code into a page that never started it', async () => {
  let activityWrites = 0;
  let executions = 0;
  globalThis.chrome = {
    scripting: { async executeScript() { executions += 1; } }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage() {},
    async setFeatureActivity() { activityWrites += 1; }
  });
  await host.sync(product, { tabId: 9, frameId: 0, documentId: 'inactive-document' }, false);
  assert.equal(executions, 0);
  assert.equal(activityWrites, 0);
});

test('an existing bridge confirms inactive cleanup before toolbar activity is cleared', async () => {
  let activityWrites = 0;
  globalThis.chrome = { scripting: { async executeScript() { throw new Error('unexpected injection'); } } };
  const host = createPageRuntimeHost({
    async sendTabMessage() { return { disposed: true }; },
    async setFeatureActivity(_tabId, _featureId, active) {
      activityWrites += 1;
      assert.equal(active, false);
    }
  });
  await host.sync(product, { tabId: 9, frameId: 0, documentId: 'active-document' }, false);
  assert.equal(activityWrites, 1);
});

test('products that require configuration wait for the page bridge to acknowledge it', async () => {
  const acknowledgedProduct = { ...product, awaitConfiguration: true };
  let messages = 0;
  globalThis.chrome = {
    scripting: { async executeScript() { return [{ frameId: 0, result: true }]; } }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage(_tabId, message) {
      messages += 1;
      if (message.type === 'CG_REFRESH_FEATURE_CONFIG') return { configured: true };
      return { disposed: true };
    },
    async setFeatureActivity() {}
  });
  await host.sync(acknowledgedProduct, { tabId: 9, frameId: 0, documentId: 'acknowledged' }, true);
  assert.equal(messages, 1);
});

test('a missing configuration acknowledgement rolls back that page runtime', async () => {
  const acknowledgedProduct = { ...product, awaitConfiguration: true };
  let executions = 0;
  const messages = [];
  globalThis.chrome = {
    scripting: {
      async executeScript() {
        executions += 1;
        return [{ frameId: 0, result: true }];
      }
    }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage(_tabId, message) {
      messages.push(message.type);
      return undefined;
    },
    async setFeatureActivity() {}
  });
  await assert.rejects(
    host.sync(acknowledgedProduct, { tabId: 9, frameId: 0, documentId: 'unacknowledged' }, true),
    /did not apply/
  );
  assert.equal(executions, 3);
  assert.deepEqual(messages, ['CG_REFRESH_FEATURE_CONFIG', 'CG_STOP_CENTRAL_FEATURE']);
});

test('page styles use Chrome injection so strict page CSP cannot block them', async () => {
  const calls = [];
  const styledProduct = {
    ...product,
    pageStyleFiles: ['content/native-scroll-standard.css', 'content/native-scroll-enhanced.css']
  };
  globalThis.chrome = {
    scripting: {
      async removeCSS(details) { calls.push({ operation: 'removeCSS', details }); },
      async insertCSS(details) { calls.push({ operation: 'insertCSS', details }); },
      async executeScript(details) {
        calls.push({ operation: 'executeScript', details });
        return [{ frameId: 0, result: true }];
      }
    }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage() { return {}; },
    async setFeatureActivity() {}
  });
  const context = { tabId: 9, frameId: 0, documentId: 'strict-csp-document' };
  await host.sync(styledProduct, context, true, ['content/native-scroll-enhanced.css']);
  assert.deepEqual(calls.map(call => call.operation), [
    'removeCSS', 'executeScript', 'executeScript', 'insertCSS'
  ]);
  assert.deepEqual(calls[0].details, {
    target: { tabId: 9, documentIds: ['strict-csp-document'] },
    files: styledProduct.pageStyleFiles,
    origin: 'USER'
  });
  assert.deepEqual(calls.at(-1).details, {
    target: { tabId: 9, documentIds: ['strict-csp-document'] },
    files: ['content/native-scroll-enhanced.css'],
    origin: 'USER'
  });
});

test('page styles are removed only after a running bridge confirms cleanup', async () => {
  const removals = [];
  const styledProduct = {
    ...product,
    pageStyleFiles: ['content/native-scroll-standard.css', 'content/native-scroll-enhanced.css']
  };
  globalThis.chrome = {
    scripting: {
      async removeCSS(details) { removals.push(details); },
      async executeScript() { throw new Error('unexpected injection'); }
    }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage() { return { disposed: true }; },
    async setFeatureActivity() {}
  });
  await host.sync(styledProduct, { tabId: 9, frameId: 0, documentId: 'active-document' }, false);
  assert.deepEqual(removals, [{
    target: { tabId: 9, documentIds: ['active-document'] },
    files: styledProduct.pageStyleFiles,
    origin: 'USER'
  }]);
});

test('undeclared page styles are rejected before a runtime touches the page', async () => {
  let calls = 0;
  const styledProduct = { ...product, pageStyleFiles: ['content/native-scroll-standard.css'] };
  globalThis.chrome = {
    scripting: {
      async removeCSS() { calls += 1; },
      async insertCSS() { calls += 1; },
      async executeScript() { calls += 1; }
    }
  };
  const host = createPageRuntimeHost({
    async sendTabMessage() { calls += 1; },
    async setFeatureActivity() {}
  });
  await assert.rejects(
    host.sync(styledProduct, { tabId: 9, frameId: 0, documentId: 'document-c' }, true, ['content/not-declared.css']),
    /Undeclared page stylesheet/
  );
  assert.equal(calls, 0);
});

test('Native Scroll selects one declared mode stylesheet and keeps Xiaohongshu style-free', async () => {
  const calls = [];
  const nativeScroll = createNativeScrollProduct({
    async sync(...args) { calls.push(args); }
  });
  const baseContext = { tabId: 9, frameId: 0, documentId: 'document-d' };
  await nativeScroll.sync({ ...baseContext, topUrl: 'https://example.com/' }, DEFAULT_SETTINGS);
  await nativeScroll.sync({ ...baseContext, topUrl: 'https://enhanced.example/' }, {
    ...DEFAULT_SETTINGS,
    nativeScroll: { ...DEFAULT_SETTINGS.nativeScroll, enhancedRules: ['enhanced.example'] }
  });
  await nativeScroll.sync({ ...baseContext, topUrl: 'https://www.xiaohongshu.com/explore' }, DEFAULT_SETTINGS);
  assert.deepEqual(calls.map(([, , active, files]) => ({ active, files })), [
    { active: true, files: ['content/native-scroll-standard.css'] },
    { active: true, files: ['content/native-scroll-enhanced.css'] },
    { active: true, files: [] }
  ]);
});
