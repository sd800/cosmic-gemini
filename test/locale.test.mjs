import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLocale, normalizeLocale, preferredLocale } from '../extension/core/locale.js';
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

test('a saved locale cache survives a transient Service Worker read failure', async () => {
  const previousChrome = globalThis.chrome;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.chrome = { runtime: { sendMessage: async () => { throw new Error('worker unavailable'); } } };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return key === 'cosmicGeminiInterfaceLocale' ? 'en-US' : null; },
      setItem() {}
    }
  });
  try { assert.equal(await loadLocale(), 'en-US'); }
  finally {
    globalThis.chrome = previousChrome;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});

test('incognito locale does not inherit the ordinary-window cache', async () => {
  const previousChrome = globalThis.chrome;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let writes = 0;
  globalThis.chrome = {
    extension: { inIncognitoContext: true },
    runtime: { sendMessage: async () => { throw new Error('worker unavailable'); } }
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { return 'zh-CN'; },
      setItem() { writes += 1; }
    }
  });
  try {
    assert.equal(await loadLocale(), preferredLocale());
    assert.equal(writes, 0);
  } finally {
    globalThis.chrome = previousChrome;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});

test('a speculative locale read can defer cache writes until its caller accepts the result', async () => {
  const previousChrome = globalThis.chrome;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let writes = 0;
  globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: true, result: { locale: 'zh-CN' } }) } };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: { getItem: () => 'en-US', setItem() { writes += 1; } }
  });
  try {
    assert.equal(await loadLocale({ cacheResult: false }), 'zh-CN');
    assert.equal(writes, 0);
    assert.equal(await loadLocale(), 'zh-CN');
    assert.equal(writes, 1);
  } finally {
    globalThis.chrome = previousChrome;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});
