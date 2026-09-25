import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createPageRuntimeHost } from '../extension/background/features/page-runtime-host.js';
import { createNativeScrollProduct } from '../extension/background/products/standing/native-scroll.js';
import { createNoAutoplayProduct } from '../extension/background/products/standing/no-autoplay.js';
import { createStandingProvince } from '../extension/background/provinces/standing.js';
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

test('delayed cleanup in an old document cannot erase the new document activity', async () => {
  let release, stopping;
  const stopped = new Promise(resolve => { stopping = resolve; });
  const reply = new Promise(resolve => { release = resolve; });
  let active = true;
  globalThis.chrome = { scripting: { async executeScript() { return [{ result: true }]; } } };
  const host = createPageRuntimeHost({
    async sendTabMessage(_tabId, message) {
      if (message.type === 'CG_STOP_CENTRAL_FEATURE') { stopping(); return reply; }
      active = true;
      return {};
    },
    async setFeatureActivity(_tabId, _featureId, value) { active = value; }
  });
  const older = host.sync(product, { tabId: 9, frameId: 0, documentId: 'old' }, false);
  await stopped;
  await host.sync(product, { tabId: 9, frameId: 0, documentId: 'new' }, true);
  release({ disposed: true });
  await older;
  assert.equal(active, true);
  await host.sync(product, { tabId: 9, frameId: 0, documentId: 'new' }, false);
  assert.equal(active, false, 'ordinary current-document cleanup still clears activity');
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

test('opted-in styles survive refresh and worker restart, but not document changes, stop or failed configuration', async () => {
  const contexts = new Map(), calls = [];
  let configured = true;
  const descriptor = { ...product, awaitConfiguration: true, preservePageStylesOnRefresh: true,
    pageStyleFiles: ['content/standard.css', 'content/enhanced.css'] };
  globalThis.chrome = { scripting: {
    async removeCSS({ files }) { calls.push(['remove', ...files]); },
    async insertCSS({ files }) { calls.push(['insert', ...files]); },
    async executeScript(details) {
      if (!details.func) return [];
      const id = details.target.documentIds[0];
      if (!contexts.has(id)) contexts.set(id, createContext({}));
      const scope = contexts.get(id);
      scope.args = details.args;
      return [{ result: runInContext(`(${details.func.toString()})(...args)`, scope) }];
    }
  } };
  const platform = {
    async sendTabMessage(_tab, message) {
      return message.type === 'CG_REFRESH_FEATURE_CONFIG' ? { configured } : { disposed: true };
    },
    async setFeatureActivity() {}
  };
  let host = createPageRuntimeHost(platform);
  const context = { tabId: 9, frameId: 0, documentId: 'persistent-document' };
  await host.sync(descriptor, context, true, ['content/standard.css']);
  calls.length = 0;
  host = createPageRuntimeHost(platform);
  await host.sync(descriptor, context, true, ['content/standard.css']);
  await host.sync(descriptor, context, true, ['content/standard.css']);
  assert.deepEqual(calls, [], 'no removal, duplicate injection or unbounded worker cache on refresh');
  await host.sync(descriptor, { ...context, documentId: 'new-document' }, true, ['content/standard.css']);
  assert.deepEqual(calls.map(c => c[0]), ['remove', 'insert']);
  calls.length = 0;
  await host.sync(descriptor, context, true, ['content/enhanced.css']);
  assert.deepEqual(calls.at(-1), ['insert', 'content/enhanced.css']);
  calls.length = 0;
  await host.sync(descriptor, context, false);
  await host.sync(descriptor, context, true, ['content/enhanced.css']);
  assert.deepEqual(calls.map(c => c[0]), ['remove', 'remove', 'insert']);
  calls.length = 0;
  configured = false;
  await assert.rejects(host.sync(descriptor, context, true, ['content/enhanced.css']), /did not apply/);
  configured = true;
  await host.sync(descriptor, context, true, ['content/enhanced.css']);
  assert.deepEqual(calls.map(c => c[0]), ['remove', 'remove', 'insert'], 'failed refresh also invalidates the receipt');
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
  await nativeScroll.sync({ ...baseContext, topUrl: 'https://example.com/' }, {
    ...DEFAULT_SETTINGS, nativeScroll: { ...DEFAULT_SETTINGS.nativeScroll, enabled: true }
  });
  await nativeScroll.sync({ ...baseContext, topUrl: 'https://enhanced.example/' }, {
    ...DEFAULT_SETTINGS,
    nativeScroll: { ...DEFAULT_SETTINGS.nativeScroll, enabled: true, enhancedRules: ['enhanced.example'] }
  });
  await nativeScroll.sync({ ...baseContext, topUrl: 'https://www.xiaohongshu.com/explore' }, {
    ...DEFAULT_SETTINGS, nativeScroll: { ...DEFAULT_SETTINGS.nativeScroll, enabled: true }
  });
  assert.deepEqual(calls.map(([, , active, files]) => ({ active, files })), [
    { active: true, files: ['content/native-scroll-standard.css'] },
    { active: true, files: ['content/native-scroll-enhanced.css'] },
    { active: true, files: [] }
  ]);
});

test('No Autoplay follows the top-level page decision in every web frame', async () => {
  const calls = [];
  const noAutoplay = createNoAutoplayProduct({
    async sync(...args) { calls.push(args); }
  });
  const topUrl = 'https://example.com/article';
  const enabledSettings = { ...DEFAULT_SETTINGS, noAutoplay: { ...DEFAULT_SETTINGS.noAutoplay, enabled: true } };
  await noAutoplay.sync({ tabId: 9, frameId: 0, documentId: 'top', topUrl }, enabledSettings);
  await noAutoplay.sync({
    tabId: 9,
    frameId: 3,
    documentId: 'embedded-player',
    frameUrl: 'https://media.example.net/player',
    topUrl
  }, enabledSettings);
  await noAutoplay.sync({
    tabId: 9,
    frameId: 4,
    documentId: 'disabled-frame',
    frameUrl: 'https://media.example.net/player',
    topUrl
  }, {
    ...DEFAULT_SETTINGS,
    noAutoplay: { ...DEFAULT_SETTINGS.noAutoplay, enabled: false }
  });
  assert.deepEqual(calls.map(([, context, active]) => ({ frameId: context.frameId, active })), [
    { frameId: 0, active: true },
    { frameId: 3, active: true },
    { frameId: 4, active: false }
  ]);
});

test('Standing Province records governed No Autoplay interventions from child frames', async () => {
  const activity = [];
  const province = createStandingProvince({
    async readSettings() { return { ...DEFAULT_SETTINGS,
      noAutoplay: { ...DEFAULT_SETTINGS.noAutoplay, enabled: true } }; },
    async setFeatureActivity(tabId, featureId, active) { activity.push({ tabId, featureId, active }); }
  });
  const result = await province.handleMessage('noAutoplay', {
    type: 'CG_FEATURE_INTERVENED',
    featureId: 'noAutoplay',
    pageUrl: 'https://media.example.net/player'
  }, {
    sender: {
      frameId: 3,
      url: 'https://media.example.net/player',
      tab: { id: 9, url: 'https://example.com/article' }
    }
  });
  assert.deepEqual(result, { recorded: true });
  assert.deepEqual(activity, [{ tabId: 9, featureId: 'noAutoplay', active: true }]);
});

test('authorized runtime dependencies load in order in the same main-world document', async () => {
  const executions = [];
  globalThis.chrome = { scripting: { async executeScript(details) { executions.push(details); return []; } } };
  const host = createPageRuntimeHost({ sendTabMessage: async () => ({ configured: true }) });
  const descriptor = { id: 'websiteKnowledgeControl', bridge: 'content/website-knowledge-control-bridge.js',
    runtime: 'content/website-knowledge-control-runtime.js', runtimeDependencies: ['content/browser-identity.js'], awaitConfiguration: true };
  await host.sync(descriptor, { tabId: 3, frameId: 2, documentId: 'identity-frame' }, true);
  assert.equal(executions[0].world, 'ISOLATED');
  assert.equal(executions[1].world, 'MAIN');
  assert.deepEqual(executions[1].files, ['content/browser-identity.js', 'content/website-knowledge-control-runtime.js']);
  assert.deepEqual(executions[1].target, { tabId: 3, documentIds: ['identity-frame'] });
});
