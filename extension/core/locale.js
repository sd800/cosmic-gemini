export const LOCALE_KEY = 'interfaceLocale';
export const LOCALE_CACHE_KEY = 'cosmicGeminiInterfaceLocale';

export function normalizeLocale(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function preferredLocale(languages = globalThis.navigator?.languages || [globalThis.navigator?.language]) {
  const first = (Array.isArray(languages) ? languages : [languages]).find(Boolean) || 'en-US';
  return normalizeLocale(first);
}

export async function loadLocale({ cacheResult = true } = {}) {
  const incognitoContext = chrome.extension?.inIncognitoContext === true;
  let locale = preferredLocale();
  if (!incognitoContext) {
    try {
      const cached = globalThis.localStorage?.getItem(LOCALE_CACHE_KEY);
      if (cached) locale = normalizeLocale(cached);
    } catch {}
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'UI_GET_LOCALE' });
    if (response?.ok && response.result?.locale) locale = normalizeLocale(response.result.locale);
  } catch {}
  if (!incognitoContext && cacheResult) {
    try { globalThis.localStorage?.setItem(LOCALE_CACHE_KEY, locale); } catch {}
  }
  return locale;
}
