import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLocale, preferredLocale } from '../extension/core/locale.js';
import { translator } from '../extension/shared/localization.js';

test('all Chinese locales use zh-CN and every other locale uses en-US', () => {
  assert.equal(normalizeLocale('zh-HK'), 'zh-CN');
  assert.equal(normalizeLocale('zh-TW'), 'zh-CN');
  assert.equal(normalizeLocale('fr-FR'), 'en-US');
  assert.equal(preferredLocale(['ja-JP', 'zh-CN']), 'en-US');
});

test('localized copy interpolates product names naturally', () => {
  assert.equal(translator('en-US')('version', { version: '1.0.0' }), 'Version 1.0.0');
  assert.equal(translator('zh-CN')('featureOnTitle', { product: 'No Autoplay' }), 'No Autoplay 已开启 · 点击关闭');
});
