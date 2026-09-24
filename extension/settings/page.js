import { loadLocale } from '../core/locale.js';
import { isIpAddress, normalizeAccessControlDomain, normalizeWebsiteFixerDomain, normalizeWebsiteFixerSite } from '../core/config.js';
import { saveSettingsViewCache } from '../core/settings-view-cache.js';
import { ACCESS_CONTROL_ALIAS_GROUPS, normalizeAccessControlRuleInput, normalizeGeneralDomainInput, normalizeWebsiteRuleInput } from '../core/website-rule-input.js';
import { localizeDocument, translator } from '../shared/localization.js';
import { icon, retryRead, send } from '../shared/ui.js';
import { createSettingsState } from './state.js';
import { PRODUCT_META, featureFromPath, viewFor } from './views.js';

const claimSettings = openedAt => void send({ type: 'UI_SETTINGS_OPENED', openedAt }).catch(() => {});
claimSettings(performance.timeOrigin);
addEventListener('pageshow', event => { if (event.persisted) claimSettings(performance.timeOrigin + performance.now()); });

const root = document.documentElement;
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 8;
const incognitoContext = chrome.extension?.inIncognitoContext === true;
const primary = document.querySelector('.primary');
const helpPanel = document.querySelector('.help');
const emptyKey = {
  inactiveRules: 'emptyInactiveSites',
  enhancedRules: 'emptyEnhancedSites',
  standardRules: 'emptyStandardSites',
  permanentAudioAllowRules: 'emptyAudioAllow',
  whitelistRules: 'emptySharedWhitelist',
  blockedDomains: 'accessControlEmptyDomains'
};
const behaviorByList = Object.freeze({
  inactiveRules: 'inactive',
  standardRules: 'standard',
  enhancedRules: 'enhanced'
});
const behaviorLabel = Object.freeze({
  inactive: 'inactiveSitesHeading',
  standard: 'standardSitesHeading',
  enhanced: 'enhancedSitesHeading'
});
let featureId = featureFromPath(location.pathname);
let locale = root.lang === 'zh-CN' ? 'zh-CN' : 'en-US';
let t = translator(locale);
let states = null;
const pendingControls = new Set();
const settingsState = createSettingsState();
const listSignatures = new WeakMap();
const websiteFixerSavedTimers = new WeakMap();
let pendingWebsiteResetButton = null;
let storageSyncTimer = 0;
let settingsUiPort = null;
let settingsUiReconnectAttempts = 0;
let pageClosing = false;
let localeSaving = false;
let localeGeneration = 0;
let ruleInputHelpPanel = null;
let developerMode = null;
let developerModeModule = null;

document.addEventListener('keydown', event => {
  if (event.key !== '1' || event.repeat || event.isComposing || event.defaultPrevented
    || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  // Keep typed website addresses and other editable text untouched.
  if (event.target.closest?.('textarea, [contenteditable]:not([contenteditable="false"]), input:not([type]), input:is([type="text"], [type="search"], [type="url"], [type="email"], [type="tel"], [type="number"], [type="password"])')) return;
  event.preventDefault();
  developerModeModule ||= import('./developer-mode.js');
  void developerModeModule.then(({ createDeveloperMode }) => {
    developerMode ||= createDeveloperMode(document);
    developerMode.toggle(t);
  }).catch(() => { developerModeModule = null; });
});

function state() {
  return (states?.preferences || states)?.[featureId] || null;
}

function sectionState(section) {
  const current = (states?.preferences || states)?.[section.dataset.featureId || featureId];
  return section.dataset.settingGroup ? current?.[section.dataset.settingGroup] || null : current || null;
}

function disarmWebsiteReset() {
  if (!pendingWebsiteResetButton) return;
  const button = pendingWebsiteResetButton;
  pendingWebsiteResetButton = null;
  delete button.dataset.confirming;
  button.dataset.i18n = 'websiteFixerResetList';
  button.textContent = t('websiteFixerResetList');
}

document.addEventListener('click', event => {
  if (pendingWebsiteResetButton && !pendingWebsiteResetButton.contains(event.target)) disarmWebsiteReset();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') disarmWebsiteReset();
});

function applyLocale() {
  root.lang = locale;
  t = translator(locale);
  localizeDocument(t);
  document.title = 'Cosmic Gemini · ' + PRODUCT_META[featureId].name;
  const language = document.querySelector('#language');
  if (language) { language.value = locale; language.disabled = localeSaving; }
  const manifest = chrome.runtime.getManifest();
  document.querySelector('#version').textContent = t('version', { version: manifest.version_name || manifest.version });
  const titles = {
    nativeScroll: 'switchNativeSettings',
    noAutoplay: 'switchAutoplaySettings',
    anyCopy: 'switchAnyCopySettings',
    imageDownload: 'switchImageDownloadSettings',
    videoDownload: 'switchVideoDownloadSettings',
    pageDisplay: 'switchPageDisplaySettings',
    satellites: 'switchSatellitesSettings',
    allSettings: 'switchAllSettings'
  };
  for (const link of document.querySelectorAll('[data-feature-link]')) {
    link.title = t(titles[link.dataset.featureLink]);
    link.setAttribute('aria-label', link.title);
  }
  if (ruleInputHelpPanel?.dialog.open && ruleInputHelpPanel.input?.isConnected) {
    openRuleInputHelp(ruleInputHelpPanel.input);
  }
  developerMode?.render(t);
}

function renderList(section) {
  const current = sectionState(section);
  if (!current) return;
  const listName = section.dataset.listSection;
  const list = section.querySelector('.rule-list');
  const rules = current[listName] || [];
  if (section.dataset.hiddenList === 'true') {
    if (!rules.length && pendingWebsiteResetButton === section.querySelector('[data-reset-websites]')) disarmWebsiteReset();
    section.querySelector('[data-reset-websites]').disabled = !rules.length;
    section.querySelector('.website-fixer-count').textContent = t(
      rules.length === 1 ? 'websiteFixerSavedCountOne' : 'websiteFixerSavedCountMany', { count: rules.length });
    return;
  }
  const note = section.querySelector('.rule-list-note');
  if (note) {
    note.hidden = !rules.some(rule => !isIpAddress(rule));
    if (!note.hidden) note.textContent = t('generalDomainListNote');
  }
  const signature = JSON.stringify([locale, rules]);
  if (listSignatures.get(list) === signature
    || [...pendingControls].some(control => list.contains(control))) return;
  listSignatures.set(list, signature);
  list.replaceChildren();
  if (!rules.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = t(section.dataset.emptyKey || emptyKey[listName]);
    list.append(empty);
    return;
  }
  for (const rule of rules) {
    const item = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = rule;
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.innerHTML = icon('trash');
    remove.title = t('removeRule', { rule });
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => void update(section, () => savePreference(section.dataset.featureId || featureId,
      section.dataset.featureId === 'nsna'
        ? { type: 'UI_DELETE_NSNA_WHITELIST_RULE', rule }
        : { type: 'UI_DELETE_RULE', featureId: section.dataset.featureId || featureId, settingGroup: section.dataset.settingGroup, listName, rule }
    ), [remove]));
    item.append(code, remove);
    list.append(item);
  }
}

function createBehaviorSelect(rule, selected) {
  const select = document.createElement('select');
  select.className = 'behavior-rule-select';
  select.setAttribute('aria-label', t('changeBehaviorForRule', { rule }));
  for (const behavior of ['inactive', 'standard', 'enhanced']) {
    const option = document.createElement('option');
    option.value = behavior;
    option.textContent = t(behaviorLabel[behavior]);
    select.append(option);
  }
  select.value = selected;
  return select;
}

