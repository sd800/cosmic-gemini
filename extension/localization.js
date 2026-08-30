import "./localization-data.js";

const CATALOG = globalThis.COSMIC_GEMINI_CATALOG;

export function translator(locale) {
  const language = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
  return (key, values = {}) => {
    let value = CATALOG[language][key] ?? CATALOG['en-US'][key] ?? key;
    for (const [name, replacement] of Object.entries(values)) value = value.replaceAll('{' + name + '}', String(replacement));
    return value;
  };
}

export function localizeDocument(t) {
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder);
}
