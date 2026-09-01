import assert from 'node:assert/strict';
import test from 'node:test';
import { retryRead } from '../extension/shared/ui.js';

test('read retries can recover from transient failures', async () => {
  let attempts = 0;
  const result = await retryRead(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary read failure');
    return 'ready';
  }, [0, 0, 0]);

  assert.equal(result, 'ready');
  assert.equal(attempts, 3);
});

test('read retries preserve the final failure after the limit', async () => {
  let attempts = 0;
  await assert.rejects(retryRead(async () => {
    attempts += 1;
    throw new Error(`read failure ${attempts}`);
  }, [0, 0]), /read failure 2/);
  assert.equal(attempts, 2);
});
