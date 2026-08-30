export const SETTINGS_KEY = 'cosmicGeminiSettings';
export const LEGACY_SETTINGS_KEY = 'settings';

export const FEATURE_IDS = Object.freeze({
  NATIVE_SCROLL: 'nativeScroll',
  NO_AUTOPLAY: 'noAutoplay'
});

const DEFAULT_FEATURE = Object.freeze({
  enabled: true,
  whitelistRules: Object.freeze([]),
  strongRules: Object.freeze([])
});

export const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  nativeScroll: DEFAULT_FEATURE,
  noAutoplay: Object.freeze({
    ...DEFAULT_FEATURE,
    permanentAudioAllowRules: Object.freeze([])
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
    whitelistRules: normalizeRules(value.whitelistRules ?? value.whitelist),
    strongRules: normalizeRules(value.strongRules)
  };
  if (includeAudioRules) normalized.permanentAudioAllowRules = normalizeRules(value.permanentAudioAllowRules);
  return normalized;
}

export function normalizeSettings(value = {}) {
  const legacy = value.version === 1 && ('enabled' in value || 'whitelist' in value || 'mode' in value);
  const nativeValue = legacy
    ? { enabled: value.enabled, whitelistRules: value.whitelist, strongRules: [] }
    : value.nativeScroll;
  return {
    version: 2,
    nativeScroll: normalizeFeature(nativeValue || {}, false),
    noAutoplay: normalizeFeature(value.noAutoplay || {}, true)
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
  return (Array.isArray(rules) ? rules : []).find(rule => ruleMatches(hostname, rule)) || '';
}

export function hostnameFromUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase().replace(/\.$/, '') : '';
  } catch { return ''; }
}

export function featureState(settings, featureId, url, temporaryAudioAllowed = false) {
  const normalized = normalizeSettings(settings);
  const feature = normalized[featureId];
  if (!feature) throw new Error('Unknown feature.');
  const hostname = hostnameFromUrl(url);
  const matchedWhitelistRule = hostname ? matchingRule(hostname, feature.whitelistRules) : '';
  const matchedStrongRule = hostname ? matchingRule(hostname, feature.strongRules) : '';
  const matchedAudioRule = featureId === FEATURE_IDS.NO_AUTOPLAY && hostname
    ? matchingRule(hostname, feature.permanentAudioAllowRules)
    : '';
  const active = feature.enabled && !!hostname && !matchedWhitelistRule;
  return {
    ...feature,
    hostname,
    supported: !!hostname,
    active,
    mode: active && matchedStrongRule ? 'strong' : 'standard',
    matchedWhitelistRule,
    exactWhitelisted: !!hostname && feature.whitelistRules.includes(hostname),
    matchedStrongRule,
    exactStrong: !!hostname && feature.strongRules.includes(hostname),
    audioAllowed: featureId === FEATURE_IDS.NO_AUTOPLAY
      ? active && (!!matchedAudioRule || temporaryAudioAllowed)
      : false,
    matchedAudioRule,
    exactAudioAllowed: featureId === FEATURE_IDS.NO_AUTOPLAY && !!hostname
      ? feature.permanentAudioAllowRules.includes(hostname)
      : false
  };
}

export function updateFeature(settings, featureId, update) {
  const normalized = normalizeSettings(settings);
  if (!normalized[featureId]) throw new Error('Unknown feature.');
  const nextFeature = typeof update === 'function' ? update(normalized[featureId]) : update;
  return normalizeSettings({ ...normalized, [featureId]: nextFeature });
}
