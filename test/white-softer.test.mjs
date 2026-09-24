import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_INCOGNITO_SETTINGS } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { createWhiteSofterProduct } from '../extension/background/products/standing/white-softer.js';

test('White Softer normalizes saved choices and starts inactive in ordinary and incognito contexts', () => {
  assert.deepEqual(normalizeSettings().whiteSofter, { enabled: false, tone: 'warm' });
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.whiteSofter.enabled, false);
  assert.deepEqual(normalizeSettings({ whiteSofter: { enabled: true, tone: 'warm-minus-1' } }).whiteSofter, { enabled: true, tone: 'warm-minus-1' });
  for (const tone of [null, 'unknown', '#ffffff']) {
    assert.deepEqual(normalizeSettings({ whiteSofter: { enabled: true, tone } }).whiteSofter, { enabled: true, tone: 'warm' });
  }
  assert.deepEqual(settingsViewCache({ whiteSofter: { enabled: true, tone: 'cool', active: false } }).whiteSofter, { enabled: true, tone: 'cool' });
});

test('Standing product applies once per supported page and preserves the selected tone while disabled', async () => {
  let settings = normalizeSettings();
  const decisions = [];
  const product = createWhiteSofterProduct({ async sync(_product, context, active, styles) {
    decisions.push({ frame: context.frameId, active, styles });
  } }, { async mutateSettings(change) { settings = normalizeSettings(change(settings)); return settings; } });
  const context = { topUrl: 'https://example.com/', frameId: 0 };
  assert.equal(await product.sync(context, settings), false);
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true });
  assert.equal(await product.sync(context, settings), true);
  assert.equal(await product.sync({ ...context, frameId: 1 }, settings), false);
  assert.equal(await product.sync({ ...context, topUrl: 'chrome://settings/' }, settings), false);
  assert.equal(product.state(settings, 'http://example.com/').active, true);
  assert.deepEqual(decisions[1].styles, ['content/white-softer.css']);
  await product.handleMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', tone: 'cool' });
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false });
  assert.deepEqual(settings.whiteSofter, { enabled: false, tone: 'cool' });
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true });
  assert.equal(product.state(settings, context.topUrl).tone, 'cool');
  await assert.rejects(product.handleMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', tone: '<style>' }));
  assert.deepEqual(settings.whiteSofter, { enabled: true, tone: 'cool' });
});
