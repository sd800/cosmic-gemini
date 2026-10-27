// UTM removal preserves other query bytes; the optional Bilibili policy clears its query.
import './url-tracking-parameters.js';
const helper = globalThis[Symbol.for('cosmic-gemini.url-tracking-cleaner.parameters')];
export const cleanTrackingUrl = helper.clean;
export const UTM_PARAMETERS = Object.freeze(helper.names.flatMap(name => [name, name.toUpperCase()]));
export const URL_TRACKING_RULE_IDS = Object.freeze({ regular: 960001, incognito: 960002, bilibiliRegular: 960003, bilibiliIncognito: 960004 });
const UTM_FILTER = '^https?://[^?#]+\\?(?:[^#]*&)?(?:utm_|UTM_)';

export function urlTrackingCleanerState(settings, value) {
  const preference = settings.urlTrackingCleaner || {};
  const enabled = preference.enabled === true, utmParameters = preference.utmParameters !== false;
  const bilibiliParameters = preference.bilibiliParameters === true;
  let supported = false;
  try { supported = ['http:', 'https:'].includes(new URL(value).protocol); } catch {}
  return { enabled, utmParameters, bilibiliParameters, supported, active: enabled && (utmParameters || bilibiliParameters) && supported };
}

export function urlTrackingCleanerRule(tabIds, incognito = false) {
  const ids = [...new Set(tabIds.filter(id => Number.isInteger(id) && id >= 0))].sort((a,b) => a-b);
  if (!ids.length) return null;
  return {
    id: URL_TRACKING_RULE_IDS[incognito ? 'incognito' : 'regular'],
    // Same-origin cleanup precedes temporary navigation allowances. The cleaned
    // request is evaluated again, so domain blocks still apply to its target.
    priority: 300,
    action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: [...UTM_PARAMETERS] } } } },
    condition: { regexFilter: UTM_FILTER, isUrlFilterCaseSensitive: true,
      requestMethods: ['get'], resourceTypes: ['main_frame'], tabIds: ids }
  };
}

export function urlTrackingCleanerRules(tabIds, incognito, preference) {
  if (preference?.enabled !== true) return [];
  const base = urlTrackingCleanerRule(tabIds, incognito);
  if (!base) return [];
  const rules = preference.utmParameters !== false ? [base] : [];
  if (preference.bilibiliParameters === true) rules.push({
    ...base,
    id: URL_TRACKING_RULE_IDS[incognito ? 'bilibiliIncognito' : 'bilibiliRegular'],
    priority: 301,
    action: { type: 'redirect', redirect: { transform: { query: '', fragment: '' } } },
    condition: { ...base.condition, regexFilter: '^https?://[^?#]+\\?', requestDomains: ['bilibili.com'] }
  });
  return rules;
}
