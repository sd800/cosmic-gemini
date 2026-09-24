(() => {
  const root = document.documentElement;
  const incognitoContext = chrome.extension?.inIncognitoContext === true;
  const cacheKey = 'cosmicGeminiSettingsViewCache';
  const emptyKeys = {
    inactiveRules: 'emptyInactiveSites',
    enhancedRules: 'emptyEnhancedSites',
    standardRules: 'emptyStandardSites',
    permanentAudioAllowRules: 'emptyAudioAllow',
    whitelistRules: 'emptySharedWhitelist',
    blockedDomains: 'accessControlEmptyDomains'
  };
  const iconPaths = {
    followListInstagram: '<g stroke-width="1.7"><path d="M2 7h3M3.5 7v10M2 17h3M14 8.5a4.5 5 0 1 0 0 7v-3h-3.5M17 10h5M19.5 7.5v5M17 16h5"/></g>',
    nativeScroll: '<path d="M12 3v18M7.5 7.5 12 3l4.5 4.5M7.5 16.5 12 21l4.5-4.5"/>',
    noAutoplay: '<path d="M6 5v14l10-7z"/><path d="M21 18A4 4 0 1 1 17 14a3.3 3.3 0 0 0 4 4Z" fill="currentColor" stroke="none"/>',
    anyCopy: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/>',
    anyCopyEnhanced: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/><path d="m17.6 10.6-5.8 7.8h4.5l-.7 4.7 6.6-8.6h-4.8z" fill="currentColor" stroke="var(--icon-surface, var(--surface))" stroke-width="1.8" paint-order="stroke fill"/>',
    imageDownload: '<rect x="2.75" y="3.75" width="12.75" height="12.75" rx="2"/><path d="m4.8 13.3 2.9-3.1 2.2 2.1 2.4-3.3 3.1 3.8"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    videoDownload: '<path d="M6 5v14l10-7z"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    reduceWhitePoint: '<path d="M8.7 15.5A6.4 6.4 0 1 1 15.3 15.5C14.5 16.1 14 17 14 18H10c0-1-.5-1.9-1.3-2.5Z"/><path d="M10 21h4M9.5 18h5"/>',
    greyscale: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none"/>',
    mailtoCapture: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    documentPreview: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h6"/>',
    whiteSofter: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 13c5-5 12 3 17-2M3.5 17c5-5 12 3 17-2"/>',
    clipboardProtect: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 5V3h6v2M9 9h6M9 13h6M9 17h4"/>',
    accessControl: '<path d="m5 3 13.5 9.1-6.1 1.25L9.5 20Z"/><path d="M12.4 13.35 15.952 18.318"/>',
    websiteKnowledgeControl: '<rect x="2.75" y="4" width="18.5" height="16" rx="2.5"/><path d="M3 8h18M6 6h.01M9 6h.01M12 6h.01"/><path d="M7 12h10M7 15.5h7"/>',
    websiteFixer: '<path d="M20 7.5a5.4 5.4 0 0 1-7.2 5.1l-6.6 6.6a2 2 0 0 1-2.8-2.8l6.6-6.6A5.4 5.4 0 0 1 15.1 2l-2.8 2.8.6 3 3 .6L20 4.3a5.4 5.4 0 0 1 0 3.2Z"/>',
    adMarshal: '<path d="M12 2.75 20 6v5.2c0 5.1-3.1 8.55-8 10.05-4.9-1.5-8-4.95-8-10.05V6Z"/><path d="m8.5 12 2.25 2.25L16 9"/>',
    leetcodeDarkMode: '<path d="m5 6.5 6 5.5-6 5.5M13 17.5h6"/>',
    langGoogle: '<circle cx="10.7" cy="10.7" r="6.5"/><path d="m15.3 15.3 4.5 4.5"/>',
    biliDailyLogin: '<path d="m8 5-2.5-2M16 5l2.5-2"/><rect x="3" y="5" width="18" height="15.5" rx="3"/><path d="M8 12h.01M16 12h.01M8.5 16c2.1 1.15 4.9 1.15 7 0"/>',
    xhsImageDarkMode: '<path d="M12 5.1C9.1 3 6 2.6 2.8 4.2v12.1c1.7-.85 3.3-1.18 4.7-1.12"/><path d="M12 5.1C9.1 3 6 2.6 2.8 4.2v12.1c1.7-.85 3.3-1.18 4.7-1.12" transform="translate(24 0) scale(-1 1)"/><path d="M12 5.1v.9"/><g transform="translate(0 1.3)"><path d="M12 7.35c-2.35 0-4.1 1.8-4.1 4.15 0 1.65.68 2.88 1.5 4.05.54.76.88 1.5.88 2.3h3.44c0-.8.34-1.54.88-2.3.82-1.17 1.5-2.4 1.5-4.05 0-2.35-1.75-4.15-4.1-4.15Z" fill="var(--icon-surface, var(--surface))" stroke="var(--icon-surface, var(--surface))" stroke-width="3.8"/><path d="M12 7.35c-2.35 0-4.1 1.8-4.1 4.15 0 1.65.68 2.88 1.5 4.05.54.76.88 1.5.88 2.3h3.44c0-.8.34-1.54.88-2.3.82-1.17 1.5-2.4 1.5-4.05 0-2.35-1.75-4.15-4.1-4.15Z" fill="var(--icon-surface, var(--surface))"/><path d="M10.1 20h3.8"/></g>',
    pageDisplay: '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
    satellites: '<path d="M15 2C15.6 8.1 17.9 11.4 22 12c-4.1.6-6.4 3.9-7 10-.6-6.1-2.9-9.4-7-10 4.1-.6 6.4-3.9 7-10Z" fill="currentColor" stroke="none"/><path d="M5.25 2c.25 1.95 1.05 2.75 3 3-1.95.25-2.75 1.05-3 3-.25-1.95-1.05-2.75-3-3 1.95-.25 2.75-1.05 3-3Z" fill="currentColor" stroke="none"/><path d="M6.25 12.25c.35 2.8 1.45 3.9 4.25 4.25-2.8.35-3.9 1.45-4.25 4.25-.35-2.8-1.45-3.9-4.25-4.25 2.8-.35 3.9-1.45 4.25-4.25Z" fill="currentColor" stroke="none"/>',
    allSettings: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/>'
  };
  let preferred = '';
  if (!incognitoContext) {
    try { preferred = localStorage.getItem('cosmicGeminiInterfaceLocale') || ''; } catch {}
  }
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
  const isIpRule = rule => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(rule)
    || (rule.startsWith('[') && rule.endsWith(']'));

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
  const manifest = chrome.runtime.getManifest();
  if (version) version.textContent = translate('version', { version: manifest.version_name || manifest.version });

  let cached = {};
  if (!incognitoContext) {
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch {}
  }
  const feature = document.body.dataset.feature;
  const current = cached[feature] || {};
  const cachedRules = name => Array.isArray(current[name])
    ? current[name].filter(rule => typeof rule === 'string')
    : [];
  const inactiveRules = cachedRules('inactiveRules');
  const explicitStandardRules = cachedRules('standardRules').filter(rule => !inactiveRules.includes(rule));
  const enhancedRules = cachedRules('enhancedRules')
    .filter(rule => !inactiveRules.includes(rule) && !explicitStandardRules.includes(rule));
  const behaviorRules = {
    inactiveRules,
    standardRules: explicitStandardRules,
    enhancedRules
  };
  const enabled = document.querySelector('#enabled');
  if (enabled) enabled.checked = incognitoContext ? false : typeof current.enabled === 'boolean' ? current.enabled : enabled.checked;
  const noAutoplayAudioOptions = document.querySelector('#noAutoplayAudioOptions');
  if (noAutoplayAudioOptions) noAutoplayAudioOptions.disabled = !enabled?.checked;
  const introSetting = document.querySelector('.intro-setting');
  if (introSetting && ['nativeScroll', 'noAutoplay'].includes(feature) && incognitoContext) {
    introSetting.textContent = translate('disabledByDefaultInIncognito');
    introSetting.hidden = false;
  }
  const audioAutoplayAllSites = document.querySelector('#audioAutoplayAllSites');
  if (audioAutoplayAllSites) audioAutoplayAllSites.checked = current.audioAutoplayAllSites === true;
  const biliDailyLogin = document.querySelector('#biliDailyLogin');
  if (biliDailyLogin) {
    biliDailyLogin.checked = !incognitoContext && current.biliDailyLogin?.enabled === true;
    if (incognitoContext) {
      biliDailyLogin.closest('.switch').hidden = true;
      const status = biliDailyLogin.closest('.satellite-control')?.querySelector('.incognito-status');
      if (status) status.hidden = false;
    }
  }
  const mailtoCaptureEnabled = document.querySelector('#mailtoCaptureEnabled');
  if (mailtoCaptureEnabled) {
    mailtoCaptureEnabled.checked = !incognitoContext && cached.mailtoCapture?.enabled === true;
  }
  const leetcodeDarkModeEnabled = document.querySelector('#leetcodeDarkModeEnabled');
  if (leetcodeDarkModeEnabled) leetcodeDarkModeEnabled.checked = !incognitoContext && cached.leetcodeDarkMode?.enabled === true;
  const langGoogleEnabled = document.querySelector('#langGoogleEnabled');
  if (langGoogleEnabled) langGoogleEnabled.checked = !incognitoContext && cached.langGoogle?.enabled === true;
  const clipboardProtectEnabled = document.querySelector('#clipboardProtectEnabled');
  if (clipboardProtectEnabled) clipboardProtectEnabled.checked = !incognitoContext && cached.clipboardProtect?.enabled === true;
  const whiteSofterEnabled = document.querySelector('#whiteSofterEnabled');
  if (whiteSofterEnabled) {
    whiteSofterEnabled.checked = !incognitoContext && cached.whiteSofter?.enabled === true;
    document.querySelector('#whiteSofterOptions').disabled = !whiteSofterEnabled.checked;
    document.querySelector('#whiteSofterTone').value = !incognitoContext && ['warm-plus-1', 'warm-plus-2', 'cool'].includes(cached.whiteSofter?.tone) ? cached.whiteSofter.tone : 'warm';
  }
  const documentPreviewEnabled = document.querySelector('#documentPreviewEnabled');
  if (documentPreviewEnabled) {
    documentPreviewEnabled.checked = !incognitoContext && cached.documentPreview?.enabled === true;
    document.querySelector('#documentPreviewOptions').disabled = !documentPreviewEnabled.checked;
    const sampling = incognitoContext ? 4 : cached.documentPreview?.pdfSampling;
    document.querySelector('#documentPdfSampling').value = [1, 2, 3, 4, 5, 6].includes(sampling) ? sampling : 4;
    const appearance = incognitoContext ? 'auto' : cached.documentPreview?.appearance;
    document.querySelector('#documentPreviewAppearance').value = ['auto', 'light', 'dark'].includes(appearance) ? appearance : 'auto';
  }
  const accessControlEnabled = document.querySelector('#accessControlEnabled');
  if (accessControlEnabled) {
    accessControlEnabled.checked = cached.accessControl?.enabled === true;
    document.querySelector('#accessControlTemporaryVisits').checked = cached.accessControl?.allowTemporaryVisits === true;
    document.querySelector('#accessControlOptions').disabled = !accessControlEnabled.checked;
  }
  const websiteFixerEnabled = document.querySelector('#websiteFixerEnabled');
  if (websiteFixerEnabled) {
    websiteFixerEnabled.checked = cached.websiteFixer?.enabled === true;
    const translateOverride = document.querySelector('#websiteFixerTranslateOverrideEnabled');
    translateOverride.checked = cached.websiteFixer?.translateOverride?.enabled === true;
    document.querySelector('#websiteFixerOptions').disabled = !websiteFixerEnabled.checked;
    document.querySelector('#websiteFixerTranslateOptions').disabled = !websiteFixerEnabled.checked || !translateOverride.checked;
    const stay = document.querySelector('#websiteFixerStayOnPageEnabled');
    stay.checked = cached.websiteFixer?.stayOnPage?.enabled === true;
    const savedCount = cached.websiteFixer?.stayOnPage?.savedCount || 0;
    document.querySelector('[data-setting-group="stayOnPage"] .website-fixer-count').textContent = translate(
      savedCount === 1 ? 'websiteFixerSavedCountOne' : 'websiteFixerSavedCountMany', { count: savedCount });
    document.querySelector('#websiteFixerStayOptions').disabled = !websiteFixerEnabled.checked || !stay.checked;
  }
  const knowledge = cached.websiteKnowledgeControl;
  const knowledgeEnabled = document.querySelector('#websiteKnowledgeEnabled');
  if (knowledgeEnabled) {
    knowledgeEnabled.checked = knowledge?.enabled === true;
    document.querySelector('#websiteKnowledgeOptions').disabled = !knowledgeEnabled.checked;
    for (const [category, suffix] of [['languages', 'Languages'], ['timeZone', 'TimeZone'], ['globalPrivacyControl', 'GlobalPrivacyControl']]) {
      const control = document.querySelector('#websiteKnowledge' + suffix);
      control.checked = knowledge?.[category]?.enabled === true;
      const value = document.querySelector('#websiteKnowledge' + suffix + 'Value');
      if (value) {
        const selected = knowledge?.[category]?.value || (category === 'timeZone' ? 'America/New_York' : 'en-US');
        if (![...value.options].some(option => option.value === selected)) value.add(new Option(selected, selected));
        value.value = selected;
        value.disabled = !knowledgeEnabled.checked || !control.checked;
      }
    }
  }
  const chineseResponseClaudeEnabled = document.querySelector('#chineseResponseClaudeEnabled');
  if (chineseResponseClaudeEnabled) {
    chineseResponseClaudeEnabled.checked = cached.chineseResponseClaude?.enabled === true;
  }
  const claudeBrowserIdentityEnabled = document.querySelector('#claudeBrowserIdentityEnabled');
  if (claudeBrowserIdentityEnabled) {
    claudeBrowserIdentityEnabled.checked = cached.chineseResponseClaude?.browserIdentityEnabled === true;
  }
  const pageDisplayEnabled = cached.pageDisplay?.enabled === true;
  if (feature === 'pageDisplay') document.body.dataset.pageDisplayEnabled = String(pageDisplayEnabled);
  const reduceWhitePointEnabled = document.querySelector('#pageDisplayReduceWhitePointEnabled');
  const reduceWhitePointActive = cached.pageDisplay?.reduceWhitePoint?.enabled === true;
  if (reduceWhitePointEnabled) {
    reduceWhitePointEnabled.checked = reduceWhitePointActive;
    reduceWhitePointEnabled.disabled = !pageDisplayEnabled;
  }
  const greyscaleEnabled = document.querySelector('#pageDisplayGreyscaleEnabled');
  if (greyscaleEnabled) {
    greyscaleEnabled.checked = cached.pageDisplay?.greyscale?.enabled === true;
    greyscaleEnabled.disabled = !pageDisplayEnabled;
  }
  const reduceWhitePointReduction = document.querySelector('#reduceWhitePointReduction');
  const reduceWhitePointReductionValue = document.querySelector('#reduceWhitePointReductionValue');
  if (reduceWhitePointReduction) {
    const percentage = Math.round((cached.pageDisplay?.reduceWhitePoint?.reduction ?? 0.25) * 100);
    reduceWhitePointReduction.value = String(percentage);
    reduceWhitePointReduction.disabled = !pageDisplayEnabled || !reduceWhitePointActive;
    if (reduceWhitePointReductionValue) reduceWhitePointReductionValue.textContent = `${percentage}%`;
  }
  const xhsImageDarkModeEnabled = document.querySelector('#xhsImageDarkModeEnabled');
  const xhsEnabled = cached.xhsImageDarkMode?.enabled === true;
  if (xhsImageDarkModeEnabled) xhsImageDarkModeEnabled.checked = xhsEnabled;
  const xhsImageDarkModeOverride = document.querySelector('#xhsImageDarkModeOverride');
  if (xhsImageDarkModeOverride) {
    xhsImageDarkModeOverride.checked = cached.xhsImageDarkMode?.overrideDarkMode === true;
    xhsImageDarkModeOverride.disabled = !xhsEnabled;
  }
  const xhsImageDarkModeControl = document.querySelector('#xhsImageDarkModeControl');
  const xhsImageDarkModeOpacityRow = document.querySelector('.xhs-opacity-row');
  const showXhsImageControl = cached.xhsImageDarkMode?.showImageControl !== false;
  if (xhsImageDarkModeControl) {
    xhsImageDarkModeControl.checked = showXhsImageControl;
    xhsImageDarkModeControl.disabled = !xhsEnabled;
  }
  if (xhsImageDarkModeOpacityRow) xhsImageDarkModeOpacityRow.hidden = !showXhsImageControl;
  const xhsImageDarkModeOpacity = document.querySelector('#xhsImageDarkModeOpacity');
  const xhsImageDarkModeOpacityValue = document.querySelector('#xhsImageDarkModeOpacityValue');
  if (xhsImageDarkModeOpacity) {
    const percentage = Math.round((cached.xhsImageDarkMode?.controlOpacity || 0.5) * 100);
    xhsImageDarkModeOpacity.value = String(percentage);
    xhsImageDarkModeOpacity.disabled = !xhsEnabled || !showXhsImageControl;
    if (xhsImageDarkModeOpacityValue) xhsImageDarkModeOpacityValue.textContent = `${percentage}%`;
  }
  const adMarshalSites = cached.adMarshal?.managedSites || {};
  for (const input of document.querySelectorAll('[data-ad-marshal-site]')) {
    input.checked = adMarshalSites[input.dataset.adMarshalSite] === true;
  }
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
    if (section.dataset.hiddenList === 'true') {
      section.querySelector('[data-reset-websites]').disabled = true;
      continue;
    }
    const listName = section.dataset.listSection;
    const sectionFeature = cached[section.dataset.featureId || feature] || {};
    const sectionState = section.dataset.settingGroup ? sectionFeature[section.dataset.settingGroup] || {} : sectionFeature;
    const list = section.querySelector('.rule-list');
    const rules = Array.isArray(sectionState[listName]) ? sectionState[listName].filter(rule => typeof rule === 'string') : [];
    const note = section.querySelector('.rule-list-note');
    if (note) {
      note.hidden = !rules.some(rule => !isIpRule(rule));
      if (!note.hidden) note.textContent = translate('generalDomainListNote');
    }
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
