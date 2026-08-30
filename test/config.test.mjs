import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  anyCopyEnhancedState,
  anyCopyState,
  featureState,
  hostnameFromUrl,
  matchingRule,
  normalizeRule,
  normalizeSettings,
  ruleMatches,
  updateFeature
} from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';

test('all products start with independent site rule lists', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings().nativeScroll.enabledRules, []);
  assert.deepEqual(normalizeSettings().nativeScroll.enhancedRules, []);
  assert.deepEqual(normalizeSettings().nativeScroll.standardRules, []);
  assert.equal(normalizeSettings().noAutoplay.audioAutoplayAllSites, false);
  assert.deepEqual(normalizeSettings().noAutoplay.permanentAudioAllowRules, []);
  assert.deepEqual(normalizeSettings().anyCopy.siteRules, []);
  assert.deepEqual(normalizeSettings().anyCopyEnhanced.siteRules, []);
  assert.deepEqual(normalizeSettings().imageDownload, { workspaceMode: 'sidePanel', batchMode: 'zip', outputFormat: 'original', askWhereToSave: true });
  assert.deepEqual(normalizeSettings().videoDownload, { preferredQuality: 'best', askWhereToSave: true });
  assert.deepEqual(normalizeSettings().satellites.biliDailyLogin, { enabled: false, lastCompletedDate: '' });
});

test('rules are normalized, deduplicated, and sorted by feature', () => {
  const settings = normalizeSettings({
    nativeScroll: { whitelistRules: ['B.example.com', '*.example.com', 'b.example.com'] },
    noAutoplay: { enhancedRules: ['media.example.com'] },
    anyCopy: { siteRules: ['copy.example.com'] },
    anyCopyEnhanced: { siteRules: ['reader.example.com'] }
  });
  assert.deepEqual(settings.nativeScroll.whitelistRules, ['*.example.com', 'b.example.com']);
  assert.deepEqual(settings.noAutoplay.enhancedRules, ['media.example.com']);
  assert.deepEqual(settings.anyCopy.siteRules, ['copy.example.com']);
  assert.deepEqual(settings.anyCopyEnhanced.siteRules, ['reader.example.com']);
});

