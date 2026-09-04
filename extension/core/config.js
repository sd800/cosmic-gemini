export const SETTINGS_KEY = 'cosmicGeminiSettings';
export const LEGACY_SETTINGS_KEY = 'settings';
export const INCOGNITO_SETTINGS_KEY = 'cosmicGeminiIncognitoSettings';
export const INCOGNITO_LOCALE_KEY = 'cosmicGeminiIncognitoLocale';
export const INCOGNITO_WINDOWS_KEY = 'cosmicGeminiIncognitoWindowIds';

export const FEATURE_IDS = Object.freeze({
  NATIVE_SCROLL: 'nativeScroll',
  NO_AUTOPLAY: 'noAutoplay',
  ANY_COPY: 'anyCopy',
  ANY_COPY_ENHANCED: 'anyCopyEnhanced',
  XHS_IMAGE_DARK_READER: 'xhsImageDarkReader',
  MAILTO_CAPTURE: 'mailtoCapture',
  AD_MARSHAL: 'adMarshal',
  IMAGE_DOWNLOAD: 'imageDownload',
  VIDEO_DOWNLOAD: 'videoDownload'
});

export const FEATURE_SLOTS = Object.freeze({
  NATIVE_SCROLL: 10,
  NO_AUTOPLAY: 20,
  ANY_COPY: 30,
  ANY_COPY_ENHANCED: 31,
  MAILTO_CAPTURE: 32,
  XHS_IMAGE_DARK_READER: 33,
  AD_MARSHAL: 35,
  IMAGE_DOWNLOAD: 40,
  VIDEO_DOWNLOAD: 50
});

const DEFAULT_FEATURE = Object.freeze({
  enabled: true,
  inactiveRules: Object.freeze([]),
  enhancedRules: Object.freeze([]),
  standardRules: Object.freeze([])
});

export const DEFAULT_SETTINGS = Object.freeze({
  version: 19,
  nsna: Object.freeze({
    whitelistRules: Object.freeze([])
  }),
  nativeScroll: DEFAULT_FEATURE,
  noAutoplay: Object.freeze({
    ...DEFAULT_FEATURE,
    audioAutoplayAllSites: false,
    permanentAudioAllowRules: Object.freeze([])
  }),
  anyCopy: Object.freeze({
    siteRules: Object.freeze([])
  }),
  mailtoCapture: Object.freeze({
    enabled: true
  }),
  xhsImageDarkReader: Object.freeze({
    enabled: false,
    overrideDarkMode: false,
    showImageControl: true,
    controlOpacity: 0.5
  }),
  adMarshal: Object.freeze({
    enabled: false
  }),
  imageDownload: Object.freeze({
    workspaceMode: 'sidePanel',
    batchMode: 'zip',
    outputFormat: 'original',
    askWhereToSave: true
  }),
  videoDownload: Object.freeze({
    preferredQuality: 'best',
    askWhereToSave: true
  }),
  satellites: Object.freeze({
    biliDailyLogin: Object.freeze({
      enabled: false,
      lastCompletedDate: ''
    })
  })
});

