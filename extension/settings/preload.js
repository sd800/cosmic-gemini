(() => {
  const root = document.documentElement;
  const cacheKey = 'cosmicGeminiSettingsViewCache';
  const emptyKeys = {
    inactiveRules: 'emptyInactiveSites',
    enhancedRules: 'emptyEnhancedSites',
    standardRules: 'emptyStandardSites',
    permanentAudioAllowRules: 'emptyAudioAllow',
    whitelistRules: 'emptySharedWhitelist',
    enforcedRules: 'emptyEnforcedSites'
  };
  const iconPaths = {
    nativeScroll: '<path d="M12 3v18M7.5 7.5 12 3l4.5 4.5M7.5 16.5 12 21l4.5-4.5"/>',
    noAutoplay: '<path d="M6 5v14l10-7z"/><path d="M21 18A4 4 0 1 1 17 14a3.3 3.3 0 0 0 4 4Z" fill="currentColor" stroke="none"/>',
    anyCopy: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/>',
    anyCopyEnhanced: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/><path d="m17.6 10.6-5.8 7.8h4.5l-.7 4.7 6.6-8.6h-4.8z" fill="currentColor" stroke="var(--icon-surface, var(--surface))" stroke-width="1.8" paint-order="stroke fill"/>',
    imageDownload: '<rect x="2.75" y="3.75" width="12.75" height="12.75" rx="2"/><path d="m4.8 13.3 2.9-3.1 2.2 2.1 2.4-3.3 3.1 3.8"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    videoDownload: '<path d="M6 5v14l10-7z"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    satellites: '<path d="M15 2C15.6 8.1 17.9 11.4 22 12c-4.1.6-6.4 3.9-7 10-.6-6.1-2.9-9.4-7-10 4.1-.6 6.4-3.9 7-10Z" fill="currentColor" stroke="none"/><path d="M5.25 2c.25 1.95 1.05 2.75 3 3-1.95.25-2.75 1.05-3 3-.25-1.95-1.05-2.75-3-3 1.95-.25 2.75-1.05 3-3Z" fill="currentColor" stroke="none"/><path d="M6.25 12.25c.35 2.8 1.45 3.9 4.25 4.25-2.8.35-3.9 1.45-4.25 4.25-.35-2.8-1.45-3.9-4.25-4.25 2.8-.35 3.9-1.45 4.25-4.25Z" fill="currentColor" stroke="none"/>',
    allSettings: '<path d="M4 6h16M4 12h16M4 18h16"/>',
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
  for (const element of document.querySelectorAll('[data-section-icon]')) {
    element.innerHTML = icon(element.dataset.sectionIcon);
  }

  const language = document.querySelector('#language');
  if (language) language.value = locale;
  const version = document.querySelector('#version');
  if (version) version.textContent = translate('version', { version: chrome.runtime.getManifest().version });

  let cached = {};
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch {}
  const feature = document.body.dataset.feature;
  const current = cached[feature] || {};
  const cachedRules = name => Array.isArray(current[name])
    ? current[name].filter(rule => typeof rule === 'string')
    : [];
  const inactiveRules = cachedRules('inactiveRules').length
    ? cachedRules('inactiveRules')
    : cachedRules('whitelistRules');
  const explicitStandardRules = cachedRules('standardRules').filter(rule => !inactiveRules.includes(rule));
  const enhancedRules = cachedRules('enhancedRules')
    .filter(rule => !inactiveRules.includes(rule) && !explicitStandardRules.includes(rule));
  const migratedEnabledRules = cachedRules('enabledRules')
    .filter(rule => !inactiveRules.includes(rule) && !explicitStandardRules.includes(rule) && !enhancedRules.includes(rule));
  const behaviorRules = {
    inactiveRules,
    standardRules: [...new Set([...explicitStandardRules, ...migratedEnabledRules])],
    enhancedRules
  };
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

  const behaviorByList = { inactiveRules: 'inactive', standardRules: 'standard', enhancedRules: 'enhanced' };
  const behaviorLabel = { inactive: 'inactiveSitesHeading', standard: 'standardSitesHeading', enhanced: 'enhancedSitesHeading' };
  for (const section of document.querySelectorAll('[data-behavior-list]')) {
    const listName = section.dataset.behaviorList;
    const list = section.querySelector('.rule-list');
    const rules = behaviorRules[listName] || [];
    list.replaceChildren();
    if (!rules.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = translate(section.dataset.emptyKey || emptyKeys[listName]);
      list.append(empty);
      continue;
    }
    for (const rule of rules) {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = rule;
      const select = document.createElement('select');
      select.className = 'behavior-rule-select';
      select.setAttribute('aria-label', translate('changeBehaviorForRule', { rule }));
      for (const behavior of ['inactive', 'standard', 'enhanced']) {
        const option = document.createElement('option');
        option.value = behavior;
        option.textContent = translate(behaviorLabel[behavior]);
        select.append(option);
      }
      select.value = behaviorByList[listName];
      const remove = document.createElement('button');
      remove.className = 'icon-button';
      remove.type = 'button';
      remove.innerHTML = icon('trash');
      remove.title = translate('removeRule', { rule });
      remove.setAttribute('aria-label', remove.title);
      const controls = document.createElement('span');
      controls.className = 'behavior-rule-controls';
      controls.append(select, remove);
      item.append(code, controls);
      list.append(item);
    }
  }

  for (const section of document.querySelectorAll('[data-list-section]')) {
    const listName = section.dataset.listSection;
    const sectionState = cached[section.dataset.featureId || feature] || {};
    const list = section.querySelector('.rule-list');
    const rules = Array.isArray(sectionState[listName]) ? sectionState[listName].filter(rule => typeof rule === 'string') : [];
    list.replaceChildren();
    if (!rules.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = translate(section.dataset.emptyKey || emptyKeys[listName]);
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