test('exact and wildcard rules match their intended hostnames', () => {
  assert.equal(ruleMatches('example.com', 'example.com'), true);
  assert.equal(ruleMatches('www.example.com', 'example.com'), false);
  assert.equal(ruleMatches('example.com', '*.example.com'), true);
  assert.equal(ruleMatches('a.b.example.com', '*.example.com'), true);
  assert.equal(ruleMatches('notexample.com', '*.example.com'), false);
  assert.equal(matchingRule('news.example.com', ['other.com', '*.example.com']), '*.example.com');
  assert.equal(matchingRule('news.example.com', ['*.example.com', 'news.example.com']), 'news.example.com');
  assert.equal(matchingRule('news.media.example.com', ['*.example.com', '*.media.example.com']), '*.media.example.com');
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

test('current-site activation overrides the global default and broader rules', () => {
  const enabled = featureState({
    nativeScroll: {
      enabled: false,
      enabledRules: ['docs.example.com'],
      whitelistRules: ['*.example.com']
    }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(enabled.active, true);
  assert.equal(enabled.activationOverride, 'enabled');
  assert.equal(enabled.exactActivationOverride, true);

  const disabled = featureState({
    nativeScroll: { enabled: true, whitelistRules: ['docs.example.com'] }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(disabled.active, false);
  assert.equal(disabled.activationOverride, 'disabled');
});

test('current-site Standard mode overrides broader Enhanced mode', () => {
  const state = featureState({
    nativeScroll: {
      enabled: true,
      enhancedRules: ['*.example.com'],
      standardRules: ['docs.example.com']
    }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(state.active, true);
  assert.equal(state.mode, 'standard');
  assert.equal(state.modeOverride, 'standard');
  assert.equal(state.exactModeOverride, true);
});

test('safer opposing rule wins when both lists contain the same scope', () => {
  const state = featureState({
    nativeScroll: {
      enabled: true,
      enabledRules: ['docs.example.com'],
      whitelistRules: ['docs.example.com'],
      enhancedRules: ['docs.example.com'],
      standardRules: ['docs.example.com']
    }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(state.active, false);
  assert.equal(state.activationOverride, 'disabled');
  assert.equal(state.modeOverride, 'standard');
});

test('Any Copy and Any Copy Enhanced activate independently', () => {
  const directEnhanced = anyCopyEnhancedState({
    anyCopy: { siteRules: [] },
    anyCopyEnhanced: { siteRules: ['docs.example.com'] }
  }, 'https://docs.example.com/a');
  assert.equal(directEnhanced.active, true);
  assert.equal(directEnhanced.exactActive, true);

  const standard = anyCopyState({
    anyCopy: { siteRules: ['docs.example.com'] },
    anyCopyEnhanced: { siteRules: [] }
  }, 'https://docs.example.com');
  assert.equal(standard.active, true);
  const enhancedOff = anyCopyEnhancedState({
    anyCopy: { siteRules: ['docs.example.com'] },
    anyCopyEnhanced: { siteRules: [] }
  }, 'https://docs.example.com');
  assert.equal(enhancedOff.active, false);
});

test('legacy Any Copy rules migrate into isolated products', () => {
  const migrated = normalizeSettings({
    version: 9,
    anyCopy: {
      enforcedRules: ['copy.example.com'],
      enhancedRules: ['reader.example.com']
    }
  });
  assert.deepEqual(migrated.anyCopy.siteRules, ['copy.example.com']);
  assert.deepEqual(migrated.anyCopyEnhanced.siteRules, ['reader.example.com']);
});

test('No Autoplay audio autoplay permission applies without allowing the feature whitelist', () => {
  const settings = {
    noAutoplay: {
      enabled: true,
      permanentAudioAllowRules: ['*.music.example'],
      enhancedRules: [],
      whitelistRules: []
    }
  };
  const permanent = featureState(settings, FEATURE_IDS.NO_AUTOPLAY, 'https://play.music.example');
  assert.equal(permanent.active, true);
  assert.equal(permanent.audioAllowed, true);
  const blocked = featureState({}, FEATURE_IDS.NO_AUTOPLAY, 'https://radio.example');
  assert.equal(blocked.audioAllowed, false);
  const global = featureState({ noAutoplay: { audioAutoplayAllSites: true } }, FEATURE_IDS.NO_AUTOPLAY, 'https://radio.example');
  assert.equal(global.audioAllowed, true);
});

test('No Autoplay whitelist disables all media blocking', () => {
  const state = featureState({
    noAutoplay: {
      enabled: true,
      whitelistRules: ['*.media.example'],
      enhancedRules: ['play.media.example'],
      permanentAudioAllowRules: []
    }
  }, FEATURE_IDS.NO_AUTOPLAY, 'https://play.media.example/watch');
  assert.equal(state.active, false);
  assert.equal(state.mode, 'standard');
  assert.equal(state.matchedWhitelistRule, '*.media.example');
});

test('feature updates do not mutate other products', () => {
  const current = normalizeSettings();
  const next = updateFeature(current, FEATURE_IDS.NATIVE_SCROLL, feature => ({ ...feature, enabled: false }));
  assert.equal(next.nativeScroll.enabled, false);
  assert.deepEqual(next.noAutoplay, current.noAutoplay);
  assert.deepEqual(next.anyCopy, current.anyCopy);
  assert.deepEqual(next.anyCopyEnhanced, current.anyCopyEnhanced);
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
    noAutoplay: { enabled: true, audioAutoplayAllSites: true },
    anyCopy: { siteRules: ['copy.example'] },
    anyCopyEnhanced: { siteRules: ['reader.example'] },
    imageDownload: { workspaceMode: 'page', batchMode: 'separate', outputFormat: 'png', askWhereToSave: false },
    videoDownload: { preferredQuality: '1080', askWhereToSave: false },
    satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '2026-08-30' } },
    activity: { nativeScroll: true }
  });
  assert.deepEqual(cache.nativeScroll, {
    enabled: false,
    enabledRules: [],
    whitelistRules: ['example.com'],
    enhancedRules: ['*.docs.example'],
    standardRules: []
  });
  assert.deepEqual(cache.satellites, { biliDailyLogin: { enabled: true } });
  assert.equal(cache.noAutoplay.audioAutoplayAllSites, true);
  assert.deepEqual(cache.anyCopy, { siteRules: ['copy.example'] });
  assert.deepEqual(cache.anyCopyEnhanced, { siteRules: ['reader.example'] });
  assert.deepEqual(cache.imageDownload, { workspaceMode: 'page', batchMode: 'separate', outputFormat: 'png', askWhereToSave: false });
  assert.deepEqual(cache.videoDownload, { preferredQuality: '1080', askWhereToSave: false });
  assert.equal('hostname' in cache.nativeScroll, false);
  assert.equal('activity' in cache, false);
});
