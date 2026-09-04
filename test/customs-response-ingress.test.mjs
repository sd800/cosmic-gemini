import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomsResponseIngress } from '../extension/background/provinces/customs-response-ingress.js';

test('Customs response ingress registers only exact collecting tabs', () => {
  const additions = [];
  const removals = [];
  const handled = [];
  const event = {
    addListener(listener, filter, extraInfoSpec) {
      additions.push({ listener, filter, extraInfoSpec });
    },
    removeListener(listener) {
      removals.push(listener);
    }
  };
  const ingress = createCustomsResponseIngress(details => handled.push(details), event);

  assert.equal(ingress.size(), 0);
  assert.equal(ingress.setTabs(new Set()), 0);
  assert.equal(additions.length, 0);

  assert.equal(ingress.setTabs(new Set([12, 30])), 2);
  assert.deepEqual(additions.map(entry => entry.filter.tabId), [12, 30]);
  assert.deepEqual(additions[0].filter.urls, ['http://*/*', 'https://*/*']);
  assert.deepEqual(additions[0].filter.types, ['media', 'xmlhttprequest', 'other', 'image']);
  assert.deepEqual(additions[0].extraInfoSpec, ['responseHeaders']);

  additions[0].listener({ tabId: 12, url: 'https://example.com/video.mp4' });
  assert.deepEqual(handled, [{ tabId: 12, url: 'https://example.com/video.mp4' }]);

  assert.equal(ingress.setTabs(new Set([30])), 1);
  assert.deepEqual(removals, [additions[0].listener]);
  assert.equal(ingress.setTabs(new Set([30])), 1);
  assert.equal(additions.length, 2);
  assert.equal(removals.length, 1);

  assert.equal(ingress.setTabs(new Set()), 0);
  assert.deepEqual(removals, [additions[0].listener, additions[1].listener]);
});