export const DEFAULT_INCOGNITO_SETTINGS = Object.freeze({
  ...DEFAULT_SETTINGS,
  nativeScroll: Object.freeze({
    ...DEFAULT_SETTINGS.nativeScroll,
    enabled: false
  }),
  noAutoplay: Object.freeze({
    ...DEFAULT_SETTINGS.noAutoplay,
    enabled: false
  }),
  mailtoCapture: Object.freeze({
    enabled: false
  }),
  adMarshal: Object.freeze({
    enabled: false
  }),
  satellites: Object.freeze({
    biliDailyLogin: Object.freeze({
      enabled: false,
      lastCompletedDate: ''
    })
  })
});

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function canonicalHostname(value) {
  if (typeof value !== 'string') throw new Error('Enter a hostname or wildcard rule.');
  const raw = value.trim().toLowerCase().replace(/\.$/, '');
  if (!raw || /[/?#@\s]/.test(raw)) throw new Error('Use a hostname without a path, port, or query.');
  if (raw === 'localhost') return raw;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) {
    if (raw.split('.').some(part => Number(part) > 255)) throw new Error('Enter a valid IP address.');
    return raw;
  }
  let hostname;
  try { hostname = new URL('http://' + raw).hostname.toLowerCase().replace(/\.$/, ''); }
  catch { throw new Error('Enter a valid hostname.'); }
  if (hostname !== raw || !hostname.includes('.') || hostname.split('.').some(label => !HOST_LABEL.test(label))) {
    throw new Error('Enter a valid hostname.');
  }
  return hostname;
}

export function normalizeRule(value) {
  if (typeof value !== 'string') throw new Error('Enter a hostname or wildcard rule.');
  const raw = value.trim().toLowerCase();
  const wildcard = raw.startsWith('*.');
  if (raw.includes('*') && !wildcard) throw new Error('Place the wildcard only at the beginning, as in *.example.com.');
  const hostname = canonicalHostname(wildcard ? raw.slice(2) : raw);
  if (wildcard && (hostname === 'localhost' || /^\d/.test(hostname))) throw new Error('Wildcards require a domain name.');
  return wildcard ? '*.' + hostname : hostname;
}

function normalizeRules(value) {
  const rules = [];
  for (const entry of Array.isArray(value) ? value : []) {
    try {
      const rule = normalizeRule(entry);
      if (!rules.includes(rule)) rules.push(rule);
    } catch {}
  }
  return rules.sort((a, b) => a.localeCompare(b));
}

function normalizeFeature(value = {}, includeAudioRules = false) {
  const inactiveRules = normalizeRules(value.inactiveRules ?? value.whitelistRules ?? value.whitelist);
  const explicitStandardRules = normalizeRules(value.standardRules)
    .filter(rule => !inactiveRules.includes(rule));
  const enhancedRules = normalizeRules(value.enhancedRules)
    .filter(rule => !inactiveRules.includes(rule) && !explicitStandardRules.includes(rule));
  const migratedEnabledRules = normalizeRules(value.enabledRules)
    .filter(rule => !inactiveRules.includes(rule) && !explicitStandardRules.includes(rule) && !enhancedRules.includes(rule));
  const normalized = {
    enabled: value.enabled !== false,
    inactiveRules,
    standardRules: normalizeRules([...explicitStandardRules, ...migratedEnabledRules]),
    enhancedRules
  };
  if (includeAudioRules) {
    normalized.audioAutoplayAllSites = value.audioAutoplayAllSites === true;
    normalized.permanentAudioAllowRules = normalizeRules(value.permanentAudioAllowRules);
  }
  return normalized;
}

export function normalizeSettings(value = {}) {
  const legacy = value.version === 1 && ('enabled' in value || 'whitelist' in value || 'mode' in value);
  const nativeValue = legacy
    ? { enabled: value.enabled, inactiveRules: value.whitelist, enhancedRules: [] }
    : value.nativeScroll;
  return {
    version: 19,
    nsna: {
      whitelistRules: normalizeRules(value.nsna?.whitelistRules ?? value.nsnaWhitelistRules)
    },
    nativeScroll: normalizeFeature(nativeValue || {}, false),
    noAutoplay: normalizeFeature(value.noAutoplay || {}, true),
    anyCopy: {
      siteRules: normalizeRules(value.anyCopy?.siteRules ?? value.anyCopy?.enforcedRules)
    },
    mailtoCapture: {
      enabled: value.mailtoCapture?.enabled !== false
    },
    xhsImageDarkReader: {
      enabled: value.xhsImageDarkReader?.enabled === true,
      overrideDarkMode: value.xhsImageDarkReader?.overrideDarkMode === true,
      showImageControl: value.xhsImageDarkReader?.showImageControl !== false,
      controlOpacity: Math.min(0.9, Math.max(0.2, Number(value.xhsImageDarkReader?.controlOpacity) || 0.5))
    },
    adMarshal: {
      enabled: value.adMarshal?.enabled === true
    },
    imageDownload: {
      workspaceMode: value.imageDownload?.workspaceMode === 'page' ? 'page' : 'sidePanel',
      batchMode: value.imageDownload?.batchMode === 'separate' ? 'separate' : 'zip',
      outputFormat: ['original', 'jpg', 'png', 'webp'].includes(String(value.imageDownload?.outputFormat))
        ? String(value.imageDownload.outputFormat)
        : 'original',
      askWhereToSave: value.imageDownload?.askWhereToSave !== false
    },
    videoDownload: {
      preferredQuality: ['best', '2160', '1440', '1080', '720', '480'].includes(String(value.videoDownload?.preferredQuality))
        ? String(value.videoDownload.preferredQuality)
        : 'best',
      askWhereToSave: value.videoDownload?.askWhereToSave !== false
    },
    satellites: {
      biliDailyLogin: {
        enabled: value.satellites?.biliDailyLogin?.enabled === true,
        lastCompletedDate: /^\d{4}-\d{2}-\d{2}$/.test(value.satellites?.biliDailyLogin?.lastCompletedDate || '')
          ? value.satellites.biliDailyLogin.lastCompletedDate
          : ''
      }
    }
  };
}

export function ruleMatches(hostname, rule) {
  let host;
  try { host = canonicalHostname(hostname); } catch { return false; }
  let normalized;
  try { normalized = normalizeRule(rule); } catch { return false; }
  if (!normalized.startsWith('*.')) return host === normalized;
  const domain = normalized.slice(2);
  return host === domain || host.endsWith('.' + domain);
}

export function matchingRule(hostname, rules) {
  const matches = (Array.isArray(rules) ? rules : []).filter(rule => ruleMatches(hostname, rule));
  if (!matches.length) return '';
  const exact = matches.find(rule => !rule.startsWith('*.'));
  if (exact) return exact;
  return matches.sort((a, b) => b.length - a.length)[0];
}

function rulePriority(rule) {
  return rule && !rule.startsWith('*.') ? Number.MAX_SAFE_INTEGER : String(rule || '').length;
}

function resolveBehavior(hostname, feature) {
  const candidates = [
    { behavior: 'inactive', rule: matchingRule(hostname, feature.inactiveRules) },
    { behavior: 'standard', rule: matchingRule(hostname, feature.standardRules) },
    { behavior: 'enhanced', rule: matchingRule(hostname, feature.enhancedRules) }
  ].filter(candidate => candidate.rule);
  if (!candidates.length) return { behavior: feature.enabled ? 'standard' : 'inactive', rule: '' };
  return candidates.reduce((selected, candidate) => (
    rulePriority(candidate.rule) > rulePriority(selected.rule) ? candidate : selected
  ));
}

export function hostnameFromUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase().replace(/\.$/, '') : '';
  } catch { return ''; }
}

