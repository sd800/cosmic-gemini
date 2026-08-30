import { loadLocale, saveLocale } from '../core/locale.js';
import { saveSettingsViewCache } from '../core/settings-view-cache.js';
import { localizeDocument, translator } from '../localization.js';
import { icon, send } from '../ui.js';
import { PRODUCT_META, featureFromPath, viewFor } from './views.js';

const root = document.documentElement;
const primary = document.querySelector('.primary');
const helpPanel = document.querySelector('.help');
const emptyKey = {
  enhancedRules: 'emptyEnhancedSites',
  whitelistRules: 'emptyWhitelist',
  permanentAudioAllowRules: 'emptyAudioAllow',
  enforcedRules: 'emptyEnforcedSites'
};
let featureId = featureFromPath(location.pathname);
let locale = root.lang === 'zh-CN' ? 'zh-CN' : 'en-US';
let t = translator(locale);
let states = null;
const pendingControls = new WeakSet();

function state() {
  return states?.[featureId] || null;
}

function applyLocale() {
  root.lang = locale;
  t = translator(locale);
  localizeDocument(t);
  document.title = 'Cosmic Gemini · ' + PRODUCT_META[featureId].name;
  const language = document.querySelector('#language');
  if (language) language.value = locale;
  document.querySelector('#version').textContent = t('version', { version: chrome.runtime.getManifest().version });
  const titles = {
    nativeScroll: 'switchNativeSettings',
    noAutoplay: 'switchAutoplaySettings',
    anyCopy: 'switchAnyCopySettings',
    imageDownload: 'switchImageDownloadSettings',
    videoDownload: 'switchVideoDownloadSettings',
    satellites: 'switchSatellitesSettings'
  };
  for (const link of document.querySelectorAll('[data-feature-link]')) {
    link.title = t(titles[link.dataset.featureLink]);
    link.setAttribute('aria-label', link.title);
  }
}

function renderList(section) {
  const current = state();
  if (!current) return;
  const listName = section.dataset.listSection;
  const list = section.querySelector('.rule-list');
  const rules = current[listName] || [];
  list.replaceChildren();
  if (!rules.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = t(emptyKey[listName]);
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
    remove.addEventListener('click', () => void update(section, () => send({
      type: 'UI_DELETE_RULE', featureId, listName, rule
    }), [remove]));
    item.append(code, remove);
    list.append(item);
  }
}

function render() {
  const current = state();
  if (!current) return;
  const enabled = document.querySelector('#enabled');
  if (enabled) enabled.checked = current.enabled;
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
  for (const section of document.querySelectorAll('[data-list-section]')) renderList(section);
}

async function reload() {
  states = await send({ type: 'UI_GET', url: '' });
  saveSettingsViewCache(states);
  render();
}

async function update(section, task, controls = []) {
  const actionable = controls.filter(Boolean);
  if (actionable.some(control => pendingControls.has(control))) return;
  const disabled = actionable.map(control => control.disabled);
  for (const control of actionable) {
    pendingControls.add(control);
    control.disabled = true;
  }
  const message = section?.querySelector('.form-message');
  if (message) message.textContent = '';
  try { await task(); await reload(); }
  catch {
    render();
    if (message?.isConnected) message.textContent = t('unavailable');
  } finally {
    actionable.forEach((control, index) => {
      pendingControls.delete(control);
      if (control.isConnected) control.disabled = disabled[index];
    });
  }
}

