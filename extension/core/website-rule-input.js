import { normalizeAccessControlDomain, normalizeRule } from './config.js';
import { etld } from './etld.js';
import { siteKey } from './site-key.js';

export const ACCESS_CONTROL_ALIAS_GROUPS = Object.freeze([
  Object.freeze({ aliases: Object.freeze(['xhs', 'xiaohongshu']), domain: 'xiaohongshu.com' }),
  Object.freeze({ aliases: Object.freeze(['dy', 'douyin']), domain: 'douyin.com' }),
  Object.freeze({ aliases: Object.freeze(['bili', 'bilibili', 'bzhan']), domain: 'bilibili.com' }),
  Object.freeze({ aliases: Object.freeze(['ins', 'ig', 'instagram']), domain: 'instagram.com' })
]);

const ACCESS_CONTROL_ALIASES = Object.freeze(Object.fromEntries(
  ACCESS_CONTROL_ALIAS_GROUPS.flatMap(group => group.aliases.map(alias => [alias, group.domain]))
));

function canonicalMultiLabelRule(rule) {
  if (rule.startsWith('*.') || rule.startsWith('!')) return '';
  try {
    const hostname = new URL(`https://${rule}/`).hostname.toLowerCase().replace(/\.$/, '');
    return hostname.includes('.') ? hostname : '';
  } catch { return ''; }
}

const MULTI_LABEL_ETLD_RULES = new Set(etld.map(canonicalMultiLabelRule).filter(Boolean));

export function normalizeWebsiteRuleInput(value) {
  if (typeof value !== 'string') throw new Error('Enter a hostname or wildcard rule.');
  let raw = value.trim();
  const leadingDotDomain = raw.startsWith('.') && raw.slice(1).includes('.');
  if (leadingDotDomain) raw = '*' + raw;
  const normalized = normalizeRule(raw);
  if (normalized.startsWith('*.')) return normalized;
  return MULTI_LABEL_ETLD_RULES.has(normalized) ? '*.' + normalized : normalized;
}

// General domain inputs accept a pasted web URL as its registrable site while
// keeping the existing hostname, wildcard, IP, and alias paths unchanged.
export function normalizeGeneralDomainInput(value) {
  if (typeof value !== 'string') throw new Error('Enter a website domain or URL.');
  const raw = value.trim();
  if (raw.includes('\\')) throw new Error('Enter a valid website URL.');
  const webPrefix = /^(https?)(?::\/\/|\/\/|:\/|:|\/)/i.exec(raw);
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
  if (!webPrefix && !hasScheme && !raw.includes('/')) return normalizeWebsiteRuleInput(raw);
  let url;
  try {
    url = new URL(webPrefix ? `${webPrefix[1]}://${raw.slice(webPrefix[0].length)}`
      : hasScheme ? raw : `https://${raw}`);
  }
  catch { throw new Error('Enter a valid website URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter an HTTP or HTTPS website URL without credentials.');
  }
  normalizeRule(url.hostname);
  const domain = siteKey(url.href);
  if (!domain) throw new Error('Enter a valid website URL.');
  return domain;
}

export function normalizeAccessControlRuleInput(value) {
  if (typeof value !== 'string') throw new Error('Enter a website domain, IP address, or alias.');
  const alias = ACCESS_CONTROL_ALIASES[value.trim().toLowerCase()];
  return normalizeAccessControlDomain(normalizeGeneralDomainInput(alias || value));
}