export function featureState(settings, featureId, url) {
  const normalized = normalizeSettings(settings);
  const feature = normalized[featureId];
  if (!feature) throw new Error('Unknown feature.');
  const hostname = hostnameFromUrl(url);
  const sharedWhitelistRule = [FEATURE_IDS.NATIVE_SCROLL, FEATURE_IDS.NO_AUTOPLAY].includes(featureId) && hostname
    ? matchingRule(hostname, normalized.nsna.whitelistRules)
    : '';
  const matchedInactiveRule = hostname ? matchingRule(hostname, feature.inactiveRules) : '';
  const matchedEnhancedRule = hostname ? matchingRule(hostname, feature.enhancedRules) : '';
  const matchedStandardRule = hostname ? matchingRule(hostname, feature.standardRules) : '';
  const matchedAudioRule = featureId === FEATURE_IDS.NO_AUTOPLAY && hostname
    ? matchingRule(hostname, feature.permanentAudioAllowRules)
    : '';
  const selection = hostname
    ? resolveBehavior(hostname, feature)
    : { behavior: 'inactive', rule: '' };
  const active = !!hostname && !sharedWhitelistRule && selection.behavior !== 'inactive';
  const behavior = sharedWhitelistRule ? 'inactive' : selection.behavior;
  return {
    ...feature,
    hostname,
    supported: !!hostname,
    active,
    mode: active && behavior === 'enhanced' ? 'enhanced' : 'standard',
    behavior,
    sharedWhitelisted: !!sharedWhitelistRule,
    sharedWhitelistRule,
    exactSharedWhitelisted: !!hostname && normalized.nsna.whitelistRules.includes(hostname),
    matchedInactiveRule,
    exactInactive: !!hostname && feature.inactiveRules.includes(hostname),
    matchedEnhancedRule,
    exactEnhanced: !!hostname && feature.enhancedRules.includes(hostname),
    matchedStandardRule,
    exactStandard: !!hostname && feature.standardRules.includes(hostname),
    behaviorRule: sharedWhitelistRule || selection.rule,
    behaviorOverride: sharedWhitelistRule ? 'sharedWhitelist' : selection.rule ? selection.behavior : '',
    exactBehaviorOverride: !!hostname && (
      feature.inactiveRules.includes(hostname)
      || feature.standardRules.includes(hostname)
      || feature.enhancedRules.includes(hostname)
    ),
    audioAllowed: featureId === FEATURE_IDS.NO_AUTOPLAY
      ? active && (feature.audioAutoplayAllSites === true || !!matchedAudioRule)
      : false,
    matchedAudioRule,
    exactAudioAllowed: featureId === FEATURE_IDS.NO_AUTOPLAY && !!hostname
      ? feature.permanentAudioAllowRules.includes(hostname)
      : false
  };
}