function bindView() {
  const enabled = document.querySelector('#enabled');
  if (enabled) enabled.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_ENABLED', featureId, enabled: enabled.checked
  }), [enabled]));
  const audioAutoplayAllSites = document.querySelector('#audioAutoplayAllSites');
  if (audioAutoplayAllSites) audioAutoplayAllSites.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_AUDIO_AUTOPLAY_ALL_SITES', enabled: audioAutoplayAllSites.checked
  }), [audioAutoplayAllSites]));
  const biliDailyLogin = document.querySelector('#biliDailyLogin');
  if (biliDailyLogin) biliDailyLogin.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_BILI_DAILY_LOGIN', enabled: biliDailyLogin.checked
  }), [biliDailyLogin]));
  const preferredQuality = document.querySelector('#preferredQuality');
  if (preferredQuality) preferredQuality.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_VIDEO_SETTING', name: 'preferredQuality', value: preferredQuality.value
  }), [preferredQuality]));
  const askWhereToSave = document.querySelector('#askWhereToSave');
  if (askWhereToSave) askWhereToSave.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_VIDEO_SETTING', name: 'askWhereToSave', value: askWhereToSave.checked
  }), [askWhereToSave]));
  const imageOutputFormat = document.querySelector('#imageOutputFormat');
  if (imageOutputFormat) imageOutputFormat.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_IMAGE_SETTING', name: 'outputFormat', value: imageOutputFormat.value
  }), [imageOutputFormat]));
  const imageWorkspaceMode = document.querySelector('#imageWorkspaceMode');
  if (imageWorkspaceMode) imageWorkspaceMode.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_IMAGE_SETTING', name: 'workspaceMode', value: imageWorkspaceMode.value
  }), [imageWorkspaceMode]));
  const imageBatchMode = document.querySelector('#imageBatchMode');
  if (imageBatchMode) imageBatchMode.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_IMAGE_SETTING', name: 'batchMode', value: imageBatchMode.value
  }), [imageBatchMode]));
  const imageAskWhereToSave = document.querySelector('#imageAskWhereToSave');
  if (imageAskWhereToSave) imageAskWhereToSave.addEventListener('change', () => void update(null, () => send({
    type: 'UI_SET_IMAGE_SETTING', name: 'askWhereToSave', value: imageAskWhereToSave.checked
  }), [imageAskWhereToSave]));

  for (const section of document.querySelectorAll('[data-list-section]')) {
    const form = section.querySelector('.rule-form');
    const input = form.querySelector('input');
    const submit = form.querySelector('button[type="submit"]');
    const message = section.querySelector('.form-message');
    const listName = section.dataset.listSection;
    form.addEventListener('submit', event => {
      event.preventDefault();
      const rule = input.value.trim().toLowerCase();
      if (!rule) { message.textContent = t('invalidRule'); return; }
      if ((state()?.[listName] || []).includes(rule)) { message.textContent = t('duplicateRule'); return; }
      void (async () => {
        if (pendingControls.has(submit)) return;
        pendingControls.add(submit);
        pendingControls.add(input);
        submit.disabled = true;
        input.disabled = true;
        message.textContent = '';
        try {
          await send({ type: 'UI_ADD_RULE', featureId, listName, rule });
          input.value = '';
          await reload();
        } catch { if (message.isConnected) message.textContent = t('invalidRule'); }
        finally {
          pendingControls.delete(submit);
          pendingControls.delete(input);
          if (submit.isConnected) submit.disabled = false;
          if (input.isConnected) input.disabled = false;
        }
      })();
    });
  }

  document.querySelector('#language').addEventListener('change', event => void (async () => {
    const control = event.currentTarget;
    if (pendingControls.has(control)) return;
    pendingControls.add(control);
    control.disabled = true;
    try {
      locale = await saveLocale(control.value);
      applyLocale();
      render();
    } finally {
      pendingControls.delete(control);
      if (control.isConnected) control.disabled = false;
    }
  })());
}

function mountView(replace = true) {
  document.body.dataset.feature = featureId;
  document.querySelector('.wordmark strong').textContent = PRODUCT_META[featureId].name;
  document.querySelector('.layout').classList.remove('single-column');
  helpPanel.hidden = false;
  if (replace) {
    const view = viewFor(featureId);
    primary.innerHTML = view.primary;
    helpPanel.innerHTML = view.help;
  }
  for (const link of document.querySelectorAll('[data-feature-link]')) {
    link.classList.toggle('active', link.dataset.featureLink === featureId);
    if (link.dataset.featureLink === featureId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  applyLocale();
  bindView();
  render();
}

for (const link of document.querySelectorAll('[data-feature-link]')) {
  link.querySelector('span').innerHTML = icon(link.dataset.featureLink);
  link.addEventListener('click', event => {
    event.preventDefault();
    const nextFeature = event.currentTarget.dataset.featureLink;
    if (!PRODUCT_META[nextFeature] || nextFeature === featureId) return;
    featureId = nextFeature;
    history.pushState({ featureId }, '', PRODUCT_META[featureId].path);
    mountView();
  });
}

window.addEventListener('popstate', () => {
  featureId = featureFromPath(location.pathname);
  mountView();
});

mountView(false);
try {
  const storedLocale = await loadLocale();
  if (storedLocale !== locale) {
    locale = storedLocale;
    applyLocale();
    render();
  }
  await reload();
} catch {
  // Keep the localized defaults if stored settings are temporarily unavailable.
}
