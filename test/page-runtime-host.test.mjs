import assert from 'node:assert/strict';
import test from 'node:test';
import { createPageRuntimeHost } from '../extension/background/features/page-runtime-host.js';

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
