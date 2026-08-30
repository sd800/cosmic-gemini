import { loadLocale, saveLocale } from '../core/locale.js';
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
    anyCopy: 'switchAnyCopySettings'
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
    })));
    item.append(code, remove);
    list.append(item);
  }
}

function render() {
  const current = state();
  if (!current) return;
  const enabled = document.querySelector('#enabled');
  if (enabled) enabled.checked = current.enabled;
  for (const section of document.querySelectorAll('[data-list-section]')) renderList(section);
}

async function reload() {
  states = await send({ type: 'UI_GET', url: '' });
  render();
}

async function update(section, task) {
  const message = section?.querySelector('.form-message');
  if (message) message.textContent = '';
  try { await task(); await reload(); }
  catch { if (message?.isConnected) message.textContent = t('unavailable'); }
}

function bindView() {
  const enabled = document.querySelector('#enabled');
  if (enabled) enabled.addEventListener('change', () => void update(null, () => send({
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
      if ((state()?.[listName] || []).includes(rule)) { message.textContent = t('duplicateRule'); return; }
      void (async () => {
        message.textContent = '';
        try {
          await send({ type: 'UI_ADD_RULE', featureId, listName, rule });
          input.value = '';
          await reload();
        } catch { if (message.isConnected) message.textContent = t('invalidRule'); }
      })();
    });
  }

  document.querySelector('#language').addEventListener('change', event => void (async () => {
    locale = await saveLocale(event.currentTarget.value);
    applyLocale();
    render();
  })());
}

function mountView(replace = true) {
  document.body.dataset.feature = featureId;
  document.querySelector('.wordmark strong').textContent = PRODUCT_META[featureId].name;
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
const storedLocale = await loadLocale();
if (storedLocale !== locale) {
  locale = storedLocale;
  applyLocale();
  render();
}
try { await reload(); } catch {}
