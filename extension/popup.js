import { loadLocale } from './core/locale.js';
import { localizeDocument, translator } from './localization.js';
import { icon, send } from './ui.js';

const root = document.documentElement;
const power = document.querySelector('#power');
const mode = document.querySelector('#mode');
const whitelist = document.querySelector('#whitelist');
const settings = document.querySelector('#settings');
const live = document.querySelector('#live');
const brandIcon = document.querySelector('.brand-icon');
let state;
let t;

function label(button, value) {
  button.title = value;
  button.setAttribute('aria-label', value);
}

function render() {
  if (!state) return;
  root.dataset.suppressing = String(state.suppressing === true);
  brandIcon.src = state.suppressing ? 'icons/icon-suppressing-128.png' : 'icons/icon-128.png';
  power.setAttribute('aria-pressed', String(state.enabled));
  label(power, t(state.enabled ? 'enabledTitle' : 'disabledTitle'));
  mode.dataset.mode = state.mode;
  mode.setAttribute('aria-pressed', String(state.mode === 'strong'));
  label(mode, t(state.mode === 'strong' ? 'strongTitle' : 'standardTitle'));

  whitelist.disabled = !state.supported;
  if (!state.supported) {
    whitelist.innerHTML = icon('siteAdd');
    label(whitelist, t('unsupportedTitle'));
  } else if (state.exactWhitelisted) {
    whitelist.innerHTML = icon('siteRemove');
    label(whitelist, t('removeWhitelistTitle'));
  } else if (state.matchedRule) {
    whitelist.innerHTML = icon('siteCovered');
    label(whitelist, t('coveredWhitelistTitle', { rule: state.matchedRule }));
  } else {
    whitelist.innerHTML = icon('siteAdd');
    label(whitelist, t('addWhitelistTitle'));
  }
  whitelist.setAttribute('aria-pressed', String(!!state.matchedRule));
  label(settings, t('settingsTitle'));
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

power.innerHTML = icon('power');
mode.innerHTML = icon('bolt');
whitelist.innerHTML = icon('siteAdd');
settings.innerHTML = icon('settings');

power.addEventListener('click', () => void act(() => send({ type: 'UI_SET_ENABLED', enabled: !state.enabled })));
mode.addEventListener('click', () => void act(() => send({ type: 'UI_SET_MODE', mode: state.mode === 'strong' ? 'standard' : 'strong' })));
whitelist.addEventListener('click', () => void act(async () => {
  if (state.matchedRule && !state.exactWhitelisted) return send({ type: 'UI_OPEN_SETTINGS' });
  return send({ type: 'UI_TOGGLE_HOST', hostname: state.hostname });
}));
settings.addEventListener('click', () => void send({ type: 'UI_OPEN_SETTINGS' }).then(() => window.close()));

const locale = await loadLocale();
root.lang = locale;
t = translator(locale);
localizeDocument(t);
root.dataset.localePending = 'false';
try { await reload(); } catch { live.textContent = t('unavailable'); }
