import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { DEFAULT_INCOGNITO_SETTINGS, normalizeSettings } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { googleResultLanguage, googleSearchUrl, rewriteGoogleSearchUrl } from '../extension/core/lang-google.js';
import { createLangGoogleProduct } from '../extension/background/products/standing/lang-google.js';
import { createStandingProvince } from '../extension/background/provinces/standing.js';

const search = (q, options = '') => `https://www.google.com/search?q=${encodeURIComponent(q)}${options}`;
const enabledSettings = () => normalizeSettings({ langGoogle: { enabled: true } });

test('Google Chinese language aliases resolve script before region, ignoring case and separators', () => {
  for (const code of ['zh', 'zhs', 'ZH-CN', 'zh-SG', 'zh-MY', 'zh-Hans', 'zh-Hans-CN', 'zh_Hans_HK', 'zh-Hans-TW']) {
    assert.equal(googleResultLanguage(code), 'lang_zh-CN', code);
  }
  for (const code of ['zht', 'ZH-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-HK', 'zh_Hant_CN']) {
    assert.equal(googleResultLanguage(code), 'lang_zh-TW', code);
  }
  assert.equal(googleResultLanguage('zh-Latn'), '', 'unsupported scripts are not guessed');
  assert.equal(googleResultLanguage('en-US'), 'lang_en');
  assert.equal(googleResultLanguage('pt-BR'), 'lang_pt');
  assert.equal(googleResultLanguage('he-IL'), 'lang_iw');
  assert.equal(googleResultLanguage('fil'), 'lang_tl');
});

test('all supported Google result languages can be combined, not only English and Japanese', () => {
  const codes = 'af ar be bg ca cs da de el en eo es et fa fi fr hi hr hu hy id is it iw ja ko lt lv nl no pl pt ro ru sk sl sr sv sw th tl tr uk vi zh-CN zh-TW'.split(' ');
  const url = new URL(rewriteGoogleSearchUrl(search(`openai lang:${codes.join(',')}`)));
  assert.equal(url.searchParams.get('q'), 'openai');
  assert.equal(url.searchParams.get('lr'), codes.map(code => `lang_${code}`).join('|'));
  const mixed = new URL(rewriteGoogleSearchUrl(search('art LANG:zhs,fr lang:ZH-HANT,DE,zh-CN lang:fr')));
  assert.equal(mixed.searchParams.get('q'), 'art');
  assert.equal(mixed.searchParams.get('lr'), 'lang_zh-CN|lang_fr|lang_zh-TW|lang_de');
});

test('language commands preserve search modes and other filters, replace lr, and reset pagination', () => {
  for (const mode of ['', '&tbm=vid', '&tbm=isch', '&tbm=nws', '&udm=7', '&udm=2', '&udm=14']) {
    const original = new URL(search('openai lang:en,ja', `${mode}&hl=zh-CN&gl=ca&safe=active&tbs=qdr:w&lr=lang_de&lr=lang_fr&start=20#result`));
    const rewritten = new URL(rewriteGoogleSearchUrl(original.href));
    assert.equal(rewritten.searchParams.get('q'), 'openai');
    assert.deepEqual(rewritten.searchParams.getAll('lr'), ['lang_en|lang_ja']);
    assert.equal(rewritten.searchParams.has('start'), false);
    for (const key of ['tbm', 'udm', 'hl', 'gl', 'safe', 'tbs']) {
      assert.equal(rewritten.searchParams.get(key), original.searchParams.get(key), key);
    }
    assert.equal(rewritten.hash, '#result');
    assert.equal(rewriteGoogleSearchUrl(rewritten.href), null, 'rewritten searches cannot loop');
  }
});

test('only Google search URLs with one query are eligible', () => {
  for (const host of ['google.com', 'www.google.com.hk', 'www.google.co.uk', 'www.google.co.jp', 'images.google.com', 'www.google.cn.']) {
    assert.ok(rewriteGoogleSearchUrl(`https://${host}/search?q=openai+lang:zh`), host);
  }
  assert.ok(rewriteGoogleSearchUrl('https://www.google.com/webhp?q=openai+lang:en'));
  for (const url of [
    'https://www.google.com.evil.test/search?q=lang:en', 'https://evil.google.com/search?q=lang:en',
    'https://www.google.unknown/search?q=lang:en', 'https://www.google.com/url?q=lang:en',
    'https://www.google.com/search?q=lang:en&q=other', 'https://www.google.com/search',
    'https://user@www.google.com/search?q=lang:en', 'ftp://www.google.com/search?q=lang:en',
    'https://example.com/search?q=lang:en', 'not a url'
  ]) assert.equal(googleSearchUrl(url), null, url);
});

test('quoted phrases, unsupported lists and literal operator-like search text remain intact', () => {
  for (const query of [
    'openai', 'openai lang:unknown', 'openai lang:en,unknown', 'openai lang:en,',
    '"lang:en"', '"learn lang:en here"', '"unclosed lang:en', '-lang:en', 'slang:en',
    'https://example.com/lang:en', 'lang:en"suffix"', '"prefix"lang:en'
  ]) assert.equal(rewriteGoogleSearchUrl(search(query)), null, query);
  const query = '  lang:zh  "keep  these spaces" C++ lang:unknown & = + lang:ja  ';
  const rewritten = new URL(rewriteGoogleSearchUrl(search(query)));
  assert.equal(rewritten.searchParams.get('q'), '"keep  these spaces" C++ lang:unknown & = +');
  assert.equal(rewritten.searchParams.get('lr'), 'lang_zh-CN|lang_ja');
  assert.equal(new URL(rewriteGoogleSearchUrl(search('lang:zh'))).searchParams.get('q'), '');
});

