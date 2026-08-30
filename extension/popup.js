import { loadLocale } from './core/locale.js';
import { localizeDocument, translator } from './localization.js';
import { icon, send } from './ui.js';

const root = document.documentElement;
const live = document.querySelector('#live');
const productKey = { nativeScroll: 'nativeScrollName', noAutoplay: 'noAutoplayName', anyCopy: 'anyCopyName' };
let state;
let t;

function label(element, value) {
  element.title = value;
  element.setAttribute('aria-label', value);
}

function iconState(featureId, feature) {
  if (featureId === 'anyCopy') return feature.active ? 'active' : 'off';
  if (!feature.active) return 'off';
  return state.activity?.[featureId] ? 'active' : 'on';
}

function renderStandardFeature(featureId) {
  const feature = state[featureId];
  const row = document.querySelector('[data-feature="' + featureId + '"]');
  const product = t(productKey[featureId]);
  const status = row.querySelector('.feature-status');
  const power = row.querySelector('[data-action="power"]');
  const enhanced = row.querySelector('[data-action="enhanced"]');
  const whitelist = row.querySelector('[data-action="whitelist"]');
  const settings = row.querySelector('[data-action="settings"]');

  status.dataset.state = iconState(featureId, feature);
  status.title = product;
  power.setAttribute('aria-pressed', String(feature.enabled));
  label(power, t(feature.enabled ? 'featureOnTitle' : 'featureOffTitle', { product }));

  enhanced.disabled = !feature.enabled || !feature.supported || !!feature.matchedWhitelistRule;
  enhanced.setAttribute('aria-pressed', String(!!feature.matchedEnhancedRule));
  if (!feature.supported) label(enhanced, t('unsupportedTitle'));
  else if (feature.matchedWhitelistRule) label(enhanced, t('enhancedUnavailableTitle'));
  else if (feature.matchedEnhancedRule && !feature.exactEnhanced) {
    label(enhanced, t('enhancedCoveredTitle', { rule: feature.matchedEnhancedRule }));
  } else label(enhanced, t(feature.exactEnhanced ? 'enhancedSiteTitle' : 'standardSiteTitle'));

  whitelist.disabled = !feature.enabled || !feature.supported;
  if (!feature.supported) {
    whitelist.innerHTML = icon('siteAdd');
    label(whitelist, t('unsupportedTitle'));
  } else if (feature.exactWhitelisted) {
    whitelist.innerHTML = icon('siteRemove');
    label(whitelist, t('removeWhitelistTitle', { product }));
  } else if (feature.matchedWhitelistRule) {
    whitelist.innerHTML = icon('siteCovered');
    label(whitelist, t('coveredWhitelistTitle', { rule: feature.matchedWhitelistRule }));
  } else {
    whitelist.innerHTML = icon('siteAdd');
    label(whitelist, t('addWhitelistTitle', { product }));
  }
  whitelist.setAttribute('aria-pressed', String(!!feature.matchedWhitelistRule));
  label(settings, t('settingsTitle', { product }));
}

