(() => {
  const root = document.documentElement;
  let preferred = '';
  try { preferred = localStorage.getItem('cosmicGeminiInterfaceLocale') || ''; } catch {}
  if (!preferred) preferred = (navigator.languages || [navigator.language]).find(Boolean) || 'en-US';
  const locale = String(preferred).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  const catalog = globalThis.COSMIC_GEMINI_CATALOG?.[locale]
    || globalThis.COSMIC_GEMINI_CATALOG?.['en-US']
    || {};
  const translate = key => catalog[key] || globalThis.COSMIC_GEMINI_CATALOG?.['en-US']?.[key] || key;

  root.lang = locale;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = translate(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = translate(element.dataset.i18nPlaceholder);
  }
  root.dataset.localePending = 'false';
})();
