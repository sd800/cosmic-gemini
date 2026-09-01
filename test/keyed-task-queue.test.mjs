import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeyedTaskQueue } from '../extension/core/keyed-task-queue.js';

test('keyed tasks serialize work for one resource and recover after failure', async () => {
  const queue = createKeyedTaskQueue();
  const order = [];
  const first = queue.run('tab:1', async () => {
    order.push('first:start');
    await Promise.resolve();
    order.push('first:end');
    throw new Error('temporary failure');
  });
  const second = queue.run('tab:1', async () => {
    order.push('second');
    return 'ready';
  });

  await assert.rejects(first, /temporary failure/);
  assert.equal(await second, 'ready');
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  assert.equal(queue.size(), 0);
});

test('keyed tasks do not block independent resources', async () => {
  const queue = createKeyedTaskQueue();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = queue.run('tab:1', () => gate);
  const second = queue.run('tab:2', async () => 'independent');
  assert.equal(await second, 'independent');
  release('finished');
  assert.equal(await first, 'finished');
  await queue.drain();
  assert.equal(queue.size(), 0);
});
