import { etld } from './etld.js';

let suffixes;
function rules() {
  if (!suffixes) suffixes = new Set(etld.map(rule => {
    const prefix = rule.startsWith('!') ? '!' : rule.startsWith('*.') ? '*.' : '';
    return prefix + new URL('https://' + rule.slice(prefix.length)).hostname.toLowerCase();
  }));
  return suffixes;
}

// eTLD+1 uses the project's curated PSL snapshot, including wildcard/exception rules.
// Unlisted top-level labels use the PSL implicit wildcard rule, including unassigned TLDs.
// IP addresses, localhost and bare public suffixes remain exact-host keys.
export function siteKey(value) {
  let host;
  try { const url = new URL(value); if (!/^https?:$/.test(url.protocol)) return ''; host = url.hostname.toLowerCase().replace(/\.$/, ''); }
  catch { return ''; }
  if (host.startsWith('[') || /^[\d.]+$/.test(host) || !host.includes('.')) return host;
  const labels = host.split('.'), set = rules();
  let suffixLength = 1;
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (set.has('!' + suffix)) { suffixLength = labels.length - i - 1; break; }
    if (set.has(suffix)) suffixLength = Math.max(suffixLength, labels.length - i);
    if (i > 0 && set.has('*.' + suffix)) suffixLength = Math.max(suffixLength, labels.length - i + 1);
  }
  return labels.slice(-suffixLength - 1).join('.');
}
