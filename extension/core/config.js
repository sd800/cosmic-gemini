export const SETTINGS_KEY = 'settings';
export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  mode: 'standard',
  whitelist: []
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
  try { hostname = new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/, ''); }
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
  return wildcard ? `*.${hostname}` : hostname;
}

export function normalizeSettings(value = {}) {
  const whitelist = [];
  for (const entry of Array.isArray(value.whitelist) ? value.whitelist : []) {
    try {
      const rule = normalizeRule(entry);
      if (!whitelist.includes(rule)) whitelist.push(rule);
    } catch {}
  }
  return {
    version: 1,
    enabled: value.enabled !== false,
    mode: value.mode === 'strong' ? 'strong' : 'standard',
    whitelist: whitelist.sort((a, b) => a.localeCompare(b))
  };
}

export function ruleMatches(hostname, rule) {
  let host;
  try { host = canonicalHostname(hostname); } catch { return false; }
  let normalized;
  try { normalized = normalizeRule(rule); } catch { return false; }
  if (!normalized.startsWith('*.')) return host === normalized;
  const domain = normalized.slice(2);
  return host === domain || host.endsWith(`.${domain}`);
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

export function pageState(settings, url) {
  const normalized = normalizeSettings(settings);
  const hostname = hostnameFromUrl(url);
  const matchedRule = hostname ? matchingRule(hostname, normalized.whitelist) : '';
  return {
    ...normalized,
    hostname,
    supported: !!hostname,
    matchedRule,
    exactWhitelisted: !!hostname && normalized.whitelist.includes(hostname),
    active: normalized.enabled && !!hostname && !matchedRule
  };
}
