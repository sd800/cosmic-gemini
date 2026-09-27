import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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
  assert.deepEqual(decisions[1].styles, ['content/white-softer/white-softer.css']);
  await product.handleMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', tone: 'cool' });
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false });
  assert.deepEqual(settings.whiteSofter, { enabled: false, tone: 'cool' });
  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true });
  assert.equal(product.state(settings, context.topUrl).tone, 'cool');
  await assert.rejects(product.handleMessage({ type: 'UI_SET_WHITE_SOFTER_TONE', tone: '<style>' }));
  assert.deepEqual(settings.whiteSofter, { enabled: true, tone: 'cool' });
});

test('White Softer preserves near-white surface and border contrast at every tone', () => {
  class Element {
    constructor() { this.attributes = new Map(); this.children = []; this.style = { setProperty() {} }; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    append(child) { this.children.push(child); child.parentNode = this; }
  }
  const context = vm.createContext({
    document: { createElement: () => new Element(), createElementNS: () => new Element(), addEventListener() {} },
    Symbol, Math, Number, Array
  });
  for (const file of ['white-tones.js', '../content/shared/white-cap-layer.js']) {
    vm.runInContext(readFileSync(new URL('../extension/shared/' + file, import.meta.url), 'utf8'), context);
  }
  const Layer = context[Symbol.for('cosmic-gemini.white-cap-layer')];
  const layer = new Layer('data-test-white-cap');
  layer.mount = () => {};
  for (const tone of context[Symbol.for('cosmic-gemini.white-tones')].tones) {
    layer.enable(tone.id);
    const caps = tone.rgb.split(' ').map(Number);
    layer.channels.forEach((channel, index) => {
      const values = channel.getAttribute('tableValues').split(' ').map(value => Math.round(Number(value) * 255));
      const cap = caps[index], shoulder = cap - 32;
      assert.equal(values.length, 256);
      assert.equal(values[255], cap, `${tone.id}: white must equal the selected color`);
      for (let n = 0; n <= shoulder; n++) assert.equal(values[n], n, `${tone.id}: midtones stay unchanged`);
      for (let n = 1; n < 256; n++) assert.ok(values[n] >= values[n-1], `${tone.id}: grayscale order ${n}`);
      assert.ok(values[240] < values[255], `${tone.id}: a light border remains distinct from its white panel`);
      assert.ok(values[245] < values[255], `${tone.id}: near-white and white surfaces remain distinct`);
    });
  }
});
