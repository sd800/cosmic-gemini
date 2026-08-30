import { loadLocale, saveLocale } from '../core/locale.js';
import { localizeDocument, translator } from '../localization.js';
import { icon, send } from '../ui.js';

const root = document.documentElement;
const featureId = document.body.dataset.feature;
const product = featureId === 'noAutoplay' ? 'No Autoplay' : 'Native Scroll';
const enabled = document.querySelector('#enabled');
const language = document.querySelector('#language');
const emptyKey = {
  strongRules: 'emptyStrongSites',
  whitelistRules: 'emptyWhitelist',
  permanentAudioAllowRules: 'emptyAudioAllow'
};
let locale = await loadLocale();
let t = translator(locale);
let state;

function applyLocale() {
  root.lang = locale;
  t = translator(locale);
  localizeDocument(t);
  document.title = 'Cosmic Gemini · ' + product;
  language.value = locale;
  document.querySelector('#version').textContent = t('version', { version: chrome.runtime.getManifest().version });
  const nativeLink = document.querySelector('[data-feature-link="nativeScroll"]');
  const autoplayLink = document.querySelector('[data-feature-link="noAutoplay"]');
  nativeLink.title = t('switchNativeSettings');
  nativeLink.setAttribute('aria-label', nativeLink.title);
  autoplayLink.title = t('switchAutoplaySettings');
  autoplayLink.setAttribute('aria-label', autoplayLink.title);
  if (state) render();
}

function renderList(section) {
  const listName = section.dataset.listSection;
  const list = section.querySelector('.rule-list');
  const rules = state[listName] || [];
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
    })));
    item.append(code, remove);
    list.append(item);
  }
}

function render() {
  enabled.checked = state.enabled;
  for (const section of document.querySelectorAll('[data-list-section]')) renderList(section);
}

async function reload() {
  const result = await send({ type: 'UI_GET', url: '' });
  state = result[featureId];
  render();
}

async function update(section, task) {
  const message = section?.querySelector('.form-message');
  if (message) message.textContent = '';
  try {
    await task();
    await reload();
  } catch { if (message) message.textContent = t('unavailable'); }
}

enabled.addEventListener('change', () => void update(null, () => send({
  type: 'UI_SET_ENABLED', featureId, enabled: enabled.checked
})));

for (const section of document.querySelectorAll('[data-list-section]')) {
  const form = section.querySelector('.rule-form');
  const input = form.querySelector('input');
  const message = section.querySelector('.form-message');
  const listName = section.dataset.listSection;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const rule = input.value.trim().toLowerCase();
    if (!rule) { message.textContent = t('invalidRule'); return; }
    if ((state[listName] || []).includes(rule)) { message.textContent = t('duplicateRule'); return; }
    void (async () => {
      message.textContent = '';
      try {
        await send({ type: 'UI_ADD_RULE', featureId, listName, rule });
        input.value = '';
        await reload();
      } catch { message.textContent = t('invalidRule'); }
    })();
  });
}

language.addEventListener('change', () => void (async () => {
  locale = await saveLocale(language.value);
  applyLocale();
})());

for (const link of document.querySelectorAll('[data-feature-link]')) {
  link.querySelector('span').innerHTML = icon(link.dataset.featureLink);
}

applyLocale();
root.dataset.localePending = 'false';
try { await reload(); } catch {}
