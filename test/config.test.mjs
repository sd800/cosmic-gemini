import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  DEFAULT_SETTINGS,
  FEATURE_IDS,
  adMarshalState,
  anyCopyEnhancedState,
  anyCopyState,
  chineseResponseClaudeState,
  featureState,
  hostnameFromUrl,
  isIpAddress,
  mailtoCaptureState,
  matchingRule,
  normalizeRule,
  normalizeSettings,
  pageDisplayState,
  ruleMatches,
  updateFeature,
  xhsImageDarkModeState
} from '../extension/core/config.js';

test('incognito defaults keep every automatic product inactive', () => {
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.nativeScroll.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.noAutoplay.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.mailtoCapture.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.pageDisplay.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.pageDisplay.reduceWhitePoint.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.pageDisplay.greyscale.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.xhsImageDarkMode.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.chineseResponseClaude.enabled, false);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.chineseResponseClaude.browserIdentityEnabled, false);
  assert.deepEqual(DEFAULT_INCOGNITO_SETTINGS.anyCopy.siteRules, []);
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.satellites.biliDailyLogin.enabled, false);
  assert.equal(Object.values(DEFAULT_INCOGNITO_SETTINGS.adMarshal.managedSites).some(Boolean), false);
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
  assert.deepEqual(settings.mailtoCapture, { enabled: true });
  assert.deepEqual(settings.accessControl, { enabled: false, blockedDomains: [] });
  assert.deepEqual(settings.pageDisplay, {
    enabled: false,
    reduceWhitePoint: { enabled: false, reduction: 0.25 },
    greyscale: { enabled: false }
  });
  assert.deepEqual(settings.xhsImageDarkMode, {
    enabled: false,
    overrideDarkMode: false,
    showImageControl: true,
    controlOpacity: 0.5
  });
  assert.deepEqual(settings.adMarshal, {
    managedSites: { tencentNews: false, zhihu: false }
  });
  assert.equal('anyCopyEnhanced' in settings, false);
  assert.deepEqual(settings.imageDownload, { workspaceMode: 'sidePanel', batchMode: 'zip', outputFormat: 'original', askWhereToSave: true });
  assert.deepEqual(settings.videoDownload, { preferredQuality: 'best', askWhereToSave: true });
  assert.deepEqual(settings.satellites.biliDailyLogin, { enabled: false, lastCompletedDate: '' });
});

test('user-maintained domain rules are normalized, deduplicated, and kept in insertion order', () => {
  const settings = normalizeSettings({
    nativeScroll: { inactiveRules: ['B.example.com', '*.example.com', 'b.example.com'] },
    nsna: { whitelistRules: ['Private.example.com', '*.shared.example', 'private.example.com'] },
    noAutoplay: { enhancedRules: ['media.example.com'] },
    anyCopy: { siteRules: ['copy.example.com'] }
  });
  assert.deepEqual(settings.nativeScroll.inactiveRules, ['b.example.com', '*.example.com']);
  assert.deepEqual(settings.nsna.whitelistRules, ['private.example.com', '*.shared.example']);
  assert.deepEqual(settings.noAutoplay.enhancedRules, ['media.example.com']);
  assert.deepEqual(settings.anyCopy.siteRules, ['copy.example.com']);
});

test('deprecated activation and mode fields are ignored', () => {
  const settings = normalizeSettings({
    version: 1,
    enabled: false,
    whitelist: ['root.example.com'],
    nativeScroll: {
      enabledRules: ['enabled.example.com', 'enhanced.example.com'],
      whitelistRules: ['inactive.example.com', 'conflict.example.com'],
      standardRules: ['standard.example.com', 'conflict.example.com'],
      enhancedRules: ['enhanced.example.com', 'standard.example.com', 'conflict.example.com']
    }
  });
  assert.equal(settings.nativeScroll.enabled, true);
  assert.deepEqual(settings.nativeScroll.inactiveRules, []);
  assert.deepEqual(settings.nativeScroll.standardRules, ['standard.example.com', 'conflict.example.com']);
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
  for (const input of ['https://example.com', 'example.com/path', 'example.com:443', 'example.com:80',
    'a.*.example.com', '*.localhost', '*.127.0.0.1', '*.[2001:db8::1]', 'example.com\\', '%65xample.com',
    '0x7f.0.0.1', '001.2.3.4', '256.1.1.1', '2001:db8::zz', '[2001:db8::1]:443',
    '-bad.example', 'bad-.example', 'a..example', 'user@example.com']) {
    assert.throws(() => normalizeRule(input));
  }
});