function renderBehaviorList(section) {
  const current = state();
  if (!current) return;
  const listName = section.dataset.behaviorList;
  const selected = behaviorByList[listName];
  const rules = current[listName] || [];
  const list = section.querySelector('.rule-list');
  const signature = JSON.stringify([locale, rules]);
  if (listSignatures.get(list) === signature
    || [...pendingControls].some(control => list.contains(control))) return;
  listSignatures.set(list, signature);
  list.replaceChildren();
  if (!rules.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = t(section.dataset.emptyKey || emptyKey[listName]);
    list.append(empty);
    return;
  }
  for (const rule of rules) {
    const item = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = rule;
    const select = createBehaviorSelect(rule, selected);
    select.addEventListener('change', () => void update(section.closest('[data-behavior-card]'), () => savePreference(featureId, {
      type: 'UI_SET_BEHAVIOR_RULE', featureId, rule, behavior: select.value
    }), [select]));
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.innerHTML = icon('trash');
    remove.title = t('removeRule', { rule });
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => void update(section.closest('[data-behavior-card]'), () => savePreference(featureId, {
      type: 'UI_DELETE_BEHAVIOR_RULE', featureId, rule
    }), [remove]));
    const controls = document.createElement('span');
    controls.className = 'behavior-rule-controls';
    controls.append(select, remove);
    item.append(code, controls);
    list.append(item);
  }
}

function render() {
  const current = state();
  if (!current) return;
  const pendingValues = [...pendingControls].map(control => ({ control, value: control.value, checked: control.checked }));
  const incognito = incognitoContext || states?.incognito === true;
  const enabled = document.querySelector('#enabled');
  if (enabled) enabled.checked = current.enabled;
  const introSetting = document.querySelector('.intro-setting');
  if (introSetting && ['nativeScroll', 'noAutoplay'].includes(featureId) && incognito) {
    introSetting.textContent = t('disabledByDefaultInIncognito');
    introSetting.hidden = false;
  }
  const audioAutoplayAllSites = document.querySelector('#audioAutoplayAllSites');
  if (audioAutoplayAllSites) audioAutoplayAllSites.checked = current.audioAutoplayAllSites === true;
  const biliDailyLogin = document.querySelector('#biliDailyLogin');
  if (biliDailyLogin) {
    const available = states?.satellites?.biliDailyLogin?.available !== false && !incognito;
    biliDailyLogin.checked = available && current.biliDailyLogin?.enabled === true;
    biliDailyLogin.closest('.switch').hidden = !available;
    const status = biliDailyLogin.closest('.satellite-control')?.querySelector('.incognito-status');
    if (status) status.hidden = available;
  }
  const mailtoCaptureEnabled = document.querySelector('#mailtoCaptureEnabled');
  if (mailtoCaptureEnabled) {
    mailtoCaptureEnabled.checked = (states?.preferences || states)?.mailtoCapture?.enabled === true;
  }
  const clipboardProtectEnabled = document.querySelector('#clipboardProtectEnabled');
  if (clipboardProtectEnabled) clipboardProtectEnabled.checked = (states?.preferences || states)?.clipboardProtect?.enabled === true;
  const whiteSofterEnabled = document.querySelector('#whiteSofterEnabled');
  if (whiteSofterEnabled) {
    const preference = (states?.preferences || states)?.whiteSofter;
    whiteSofterEnabled.checked = preference?.enabled === true;
    document.querySelector('#whiteSofterOptions').disabled = !whiteSofterEnabled.checked;
    document.querySelector('#whiteSofterTone').value = ['warm-minus-1', 'warm-plus-1', 'warm-plus-2', 'cool'].includes(preference?.tone) ? preference.tone : 'warm';
  }
  const documentPreviewEnabled = document.querySelector('#documentPreviewEnabled');
  if (documentPreviewEnabled) {
    const preference = (states?.preferences || states)?.documentPreview;
    documentPreviewEnabled.checked = preference?.enabled === true;
    document.querySelector('#documentPreviewOptions').disabled = !documentPreviewEnabled.checked;
    document.querySelector('#documentPreviewAppearance').value = preference?.appearance || 'auto';
    document.querySelector('#documentPdfSampling').value = preference?.pdfSampling || 4;
  }
  const leetcodeDarkModeEnabled = document.querySelector('#leetcodeDarkModeEnabled');
  const langGoogleEnabled = document.querySelector('#langGoogleEnabled');
  if (leetcodeDarkModeEnabled) leetcodeDarkModeEnabled.checked = (states?.preferences || states)?.leetcodeDarkMode?.enabled === true;
  if (langGoogleEnabled) langGoogleEnabled.checked = (states?.preferences || states)?.langGoogle?.enabled === true;
  const accessControl = (states?.preferences || states)?.accessControl;
  const accessControlEnabled = document.querySelector('#accessControlEnabled');
  if (accessControlEnabled) {
    accessControlEnabled.checked = accessControl?.enabled === true;
    document.querySelector('#accessControlTemporaryVisits').checked = accessControl?.allowTemporaryVisits === true;
    document.querySelector('#accessControlOptions').disabled = !accessControlEnabled.checked;
  }
  const websiteFixer = (states?.preferences || states)?.websiteFixer;
  const websiteFixerEnabled = document.querySelector('#websiteFixerEnabled');
  const websiteFixerTranslateOverrideEnabled = document.querySelector('#websiteFixerTranslateOverrideEnabled');
  if (websiteFixerEnabled) {
    websiteFixerEnabled.checked = websiteFixer?.enabled === true;
    websiteFixerTranslateOverrideEnabled.checked = websiteFixer?.translateOverride?.enabled === true;
    document.querySelector('#websiteFixerStayOnPageEnabled').checked = websiteFixer?.stayOnPage?.enabled === true;
  }
  const knowledge = (states?.preferences || states)?.websiteKnowledgeControl;
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
    chineseResponseClaudeEnabled.checked = (states?.preferences || states)?.chineseResponseClaude?.enabled === true;
  }
  const claudeBrowserIdentityEnabled = document.querySelector('#claudeBrowserIdentityEnabled');
  if (claudeBrowserIdentityEnabled) {
    claudeBrowserIdentityEnabled.checked = (states?.preferences || states)?.chineseResponseClaude?.browserIdentityEnabled === true;
  }
  const pageDisplaySettings = (states?.preferences || states)?.pageDisplay;
  const pageDisplayEnabled = pageDisplaySettings?.enabled === true;
  if (featureId === 'pageDisplay') document.body.dataset.pageDisplayEnabled = String(pageDisplayEnabled);
  const reduceWhitePointEnabled = document.querySelector('#pageDisplayReduceWhitePointEnabled');
  const reduceWhitePointActive = pageDisplaySettings?.reduceWhitePoint?.enabled === true;
  if (reduceWhitePointEnabled) {
    reduceWhitePointEnabled.checked = reduceWhitePointActive;
    reduceWhitePointEnabled.disabled = !pageDisplayEnabled;
  }
  const greyscaleEnabled = document.querySelector('#pageDisplayGreyscaleEnabled');
  if (greyscaleEnabled) {
    greyscaleEnabled.checked = pageDisplaySettings?.greyscale?.enabled === true;
    greyscaleEnabled.disabled = !pageDisplayEnabled;
  }
  const reduceWhitePointReduction = document.querySelector('#reduceWhitePointReduction');
  const reduceWhitePointReductionValue = document.querySelector('#reduceWhitePointReductionValue');
  if (reduceWhitePointReduction) {
    const percentage = Math.round((pageDisplaySettings?.reduceWhitePoint?.reduction ?? 0.25) * 100);
    reduceWhitePointReduction.value = String(percentage);
    reduceWhitePointReduction.disabled = !pageDisplayEnabled || !reduceWhitePointActive;
    if (reduceWhitePointReductionValue) reduceWhitePointReductionValue.textContent = `${percentage}%`;
  }
  const xhsSettings = (states?.preferences || states)?.xhsImageDarkMode;
  const xhsImageDarkModeEnabled = document.querySelector('#xhsImageDarkModeEnabled');
  const xhsEnabled = xhsSettings?.enabled === true;
  if (xhsImageDarkModeEnabled) xhsImageDarkModeEnabled.checked = xhsEnabled;
  const xhsImageDarkModeOverride = document.querySelector('#xhsImageDarkModeOverride');
  if (xhsImageDarkModeOverride) {
    xhsImageDarkModeOverride.checked = xhsSettings?.overrideDarkMode === true;
    xhsImageDarkModeOverride.disabled = !xhsEnabled;
  }
  const xhsImageDarkModeControl = document.querySelector('#xhsImageDarkModeControl');
  const xhsImageDarkModeOpacityRow = document.querySelector('.xhs-opacity-row');
  const showXhsImageControl = xhsSettings?.showImageControl !== false;
  if (xhsImageDarkModeControl) {
    xhsImageDarkModeControl.checked = showXhsImageControl;
    xhsImageDarkModeControl.disabled = !xhsEnabled;
  }
  if (xhsImageDarkModeOpacityRow) xhsImageDarkModeOpacityRow.hidden = !showXhsImageControl;
  const xhsImageDarkModeOpacity = document.querySelector('#xhsImageDarkModeOpacity');
  const xhsImageDarkModeOpacityValue = document.querySelector('#xhsImageDarkModeOpacityValue');
  if (xhsImageDarkModeOpacity) {
    const percentage = Math.round((xhsSettings?.controlOpacity || 0.5) * 100);
    xhsImageDarkModeOpacity.value = String(percentage);
    xhsImageDarkModeOpacity.disabled = !xhsEnabled || !showXhsImageControl;
    if (xhsImageDarkModeOpacityValue) xhsImageDarkModeOpacityValue.textContent = `${percentage}%`;
  }
  const adMarshalSites = (states?.preferences || states)?.adMarshal?.managedSites || {};
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
  for (const section of document.querySelectorAll('[data-list-section]')) renderList(section);
  for (const section of document.querySelectorAll('[data-behavior-list]')) renderBehaviorList(section);
  for (const { control, value, checked } of pendingValues) {
    control.value = value;
    control.checked = checked;
  }
  const noAutoplayAudioOptions = document.querySelector('#noAutoplayAudioOptions');
  if (noAutoplayAudioOptions) noAutoplayAudioOptions.disabled = !enabled?.checked;
  if (reduceWhitePointReduction) {
    reduceWhitePointReduction.disabled = !pageDisplayEnabled || !reduceWhitePointEnabled.checked;
    if (reduceWhitePointReductionValue) reduceWhitePointReductionValue.textContent = `${reduceWhitePointReduction.value}%`;
  }
  if (xhsImageDarkModeOverride) xhsImageDarkModeOverride.disabled = !xhsImageDarkModeEnabled.checked;
  if (xhsImageDarkModeControl) xhsImageDarkModeControl.disabled = !xhsImageDarkModeEnabled.checked;
  if (xhsImageDarkModeOpacityRow) xhsImageDarkModeOpacityRow.hidden = !xhsImageDarkModeControl.checked;
  if (xhsImageDarkModeOpacity) {
    xhsImageDarkModeOpacity.disabled = !xhsImageDarkModeEnabled.checked || !xhsImageDarkModeControl.checked;
    if (xhsImageDarkModeOpacityValue) xhsImageDarkModeOpacityValue.textContent = `${xhsImageDarkModeOpacity.value}%`;
  }
  for (const control of pendingControls) control.disabled = true;
  if (documentPreviewEnabled) document.querySelector('#documentPreviewOptions').disabled = !documentPreviewEnabled.checked;
  if (websiteFixerEnabled) {
    document.querySelector('#websiteFixerOptions').disabled = !websiteFixerEnabled.checked;
    document.querySelector('#websiteFixerTranslateOptions').disabled = !websiteFixerEnabled.checked
      || !websiteFixerTranslateOverrideEnabled.checked;
    document.querySelector('#websiteFixerStayOptions').disabled = !websiteFixerEnabled.checked
      || !document.querySelector('#websiteFixerStayOnPageEnabled').checked;
  }
}

