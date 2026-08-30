import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  featureState,
  hostnameFromUrl,
  matchingRule,
  normalizeRule,
  normalizeSettings,
  ruleMatches,
  updateFeature
} from '../extension/core/config.js';

test('both products are enabled by default with site-specific rule lists', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings().nativeScroll.strongRules, []);
  assert.deepEqual(normalizeSettings().noAutoplay.permanentAudioAllowRules, []);
});

test('rules are normalized, deduplicated, and sorted by feature', () => {
  const settings = normalizeSettings({
    nativeScroll: { whitelistRules: ['B.example.com', '*.example.com', 'b.example.com'] },
    noAutoplay: { strongRules: ['media.example.com'] }
  });
  assert.deepEqual(settings.nativeScroll.whitelistRules, ['*.example.com', 'b.example.com']);
  assert.deepEqual(settings.noAutoplay.strongRules, ['media.example.com']);
});

test('exact and wildcard rules match their intended hostnames', () => {
  assert.equal(ruleMatches('example.com', 'example.com'), true);
  assert.equal(ruleMatches('www.example.com', 'example.com'), false);
  assert.equal(ruleMatches('example.com', '*.example.com'), true);
  assert.equal(ruleMatches('a.b.example.com', '*.example.com'), true);
  assert.equal(ruleMatches('notexample.com', '*.example.com'), false);
  assert.equal(matchingRule('news.example.com', ['other.com', '*.example.com']), '*.example.com');
});

test('rule parser rejects URLs, ports, paths, and misplaced wildcards', () => {
  for (const input of ['https://example.com', 'example.com/path', 'example.com:443', 'a.*.example.com']) {
    assert.throws(() => normalizeRule(input));
  }
});

test('whitelist takes priority over site-specific Strong mode', () => {
  const state = featureState({
    nativeScroll: {
      enabled: true,
      whitelistRules: ['*.example.com'],
      strongRules: ['docs.example.com']
    }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(state.active, false);
  assert.equal(state.mode, 'standard');
  assert.equal(state.matchedWhitelistRule, '*.example.com');
  assert.equal(state.matchedStrongRule, 'docs.example.com');
});

test('No Autoplay sound permission applies without allowing the feature whitelist', () => {
  const settings = {
    noAutoplay: {
      enabled: true,
      permanentAudioAllowRules: ['*.music.example'],
      strongRules: [],
      whitelistRules: []
    }
  };
  const permanent = featureState(settings, FEATURE_IDS.NO_AUTOPLAY, 'https://play.music.example', false);
  assert.equal(permanent.active, true);
  assert.equal(permanent.audioAllowed, true);
  const temporary = featureState({}, FEATURE_IDS.NO_AUTOPLAY, 'https://radio.example', true);
  assert.equal(temporary.audioAllowed, true);
});

test('feature updates do not mutate the other product', () => {
  const current = normalizeSettings();
  const next = updateFeature(current, FEATURE_IDS.NATIVE_SCROLL, feature => ({ ...feature, enabled: false }));
  assert.equal(next.nativeScroll.enabled, false);
  assert.deepEqual(next.noAutoplay, current.noAutoplay);
});

test('only HTTP and HTTPS pages expose a hostname', () => {
  assert.equal(hostnameFromUrl('https://example.com/path'), 'example.com');
  assert.equal(hostnameFromUrl('chrome://extensions'), '');
});
