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

test('persistent products start with independent settings while Any Copy Enhanced has no site rules', () => {
  const settings = normalizeSettings();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(settings.nativeScroll.inactiveRules, []);
  assert.deepEqual(settings.nativeScroll.standardRules, []);
  assert.deepEqual(settings.nativeScroll.enhancedRules, []);
  assert.equal(settings.noAutoplay.audioAutoplayAllSites, false);
  assert.deepEqual(settings.noAutoplay.permanentAudioAllowRules, []);
  assert.deepEqual(settings.anyCopy.siteRules, []);
  assert.equal('anyCopyEnhanced' in settings, false);
  assert.deepEqual(settings.imageDownload, { workspaceMode: 'sidePanel', batchMode: 'zip', outputFormat: 'original', askWhereToSave: true });
  assert.deepEqual(settings.videoDownload, { preferredQuality: 'best', askWhereToSave: true });
  assert.deepEqual(settings.satellites.biliDailyLogin, { enabled: false, lastCompletedDate: '' });
});

test('website behavior rules are normalized, deduplicated, and sorted', () => {
  const settings = normalizeSettings({
    nativeScroll: { inactiveRules: ['B.example.com', '*.example.com', 'b.example.com'] },
    noAutoplay: { enhancedRules: ['media.example.com'] },
    anyCopy: { siteRules: ['copy.example.com'] }
  });
  assert.deepEqual(settings.nativeScroll.inactiveRules, ['*.example.com', 'b.example.com']);
  assert.deepEqual(settings.noAutoplay.enhancedRules, ['media.example.com']);
  assert.deepEqual(settings.anyCopy.siteRules, ['copy.example.com']);
});