test('exact IPv4 and IPv6 rules match their host across ports', () => {
  const ipv4 = '192.0.2.15';
  const ipv6 = '[2001:db8::f]';
  assert.equal(normalizeRule(ipv4), ipv4);
  assert.equal(normalizeRule('2001:0db8:0:0:0:0:0:000f'), ipv6);
  assert.equal(normalizeRule(ipv6), ipv6);
  assert.equal(isIpAddress(ipv4), true);
  assert.equal(isIpAddress(ipv6), true);
  assert.equal(isIpAddress('example.com'), false);
  assert.equal(ruleMatches(ipv4, ipv4), true);
  assert.equal(ruleMatches('2001:db8::f', ipv6), true);
  assert.equal(hostnameFromUrl(`http://${ipv4}:8080/path`), ipv4);
  assert.equal(hostnameFromUrl(`https://${ipv6}:8443/path`), ipv6);

  const settings = normalizeSettings({
    nativeScroll: { inactiveRules: [ipv4, ipv6] },
    anyCopy: { siteRules: [ipv4, ipv6] }
  });
  for (const url of [`http://${ipv4}:8080/path`, `https://${ipv6}:8443/path`]) {
    assert.equal(featureState(settings, FEATURE_IDS.NATIVE_SCROLL, url).active, false);
    assert.equal(anyCopyState(settings, url).active, true);
  }
});

