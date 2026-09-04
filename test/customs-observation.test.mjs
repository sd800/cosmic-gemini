import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomsObservationRegistry } from '../extension/background/provinces/customs-observation.js';

test('Customs releases response observation only after the final collecting session ends', () => {
  const states = [];
  const registry = createCustomsObservationRegistry({
    setTabs(tabIds) {
      const value = [...tabIds].sort((left, right) => left - right);
      states.push(value);
      return value.length;
    }
  });

  assert.equal(registry.size(), 0);
  assert.deepEqual(registry.completeInitialization([true, true]), { reliable: true, collecting: 0 });
  assert.deepEqual(states, [[]]);

  assert.equal(registry.setCollecting('imageDownload', 7, true), true);
  assert.equal(registry.setCollecting('imageDownload', 7, true), false);
  assert.equal(registry.isCollecting('imageDownload', 7), true);
  assert.deepEqual(states, [[], [7]]);

  assert.equal(registry.setCollecting('videoDownload', 7, true), true);
  assert.equal(registry.setCollecting('imageDownload', 7, false), true);
  assert.deepEqual(states, [[], [7]]);
  assert.equal(registry.size(), 1);

  assert.equal(registry.setCollecting('videoDownload', 7, false), true);
  assert.deepEqual(states, [[], [7], []]);
  assert.equal(registry.size(), 0);
});

test('Customs restores collecting sessions before deciding whether to release observation', () => {
  const states = [];
  const registry = createCustomsObservationRegistry({
    setTabs(tabIds) { states.push([...tabIds]); }
  });
  registry.setCollecting('videoDownload', 12, true);
  assert.deepEqual(states, []);
  assert.deepEqual(registry.completeInitialization([true, true]), { reliable: true, collecting: 1 });
  assert.deepEqual(states, [[12]]);
});

test('Customs never falls back to global response observation after uncertain restoration', () => {
  const states = [];
  const registry = createCustomsObservationRegistry({
    setTabs(tabIds) {
      const value = [...tabIds].sort((left, right) => left - right);
      states.push(value);
      return value.length;
    }
  });
  assert.deepEqual(registry.completeInitialization([true, false]), { reliable: false, collecting: 0 });
  assert.deepEqual(states, [[]]);
  assert.equal(registry.needsRestoration(), true);
  registry.setCollecting('videoDownload', 20, true);
  registry.setCollecting('videoDownload', 20, false);
  assert.deepEqual(states, [[], [20], []]);
  assert.deepEqual(registry.completeInitialization([true, true]), { reliable: true, collecting: 0 });
  assert.equal(registry.needsRestoration(), false);
  assert.deepEqual(states, [[], [20], []]);
});

test('Customs observes exactly the tabs collecting for either download product', () => {
  const states = [];
  const registry = createCustomsObservationRegistry({
    setTabs(tabIds) {
      const value = [...tabIds].sort((left, right) => left - right);
      states.push(value);
      return value.length;
    }
  });
  registry.completeInitialization([true, true]);
  registry.setCollecting('imageDownload', 5, true);
  registry.setCollecting('videoDownload', 9, true);
  registry.setCollecting('imageDownload', 5, false);
  registry.setCollecting('videoDownload', 9, false);
  assert.deepEqual(states, [[], [5], [5, 9], [9], []]);
});
