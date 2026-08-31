export const SETTINGS_KEY = 'cosmicGeminiSettings';
export const LEGACY_SETTINGS_KEY = 'settings';

export const FEATURE_IDS = Object.freeze({
  NATIVE_SCROLL: 'nativeScroll',
  NO_AUTOPLAY: 'noAutoplay',
  ANY_COPY: 'anyCopy',
  ANY_COPY_ENHANCED: 'anyCopyEnhanced',
  IMAGE_DOWNLOAD: 'imageDownload',
  VIDEO_DOWNLOAD: 'videoDownload'
});

export const FEATURE_SLOTS = Object.freeze({
  NATIVE_SCROLL: 10,
  NO_AUTOPLAY: 20,
  ANY_COPY: 30,
  ANY_COPY_ENHANCED: 31,
  IMAGE_DOWNLOAD: 40,
  VIDEO_DOWNLOAD: 50
});

const DEFAULT_FEATURE = Object.freeze({
  enabled: true,
  enabledRules: Object.freeze([]),
  whitelistRules: Object.freeze([]),
  enhancedRules: Object.freeze([]),
  standardRules: Object.freeze([])
});

export const DEFAULT_SETTINGS = Object.freeze({
  version: 12,
  nativeScroll: DEFAULT_FEATURE,
  noAutoplay: Object.freeze({
    ...DEFAULT_FEATURE,
    audioAutoplayAllSites: false,
    permanentAudioAllowRules: Object.freeze([])
  }),
  anyCopy: Object.freeze({
    siteRules: Object.freeze([])
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
  const normalized = {
    enabled: value.enabled !== false,
    enabledRules: normalizeRules(value.enabledRules),
    whitelistRules: normalizeRules(value.whitelistRules ?? value.whitelist),
    enhancedRules: normalizeRules(value.enhancedRules),
    standardRules: normalizeRules(value.standardRules)
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
    ? { enabled: value.enabled, whitelistRules: value.whitelist, enhancedRules: [] }
    : value.nativeScroll;
  return {
    version: 12,
    nativeScroll: normalizeFeature(nativeValue || {}, false),
    noAutoplay: normalizeFeature(value.noAutoplay || {}, true),
    anyCopy: {
      siteRules: normalizeRules(value.anyCopy?.siteRules ?? value.anyCopy?.enforcedRules)
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

export function resolveRuleChoice(hostname, positiveRules, negativeRules, defaultValue = false) {
  const positiveRule = matchingRule(hostname, positiveRules);
  const negativeRule = matchingRule(hostname, negativeRules);
  const positivePriority = rulePriority(positiveRule);
  const negativePriority = rulePriority(negativeRule);
  if (!positiveRule && !negativeRule) return { value: defaultValue === true, rule: '', choice: '' };
  if (positivePriority > negativePriority) return { value: true, rule: positiveRule, choice: 'positive' };
  return { value: false, rule: negativeRule, choice: 'negative' };
}

export function toggleRule(rules, rule) {
  const current = normalizeRules(rules);
  const normalized = normalizeRule(rule);
  return current.includes(normalized)
    ? current.filter(item => item !== normalized)
    : normalizeRules([...current, normalized]);
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
  const matchedEnabledRule = hostname ? matchingRule(hostname, feature.enabledRules) : '';
  const matchedWhitelistRule = hostname ? matchingRule(hostname, feature.whitelistRules) : '';
  const matchedEnhancedRule = hostname ? matchingRule(hostname, feature.enhancedRules) : '';
  const matchedStandardRule = hostname ? matchingRule(hostname, feature.standardRules) : '';
  const matchedAudioRule = featureId === FEATURE_IDS.NO_AUTOPLAY && hostname
    ? matchingRule(hostname, feature.permanentAudioAllowRules)
    : '';
  const activation = hostname
    ? resolveRuleChoice(hostname, feature.enabledRules, feature.whitelistRules, feature.enabled)
    : { value: false, rule: '', choice: '' };
  const modeChoice = hostname
    ? resolveRuleChoice(hostname, feature.enhancedRules, feature.standardRules, false)
    : { value: false, rule: '', choice: '' };
  const active = !!hostname && activation.value;
  return {
    ...feature,
    hostname,
    supported: !!hostname,
    active,
    mode: active && modeChoice.value ? 'enhanced' : 'standard',
    matchedEnabledRule,
    exactEnabled: !!hostname && feature.enabledRules.includes(hostname),
    matchedWhitelistRule,
    exactWhitelisted: !!hostname && feature.whitelistRules.includes(hostname),
    matchedEnhancedRule,
    exactEnhanced: !!hostname && feature.enhancedRules.includes(hostname),
    matchedStandardRule,
    exactStandard: !!hostname && feature.standardRules.includes(hostname),
    activationRule: activation.rule,
    activationOverride: activation.choice === 'positive' ? 'enabled' : activation.choice === 'negative' ? 'disabled' : '',
    exactActivationOverride: !!hostname && (feature.enabledRules.includes(hostname) || feature.whitelistRules.includes(hostname)),
    modeRule: modeChoice.rule,
    modeOverride: modeChoice.choice === 'positive' ? 'enhanced' : modeChoice.choice === 'negative' ? 'standard' : '',
    exactModeOverride: !!hostname && (feature.enhancedRules.includes(hostname) || feature.standardRules.includes(hostname)),
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

export function updateFeature(settings, featureId, update) {
  const normalized = normalizeSettings(settings);
  if (!normalized[featureId]) throw new Error('Unknown feature.');
  const nextFeature = typeof update === 'function' ? update(normalized[featureId]) : update;
  return normalizeSettings({ ...normalized, [featureId]: nextFeature });
}