test('numeric-leading domains and internationalized hostnames survive saving and matching', () => {
  for (const hostname of ['163.com', '12306.cn', '例子.公司.cn']) {
    const canonical = new URL('https://' + hostname).hostname;
    assert.equal(normalizeRule(hostname), canonical);
    const rule = normalizeRule('*.' + hostname);
    assert.equal(rule, '*.' + canonical);
    const settings = normalizeSettings({ nsna: { whitelistRules: [rule] } });
    assert.deepEqual(settings.nsna.whitelistRules, [rule]);
    for (const host of [hostname, 'www.' + hostname]) {
      assert.equal(featureState(settings, 'nativeScroll', 'https://' + host).active, false);
      assert.equal(featureState(settings, 'noAutoplay', 'https://' + host).active, false);
    }
    assert.equal(featureState(settings, 'nativeScroll', 'https://not' + hostname).active, true);
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

test('deprecated Any Copy website fields are ignored', () => {
  const settings = normalizeSettings({
    version: 9,
    anyCopy: { enforcedRules: ['copy.example.com'], enhancedRules: ['reader.example.com'] }
  });
  assert.deepEqual(settings.anyCopy.siteRules, []);
  assert.equal('anyCopyEnhanced' in settings, false);
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

test('saved settings switches remain independent from effective page state', () => {
  const nativeScroll = featureState({
    nativeScroll: { enabled: false, standardRules: ['enabled.example'] }
  }, FEATURE_IDS.NATIVE_SCROLL, 'https://enabled.example');
  assert.equal(nativeScroll.enabled, false);
  assert.equal(nativeScroll.active, true);

  const noAutoplay = featureState({
    noAutoplay: {
      enabled: true,
      inactiveRules: ['disabled.example'],
      audioAutoplayAllSites: true
    }
  }, FEATURE_IDS.NO_AUTOPLAY, 'https://disabled.example');
  assert.equal(noAutoplay.enabled, true);
  assert.equal(noAutoplay.active, false);
  assert.equal(noAutoplay.audioAutoplayAllSites, true);

  const adMarshal = adMarshalState({ adMarshal: { managedSites: { unknown: true } } }, 'https://example.com');
  assert.equal(adMarshal.enabled, false);
  assert.equal(adMarshal.supported, false);
  assert.equal(adMarshal.active, false);
});

test('only HTTP and HTTPS pages expose a hostname', () => {
  assert.equal(hostnameFromUrl('https://example.com/path'), 'example.com');
  assert.equal(hostnameFromUrl('chrome://extensions'), '');
});

test('Mailto Capture follows its ordinary and incognito defaults without website rules', () => {
  const ordinary = mailtoCaptureState(DEFAULT_SETTINGS, 'https://example.com/page');
  assert.equal(ordinary.enabled, true);
  assert.equal(ordinary.active, true);
  assert.equal(ordinary.hostname, 'example.com');
  assert.equal(mailtoCaptureState(DEFAULT_INCOGNITO_SETTINGS, 'https://example.com/page').active, false);
  assert.equal(mailtoCaptureState({ mailtoCapture: { enabled: false } }, 'https://example.com/page').active, false);
  assert.equal(mailtoCaptureState(DEFAULT_SETTINGS, 'chrome://extensions').active, false);
});

test('Claude reply display and browser identity settings authorize independently', () => {
  const disabled = chineseResponseClaudeState(DEFAULT_SETTINGS, 'https://claude.ai/new');
  assert.equal(disabled.supported, true);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.active, false);
  const enabled = { chineseResponseClaude: { enabled: true } };
  assert.equal(chineseResponseClaudeState(enabled, 'https://claude.ai/chat/example').active, true);
  assert.equal(chineseResponseClaudeState(enabled, 'https://www.claude.ai/').supported, true);
  assert.equal(chineseResponseClaudeState(enabled, 'https://www.claude.ai/').responseDisplay, false);
  assert.equal(chineseResponseClaudeState(enabled, 'https://console.anthropic.com/').active, false);
  assert.equal(chineseResponseClaudeState(enabled, 'https://claude.ai/chat/example').responseDisplay, true);
  const identityEnabled = { chineseResponseClaude: { browserIdentityEnabled: true } };
  assert.equal(chineseResponseClaudeState(identityEnabled, 'https://anthropic.com/').active, true);
  assert.equal(chineseResponseClaudeState(identityEnabled, 'https://platform.claude.com/docs/').active, true);
  assert.equal(chineseResponseClaudeState(identityEnabled, 'https://claude.ai/chat/example').responseDisplay, false);
  assert.equal(chineseResponseClaudeState(identityEnabled, 'https://claude.ai/chat/example').browserIdentityActive, true);
  const retained = chineseResponseClaudeState(DEFAULT_SETTINGS, 'https://console.anthropic.com/', {
    browserIdentityRetained: true
  });
  assert.equal(retained.browserIdentityActive, true);
  assert.equal(retained.browserIdentityRetained, true);
  assert.equal(chineseResponseClaudeState(enabled, 'https://notclaude.ai/').active, false);
  assert.equal(chineseResponseClaudeState(enabled, 'chrome://extensions').active, false);
});

test('Page Display features are independent, bounded, and limited to ordinary web pages', () => {
  assert.deepEqual(pageDisplayState(DEFAULT_SETTINGS, 'https://example.com/page'), {
    enabled: false,
    reduceWhitePoint: { enabled: false, reduction: 0.25 },
    greyscale: { enabled: false },
    hostname: 'example.com',
    supported: true,
    active: false
  });
  const enabled = pageDisplayState({
    pageDisplay: {
      enabled: true,
      reduceWhitePoint: { enabled: true, reduction: 0.45 },
      greyscale: { enabled: false }
    }
  }, 'http://example.com/page');
  assert.equal(enabled.active, true);
  assert.equal(enabled.reduceWhitePoint.reduction, 0.45);
  assert.equal(pageDisplayState({
    pageDisplay: { reduceWhitePoint: { enabled: true, reduction: 10 } }
  }, 'https://example.com').reduceWhitePoint.reduction, 0.8);
  assert.equal(pageDisplayState({
    pageDisplay: { reduceWhitePoint: { enabled: true, reduction: 0 } }
  }, 'https://example.com').reduceWhitePoint.reduction, 0.1);
  assert.equal(pageDisplayState({
    pageDisplay: { enabled: true, greyscale: { enabled: true } }
  }, 'https://example.com').active, true);
  assert.equal(pageDisplayState({
    pageDisplay: { enabled: false, greyscale: { enabled: true } }
  }, 'https://example.com').active, false);
  assert.equal(pageDisplayState({
    pageDisplay: { reduceWhitePoint: { enabled: true } }
  }, 'chrome://extensions').active, false);
});

test('XHS Image Dark Mode is exact-host, opt-in, and dark-page gated', () => {
  const disabled = xhsImageDarkModeState(DEFAULT_SETTINGS, 'https://www.xiaohongshu.com/explore');
  assert.equal(disabled.supported, true);
  assert.equal(disabled.active, false);

  const enabled = { xhsImageDarkMode: { enabled: true } };
  assert.equal(xhsImageDarkModeState(enabled, 'https://xiaohongshu.com/explore').supported, false);
  assert.equal(xhsImageDarkModeState(enabled, 'https://sub.www.xiaohongshu.com/explore').supported, false);
  const waiting = xhsImageDarkModeState(enabled, 'https://www.xiaohongshu.com/explore', {
    darkModeDetected: false,
    processing: false
  });
  assert.equal(waiting.active, true);
  assert.equal(waiting.processing, false);
  assert.equal(waiting.intervened, false);
  const processing = xhsImageDarkModeState(enabled, 'https://www.xiaohongshu.com/explore', {
    darkModeDetected: true,
    processing: false,
    intervened: false
  });
  assert.equal(processing.processing, true);
  assert.equal(processing.intervened, false);
  const intervened = xhsImageDarkModeState(enabled, 'https://www.xiaohongshu.com/explore', {
    darkModeDetected: true,
    processing: true,
    intervened: true
  });
  assert.equal(intervened.processing, true);
  assert.equal(intervened.intervened, true);

  const override = xhsImageDarkModeState({
    xhsImageDarkMode: { enabled: true, overrideDarkMode: true }
  }, 'https://www.xiaohongshu.com/explore');
  assert.equal(override.active, true);
  assert.equal(override.overrideDarkMode, true);
  assert.equal(override.processing, true);
  assert.equal(override.intervened, false);
  assert.equal(override.status, 'active');
});

test('Ad Marshal enables only explicitly selected managed-site groups', () => {
  assert.equal(adMarshalState(DEFAULT_SETTINGS, 'https://news.qq.com/').active, false);
  assert.equal(adMarshalState(DEFAULT_SETTINGS, 'https://www.qq.com/').active, false);
  const selected = { adMarshal: { managedSites: { tencentNews: true, zhihu: true } } };
  const newsQq = adMarshalState(selected, 'https://news.qq.com/');
  assert.equal(newsQq.active, true);
  assert.equal(newsQq.siteId, 'newsQqCom');
  assert.equal(newsQq.settingId, 'tencentNews');
  const newsTimeline = adMarshalState(selected, 'https://view.inews.qq.com/timeline/example');
  assert.equal(newsTimeline.active, true);
  assert.equal(newsTimeline.siteId, 'newsQqCom');
  const wwwQq = adMarshalState(selected, 'https://www.qq.com/');
  assert.equal(wwwQq.active, true);
  assert.equal(wwwQq.siteId, 'wwwQqCom');
  assert.equal(adMarshalState(selected, 'https://video.qq.com/').active, false);
  assert.equal(adMarshalState(selected, 'https://video.qq.com/').enabled, true);
  const zhihu = adMarshalState(selected, 'https://www.zhihu.com/');
  assert.equal(zhihu.active, true);
  assert.equal(zhihu.siteId, 'zhihuCom');
  assert.equal(adMarshalState(selected, 'https://zhuanlan.zhihu.com/p/1').active, true);
  assert.equal(adMarshalState(selected, 'https://zhimg.com/').active, false);
  const settingsState = adMarshalState(selected, '');
  assert.equal(settingsState.enabled, true);
  assert.equal(settingsState.supported, false);
  assert.equal(settingsState.active, false);
  assert.deepEqual(normalizeSettings({
    adMarshal: {
      enabled: true,
      sites: { newsQqCom: true }
    }
  }).adMarshal, { managedSites: { tencentNews: false, zhihu: false } });
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
    mailtoCapture: { enabled: false, active: true },
    accessControl: { enabled: true, blockedDomains: ['z.example', 'a.example', 'z.example'] },
    chineseResponseClaude: { enabled: true, browserIdentityEnabled: true, active: false },
    pageDisplay: {
      enabled: true,
      reduceWhitePoint: { enabled: true, reduction: 0.4 },
      greyscale: { enabled: true },
      active: true
    },
    imageDownload: { workspaceMode: 'page', batchMode: 'separate', outputFormat: 'png', askWhereToSave: false },
    videoDownload: { preferredQuality: '1080', askWhereToSave: false },
    satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '2026-08-30' } },
    adMarshal: { managedSites: { tencentNews: true } },
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
  assert.deepEqual(cache.adMarshal, {
    managedSites: { tencentNews: true, zhihu: false }
  });
  assert.equal(cache.noAutoplay.audioAutoplayAllSites, true);
  assert.deepEqual(cache.anyCopy, { siteRules: ['copy.example'] });
  assert.deepEqual(cache.mailtoCapture, { enabled: false });
  assert.deepEqual(cache.accessControl, { enabled: true, blockedDomains: ['z.example', 'a.example'] });
  assert.deepEqual(cache.chineseResponseClaude, { enabled: true, browserIdentityEnabled: true });
  assert.deepEqual(cache.pageDisplay, {
    enabled: true,
    reduceWhitePoint: { enabled: true, reduction: 0.4 },
    greyscale: { enabled: true }
  });
  assert.equal('anyCopyEnhanced' in cache, false);
  assert.deepEqual(cache.imageDownload, { workspaceMode: 'page', batchMode: 'separate', outputFormat: 'png', askWhereToSave: false });
  assert.deepEqual(cache.videoDownload, { preferredQuality: '1080', askWhereToSave: false });
  assert.equal('hostname' in cache.nativeScroll, false);
  assert.equal('activity' in cache, false);
});