export function siteFeatureState(settings, featureId, url) {
  const normalized = normalizeSettings(settings);
  const feature = normalized[featureId];
  if (featureId !== FEATURE_IDS.ANY_COPY || !feature) {
    throw new Error('Unknown site feature.');
  }
  const hostname = hostnameFromUrl(url);
  const matchedRule = hostname ? matchingRule(hostname, feature.siteRules) : '';
  const active = !!hostname && !!matchedRule;
  return {
    ...feature,
    hostname,
    supported: !!hostname,
    active,
    enabled: active,
    matchedRule,
    exactActive: !!hostname && feature.siteRules.includes(hostname)
  };
}

export function anyCopyState(settings, url) {
  return siteFeatureState(settings, FEATURE_IDS.ANY_COPY, url);
}

export function anyCopyEnhancedState(url, tabActive = false) {
  const hostname = hostnameFromUrl(url);
  const active = !!hostname && tabActive === true;
  return {
    hostname,
    supported: !!hostname,
    active,
    enabled: active,
    scope: 'tab',
    exactActive: active,
    matchedRule: ''
  };
}

export function mailtoCaptureState(settings, url) {
  const normalized = normalizeSettings(settings);
  const hostname = hostnameFromUrl(url);
  const enabled = normalized.mailtoCapture.enabled === true;
  return {
    ...normalized.mailtoCapture,
    hostname,
    supported: !!hostname,
    active: !!hostname && enabled,
    enabled
  };
}

export function adMarshalState(settings, url) {
  const normalized = normalizeSettings(settings);
  const hostname = hostnameFromUrl(url);
  const siteId = hostname === 'news.qq.com' || hostname === 'view.inews.qq.com'
    ? 'newsQqCom'
    : hostname === 'www.qq.com'
      ? 'wwwQqCom'
      : ['douyin.com', 'www.douyin.com', 'live.douyin.com'].includes(hostname)
        ? 'douyinCom'
        : hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com')
          ? 'zhihuCom'
          : hostname === 'mail.google.com'
            ? 'gmailCom'
            : '';
  const enabled = normalized.adMarshal.enabled === true;
  const supported = !!siteId;
  return {
    ...normalized.adMarshal,
    hostname,
    siteId,
    supported,
    active: supported && enabled,
    enabled
  };
}

export function xhsImageDarkReaderState(settings, url, pageState = {}) {
  const normalized = normalizeSettings(settings);
  const feature = normalized.xhsImageDarkReader;
  const hostname = hostnameFromUrl(url);
  const supported = hostname === 'www.xiaohongshu.com';
  const enabled = feature.enabled === true;
  const darkModeDetected = pageState.darkModeDetected === true;
  const processing = supported && enabled
    && (feature.overrideDarkMode === true || darkModeDetected)
    && pageState.processing === true;
  return {
    ...feature,
    hostname,
    supported,
    enabled,
    active: supported && enabled,
    darkModeDetected,
    processing,
    status: !supported ? 'unavailable' : !enabled ? 'off' : processing ? 'active' : 'waiting'
  };
}

export function updateFeature(settings, featureId, update) {
  const normalized = normalizeSettings(settings);
  if (!normalized[featureId]) throw new Error('Unknown feature.');
  const nextFeature = typeof update === 'function' ? update(normalized[featureId]) : update;
  return normalizeSettings({ ...normalized, [featureId]: nextFeature });
}