async function reload() {
  if (storageSyncTimer) clearTimeout(storageSyncTimer);
  storageSyncTimer = 0;
  if (!await settingsState.read(() => send({ type: 'UI_GET', url: '' }))) return;
  states = settingsState.value;
  if (!incognitoContext) saveSettingsViewCache(states.preferences || states);
  render();
}

function scheduleStoredStateSync() {
  if (storageSyncTimer) clearTimeout(storageSyncTimer);
  storageSyncTimer = setTimeout(() => {
    storageSyncTimer = 0;
    void (async () => {
      const localeTicket = localeGeneration;
      const storedLocale = await loadLocale({ cacheResult: false });
      if (!localeSaving && localeTicket === localeGeneration && storedLocale !== locale) {
        locale = storedLocale;
        cacheLocale();
        applyLocale();
      }
      await reloadAfterUpdate();
    })();
  }, 120);
}

function connectSettingsUi() {
  if (pageClosing || document.hidden || settingsUiPort) return;
  const port = chrome.runtime.connect({ name: 'central-ui:settings' });
  settingsUiPort = port;
  port.onMessage.addListener(message => {
    if (message?.type === 'central-state-changed' && message.global === true) scheduleStoredStateSync();
  });
  setTimeout(() => {
    if (settingsUiPort === port) settingsUiReconnectAttempts = 0;
  }, 1_000);
  port.onDisconnect.addListener(() => {
    if (settingsUiPort !== port) return;
    settingsUiPort = null;
    if (pageClosing || document.hidden || settingsUiReconnectAttempts >= 5) return;
    settingsUiReconnectAttempts += 1;
    setTimeout(connectSettingsUi, Math.min(250 * (2 ** settingsUiReconnectAttempts), 4_000));
  });
}

async function reloadAfterUpdate() {
  try { await retryRead(() => reload()); }
  catch { setTimeout(() => { void retryRead(() => reload()).catch(() => {}); }, 800); }
}

async function savePreference(preference, command, toPreference) {
  const result = await settingsState.write(preference, () => send(command), toPreference);
  states = settingsState.value;
  if (!incognitoContext && settingsState.loaded) saveSettingsViewCache(states.preferences);
  return result;
}

function cacheLocale() {
  if (!incognitoContext) {
    try { localStorage.setItem('cosmicGeminiInterfaceLocale', locale); } catch {}
  }
}

function actionMessage(section, controls) {
  const container = section || controls[0]?.closest('.card');
  if (!container) return null;
  let message = container.querySelector('.form-message');
  if (!message) {
    message = document.createElement('p');
    message.className = 'form-message action-message';
    message.setAttribute('role', 'status');
    message.hidden = true;
    container.append(message);
  }
  return message;
}

