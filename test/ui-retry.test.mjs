import assert from 'node:assert/strict';
import test from 'node:test';
import { retryRead, retryReadUntil } from '../extension/shared/ui.js';

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

test('conditional read retries wait for a usable state without repeating mutations', async () => {
  const states = [{ active: false }, { active: false }, { active: true, count: 3 }];
  let attempts = 0;
  const result = await retryReadUntil(async () => {
    attempts += 1;
    return states.shift();
  }, value => value?.active === true, [0, 0, 0]);

  assert.deepEqual(result, { active: true, count: 3 });
  assert.equal(attempts, 3);
});

test('conditional read retries return the latest readable state when the condition stays pending', async () => {
  let attempts = 0;
  const result = await retryReadUntil(async () => {
    attempts += 1;
    return { active: false, attempt: attempts };
  }, value => value?.active === true, [0, 0]);

  assert.deepEqual(result, { active: false, attempt: 2 });
});
