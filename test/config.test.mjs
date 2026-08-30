import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  anyCopyState,
  featureState,
  hostnameFromUrl,
  matchingRule,
  normalizeRule,
  normalizeSettings,
  ruleMatches,
  toggleRule,
  updateFeature
} from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';

test('all products start with independent site rule lists', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings().nativeScroll.enhancedRules, []);
  assert.deepEqual(normalizeSettings().noAutoplay.permanentAudioAllowRules, []);
  assert.deepEqual(normalizeSettings().anyCopy.enforcedRules, []);
  assert.deepEqual(normalizeSettings().videoDownload, { preferredQuality: 'best', askWhereToSave: true });
  assert.deepEqual(normalizeSettings().satellites.biliDailyLogin, { enabled: false, lastCompletedDate: '' });
});

test('rules are normalized, deduplicated, and sorted by feature', () => {
  const settings = normalizeSettings({
    nativeScroll: { whitelistRules: ['B.example.com', '*.example.com', 'b.example.com'] },
    noAutoplay: { enhancedRules: ['media.example.com'] },
    anyCopy: { enforcedRules: ['copy.example.com'] }
  });
  assert.deepEqual(settings.nativeScroll.whitelistRules, ['*.example.com', 'b.example.com']);
  assert.deepEqual(settings.noAutoplay.enhancedRules, ['media.example.com']);
  assert.deepEqual(settings.anyCopy.enforcedRules, ['copy.example.com']);
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

test('whitelist takes priority over site-specific Enhanced mode', () => {
  const state = featureState({
    nativeScroll: {
      enabled: true,
      whitelistRules: ['*.example.com'],
      enhancedRules: ['docs.example.com']
    }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(state.active, false);
  assert.equal(state.mode, 'standard');
  assert.equal(state.matchedWhitelistRule, '*.example.com');
  assert.equal(state.matchedEnhancedRule, 'docs.example.com');
});

test('Any Copy Enhanced rules can enable a site without a standard rule', () => {
  const directEnhanced = anyCopyState({
    anyCopy: { enforcedRules: [], enhancedRules: ['docs.example.com'] }
  }, 'https://docs.example.com/a');
  assert.equal(directEnhanced.active, true);
  assert.equal(directEnhanced.mode, 'enhanced');
  assert.equal(directEnhanced.exactEnforced, false);
  assert.equal(directEnhanced.exactEnhanced, true);

  const remainingEnhancedRules = toggleRule(directEnhanced.enhancedRules, 'docs.example.com');
  const off = anyCopyState({ anyCopy: { enforcedRules: [], enhancedRules: remainingEnhancedRules } }, 'https://docs.example.com/a');
  assert.equal(off.active, false);
});

test('Any Copy returns to standard when its standard rule remains', () => {
  const enhanced = anyCopyState({
    anyCopy: { enforcedRules: ['docs.example.com'], enhancedRules: ['docs.example.com'] }
  }, 'https://docs.example.com');
  assert.equal(enhanced.mode, 'enhanced');
  const standard = anyCopyState({
    anyCopy: { enforcedRules: ['docs.example.com'], enhancedRules: [] }
  }, 'https://docs.example.com');
  assert.equal(standard.active, true);
  assert.equal(standard.mode, 'standard');
});

test('No Autoplay sound permission applies without allowing the feature whitelist', () => {
  const settings = {
    noAutoplay: {
      enabled: true,
      permanentAudioAllowRules: ['*.music.example'],
      enhancedRules: [],
      whitelistRules: []
    }
  };
  const permanent = featureState(settings, FEATURE_IDS.NO_AUTOPLAY, 'https://play.music.example', false);
  assert.equal(permanent.active, true);
  assert.equal(permanent.audioAllowed, true);
  const temporary = featureState({}, FEATURE_IDS.NO_AUTOPLAY, 'https://radio.example', true);
  assert.equal(temporary.audioAllowed, true);
});

test('feature updates do not mutate other products', () => {
  const current = normalizeSettings();
  const next = updateFeature(current, FEATURE_IDS.NATIVE_SCROLL, feature => ({ ...feature, enabled: false }));
  assert.equal(next.nativeScroll.enabled, false);
  assert.deepEqual(next.noAutoplay, current.noAutoplay);
  assert.deepEqual(next.anyCopy, current.anyCopy);
  assert.deepEqual(next.satellites, current.satellites);
});

test('only HTTP and HTTPS pages expose a hostname', () => {
  assert.equal(hostnameFromUrl('https://example.com/path'), 'example.com');
  assert.equal(hostnameFromUrl('chrome://extensions'), '');
});

test('settings first-frame cache keeps preferences without page activity', () => {
  const cache = settingsViewCache({
    nativeScroll: {
      enabled: false,
      whitelistRules: ['example.com'],
      enhancedRules: ['*.docs.example'],
      hostname: 'private.example',
      active: true
    },
    noAutoplay: { enabled: true },
    anyCopy: { enforcedRules: ['copy.example'], enhancedRules: [] },
    videoDownload: { preferredQuality: '1080', askWhereToSave: false },
    satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '2026-08-30' } },
    activity: { nativeScroll: true }
  });
  assert.deepEqual(cache.nativeScroll, {
    enabled: false,
    whitelistRules: ['example.com'],
    enhancedRules: ['*.docs.example']
  });
  assert.deepEqual(cache.satellites, { biliDailyLogin: { enabled: true } });
  assert.deepEqual(cache.videoDownload, { preferredQuality: '1080', askWhereToSave: false });
  assert.equal('hostname' in cache.nativeScroll, false);
  assert.equal('activity' in cache, false);
});