test('legacy activation and mode lists migrate into one behavior per rule', () => {
  const settings = normalizeSettings({
    nativeScroll: {
      enabledRules: ['enabled.example.com', 'enhanced.example.com'],
      whitelistRules: ['inactive.example.com', 'conflict.example.com'],
      standardRules: ['standard.example.com', 'conflict.example.com'],
      enhancedRules: ['enhanced.example.com', 'standard.example.com', 'conflict.example.com']
    }
  });
  assert.deepEqual(settings.nativeScroll.inactiveRules, ['conflict.example.com', 'inactive.example.com']);
  assert.deepEqual(settings.nativeScroll.standardRules, ['enabled.example.com', 'standard.example.com']);
  assert.deepEqual(settings.nativeScroll.enhancedRules, ['enhanced.example.com']);
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

test('inactive behavior overrides broader Enhanced behavior when it is more specific', () => {
  const state = featureState({
    nativeScroll: {
      enabled: true,
      inactiveRules: ['docs.example.com'],
      enhancedRules: ['*.example.com']
    }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(state.active, false);
  assert.equal(state.behavior, 'inactive');
  assert.equal(state.behaviorRule, 'docs.example.com');
});

test('Standard behavior overrides broader Enhanced behavior', () => {
  const state = featureState({
    nativeScroll: {
      enabled: true,
      enhancedRules: ['*.example.com'],
      standardRules: ['docs.example.com']
    }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://docs.example.com/a');
  assert.equal(state.active, true);
  assert.equal(state.mode, 'standard');
  assert.equal(state.behaviorOverride, 'standard');
  assert.equal(state.exactBehaviorOverride, true);
});

test('Standard and Enhanced rules activate a site even when the global default is off', () => {
  const standard = featureState({
    nativeScroll: { enabled: false, standardRules: ['standard.example.com'] }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://standard.example.com');
  assert.equal(standard.active, true);
  assert.equal(standard.mode, 'standard');

  const enhanced = featureState({
    nativeScroll: { enabled: false, enhancedRules: ['enhanced.example.com'] }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://enhanced.example.com');
  assert.equal(enhanced.active, true);
  assert.equal(enhanced.mode, 'enhanced');
});

test('unlisted sites follow the global default', () => {
  const active = featureState({ nativeScroll: { enabled: true } }, FEATURE_IDS.NATIVE_SCROLL, 'https://example.com');
  assert.equal(active.active, true);
  assert.equal(active.mode, 'standard');
  assert.equal(active.behaviorOverride, '');

  const inactive = featureState({ nativeScroll: { enabled: false } }, FEATURE_IDS.NATIVE_SCROLL, 'https://example.com');
  assert.equal(inactive.active, false);
  assert.equal(inactive.behavior, 'inactive');
  assert.equal(inactive.exactBehaviorOverride, false);
});

test('Any Copy and current-tab Any Copy Enhanced activate independently', () => {
  const directEnhanced = anyCopyEnhancedState('https://docs.example.com/a', true);
  assert.equal(directEnhanced.active, true);
  assert.equal(directEnhanced.exactActive, true);
  assert.equal(directEnhanced.scope, 'tab');
  assert.equal(anyCopyState({ anyCopy: { siteRules: ['docs.example.com'] } }, 'https://docs.example.com').active, true);
  assert.equal(anyCopyEnhancedState('https://docs.example.com', false).active, false);
});

test('legacy Any Copy rules keep standard activation and discard Enhanced website scope', () => {
  const migrated = normalizeSettings({
    version: 9,
    anyCopy: { enforcedRules: ['copy.example.com'], enhancedRules: ['reader.example.com'] }
  });
  assert.deepEqual(migrated.anyCopy.siteRules, ['copy.example.com']);
  assert.equal('anyCopyEnhanced' in migrated, false);
});

test('No Autoplay audio permission applies only while No Autoplay is active', () => {
  const settings = {
    noAutoplay: {
      enabled: true,
      permanentAudioAllowRules: ['*.music.example'],
      inactiveRules: ['quiet.music.example']
    }
  };
  const allowed = featureState(settings, FEATURE_IDS.NO_AUTOPLAY, 'https://play.music.example');
  assert.equal(allowed.active, true);
  assert.equal(allowed.audioAllowed, true);
  const inactive = featureState(settings, FEATURE_IDS.NO_AUTOPLAY, 'https://quiet.music.example');
  assert.equal(inactive.active, false);
  assert.equal(inactive.audioAllowed, false);
  assert.equal(featureState({}, FEATURE_IDS.NO_AUTOPLAY, 'https://radio.example').audioAllowed, false);
  assert.equal(featureState({ noAutoplay: { audioAutoplayAllSites: true } }, FEATURE_IDS.NO_AUTOPLAY, 'https://radio.example').audioAllowed, true);
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
      inactiveRules: ['example.com'],
      enhancedRules: ['*.docs.example'],
      standardRules: ['read.example'],
      hostname: 'private.example',
      active: true
    },
    noAutoplay: { enabled: true, audioAutoplayAllSites: true },
    anyCopy: { siteRules: ['copy.example'] },
    imageDownload: { workspaceMode: 'page', batchMode: 'separate', outputFormat: 'png', askWhereToSave: false },
    videoDownload: { preferredQuality: '1080', askWhereToSave: false },
    satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '2026-08-30' } },
    activity: { nativeScroll: true }
  });
  assert.deepEqual(cache.nativeScroll, {
    enabled: false,
    inactiveRules: ['example.com'],
    enhancedRules: ['*.docs.example'],
    standardRules: ['read.example']
  });
  assert.deepEqual(cache.satellites, { biliDailyLogin: { enabled: true } });
  assert.equal(cache.noAutoplay.audioAutoplayAllSites, true);
  assert.deepEqual(cache.anyCopy, { siteRules: ['copy.example'] });
  assert.equal('anyCopyEnhanced' in cache, false);
  assert.deepEqual(cache.imageDownload, { workspaceMode: 'page', batchMode: 'separate', outputFormat: 'png', askWhereToSave: false });
  assert.deepEqual(cache.videoDownload, { preferredQuality: '1080', askWhereToSave: false });
  assert.equal('hostname' in cache.nativeScroll, false);
  assert.equal('activity' in cache, false);
});
