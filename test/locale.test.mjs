import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLocale, preferredLocale } from '../extension/core/locale.js';
import { translator } from '../extension/localization.js';

test('all Chinese locales use zh-CN and every other locale uses en-US', () => {
  assert.equal(normalizeLocale('zh-HK'), 'zh-CN');
  assert.equal(normalizeLocale('zh-TW'), 'zh-CN');
  assert.equal(normalizeLocale('fr-FR'), 'en-US');
  assert.equal(preferredLocale(['ja-JP', 'zh-CN']), 'en-US');
});

test('translated strings interpolate values', () => {
  assert.equal(translator('en-US')('version', { version: '0.1.0' }), 'Version 0.1.0');
  assert.equal(translator('zh-CN')('removeRule', { rule: '*.example.com' }), '移除 *.example.com');
});
