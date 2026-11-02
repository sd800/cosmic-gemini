import { WARDEN_CSP, WARDEN_KEY, wardenPageUrl, sameWardenPage } from '../../../core/crash-page-warden.js';
import { WHITE_TONES } from '../../../core/config.js';
import { translator } from '../../../shared/localization.js';
import { savedToolDomains, toolChoices, toolSite, websiteToolEnabled } from './website-fixer-tools.js';

const ROOT = 'content/crash-page-warden/';
const KEY = 'cosmicGeminiCrashPageWardenStatic';
const MAX_TABS = 512;
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function wardenRules(settings, tools, tabIds, incognito = false) {
  if (!tabIds.length) return [];
  const start = incognito ? 942_001 : 940_001;
  const rules = [...new Set([...savedToolDomains(settings, 'crashPageWarden'),
    ...toolChoices(tools, 'crashPageWarden', true).map(site => '*.' + site)])];
  const excludedRequestDomains = toolChoices(tools, 'crashPageWarden', false);
  return rules.map((rule, index) => {
    const host = rule.replace(/^\*\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Header policies must remain above a one-time navigation allowance (200).
    // They cannot override a navigation block: they run only after a response.
    return { id: start + index, priority: 210,
      action: { type: 'modifyHeaders', responseHeaders: [{ header: 'content-security-policy', operation: 'append', value: WARDEN_CSP }] },
      condition: { regexFilter: `^https?://${rule.startsWith('*.') ? '(?:[^./:]+\\.)*' : ''}${host}(?::[0-9]+)?/`,
        tabIds, excludedRequestDomains, resourceTypes: ['main_frame'], requestMethods: ['get'],
        responseHeaders: [{ header: 'content-type', values: ['text/html*', 'application/xhtml+xml*'] }] }
    };
  });
}

export function createCrashPageWarden(platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const id = 'cosmic-gemini-crash-page-warden' + (incognito ? '-incognito' : '');
  const start = incognito ? 942_001 : 940_001;
  const owns = rule => rule.id >= start && rule.id < start + 200;
  const records = new Map(), pending = new Map();
  let loaded, writes = Promise.resolve();
  const load = () => loaded ||= (async () => {
    const saved = platform.sessionStorage ? (await platform.sessionStorage.get(KEY))[KEY] : [];
    for (const record of Array.isArray(saved) ? saved.slice(-MAX_TABS) : []) {
      if (Number.isInteger(record?.tabId) && wardenPageUrl(record.url)) records.set(record.tabId, record);
    }
    if (platform.sessionStorage) await platform.sessionStorage.remove('cosmicGeminiCrashPageWardenDocuments').catch(() => {});
  })().catch(error => { loaded = null; throw error; });
  function save() {
    const next = writes.then(() => platform.sessionStorage?.set({ [KEY]: [...records.values()] }));
    writes = next.catch(() => {}); return next;
  }
  function put(record) {
    if (!records.has(record.tabId) && records.size >= MAX_TABS) records.delete(records.keys().next().value);
    records.set(record.tabId, record);
  }
  async function probe(tabId) {
    let timer;
    try { return await Promise.race([
      chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', injectImmediately: true,
        args: [WARDEN_KEY],
        func: key => ({ active: globalThis[Symbol.for(key)]?.started === true, href: location.href, type: document.contentType }) })
        .then(result => result[0]),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 180); })
    ]); } catch { return null; } finally { clearTimeout(timer); }
  }
  async function reloadTab(tab, settings, tools) {
    await load();
    const url = wardenPageUrl(tab.pendingUrl || tab.url);
    if (!url || !!tab.incognito !== incognito || !websiteToolEnabled(settings, tools, 'crashPageWarden', url)) return;
    if (pending.has(tab.id)) return pending.get(tab.id);
    const task = (async () => {
      const result = await probe(tab.id);
      if (result?.result?.type && !/^(?:text\/html|application\/xhtml\+xml)$/i.test(result.result.type)) return;
      if (result?.result?.active && sameWardenPage(result.result.href, url)) return;
      const record = records.get(tab.id);
      if (record?.stage === 'reloading' && sameWardenPage(record.url, url) && Date.now() - record.at < 15_000) return;
      const live = await chrome.tabs.get(tab.id).catch(() => null);
      if (!live || !!live.incognito !== incognito || !sameWardenPage(live.pendingUrl || live.url, url)) return;
      const next = { tabId: tab.id, url, stage: 'reloading', at: Date.now() };
      put(next); await save().catch(() => {});
      try { await chrome.tabs.reload(tab.id); }
      catch (error) { if (records.get(tab.id) === next) { records.delete(tab.id); await save(); } throw error; }
    })();
    pending.set(tab.id, task);
    try { await task; } finally { if (pending.get(tab.id) === task) pending.delete(tab.id); }
  }
  return {
    async reconcile(settings, tools) {
      await load();
      // Retire both old watchdog registrations, including upgrades from its
      // dormant MAIN bootstrap. No debugger or page timer hooks remain.
      const old = await chrome.scripting.getRegisteredContentScripts({ ids: [id, id + '-bootstrap'] });
      if (old.some(script => script.id === id + '-bootstrap')) {
        await chrome.scripting.unregisterContentScripts({ ids: [id + '-bootstrap'] });
      }
      const rules = [...new Set([...savedToolDomains(settings, 'crashPageWarden'),
        ...toolChoices(tools, 'crashPageWarden', true).map(site => '*.' + site)])];
      const desired = { id, matches: rules.map(rule => `*://${rule}/*`).sort(),
        excludeMatches: toolChoices(tools, 'crashPageWarden', false).map(site => `*://*.${site}/*`).sort(),
        allFrames: false, runAt: 'document_start', world: 'ISOLATED', persistAcrossSessions: !incognito,
        css: [ROOT + 'reader.css'], js: [ROOT + 'bootstrap.js', ROOT + 'appearance.js', ROOT + (incognito ? 'incognito.js' : 'regular.js'),
          'vendor/readability/Readability.js', ROOT + 'extract.js', ROOT + 'runtime.js'] };
      const current = old.find(script => script.id === id);
      if (!rules.length) {
        if (current) await chrome.scripting.unregisterContentScripts({ ids: [id] });
      } else if (!current) await chrome.scripting.registerContentScripts([desired]);
      else if (Object.entries(desired).some(([key, value]) => stable(current[key]) !== stable(value))) {
        await chrome.scripting.updateContentScripts([desired]);
      }
      const tabs = rules.length ? (await chrome.tabs.query({})).filter(tab => !!tab.incognito === incognito) : [];
      const next = wardenRules(settings, tools, tabs.map(tab => tab.id), incognito);
      const existing = (await chrome.declarativeNetRequest.getSessionRules()).filter(owns);
      if (stable(existing.sort((a, b) => a.id - b.id)) !== stable(next)) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map(rule => rule.id), addRules: next });
        const installed = (await chrome.declarativeNetRequest.getSessionRules()).filter(owns).sort((a, b) => a.id - b.id);
        if (stable(installed) !== stable(next)) throw new Error('Crash Page Warden could not verify its page rules.');
      }
    },
    async activate(settings, tools, sender) {
      await load();
      const tabId = sender.tab?.id, url = wardenPageUrl(sender.url);
      if (!Number.isInteger(tabId) || sender.frameId !== 0 || typeof sender.documentId !== 'string' || !url
        || !!sender.tab.incognito !== incognito || !sameWardenPage(sender.tab.url || url, url)) return { active: false };
      const record = records.get(tabId);
      const started = record && sameWardenPage(record.url, url) && (record.documentId === sender.documentId || record.stage === 'reloading');
      if (!started && !websiteToolEnabled(settings, tools, 'crashPageWarden', url)) return { active: false };
      put({ tabId, url, documentId: sender.documentId, stage: 'ready', at: Date.now() });
      await save().catch(() => {});
      const locale = await platform.getLocale?.() || 'en-US', t = translator(locale);
      return { active: true, locale, whiteRGB: settings.whiteSofter?.enabled ? WHITE_TONES.get(settings.whiteSofter.tone).rgb : null,
        labels: { copy: t('wardenCopyLink'), copied: t('wardenCopied'),
          smaller: t('wardenSmallerText'), larger: t('wardenLargerText'), fallback: t('wardenNoArticle'),
          contact: t('wardenCopyContact') } };
    },
    async syncSites(sites, settings, tools) {
      if (!savedToolDomains(settings, 'crashPageWarden').length && !toolChoices(tools, 'crashPageWarden', true).length) return;
      const selected = sites && new Set(sites);
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.filter(tab => !!tab.incognito === incognito
        && (!selected || selected.has(toolSite(tab.pendingUrl || tab.url)))).map(tab => reloadTab(tab, settings, tools)));
    },
    async handleTabUpdated(tabId, change) {
      if (!change.url) return;
      await load();
      const record = records.get(tabId);
      if (record && !sameWardenPage(record.url, change.url)) { records.delete(tabId); await save(); }
    },
    async handleTabRemoved(tabId) {
      await load(); records.delete(tabId); pending.delete(tabId); await save();
    },
    async reset() {
      const old = await chrome.scripting.getRegisteredContentScripts({ ids: [id, id + '-bootstrap'] });
      if (old.length) await chrome.scripting.unregisterContentScripts({ ids: old.map(script => script.id) });
      const rules = (await chrome.declarativeNetRequest.getSessionRules()).filter(owns);
      if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id) });
      // A current static document and its CSP deliberately survive reset.
    }
  };
}
