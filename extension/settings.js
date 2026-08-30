import { loadLocale, saveLocale } from './core/locale.js';
import { localizeDocument, translator } from './localization.js';
import { icon, send } from './ui.js';

const root = document.documentElement;
const enabled = document.querySelector('#enabled');
const language = document.querySelector('#language');
const form = document.querySelector('#whitelist-form');
const input = document.querySelector('#rule');
const message = document.querySelector('#rule-message');
const list = document.querySelector('#rule-list');
let locale = await loadLocale();
let t = translator(locale);
let state;

function applyLocale() {
  root.lang = locale;
  t = translator(locale);
  localizeDocument(t);
  document.title = `${t('appName')} · ${t('settingsTitle')}`;
  language.value = locale;
  document.querySelector('#version').textContent = t('version', { version: chrome.runtime.getManifest().version });
  if (state) render();
}

function render() {
  enabled.checked = state.enabled;
  const mode = document.querySelector(`input[name="mode"][value="${state.mode}"]`);
  if (mode) mode.checked = true;
  list.replaceChildren();
  if (!state.whitelist.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = t('emptyWhitelist');
    list.append(empty);
    return;
  }
  for (const rule of state.whitelist) {
    const item = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = rule;
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.innerHTML = icon('trash');
    remove.title = t('removeRule', { rule });
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => void update(() => send({ type: 'UI_DELETE_RULE', rule })));
    item.append(code, remove);
    list.append(item);
  }
}

async function reload() {
  state = await send({ type: 'UI_GET', url: '' });
  render();
}

async function update(task) {
  message.textContent = '';
  try { await task(); await reload(); }
  catch { message.textContent = t('unavailable'); }
}

enabled.addEventListener('change', () => void update(() => send({ type: 'UI_SET_ENABLED', enabled: enabled.checked })));
for (const control of document.querySelectorAll('input[name="mode"]')) {
  control.addEventListener('change', () => control.checked && void update(() => send({ type: 'UI_SET_MODE', mode: control.value })));
}
form.addEventListener('submit', event => {
  event.preventDefault();
  const raw = input.value.trim().toLowerCase();
  if (!raw) { message.textContent = t('invalidRule'); return; }
  if (state.whitelist.includes(raw)) { message.textContent = t('duplicateRule'); return; }
  void (async () => {
    message.textContent = '';
    try {
      await send({ type: 'UI_ADD_RULE', rule: raw });
      input.value = '';
      await reload();
    } catch { message.textContent = t('invalidRule'); }
  })();
});
language.addEventListener('change', () => void (async () => {
  locale = await saveLocale(language.value);
  applyLocale();
})());

applyLocale();
root.dataset.localePending = 'false';
try { await reload(); } catch { message.textContent = t('unavailable'); }