function renderAnyCopy() {
  const feature = state.anyCopy;
  const row = document.querySelector('[data-feature="anyCopy"]');
  const product = t('anyCopyName');
  const toggle = row.querySelector('.feature-toggle');
  const enhanced = row.querySelector('[data-action="enhanced"]');
  const settings = row.querySelector('[data-action="settings"]');

  if (!feature) {
    toggle.disabled = true;
    enhanced.disabled = true;
    settings.disabled = true;
    label(toggle, t('unavailable'));
    label(enhanced, t('unavailable'));
    label(settings, t('unavailable'));
    return;
  }
  settings.disabled = false;

  toggle.dataset.state = iconState('anyCopy', feature);
  toggle.setAttribute('aria-pressed', String(feature.active));
  if (!feature.supported) {
    toggle.disabled = true;
    label(toggle, t('unsupportedTitle'));
  } else if (feature.active && !feature.exactEnforced && !feature.exactEnhanced) {
    toggle.disabled = false;
    label(toggle, t('anyCopyCoveredTitle', { rule: feature.matchedEnhancedRule || feature.matchedEnforcedRule }));
  } else {
    toggle.disabled = false;
    label(toggle, t(feature.active ? 'anyCopyOnTitle' : 'anyCopyOffTitle'));
  }

  enhanced.disabled = !feature.supported;
  enhanced.setAttribute('aria-pressed', String(!!feature.matchedEnhancedRule));
  if (!feature.supported) label(enhanced, t('unsupportedTitle'));
  else if (feature.matchedEnhancedRule && !feature.exactEnhanced) {
    label(enhanced, t('enhancedCoveredTitle', { rule: feature.matchedEnhancedRule }));
  } else label(enhanced, t(feature.exactEnhanced ? 'anyCopyEnhancedOnTitle' : 'anyCopyEnhancedOffTitle'));
  label(settings, t('settingsTitle', { product }));
}

function render() {
  if (!state) return;
  renderStandardFeature('nativeScroll');
  renderStandardFeature('noAutoplay');
  renderAnyCopy();
}

async function reload() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state = await send({ type: 'UI_GET', tabId: tab?.id, url: tab?.url || '' });
  render();
}

async function act(task) {
  try { await task(); await reload(); }
  catch { live.textContent = t('unavailable'); }
}

for (const row of document.querySelectorAll('.feature-row')) {
  const featureId = row.dataset.feature;
  row.querySelector('.feature-status').innerHTML = icon(featureId);
  row.querySelector('[data-action="enhanced"]').innerHTML = icon('bolt');
  row.querySelector('[data-action="settings"]').innerHTML = icon('settings');

  const power = row.querySelector('[data-action="power"]');
  if (power) {
    power.innerHTML = icon('power');
    power.addEventListener('click', () => void act(() => send({
      type: 'UI_SET_ENABLED', featureId, enabled: !state[featureId].enabled
    })));
  }
  const whitelist = row.querySelector('[data-action="whitelist"]');
  if (whitelist) {
    whitelist.innerHTML = icon('siteAdd');
    whitelist.addEventListener('click', () => void act(() => {
      const feature = state[featureId];
      if (feature.matchedWhitelistRule && !feature.exactWhitelisted) {
        return send({ type: 'UI_OPEN_SETTINGS', featureId });
      }
      return send({ type: 'UI_TOGGLE_WHITELIST', featureId, hostname: feature.hostname });
    }));
  }
  row.querySelector('[data-action="enhanced"]').addEventListener('click', () => void act(() => {
    const feature = state[featureId];
    if (feature.matchedEnhancedRule && !feature.exactEnhanced) {
      return send({ type: 'UI_OPEN_SETTINGS', featureId });
    }
    return send({ type: 'UI_TOGGLE_ENHANCED', featureId, hostname: feature.hostname });
  }));
  row.querySelector('[data-action="settings"]').addEventListener('click', () => void act(async () => {
    await send({ type: 'UI_OPEN_SETTINGS', featureId });
    window.close();
  }));
}

document.querySelector('#anyCopy-status').addEventListener('click', () => void act(() => {
  const feature = state.anyCopy;
  if (feature.active && !feature.exactEnforced && !feature.exactEnhanced) {
    return send({ type: 'UI_OPEN_SETTINGS', featureId: 'anyCopy' });
  }
  return send({ type: 'UI_TOGGLE_ANY_COPY', hostname: feature.hostname });
}));

const locale = await loadLocale();
root.lang = locale;
t = translator(locale);
localizeDocument(t);
for (const nav of document.querySelectorAll('[data-i18n-aria-label]')) nav.setAttribute('aria-label', t(nav.dataset.i18nAriaLabel));
root.dataset.localePending = 'false';
try { await reload(); } catch { live.textContent = t('unavailable'); }
