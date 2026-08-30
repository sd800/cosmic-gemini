export const LOCALE_KEY = 'interfaceLocale';

export function normalizeLocale(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function preferredLocale(languages = globalThis.navigator?.languages || [globalThis.navigator?.language]) {
  const first = (Array.isArray(languages) ? languages : [languages]).find(Boolean) || 'en-US';
  return normalizeLocale(first);
}

export async function loadLocale() {
  const stored = await chrome.storage.local.get(LOCALE_KEY);
  return stored[LOCALE_KEY] ? normalizeLocale(stored[LOCALE_KEY]) : preferredLocale();
}

export async function saveLocale(locale) {
  const normalized = normalizeLocale(locale);
  await chrome.storage.local.set({ [LOCALE_KEY]: normalized });
  return normalized;
}
