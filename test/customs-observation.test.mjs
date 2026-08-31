import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomsObservationRegistry } from '../extension/background/provinces/customs-observation.js';

test('Customs releases response observation only after the final collecting session ends', () => {
  const states = [];
  const registry = createCustomsObservationRegistry({
    setEnabled(value) {
      states.push(value);
      return value;
    }
  });

  assert.equal(registry.size(), 0);
  assert.deepEqual(registry.completeInitialization([true, true]), { reliable: true, collecting: 0 });
  assert.deepEqual(states, [false]);

  assert.equal(registry.setCollecting('imageDownload', 7, true), true);
  assert.equal(registry.setCollecting('imageDownload', 7, true), false);
  assert.equal(registry.isCollecting('imageDownload', 7), true);
  assert.deepEqual(states, [false, true]);

  assert.equal(registry.setCollecting('videoDownload', 7, true), true);
  assert.equal(registry.setCollecting('imageDownload', 7, false), true);
  assert.deepEqual(states, [false, true, true, true]);
  assert.equal(registry.size(), 1);

  assert.equal(registry.setCollecting('videoDownload', 7, false), true);
  assert.deepEqual(states, [false, true, true, true, false]);
  assert.equal(registry.size(), 0);
});

test('Customs restores collecting sessions before deciding whether to release observation', () => {
  const states = [];
  const registry = createCustomsObservationRegistry({ setEnabled: value => states.push(value) });
  registry.setCollecting('videoDownload', 12, true);
  assert.deepEqual(states, []);
  assert.deepEqual(registry.completeInitialization([true, true]), { reliable: true, collecting: 1 });
  assert.deepEqual(states, [true]);
});

test('Customs keeps response observation available after uncertain restoration', () => {
  const states = [];
  const registry = createCustomsObservationRegistry({ setEnabled: value => states.push(value) });
  assert.deepEqual(registry.completeInitialization([true, false]), { reliable: false, collecting: 0 });
  assert.deepEqual(states, [true]);
  assert.equal(registry.needsRestoration(), true);
  registry.setCollecting('videoDownload', 20, true);
  registry.setCollecting('videoDownload', 20, false);
  assert.deepEqual(states, [true, true, true]);
  assert.deepEqual(registry.completeInitialization([true, true]), { reliable: true, collecting: 0 });
  assert.equal(registry.needsRestoration(), false);
  assert.deepEqual(states, [true, true, true, false]);
});
