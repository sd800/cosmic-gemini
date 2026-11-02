import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaSourcePolicy } from '../extension/background/features/media-source.js';

test('media tools reject protected and PDF URLs without inspecting their DOM', async () => {
  let reads = 0;
  globalThis.chrome = { scripting: { executeScript: async () => { reads++; return []; } } };
  const policy = createMediaSourcePolicy();
  for (const url of ['chrome://settings/', 'chrome-extension://reader/viewer.html', 'about:blank',
    'file:///local/page.html', 'data:text/html,test', 'https://files.test/paper.PDF?download=1']) {
    assert.equal(await policy.inspect(1, url), false);
    assert.equal(policy.allows(1, url), false);
  }
  assert.equal(reads, 0);
});

test('eligible page decisions are shared, refreshed on demand, and invalidated on navigation', async () => {
  let reads = 0;
  const url = 'https://media.test/page';
  globalThis.chrome = { scripting: { executeScript: async () => {
    reads++; return [{ frameId: 0, result: { href: url, eligible: true } }];
  } } };
  const policy = createMediaSourcePolicy();
  assert.deepEqual(await Promise.all([policy.inspect(1, url), policy.inspect(1, url)]), [true, true]);
  assert.equal(reads, 1);
  assert.equal(policy.allows(1, url), true);
  await policy.inspect(1, url, true); assert.equal(reads, 2);
  policy.invalidate(1); assert.equal(policy.allows(1, url), false);
  await policy.inspect(1, url); assert.equal(reads, 3);
  policy.clear(); assert.equal(policy.allows(1, url), false);
});

test('extensionless PDF documents, inaccessible documents, and stale source documents cannot start media tools', async () => {
  const url = 'https://files.test/document';
  let mode = 'pdf';
  globalThis.chrome = { scripting: { executeScript: async () => {
    if (mode === 'blocked') throw Error('Cannot access this document');
    return [{ frameId: 0, result: { href: mode === 'stale' ? 'https://other.test/' : url, eligible: mode !== 'pdf' } }];
  } } };
  const policy = createMediaSourcePolicy();
  for (mode of ['pdf', 'blocked', 'stale']) {
    policy.invalidate(1);
    assert.equal(await policy.inspect(1, url), false);
    assert.equal(policy.allows(1, url), false);
  }
});

test('a pending document check cannot approve a source retired by navigation', async () => {
  let finish;
  const url = 'https://media.test/page';
  globalThis.chrome = { scripting: { executeScript: () => new Promise(resolve => { finish = resolve; }) } };
  const policy = createMediaSourcePolicy();
  const pending = policy.inspect(1, url);
  policy.invalidate(1);
  finish([{ frameId: 0, result: { href: url, eligible: true } }]);
  assert.equal(await pending, false);
  assert.equal(policy.allows(1, url), false);
});
