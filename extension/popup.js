import { loadLocale } from './core/locale.js';
import { localizeDocument, translator } from './localization.js';
import { icon, send } from './ui.js';

const root = document.documentElement;
const live = document.querySelector('#live');
const productKey = { nativeScroll: 'nativeScrollName', noAutoplay: 'noAutoplayName' };
let state;
let t;

function label(button, value) {
  button.title = value;
  button.setAttribute('aria-label', value);
}

function renderFeature(featureId) {
  const feature = state[featureId];
  const row = document.querySelector('[data-feature="' + featureId + '"]');
  const product = t(productKey[featureId]);
  const status = row.querySelector('.feature-status');
  const power = row.querySelector('[data-action="power"]');
  const strong = row.querySelector('[data-action="strong"]');
  const whitelist = row.querySelector('[data-action="whitelist"]');
  const settings = row.querySelector('[data-action="settings"]');

  status.dataset.active = String(feature.active);
  status.title = product;
  power.setAttribute('aria-pressed', String(feature.enabled));
  label(power, t(feature.enabled ? 'featureOnTitle' : 'featureOffTitle', { product }));

  strong.disabled = !feature.enabled || !feature.supported || !!feature.matchedWhitelistRule;
  strong.setAttribute('aria-pressed', String(!!feature.matchedStrongRule));
  if (!feature.supported) label(strong, t('unsupportedTitle'));
  else if (feature.matchedWhitelistRule) label(strong, t('strongUnavailableTitle'));
  else if (feature.matchedStrongRule && !feature.exactStrong) {
    label(strong, t('strongCoveredTitle', { rule: feature.matchedStrongRule }));
  } else label(strong, t(feature.exactStrong ? 'strongSiteTitle' : 'standardSiteTitle'));

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

function render() {
  if (!state) return;
  renderFeature('nativeScroll');
  renderFeature('noAutoplay');
}

async function reload() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state = await send({ type: 'UI_GET', tabId: tab?.id, url: tab?.url || '' });
  render();
}

async function act(task) {
  try {
    await task();
    await reload();
  } catch { live.textContent = t('unavailable'); }
}

for (const row of document.querySelectorAll('.feature-row')) {
  const featureId = row.dataset.feature;
  row.querySelector('.feature-status').innerHTML = icon(featureId);
  row.querySelector('[data-action="power"]').innerHTML = icon('power');
  row.querySelector('[data-action="strong"]').innerHTML = icon('bolt');
  row.querySelector('[data-action="whitelist"]').innerHTML = icon('siteAdd');
  row.querySelector('[data-action="settings"]').innerHTML = icon('settings');

  row.querySelector('[data-action="power"]').addEventListener('click', () => void act(() => send({
    type: 'UI_SET_ENABLED',
    featureId,
    enabled: !state[featureId].enabled
  })));
  row.querySelector('[data-action="strong"]').addEventListener('click', () => void act(() => {
    if (state[featureId].matchedStrongRule && !state[featureId].exactStrong) {
      return send({ type: 'UI_OPEN_SETTINGS', featureId });
    }
    return send({ type: 'UI_TOGGLE_STRONG', featureId, hostname: state[featureId].hostname });
  }));
  row.querySelector('[data-action="whitelist"]').addEventListener('click', () => void act(() => {
    if (state[featureId].matchedWhitelistRule && !state[featureId].exactWhitelisted) {
      return send({ type: 'UI_OPEN_SETTINGS', featureId });
    }
    return send({ type: 'UI_TOGGLE_WHITELIST', featureId, hostname: state[featureId].hostname });
  }));
  row.querySelector('[data-action="settings"]').addEventListener('click', () => void send({
    type: 'UI_OPEN_SETTINGS',
    featureId
  }).then(() => window.close()));
}

const locale = await loadLocale();
root.lang = locale;
t = translator(locale);
localizeDocument(t);
for (const nav of document.querySelectorAll('[data-i18n-aria-label]')) nav.setAttribute('aria-label', t(nav.dataset.i18nAriaLabel));
root.dataset.localePending = 'false';
try { await reload(); } catch { live.textContent = t('unavailable'); }