test('Standing Province saves Google language authorization independently, including settings cache', async () => {
  let settings = normalizeSettings();
  assert.equal(settings.langGoogle.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.langGoogle.enabled, false);
  const province = createStandingProvince({
    mutateSettings: async update => (settings = update(settings)),
    readSettings: async () => settings
  });
  assert.deepEqual(await province.handleMessage('langGoogle', {
    type: 'UI_SET_ENABLED', enabled: true
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } }), { enabled: true });
  assert.equal(settingsViewCache(settings).langGoogle.enabled, true);
  const state = await province.getProductState('langGoogle', { settings, url: search('hello') });
  assert.equal(state.active, true);
  await province.handleMessage('langGoogle', { type: 'UI_SET_ENABLED', enabled: false }, { sender: {} });
  assert.equal(settingsViewCache(settings).langGoogle.enabled, false);
});

function harness(url = search('openai lang:zh')) {
  let settings = enabledSettings();
  let reads = 0;
  const calls = [];
  const replacements = [];
  const location = { href: url, replace(value) { replacements.push(value); } };
  const context = vm.createContext({ location });
  vm.runInContext('window = globalThis; window.top = window;', context);
  globalThis.chrome = { scripting: { async executeScript(details) {
    calls.push(details);
    context.args = details.args;
    const result = vm.runInContext(`(${details.func.toString()})(...args)`, context);
    return [{ result }];
  } } };
  const product = createLangGoogleProduct({ readSettings: async () => { reads += 1; return settings; } });
  return { product, calls, replacements, location, context,
    reads: () => reads, disable: () => { settings = normalizeSettings(); },
    sync: (overrides = {}) => product.sync({ tabId: 12, frameId: 0, documentId: 'document-1', frameUrl: url, ...overrides }, settings)
  };
}

test('Google URL rewrites use one-shot isolated top-frame navigation without history loops', async () => {
  const h = harness();
  assert.equal(await h.sync(), true);
  assert.deepEqual(h.calls[0].target, { tabId: 12, documentIds: ['document-1'] });
  assert.equal(h.calls[0].world, 'ISOLATED');
  assert.equal(h.calls[0].injectImmediately, true);
  assert.equal(new URL(h.replacements[0]).searchParams.get('lr'), 'lang_zh-CN');
  await h.product.handleTabUpdated(12, { url: h.location.href }, { url: h.location.href });
  assert.equal(h.replacements.length, 1, 'a second event cannot restart a pending navigation');
  h.location.href = h.replacements[0];
  await h.product.handleTabUpdated(12, { url: h.location.href }, { url: h.location.href });
  assert.equal(h.calls.length, 2, 'the rewritten URL needs no injection');
});

test('no command, disabled authorization and iframe visits leave pages alone', async () => {
  const h = harness();
  await h.sync({ frameId: 1 });
  await h.sync({ frameUrl: search('openai') });
  await h.product.handleTabUpdated(12, { url: 'https://example.com/?q=lang:en' }, {});
  await h.product.handleTabUpdated(12, { status: 'complete' }, {});
  assert.equal(h.reads(), 0);
  assert.equal(h.calls.length, 0);
  h.disable();
  await h.sync();
  await h.product.handleTabUpdated(12, { url: h.location.href }, {});
  assert.equal(h.calls.length, 0);
});

test('same-document searches are handled, but a stale event cannot overwrite a newer navigation', async () => {
  const h = harness();
  const newer = search('other lang:fr', '&tbm=vid');
  h.location.href = newer;
  assert.equal(await h.sync(), false);
  assert.equal(h.replacements.length, 0);
  await h.product.handleTabUpdated(12, { url: newer }, { url: newer, pendingUrl: 'https://example.com/' });
  assert.equal(h.calls.length, 1);
  assert.equal(await h.product.handleTabUpdated(12, { url: newer }, { url: newer }), true);
  assert.deepEqual(h.calls.at(-1).target, { tabId: 12, frameIds: [0] });
  const result = new URL(h.replacements[0]);
  assert.equal(result.searchParams.get('q'), 'other');
  assert.equal(result.searchParams.get('lr'), 'lang_fr');
  assert.equal(result.searchParams.get('tbm'), 'vid');
});

test('concurrent sync is coalesced and a closed document does not poison later searches', async () => {
  const h = harness();
  const execute = chrome.scripting.executeScript;
  let release;
  chrome.scripting.executeScript = async () => new Promise((_, reject) => { release = () => reject(Error('Document closed')); });
  const first = h.sync();
  const second = h.sync();
  await Promise.resolve();
  release();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(h.reads(), 1);
  chrome.scripting.executeScript = execute;
  assert.equal(await h.sync(), true);
  assert.equal(h.replacements.length, 1);
});
