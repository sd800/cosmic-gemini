(() => {
  const root = document.documentElement;
  const cacheKey = 'cosmicGeminiSettingsViewCache';
  const emptyKeys = {
    enhancedRules: 'emptyEnhancedSites',
    whitelistRules: 'emptyWhitelist',
    permanentAudioAllowRules: 'emptyAudioAllow',
    enforcedRules: 'emptyEnforcedSites'
  };
  const iconPaths = {
    nativeScroll: '<path d="M12 3v18M7.5 7.5 12 3l4.5 4.5M7.5 16.5 12 21l4.5-4.5"/>',
    noAutoplay: '<path d="M6 5v14l10-7z"/><path d="M21 18A4 4 0 1 1 17 14a3.3 3.3 0 0 0 4 4Z" fill="currentColor" stroke="none"/>',
    anyCopy: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/>',
    imageDownload: '<rect x="3.5" y="4.5" width="11.5" height="11.5" rx="2"/><path d="m5.5 13 2.7-2.8 2.1 2 2.2-3 2.5 3.2"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    videoDownload: '<path d="M6 5v14l10-7z"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    satellites: '<path d="M15 2C15.6 8.1 17.9 11.4 22 12c-4.1.6-6.4 3.9-7 10-.6-6.1-2.9-9.4-7-10 4.1-.6 6.4-3.9 7-10Z" fill="currentColor" stroke="none"/><path d="M5.25 2c.25 1.95 1.05 2.75 3 3-1.95.25-2.75 1.05-3 3-.25-1.95-1.05-2.75-3-3 1.95-.25 2.75-1.05 3-3Z" fill="currentColor" stroke="none"/><path d="M6.25 12.25c.35 2.8 1.45 3.9 4.25 4.25-2.8.35-3.9 1.45-4.25 4.25-.35-2.8-1.45-3.9-4.25-4.25 2.8-.35 3.9-1.45 4.25-4.25Z" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>'
  };
  let preferred = '';
  try { preferred = localStorage.getItem('cosmicGeminiInterfaceLocale') || ''; } catch {}
  if (!preferred) preferred = (navigator.languages || [navigator.language]).find(Boolean) || 'en-US';
  const locale = String(preferred).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  const catalog = globalThis.COSMIC_GEMINI_CATALOG?.[locale]
    || globalThis.COSMIC_GEMINI_CATALOG?.['en-US']
    || {};
  const translate = (key, values = {}) => {
    let value = catalog[key] || globalThis.COSMIC_GEMINI_CATALOG?.['en-US']?.[key] || key;
    for (const [name, replacement] of Object.entries(values)) value = value.replaceAll('{' + name + '}', String(replacement));
    return value;
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconPaths[name] || ''}</svg>`;

  root.lang = locale;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = translate(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = translate(element.dataset.i18nPlaceholder);
  }

  for (const link of document.querySelectorAll('[data-feature-link]')) {
    link.querySelector('span').innerHTML = icon(link.dataset.featureLink);
  }

  const language = document.querySelector('#language');
  if (language) language.value = locale;
  const version = document.querySelector('#version');
  if (version) version.textContent = translate('version', { version: chrome.runtime.getManifest().version });

  let cached = {};
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch {}
  const feature = document.body.dataset.feature;
  const current = cached[feature] || {};
  const enabled = document.querySelector('#enabled');
  if (enabled && typeof current.enabled === 'boolean') enabled.checked = current.enabled;
  const audioAutoplayAllSites = document.querySelector('#audioAutoplayAllSites');
  if (audioAutoplayAllSites) audioAutoplayAllSites.checked = current.audioAutoplayAllSites === true;
  const biliDailyLogin = document.querySelector('#biliDailyLogin');
  if (biliDailyLogin) biliDailyLogin.checked = current.biliDailyLogin?.enabled === true;
  const preferredQuality = document.querySelector('#preferredQuality');
  if (preferredQuality) preferredQuality.value = current.preferredQuality || 'best';
  const askWhereToSave = document.querySelector('#askWhereToSave');
  if (askWhereToSave) askWhereToSave.checked = current.askWhereToSave !== false;
  const imageOutputFormat = document.querySelector('#imageOutputFormat');
  if (imageOutputFormat) imageOutputFormat.value = current.outputFormat || 'original';
  const imageWorkspaceMode = document.querySelector('#imageWorkspaceMode');
  if (imageWorkspaceMode) imageWorkspaceMode.value = current.workspaceMode === 'page' ? 'page' : 'sidePanel';
  const imageBatchMode = document.querySelector('#imageBatchMode');
  if (imageBatchMode) imageBatchMode.value = current.batchMode || 'zip';
  const imageAskWhereToSave = document.querySelector('#imageAskWhereToSave');
  if (imageAskWhereToSave) imageAskWhereToSave.checked = current.askWhereToSave !== false;

  for (const section of document.querySelectorAll('[data-list-section]')) {
    const listName = section.dataset.listSection;
    const list = section.querySelector('.rule-list');
    const rules = Array.isArray(current[listName]) ? current[listName].filter(rule => typeof rule === 'string') : [];
    list.replaceChildren();
    if (!rules.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = translate(emptyKeys[listName]);
      list.append(empty);
      continue;
    }
    for (const rule of rules) {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = rule;
      const remove = document.createElement('button');
      remove.className = 'icon-button';
      remove.type = 'button';
      remove.innerHTML = icon('trash');
      remove.title = translate('removeRule', { rule });
      remove.setAttribute('aria-label', remove.title);
      item.append(code, remove);
      list.append(item);
    }
  }

  root.dataset.localePending = 'false';
})();