function bindEmptyRuleSort(button, input, sort) {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let suppressClickUntil = 0;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
  };
  button.addEventListener('pointerdown', event => {
    cancel();
    suppressClickUntil = 0;
    if (input.value.trim() || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    startX = Number(event.clientX) || 0;
    startY = Number(event.clientY) || 0;
    try { button.setPointerCapture?.(event.pointerId); } catch {}
    timer = setTimeout(() => {
      timer = 0;
      if (input.value.trim()) return;
      suppressClickUntil = Date.now() + 1_000;
      void sort();
    }, LONG_PRESS_MS);
  });
  button.addEventListener('pointermove', event => {
    if (!timer) return;
    const distance = Math.hypot((Number(event.clientX) || 0) - startX, (Number(event.clientY) || 0) - startY);
    if (distance > LONG_PRESS_MOVE_TOLERANCE) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, cancel);
  }
  button.addEventListener('contextmenu', event => {
    if (timer || Date.now() < suppressClickUntil) event.preventDefault();
  });
  button.addEventListener('click', event => {
    if (Date.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  });
}

function isRuleOrderReset(value) {
  return String(value || '').trim().toLowerCase() === 'reset';
}

function isRuleListClean(value) {
  return String(value || '').trim().toLowerCase() === 'clean';
}

function isRuleInputHelpRequest(value) {
  return ['?', '？'].includes(String(value || '').trim());
}

function helpTextItem(key) {
  const item = document.createElement('li');
  item.textContent = t(key);
  return item;
}

function helpCommandItem(command, key) {
  const item = document.createElement('li');
  const code = document.createElement('code');
  const description = document.createElement('span');
  code.textContent = command;
  description.textContent = t(key);
  item.append(code, description);
  return item;
}

function ensureRuleInputHelpPanel() {
  if (ruleInputHelpPanel?.dialog?.isConnected) return ruleInputHelpPanel;
  const dialog = document.createElement('dialog');
  dialog.id = 'rule-input-help-dialog';
  dialog.className = 'settings-dialog rule-input-help-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const heading = document.createElement('h2');
  const intro = document.createElement('p');
  const behavior = document.createElement('p');
  behavior.className = 'rule-input-help-note';
  const rulesHeading = document.createElement('h3');
  const rules = document.createElement('ul');
  rules.className = 'rule-input-help-list';
  const aliasesSection = document.createElement('section');
  aliasesSection.className = 'rule-input-help-aliases';
  const aliasesHeading = document.createElement('h3');
  const aliases = document.createElement('dl');
  aliasesSection.append(aliasesHeading, aliases);
  const shortcutsHeading = document.createElement('h3');
  const shortcuts = document.createElement('ul');
  shortcuts.className = 'rule-input-help-list rule-input-help-commands';
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const close = document.createElement('button');
  close.type = 'submit';
  close.value = 'close';
  actions.append(close);
  form.append(heading, intro, behavior, rulesHeading, rules, shortcutsHeading, shortcuts, aliasesSection, actions);
  dialog.append(form);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  ruleInputHelpPanel = {
    dialog, heading, intro, behavior, rulesHeading, rules,
    aliasesSection, aliasesHeading, aliases, shortcutsHeading, shortcuts, close
  };
  return ruleInputHelpPanel;
}

function openRuleInputHelp(input) {
  const panel = ensureRuleInputHelpPanel();
  panel.input = input;
  const section = input.closest('[data-list-section]');
  const accessControl = section?.dataset.featureId === 'accessControl';
  const hiddenList = section?.dataset.hiddenList === 'true';
  const websiteFixer = section?.dataset.featureId === 'websiteFixer';
  const documentWhitelist = section?.dataset.featureId === 'documentPreview';
  const behaviorEditor = Boolean(input.closest('[data-behavior-card]'));
  const aliasGroups = accessControl ? ACCESS_CONTROL_ALIAS_GROUPS : [];
  panel.heading.textContent = t(accessControl ? 'accessControlInputHelpHeading' : 'ruleInputHelpHeading');
  panel.intro.textContent = t(documentWhitelist ? 'documentWhitelistDescription' : accessControl ? 'accessControlInputHelpIntro' : 'ruleInputHelpIntro');
  panel.behavior.hidden = !behaviorEditor;
  panel.behavior.textContent = behaviorEditor ? t('ruleInputBehaviorHelp') : '';
  panel.rulesHeading.textContent = t('ruleInputRulesHeading');
  panel.rules.replaceChildren(...(websiteFixer
    ? [helpTextItem('websiteFixerDomainHelp')]
    : documentWhitelist
    ? [helpTextItem('documentWhitelistDomainHelp'), helpTextItem('documentWhitelistIpHelp')]
    : accessControl
    ? [helpTextItem('accessControlInputDomainHelp'), helpTextItem('accessControlInputIpHelp')]
    : [helpTextItem('ruleInputExactHelp'), helpTextItem('ruleInputWildcardHelp')]),
  helpTextItem('ruleInputExpansionHelp'));
  panel.aliasesSection.hidden = aliasGroups.length === 0;
  panel.aliasesHeading.textContent = t('accessControlInputAliasesHeading');
  panel.aliases.replaceChildren();
  if (aliasGroups.length) {
    for (const group of aliasGroups) {
      const aliases = document.createElement('dt');
      const domain = document.createElement('dd');
      aliases.textContent = group.aliases.join(' / ');
      domain.textContent = group.domain;
      panel.aliases.append(aliases, domain);
    }
  }
  panel.shortcutsHeading.textContent = t('ruleInputShortcutsHeading');
  panel.shortcuts.replaceChildren(
    ...(hiddenList ? [] : [helpCommandItem('reset', 'ruleInputResetHelp'),
    helpCommandItem('clean', 'ruleInputCleanHelp'),
    helpCommandItem(t('add'), 'ruleInputLongPressHelp')]),
    helpCommandItem('? / ？', 'ruleInputQuestionHelp')
  );
  panel.close.textContent = t('close');
  if (!panel.dialog.open) panel.dialog.showModal();
}

function bindRuleInputHelp(input) {
  if (input.dataset.ruleInputHelpBound === 'true') return;
  input.dataset.ruleInputHelpBound = 'true';
  input.addEventListener('input', () => {
    if (!input.value.trim()) {
      const container = input.closest('[data-list-section]') || input.closest('[data-behavior-card]');
      const message = container?.querySelector('.form-message');
      if (message) message.textContent = '';
    }
    if (!isRuleInputHelpRequest(input.value)) return;
    input.value = '';
    openRuleInputHelp(input);
  });
}

async function update(section, task, controls = [], errorKey = 'settingsSaveFailed') {
  const actionable = controls.filter(Boolean);
  if (actionable.some(control => pendingControls.has(control))) return;
  for (const control of actionable) {
    pendingControls.add(control);
    control.disabled = true;
  }
  const message = actionMessage(section, actionable);
  if (message) { message.textContent = ''; message.hidden = message.className.includes('action-message'); }
  try { await task(); await reloadAfterUpdate(); }
  catch {
    for (const control of actionable) {
      const list = control.closest('.rule-list');
      if (list) listSignatures.delete(list);
    }
    if (message?.isConnected) { message.textContent = t(errorKey); message.hidden = false; }
  } finally {
    for (const control of actionable) {
      pendingControls.delete(control);
      if (control.isConnected) control.disabled = false;
    }
    render();
  }
}

function bindView() {
  for (const input of document.querySelectorAll('input[type="text"]')) bindRuleInputHelp(input);
  const enabled = document.querySelector('#enabled');
  if (enabled) {
    const enabledFeatureId = featureId;
    enabled.addEventListener('change', () => {
      if (enabledFeatureId === 'noAutoplay') {
        const audioOptions = document.querySelector('#noAutoplayAudioOptions');
        if (audioOptions) audioOptions.disabled = !enabled.checked;
      }
      if (enabledFeatureId === 'pageDisplay') {
        document.body.dataset.pageDisplayEnabled = String(enabled.checked);
        const reduceWhitePointEnabled = document.querySelector('#pageDisplayReduceWhitePointEnabled');
        const greyscaleEnabled = document.querySelector('#pageDisplayGreyscaleEnabled');
        const reduction = document.querySelector('#reduceWhitePointReduction');
        if (reduceWhitePointEnabled) reduceWhitePointEnabled.disabled = !enabled.checked;
        if (greyscaleEnabled) greyscaleEnabled.disabled = !enabled.checked;
        if (reduction) reduction.disabled = !enabled.checked || !reduceWhitePointEnabled?.checked;
      }
      void update(null, () => savePreference(enabledFeatureId, {
        type: 'UI_SET_ENABLED', featureId: enabledFeatureId, enabled: enabled.checked
      }), [enabled]);
    });
  }
  const audioAutoplayAllSites = document.querySelector('#audioAutoplayAllSites');
  if (audioAutoplayAllSites) audioAutoplayAllSites.addEventListener('change', () => void update(null, () => savePreference('noAutoplay', {
    type: 'UI_SET_AUDIO_AUTOPLAY_ALL_SITES', enabled: audioAutoplayAllSites.checked
  }), [audioAutoplayAllSites]));
  const biliDailyLogin = document.querySelector('#biliDailyLogin');
  if (biliDailyLogin) biliDailyLogin.addEventListener('change', () => void update(null, () => savePreference('satellites', {
    type: 'UI_SET_BILI_DAILY_LOGIN', enabled: biliDailyLogin.checked
  }, biliDailyLogin => ({ biliDailyLogin })), [biliDailyLogin]));
  const mailtoCaptureEnabled = document.querySelector('#mailtoCaptureEnabled');
  const clipboardProtectEnabled = document.querySelector('#clipboardProtectEnabled');
  const whiteSofterEnabled = document.querySelector('#whiteSofterEnabled');
  if (whiteSofterEnabled) whiteSofterEnabled.addEventListener('change', () => {
    document.querySelector('#whiteSofterOptions').disabled = !whiteSofterEnabled.checked;
    void update(null, () => savePreference('whiteSofter', {
      type: 'UI_SET_ENABLED', featureId: 'whiteSofter', enabled: whiteSofterEnabled.checked
    }), [whiteSofterEnabled]);
  });
  const whiteSofterTone = document.querySelector('#whiteSofterTone');
  if (whiteSofterTone) whiteSofterTone.addEventListener('change', () => void update(null, () => savePreference('whiteSofter', {
    type: 'UI_SET_WHITE_SOFTER_TONE', featureId: 'whiteSofter', tone: whiteSofterTone.value
  }), [whiteSofterTone]));
  const documentPreviewEnabled = document.querySelector('#documentPreviewEnabled');
  if (documentPreviewEnabled) documentPreviewEnabled.addEventListener('change', () => {
    document.querySelector('#documentPreviewOptions').disabled = !documentPreviewEnabled.checked;
    void update(null, () => savePreference('documentPreview', {
      type: 'UI_SET_ENABLED', featureId: 'documentPreview', enabled: documentPreviewEnabled.checked
    }), [documentPreviewEnabled]);
  });
  const documentPdfSampling = document.querySelector('#documentPdfSampling');
  if (documentPdfSampling) documentPdfSampling.addEventListener('change', () => void update(null, () => savePreference('documentPreview', {
    type: 'UI_SET_DOCUMENT_PDF_SAMPLING', featureId: 'documentPreview', pdfSampling: Number(documentPdfSampling.value)
  }), [documentPdfSampling]));
  const documentPreviewAppearance = document.querySelector('#documentPreviewAppearance');
  if (documentPreviewAppearance) documentPreviewAppearance.addEventListener('change', () => void update(null, () => savePreference('documentPreview', {
    type: 'UI_SET_DOCUMENT_APPEARANCE', featureId: 'documentPreview', appearance: documentPreviewAppearance.value
  }), [documentPreviewAppearance]));
  if (clipboardProtectEnabled) clipboardProtectEnabled.addEventListener('change', () => void update(null, () => savePreference('clipboardProtect', {
    type: 'UI_SET_ENABLED', featureId: 'clipboardProtect', enabled: clipboardProtectEnabled.checked
  }), [clipboardProtectEnabled]));
  if (mailtoCaptureEnabled) mailtoCaptureEnabled.addEventListener('change', () => void update(null, () => savePreference('mailtoCapture', {
    type: 'UI_SET_ENABLED', featureId: 'mailtoCapture', enabled: mailtoCaptureEnabled.checked
  }), [mailtoCaptureEnabled]));
  const leetcodeDarkModeEnabled = document.querySelector('#leetcodeDarkModeEnabled');
  const langGoogleEnabled = document.querySelector('#langGoogleEnabled');
  if (leetcodeDarkModeEnabled) leetcodeDarkModeEnabled.addEventListener('change', () => void update(null, () => savePreference('leetcodeDarkMode', {
    type: 'UI_SET_ENABLED', featureId: 'leetcodeDarkMode', enabled: leetcodeDarkModeEnabled.checked
  }), [leetcodeDarkModeEnabled]));
  if (langGoogleEnabled) langGoogleEnabled.addEventListener('change', () => void update(null, () => savePreference('langGoogle', {
    type: 'UI_SET_ENABLED', featureId: 'langGoogle', enabled: langGoogleEnabled.checked
  }), [langGoogleEnabled]));
  const accessControlEnabled = document.querySelector('#accessControlEnabled');
  if (accessControlEnabled) accessControlEnabled.addEventListener('change', () => {
    const options = document.querySelector('#accessControlOptions');
    if (options) options.disabled = !accessControlEnabled.checked;
    void update(null, () => savePreference('accessControl', {
      type: 'UI_SET_ENABLED', featureId: 'accessControl', enabled: accessControlEnabled.checked
    }), [accessControlEnabled]);
  });
  const accessControlTemporaryVisits = document.querySelector('#accessControlTemporaryVisits');
  if (accessControlTemporaryVisits) accessControlTemporaryVisits.addEventListener('change', () => void update(null, () => savePreference('accessControl', {
    type: 'UI_SET_ACCESS_CONTROL_TEMPORARY_VISITS',
    featureId: 'accessControl',
    enabled: accessControlTemporaryVisits.checked
  }), [accessControlTemporaryVisits]));
  const websiteFixerEnabled = document.querySelector('#websiteFixerEnabled');
  const websiteFixerStayOnPageEnabled = document.querySelector('#websiteFixerStayOnPageEnabled');
  if (websiteFixerStayOnPageEnabled) websiteFixerStayOnPageEnabled.addEventListener('change', () => {
    document.querySelector('#websiteFixerStayOptions').disabled = !websiteFixerEnabled.checked || !websiteFixerStayOnPageEnabled.checked;
    void update(null, () => savePreference('websiteFixer', {
      type: 'UI_SET_WEBSITE_FIXER_STAY_ON_PAGE', featureId: 'websiteFixer', enabled: websiteFixerStayOnPageEnabled.checked
    }), [websiteFixerStayOnPageEnabled]);
  });
  const websiteFixerTranslateOverrideEnabled = document.querySelector('#websiteFixerTranslateOverrideEnabled');
  if (websiteFixerEnabled) websiteFixerEnabled.addEventListener('change', () => {
    document.querySelector('#websiteFixerOptions').disabled = !websiteFixerEnabled.checked;
    document.querySelector('#websiteFixerTranslateOptions').disabled = !websiteFixerEnabled.checked
      || !websiteFixerTranslateOverrideEnabled.checked;
    document.querySelector('#websiteFixerStayOptions').disabled = !websiteFixerEnabled.checked
      || !document.querySelector('#websiteFixerStayOnPageEnabled').checked;
    void update(null, () => savePreference('websiteFixer', {
      type: 'UI_SET_ENABLED', featureId: 'websiteFixer', enabled: websiteFixerEnabled.checked
    }), [websiteFixerEnabled]);
  });
  if (websiteFixerTranslateOverrideEnabled) websiteFixerTranslateOverrideEnabled.addEventListener('change', () => {
    document.querySelector('#websiteFixerTranslateOptions').disabled = !websiteFixerEnabled.checked
      || !websiteFixerTranslateOverrideEnabled.checked;
    document.querySelector('#websiteFixerStayOptions').disabled = !websiteFixerEnabled.checked
      || !document.querySelector('#websiteFixerStayOnPageEnabled').checked;
    void update(null, () => savePreference('websiteFixer', {
      type: 'UI_SET_WEBSITE_FIXER_TRANSLATE_OVERRIDE', featureId: 'websiteFixer',
      enabled: websiteFixerTranslateOverrideEnabled.checked
    }), [websiteFixerTranslateOverrideEnabled]);
  });
  const knowledgeEnabled = document.querySelector('#websiteKnowledgeEnabled');
  if (knowledgeEnabled) {
    const zoneSelect = document.querySelector('#websiteKnowledgeTimeZoneValue');
    const selected = zoneSelect.value;
    const primaryZones = ['Asia/Shanghai', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Pacific/Honolulu'];
    const secondaryZones = [
      'America/Toronto',
      'America/Denver',
      'America/Phoenix',
      'America/Vancouver',
      'America/Anchorage',
      'UTC'
    ];
    const tertiaryZones = [
      'Pacific/Auckland',
      'Australia/Sydney',
      'Asia/Seoul',
      'Asia/Hong_Kong',
      'Asia/Singapore',
      'Asia/Bangkok',
      'Asia/Dubai',
      'Europe/Istanbul',
      'Europe/Athens',
      'Europe/Paris',
      'Europe/Zurich',
      'Europe/London',
      'America/Sao_Paulo'
    ];
    const pinnedZones = new Set([...primaryZones, ...secondaryZones, ...tertiaryZones]);
    const remainingZones = [...new Set(['UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])]
      .filter(zone => !pinnedZones.has(zone)).sort();
    const zoneOption = zone => new Option(zone.replaceAll('_', ' '), zone);
    zoneSelect.replaceChildren(
      ...primaryZones.map(zoneOption), document.createElement('hr'),
      ...secondaryZones.map(zoneOption), document.createElement('hr'),
      ...tertiaryZones.map(zoneOption), document.createElement('hr'),
      ...remainingZones.map(zoneOption)
    );
    zoneSelect.value = selected || 'America/New_York';
    knowledgeEnabled.addEventListener('change', () => void update(null, () => savePreference('websiteKnowledgeControl', {
      type: 'UI_SET_ENABLED', featureId: 'websiteKnowledgeControl', enabled: knowledgeEnabled.checked
    }), [knowledgeEnabled]));
    for (const [category, suffix] of [['languages', 'Languages'], ['timeZone', 'TimeZone'], ['globalPrivacyControl', 'GlobalPrivacyControl']]) {
      const control = document.querySelector('#websiteKnowledge' + suffix);
      const value = document.querySelector('#websiteKnowledge' + suffix + 'Value');
      const save = () => void update(null, () => savePreference('websiteKnowledgeControl', {
        type: 'UI_SET_WEBSITE_KNOWLEDGE_SETTING', featureId: 'websiteKnowledgeControl', category,
        enabled: control.checked, ...(value ? { value: value.value } : {})
      }), value ? [control, value] : [control]);
      control.addEventListener('change', save);
      value?.addEventListener('change', save);
    }
  }
  const chineseResponseClaudeEnabled = document.querySelector('#chineseResponseClaudeEnabled');
  if (chineseResponseClaudeEnabled) chineseResponseClaudeEnabled.addEventListener('change', () => void update(null, () => savePreference('chineseResponseClaude', {
    type: 'UI_SET_ENABLED',
    featureId: 'chineseResponseClaude',
    enabled: chineseResponseClaudeEnabled.checked
  }), [chineseResponseClaudeEnabled]));
  const claudeBrowserIdentityEnabled = document.querySelector('#claudeBrowserIdentityEnabled');
  if (claudeBrowserIdentityEnabled) claudeBrowserIdentityEnabled.addEventListener('change', () => void update(null, () => savePreference('chineseResponseClaude', {
    type: 'UI_SET_CLAUDE_BROWSER_IDENTITY',
    featureId: 'chineseResponseClaude',
    enabled: claudeBrowserIdentityEnabled.checked
  }), [claudeBrowserIdentityEnabled]));
  const reduceWhitePointEnabled = document.querySelector('#pageDisplayReduceWhitePointEnabled');
  if (reduceWhitePointEnabled) reduceWhitePointEnabled.addEventListener('change', () => {
    const reduction = document.querySelector('#reduceWhitePointReduction');
    if (reduction) reduction.disabled = !reduceWhitePointEnabled.checked;
    void update(null, () => savePreference('pageDisplay', {
      type: 'UI_SET_PAGE_DISPLAY_SETTING', name: 'reduceWhitePointEnabled', value: reduceWhitePointEnabled.checked
    }), [reduceWhitePointEnabled]);
  });
  const greyscaleEnabled = document.querySelector('#pageDisplayGreyscaleEnabled');
  if (greyscaleEnabled) greyscaleEnabled.addEventListener('change', () => void update(null, () => savePreference('pageDisplay', {
    type: 'UI_SET_PAGE_DISPLAY_SETTING', name: 'greyscaleEnabled', value: greyscaleEnabled.checked
  }), [greyscaleEnabled]));
  const reduceWhitePointReduction = document.querySelector('#reduceWhitePointReduction');
  const reduceWhitePointReductionValue = document.querySelector('#reduceWhitePointReductionValue');
  if (reduceWhitePointReduction) {
    reduceWhitePointReduction.addEventListener('input', () => {
      if (reduceWhitePointReductionValue) {
        reduceWhitePointReductionValue.textContent = `${reduceWhitePointReduction.value}%`;
      }
    });
    reduceWhitePointReduction.addEventListener('change', () => void update(null, () => savePreference('pageDisplay', {
      type: 'UI_SET_PAGE_DISPLAY_SETTING',
      name: 'reduction',
      value: Number(reduceWhitePointReduction.value) / 100
    }), [reduceWhitePointReduction]));
  }
  const xhsImageDarkModeEnabled = document.querySelector('#xhsImageDarkModeEnabled');
  if (xhsImageDarkModeEnabled) xhsImageDarkModeEnabled.addEventListener('change', () => void update(null, () => savePreference('xhsImageDarkMode', {
    type: 'UI_SET_XHS_IMAGE_DARK_MODE_ENABLED', enabled: xhsImageDarkModeEnabled.checked
  }), [xhsImageDarkModeEnabled]));
  const xhsImageDarkModeOverride = document.querySelector('#xhsImageDarkModeOverride');
  if (xhsImageDarkModeOverride) xhsImageDarkModeOverride.addEventListener('change', () => void update(null, () => savePreference('xhsImageDarkMode', {
    type: 'UI_SET_XHS_IMAGE_DARK_MODE_SETTING', name: 'overrideDarkMode', value: xhsImageDarkModeOverride.checked
  }), [xhsImageDarkModeOverride]));
  const xhsImageDarkModeControl = document.querySelector('#xhsImageDarkModeControl');
  if (xhsImageDarkModeControl) xhsImageDarkModeControl.addEventListener('change', () => {
    const opacityRow = document.querySelector('.xhs-opacity-row');
    if (opacityRow) opacityRow.hidden = !xhsImageDarkModeControl.checked;
    void update(null, () => savePreference('xhsImageDarkMode', {
      type: 'UI_SET_XHS_IMAGE_DARK_MODE_SETTING', name: 'showImageControl', value: xhsImageDarkModeControl.checked
    }), [xhsImageDarkModeControl]);
  });
  const xhsImageDarkModeOpacity = document.querySelector('#xhsImageDarkModeOpacity');
  const xhsImageDarkModeOpacityValue = document.querySelector('#xhsImageDarkModeOpacityValue');
  if (xhsImageDarkModeOpacity) {
    xhsImageDarkModeOpacity.addEventListener('input', () => {
      if (xhsImageDarkModeOpacityValue) xhsImageDarkModeOpacityValue.textContent = `${xhsImageDarkModeOpacity.value}%`;
    });
    xhsImageDarkModeOpacity.addEventListener('change', () => void update(null, () => savePreference('xhsImageDarkMode', {
      type: 'UI_SET_XHS_IMAGE_DARK_MODE_SETTING',
      name: 'controlOpacity',
      value: Number(xhsImageDarkModeOpacity.value) / 100
    }), [xhsImageDarkModeOpacity]));
  }
  for (const input of document.querySelectorAll('[data-ad-marshal-site]')) {
    input.addEventListener('change', () => void update(null, () => savePreference('adMarshal', {
      type: 'UI_SET_AD_MARSHAL_SITE',
      siteId: input.dataset.adMarshalSite,
      enabled: input.checked
    }), [input]));
  }
  const preferredQuality = document.querySelector('#preferredQuality');
  if (preferredQuality) preferredQuality.addEventListener('change', () => void update(null, () => savePreference('videoDownload', {
    type: 'UI_SET_VIDEO_SETTING', name: 'preferredQuality', value: preferredQuality.value
  }), [preferredQuality]));
  const askWhereToSave = document.querySelector('#askWhereToSave');
  if (askWhereToSave) askWhereToSave.addEventListener('change', () => void update(null, () => savePreference('videoDownload', {
    type: 'UI_SET_VIDEO_SETTING', name: 'askWhereToSave', value: askWhereToSave.checked
  }), [askWhereToSave]));
  const imageOutputFormat = document.querySelector('#imageOutputFormat');
  if (imageOutputFormat) imageOutputFormat.addEventListener('change', () => void update(null, () => savePreference('imageDownload', {
    type: 'UI_SET_IMAGE_SETTING', name: 'outputFormat', value: imageOutputFormat.value
  }), [imageOutputFormat]));
  const imageWorkspaceMode = document.querySelector('#imageWorkspaceMode');
  if (imageWorkspaceMode) imageWorkspaceMode.addEventListener('change', () => void update(null, () => savePreference('imageDownload', {
    type: 'UI_SET_IMAGE_SETTING', name: 'workspaceMode', value: imageWorkspaceMode.value
  }), [imageWorkspaceMode]));
  const imageBatchMode = document.querySelector('#imageBatchMode');
  if (imageBatchMode) imageBatchMode.addEventListener('change', () => void update(null, () => savePreference('imageDownload', {
    type: 'UI_SET_IMAGE_SETTING', name: 'batchMode', value: imageBatchMode.value
  }), [imageBatchMode]));
  const imageAskWhereToSave = document.querySelector('#imageAskWhereToSave');
  if (imageAskWhereToSave) imageAskWhereToSave.addEventListener('change', () => void update(null, () => savePreference('imageDownload', {
    type: 'UI_SET_IMAGE_SETTING', name: 'askWhereToSave', value: imageAskWhereToSave.checked
  }), [imageAskWhereToSave]));

  const behaviorCard = document.querySelector('[data-behavior-card]');
  if (behaviorCard) {
    const form = behaviorCard.querySelector('.behavior-rule-form');
    const input = form.querySelector('input');
    const select = form.querySelector('select');
    const submit = form.querySelector('button[type="submit"]');
    const message = behaviorCard.querySelector('.form-message');
    const alphabetize = (clearInput = false) => update(behaviorCard, async () => {
      await savePreference(featureId, {
        type: 'UI_ALPHABETIZE_RULES', featureId, listName: 'behaviorRules'
      });
      if (clearInput) input.value = '';
    }, [input, select, submit], 'ruleSaveFailed');
    const clearRules = () => update(behaviorCard, async () => {
      await savePreference(featureId, {
        type: 'UI_CLEAR_RULES', featureId, listName: 'behaviorRules'
      });
      input.value = '';
    }, [input, select, submit], 'ruleSaveFailed');
    bindEmptyRuleSort(submit, input, alphabetize);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (isRuleOrderReset(input.value)) { void alphabetize(true); return; }
      if (isRuleListClean(input.value)) {
        if (confirm(t('clearDomainRulesConfirm'))) void clearRules();
        return;
      }
      let rule;
      try { rule = normalizeWebsiteRuleInput(input.value); }
      catch { message.textContent = t('invalidRule'); return; }
      void update(behaviorCard, async () => {
        await savePreference(featureId, { type: 'UI_SET_BEHAVIOR_RULE', featureId, rule, behavior: select.value });
        input.value = '';
      }, [input, select, submit], 'ruleSaveFailed');
    });
  }

  for (const section of document.querySelectorAll('[data-list-section]')) {
    const form = section.querySelector('.rule-form');
    const input = form.querySelector('input');
    const submit = form.querySelector('button[type="submit"]');
    const message = section.querySelector('.form-message');
    const listName = section.dataset.listSection;
    const settingGroup = section.dataset.settingGroup;
    const hiddenList = section.dataset.hiddenList === 'true';
    const sectionFeatureId = section.dataset.featureId || featureId;
    const alphabetize = (clearInput = false) => update(section, async () => {
      await savePreference(sectionFeatureId, {
        type: 'UI_ALPHABETIZE_RULES',
        featureId: sectionFeatureId === 'nsna' ? 'nativeScroll' : sectionFeatureId,
        listName, settingGroup
      });
      if (clearInput) input.value = '';
    }, [input, submit], 'ruleSaveFailed');
    const clearRules = () => update(section, async () => {
      await savePreference(sectionFeatureId, {
        type: 'UI_CLEAR_RULES',
        featureId: sectionFeatureId === 'nsna' ? 'nativeScroll' : sectionFeatureId,
        listName, settingGroup
      });
      input.value = '';
      const status = section.querySelector('.website-fixer-saved');
      if (status) {
        clearTimeout(websiteFixerSavedTimers.get(status));
        status.textContent = ''; delete status.dataset.i18n;
      }
    }, [input, submit], 'ruleSaveFailed');
    if (!hiddenList) bindEmptyRuleSort(submit, input, alphabetize);
    section.querySelector('[data-reset-websites]')?.addEventListener('click', event => {
      const button = event.currentTarget;
      if (pendingWebsiteResetButton === button) {
        disarmWebsiteReset();
        void clearRules();
      } else {
        disarmWebsiteReset();
        pendingWebsiteResetButton = button;
        button.dataset.confirming = 'true';
        button.dataset.i18n = 'websiteFixerResetConfirmButton';
        button.textContent = t('websiteFixerResetConfirmButton');
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!hiddenList && isRuleOrderReset(input.value)) { void alphabetize(true); return; }
      if (!hiddenList && isRuleListClean(input.value)) {
        if (confirm(t('clearDomainRulesConfirm'))) void clearRules();
        return;
      }
      let rule;
      try {
        rule = sectionFeatureId === 'accessControl'
          ? normalizeAccessControlRuleInput(input.value)
          : sectionFeatureId === 'websiteFixer'
            ? (settingGroup === 'stayOnPage' ? normalizeWebsiteFixerSite : normalizeWebsiteFixerDomain)(normalizeGeneralDomainInput(input.value))
          : section.dataset.domainScope === 'subdomains'
            ? normalizeAccessControlDomain(normalizeGeneralDomainInput(input.value))
            : normalizeWebsiteRuleInput(input.value);
      } catch {
        message.textContent = t(sectionFeatureId === 'accessControl' ? 'accessControlInvalidDomain' : 'invalidRule');
        return;
      }
      if ((sectionState(section)?.[listName] || []).includes(rule)) { message.textContent = t('duplicateRule'); return; }
      void update(section, async () => {
        await savePreference(sectionFeatureId, sectionFeatureId === 'nsna'
          ? { type: 'UI_ADD_NSNA_WHITELIST_RULE', rule }
          : { type: 'UI_ADD_RULE', featureId: sectionFeatureId, settingGroup, listName, rule });
        input.value = '';
        const status = section.querySelector('.website-fixer-saved');
        if (status) {
          clearTimeout(websiteFixerSavedTimers.get(status));
          status.dataset.i18n = 'websiteFixerSaved'; status.textContent = t('websiteFixerSaved');
          websiteFixerSavedTimers.set(status, setTimeout(() => {
            status.textContent = ''; delete status.dataset.i18n; websiteFixerSavedTimers.delete(status);
          }, 1_500));
        }
      }, [input, submit], 'ruleSaveFailed');
    });
  }

  for (const card of document.querySelectorAll('[data-settings-card]')) {
    card.addEventListener('click', event => {
      event.preventDefault();
      navigateTo(card.dataset.settingsCard);
    });
  }

  document.querySelector('#language').onchange = event => {
    const control = event.currentTarget;
    if (localeSaving) return;
    localeSaving = true;
    localeGeneration += 1;
    void update(null, async () => {
      try {
        const result = await send({ type: 'UI_SET_LOCALE', locale: control.value });
        locale = result.locale;
        cacheLocale();
      } finally {
        localeSaving = false;
        localeGeneration += 1;
        applyLocale();
      }
    }, [control]);
  };
}

function syncResetControls() {
  let card = document.querySelector('#reset-settings-card');
  let dialog = document.querySelector('#reset-settings-dialog');
  if (featureId !== 'allSettings') {
    card?.remove();
    dialog?.remove();
    return;
  }
  if (!card) {
    card = document.createElement('section');
    card.id = 'reset-settings-card';
    card.className = 'card reset-settings-card';
    card.innerHTML = `
      <div><strong data-i18n="resetAllSettingsHeading"></strong><p data-i18n="resetAllSettingsHelp"></p></div>
      <button class="reset-settings-button" type="button" data-i18n="resetAllSettingsAction"></button>`;
    document.querySelector('.sidebar').append(card);
  }
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'reset-settings-dialog';
    dialog.className = 'settings-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <h2 data-i18n="resetAllSettingsConfirmHeading"></h2>
        <p data-i18n="resetAllSettingsConfirmHelp"></p>
        <div class="dialog-actions">
          <button value="cancel" type="submit" data-i18n="cancel"></button>
          <button class="danger-button" value="confirm" type="submit" data-i18n="reset"></button>
        </div>
      </form>`;
    document.body.append(dialog);
  }
  if (card.dataset.bound === 'true') return;
  card.dataset.bound = 'true';
  card.querySelector('button').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'confirm') return;
    const confirm = dialog.querySelector('.danger-button');
    void update(card, async () => {
      await send({ type: 'UI_RESET_ALL_SETTINGS' });
      if (!incognitoContext) {
        try {
          localStorage.removeItem('cosmicGeminiSettingsViewCache');
          localStorage.removeItem('cosmicGeminiInterfaceLocale');
        } catch {}
      }
      location.reload();
    }, [card.querySelector('button'), confirm], 'settingsResetFailed');
  });
}

function mountView(replace = true) {
  disarmWebsiteReset();
  document.body.dataset.feature = featureId;
  document.querySelector('.wordmark strong').textContent = PRODUCT_META[featureId].name;
  document.querySelector('.layout').classList.remove('single-column');
  helpPanel.hidden = false;
  if (replace) {
    const view = viewFor(featureId);
    primary.innerHTML = view.primary;
    helpPanel.innerHTML = view.help;
  }
  for (const element of document.querySelectorAll('[data-section-icon]')) {
    element.innerHTML = icon(element.dataset.sectionIcon);
  }
  for (const link of document.querySelectorAll('[data-feature-link]')) {
    link.classList.toggle('active', link.dataset.featureLink === featureId);
    if (link.dataset.featureLink === featureId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  syncResetControls();
  applyLocale();
  bindView();
  render();
}

function navigateTo(nextFeature) {
  if (!PRODUCT_META[nextFeature] || nextFeature === featureId) return;
  featureId = nextFeature;
  history.pushState({ featureId }, '', PRODUCT_META[featureId].path);
  mountView();
}

for (const link of document.querySelectorAll('[data-feature-link]')) {
  link.querySelector('span').innerHTML = icon(link.dataset.featureLink);
  link.addEventListener('click', event => {
    event.preventDefault();
    navigateTo(event.currentTarget.dataset.featureLink);
  });
}

window.addEventListener('popstate', () => {
  featureId = featureFromPath(location.pathname);
  mountView();
});

mountView(false);
connectSettingsUi();
try {
  const localeTicket = localeGeneration;
  const storedLocale = await loadLocale({ cacheResult: false });
  if (!localeSaving && localeTicket === localeGeneration && storedLocale !== locale) {
    locale = storedLocale;
    cacheLocale();
    applyLocale();
    render();
  }
  await retryRead(() => reload());
} catch {
  // Keep the localized defaults if stored settings are temporarily unavailable.
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) connectSettingsUi();
});
window.addEventListener('pagehide', () => {
  pageClosing = true;
  if (storageSyncTimer) clearTimeout(storageSyncTimer);
  storageSyncTimer = 0;
  const port = settingsUiPort;
  settingsUiPort = null;
  try { port?.disconnect(); } catch {}
}, { once: true });
