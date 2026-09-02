import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  adMarshalState,
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

test('incognito defaults keep every automatic product inactive', () => {
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.nativeScroll.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.noAutoplay.enabled, false);
  assert.deepEqual(DEFAULT_INCOGNITO_SETTINGS.anyCopy.siteRules, []);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.satellites.biliDailyLogin.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.adMarshal.sites.newsQqCom, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.adMarshal.sites.douyinCom, false);
});
import { settingsViewCache } from '../extension/core/settings-view-cache.js';

test('persistent products start with independent settings while Any Copy Enhanced has no site rules', () => {
  const settings = normalizeSettings();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(settings.nativeScroll.inactiveRules, []);
  assert.deepEqual(settings.nativeScroll.standardRules, []);
  assert.deepEqual(settings.nativeScroll.enhancedRules, []);
  assert.deepEqual(settings.nsna.whitelistRules, []);
  assert.equal(settings.noAutoplay.audioAutoplayAllSites, false);
  assert.deepEqual(settings.noAutoplay.permanentAudioAllowRules, []);
  assert.deepEqual(settings.anyCopy.siteRules, []);
  assert.deepEqual(settings.adMarshal, { sites: { newsQqCom: false, douyinCom: false } });
  assert.equal('anyCopyEnhanced' in settings, false);
  assert.deepEqual(settings.imageDownload, { workspaceMode: 'sidePanel', batchMode: 'zip', outputFormat: 'original', askWhereToSave: true });
  assert.deepEqual(settings.videoDownload, { preferredQuality: 'best', askWhereToSave: true });
  assert.deepEqual(settings.satellites.biliDailyLogin, { enabled: false, lastCompletedDate: '' });
});

test('website behavior rules are normalized, deduplicated, and sorted', () => {
  const settings = normalizeSettings({
    nativeScroll: { inactiveRules: ['B.example.com', '*.example.com', 'b.example.com'] },
    nsna: { whitelistRules: ['Private.example.com', '*.shared.example', 'private.example.com'] },
    noAutoplay: { enhancedRules: ['media.example.com'] },
    anyCopy: { siteRules: ['copy.example.com'] }
  });
  assert.deepEqual(settings.nativeScroll.inactiveRules, ['*.example.com', 'b.example.com']);
  assert.deepEqual(settings.nsna.whitelistRules, ['*.shared.example', 'private.example.com']);
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

test('shared NSNA whitelist takes priority over both product behavior rules', () => {
  const settings = {
    nsna: { whitelistRules: ['*.private.example'] },
    nativeScroll: { enabled: true, enhancedRules: ['app.private.example'] },
    noAutoplay: { enabled: true, standardRules: ['app.private.example'], audioAutoplayAllSites: true }
  };
  for (const featureId of [FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY]) {
    const state = featureState(settings, featureId, 'https://app.private.example');
    assert.equal(state.active, false);
    assert.equal(state.sharedWhitelisted, true);
    assert.equal(state.sharedWhitelistRule, '*.private.example');
    assert.equal(state.behaviorOverride, 'sharedWhitelist');
  }
  assert.equal(featureState(settings, FEATURE_IDS.NO_AUTOPLAY, 'https://app.private.example').audioAllowed, false);
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

test('Ad Marshal is limited to each enabled managed website', () => {
  assert.equal(adMarshalState(DEFAULT_SETTINGS, 'https://news.qq.com/').active, false);
  assert.equal(adMarshalState(DEFAULT_SETTINGS, 'https://www.douyin.com/jingxuan').active, false);
  assert.equal(adMarshalState(DEFAULT_SETTINGS, 'https://www.qq.com/').active, false);
  assert.equal(adMarshalState({ version: 17, adMarshal: { sites: { newsQqCom: true } } }, 'https://news.qq.com/').active, true);
  assert.equal(adMarshalState({ version: 17, adMarshal: { sites: { newsQqCom: true } } }, 'https://www.qq.com/').active, true);
  assert.equal(adMarshalState({ version: 17, adMarshal: { sites: { newsQqCom: true } } }, 'https://video.qq.com/').active, false);
  const douyin = adMarshalState({ version: 17, adMarshal: { sites: { douyinCom: true } } }, 'https://www.douyin.com/jingxuan');
  assert.equal(douyin.active, true);
  assert.equal(douyin.siteId, 'douyinCom');
  assert.equal(adMarshalState({ version: 17, adMarshal: { sites: { douyinCom: true } } }, 'https://live.douyin.com/').active, false);
  assert.equal(normalizeSettings({ version: 16, adMarshal: { sites: { newsQqCom: true } } }).adMarshal.sites.newsQqCom, true);
});

test('settings first-frame cache keeps preferences without page activity', () => {
  const cache = settingsViewCache({
    nsna: { whitelistRules: ['*.private.example'] },
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
    adMarshal: { sites: { newsQqCom: true, douyinCom: true } },
    activity: { nativeScroll: true }
  });
  assert.deepEqual(cache.nativeScroll, {
    enabled: false,
    inactiveRules: ['example.com'],
    enhancedRules: ['*.docs.example'],
    standardRules: ['read.example']
  });
  assert.deepEqual(cache.nsna, { whitelistRules: ['*.private.example'] });
  assert.deepEqual(cache.satellites, { biliDailyLogin: { enabled: true } });
  assert.deepEqual(cache.adMarshal, { sites: { newsQqCom: true, douyinCom: true } });
  assert.equal(cache.noAutoplay.audioAutoplayAllSites, true);
  assert.deepEqual(cache.anyCopy, { siteRules: ['copy.example'] });
  assert.equal('anyCopyEnhanced' in cache, false);
  assert.deepEqual(cache.imageDownload, { workspaceMode: 'page', batchMode: 'separate', outputFormat: 'png', askWhereToSave: false });
  assert.deepEqual(cache.videoDownload, { preferredQuality: '1080', askWhereToSave: false });
  assert.equal('hostname' in cache.nativeScroll, false);
  assert.equal('activity' in cache, false);
});
