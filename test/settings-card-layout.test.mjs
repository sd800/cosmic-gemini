import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { translator } from '../extension/shared/localization.js';

const source = readFileSync(new URL('../extension/settings/preload.js', import.meta.url), 'utf8');
const layoutSource = source.slice(source.indexOf('  const cardLayoutStorageKey ='), source.indexOf('  const emptyKeys ='));
const storageKey = 'cosmicGeminiSettingsCardLayout';
const apiKey = Symbol.for('cosmic-gemini.settings.card-layout');
function storage() {
  const values = new Map();
  return { values, writes: 0, fail: false,
    getItem(key) { if (this.fail) throw Error('unavailable'); return values.get(key) ?? null; },
    setItem(key, value) { if (this.fail) throw Error('unavailable'); this.writes++; values.set(key, value); },
    removeItem(key) { if (this.fail) throw Error('unavailable'); this.writes++; values.delete(key); } };
}
function fixture(local = storage(), session = storage(), incognitoContext = false) {
  const context = { localStorage: local, sessionStorage: session, incognitoContext };
  runInNewContext(layoutSource, context);
  return { api: context[apiKey], local, session };
}

test('card layout persists independent choices without writes during reads or default rendering', () => {
  const f = fixture();
  assert.deepEqual([...f.api.read()], []);
  assert.equal(f.local.writes, 0);
  f.api.write('satellite-document-preview', true);
  f.api.write('orbiter-xhs-navigation', true);
  const reopened = fixture(f.local);
  assert.deepEqual([...reopened.api.read()], ['satellite-document-preview', 'orbiter-xhs-navigation']);
  const count = f.local.writes;
  reopened.api.read(); assert.equal(f.local.writes, count);
  reopened.api.write('satellite-document-preview', false);
  assert.deepEqual([...fixture(f.local).api.read()], ['orbiter-xhs-navigation']);
  reopened.api.reset();
  assert.equal(f.local.values.has(storageKey), false);
  assert.deepEqual([...fixture(f.local).api.read()], []);
});

test('private card layout uses only tab-session storage and survives a private refresh', () => {
  const local = storage(), session = storage();
  fixture(local).api.write('satellite-white-softer', true);
  const privatePage = fixture(local, session, true);
  assert.deepEqual([...privatePage.api.read()], []);
  privatePage.api.write('orbiter-xhs-navigation', true);
  assert.deepEqual([...fixture(local, session, true).api.read()], ['orbiter-xhs-navigation']);
  assert.deepEqual([...fixture(local).api.read()], ['satellite-white-softer']);
  privatePage.api.reset();
  assert.deepEqual([...fixture(local).api.read()], ['satellite-white-softer']);
});

test('layout data is bounded, treats malformed values as defaults, and tolerates unavailable storage', () => {
  const f = fixture();
  for (const raw of ['{invalid', '{}', 'null', 'x'.repeat(8193)]) {
    f.local.values.set(storageKey, raw);
    assert.deepEqual([...f.api.read()], []);
  }
  f.local.values.set(storageKey, JSON.stringify(['__proto__', 5, null, 'orbiter-xhs-navigation', 'orbiter-xhs-navigation', 'satellite-<bad>']));
  assert.deepEqual([...f.api.read()], ['orbiter-xhs-navigation']);
  f.api.write('<untrusted>', true);
  assert.equal(f.local.writes, 0);
  f.local.values.set(storageKey, JSON.stringify(Array.from({ length: 100 }, (_, i) => `orbiter-fixture-${i}`)));
  assert.equal(f.api.read().size, 64);
  f.local.fail = true;
  assert.doesNotThrow(() => f.api.write('orbiter-xhs-navigation', false));
  assert.doesNotThrow(() => f.api.reset());
});

test('Orbiters display names match the selected UI labels in both interface languages', () => {
  const labels = { biliDailyLoginName: 'Bilibili – Daily Login', leetcodeDarkModeName: 'LeetCode Explore – Dark Mode',
    chineseResponseClaudeName: 'Claude – Chinese Formatting', followListInstagramName: 'Instagram – Follow List Check',
    langGoogleName: 'Google Search – By Language', zhihuImageAdjustmentName: 'Zhihu – Image Display' };
  for (const locale of ['en-US', 'zh-CN']) for (const [key, label] of Object.entries(labels)) assert.equal(translator(locale)(key), label);
});
