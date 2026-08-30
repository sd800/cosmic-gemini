export const LOCALE_KEY = 'interfaceLocale';
export const LOCALE_CACHE_KEY = 'cosmicGeminiInterfaceLocale';

export function normalizeLocale(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function preferredLocale(languages = globalThis.navigator?.languages || [globalThis.navigator?.language]) {
  const first = (Array.isArray(languages) ? languages : [languages]).find(Boolean) || 'en-US';
  return normalizeLocale(first);
}

export async function loadLocale() {
  const stored = await chrome.storage.local.get(LOCALE_KEY);
  const locale = stored[LOCALE_KEY] ? normalizeLocale(stored[LOCALE_KEY]) : preferredLocale();
  try { globalThis.localStorage?.setItem(LOCALE_CACHE_KEY, locale); } catch {}
  return locale;
}

export async function saveLocale(locale) {
  const normalized = normalizeLocale(locale);
  await chrome.storage.local.set({ [LOCALE_KEY]: normalized });
  try { globalThis.localStorage?.setItem(LOCALE_CACHE_KEY, normalized); } catch {}
  return normalized;
}
