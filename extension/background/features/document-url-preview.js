import { DOCUMENT_PREVIEW_PATH, isLocalDocumentId } from '../../core/document-preview/document-preview.js';

// A user-created, same-origin shell hosts only the authenticated extension
// reader. File bytes stay in the existing offscreen RAM store.
export function createDocumentUrlPreview(platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const start = incognito ? 983001 : 982001;
  const key = 'documentUrlPreviews', records = new Map(), waiters = new Map();
  let loaded;
  const own = rule => rule.id >= start && rule.id < start + 32;
  const storage = platform.sessionStorage || chrome.storage.session;
  const sameUrl = (left, right) => typeof left === 'string' && typeof right === 'string' && left.split('#')[0] === right.split('#')[0];
  function fallbackUrl(record, value) {
    try {
      const url = new URL(value), pages = [chrome.runtime.getURL(DOCUMENT_PREVIEW_PATH), chrome.runtime.getURL('workspaces/document-preview/entry.html'), chrome.runtime.getURL('') + 'workspaces/document-preview/entry.html'];
      return pages.includes(url.href.split('#')[0]) && new URLSearchParams(url.hash.slice(1)).get('id') === record.id;
    } catch { return false; }
  }
  const save = () => storage.set({ [key]: [...records.values()] });
  const load = () => loaded ||= storage.get(key).then(data => {
    for (const record of Array.isArray(data[key]) ? data[key].slice(0, 32) : []) {
      if (Number.isInteger(record?.tabId) && isLocalDocumentId(record.nonce) && isLocalDocumentId(record.id)
        && Number.isInteger(record.ruleId) && record.ruleId >= start && record.ruleId < start + 32
        && typeof record.documentId === 'string' && /^https?:\/\//.test(record.url || '')) records.set(record.tabId, record);
    }
  }).catch(error => { loaded = null; throw error; });
  async function live(record) {
    try {
      const tab = await chrome.tabs.get(record.tabId);
      if (!!tab.incognito !== incognito || !sameUrl(tab.url, record.url) || tab.pendingUrl && !sameUrl(tab.pendingUrl, record.url)) return false;
      const [scope] = await chrome.scripting.executeScript({ target: { tabId: record.tabId, documentIds: [record.documentId] }, world: 'ISOLATED',
        func: () => ({ url: location.href, name: window.name }) });
      return scope?.frameId === 0 && scope.documentId === record.documentId && sameUrl(scope.result?.url, record.url)
        && scope.result.name === 'cosmic-gemini-document:' + record.nonce;
    } catch { return false; }
  }
  async function forget(record, close = false) {
    const current = records.get(record.tabId);
    if (current !== record) return;
    const waiter = waiters.get(record.tabId);
    if (waiter) { clearTimeout(waiter.timer); waiter.resolve(false); waiters.delete(record.tabId); }
    const ownedWindow = close && await live(record);
    const installed = (await chrome.declarativeNetRequest.getSessionRules()).find(rule => rule.id === record.ruleId);
    if (installed?.condition.tabIds?.length === 1 && installed.condition.tabIds[0] === record.tabId) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [record.ruleId] });
    }
    records.delete(record.tabId); await save();
    if (ownedWindow) await chrome.tabs.remove(record.tabId).catch(() => {});
  }
  return {
    async reconcile(tabs) {
      await load();
      const valid = new Set(tabs.filter(tab => !!tab.incognito === incognito).map(tab => tab.id));
      for (const record of [...records.values()]) {
        const tab = tabs.find(tab => tab.id === record.tabId);
        if (!valid.has(record.tabId) || !sameUrl(tab.url, record.url) && !fallbackUrl(record, tab.url)) await forget(record);
      }
      const rules = await chrome.declarativeNetRequest?.getSessionRules?.() || [];
      const orphaned = rules.filter(rule => own(rule) && ![...records.values()].some(record => record.ruleId === rule.id));
      if (orphaned.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: orphaned.map(rule => rule.id) });
    },
    owns(tabId, id) { return records.get(tabId)?.id === id; },
    retainedIds(tabs) { return new Set([...records.values()].filter(record => tabs.some(tab => tab.id === record.tabId && !!tab.incognito === incognito
      && (sameUrl(tab.url, record.url) || fallbackUrl(record, tab.url)))).map(record => record.id)); },
    live,
    async reserve(doc, sender, nonce) {
      if (doc.local || !isLocalDocumentId(nonce) || sender.frameId !== 0 || !sender.documentId) return null;
      try { const url = new URL(doc.url); if (url.origin !== new URL(sender.url).origin || !/^https?:/.test(doc.url) || url.username || url.password) return null; } catch { return null; }
      await load(); if (records.size >= 32) return null;
      const candidates = (await chrome.tabs.query({})).filter(tab => tab.id !== sender.tab?.id && sameUrl(tab.url, doc.url)
        && !!tab.incognito === incognito).slice(0, 8);
      for (const tab of candidates) {
        const [scope] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED',
          func: () => ({ url: location.href, name: window.name }) }).catch(() => []);
        if (!scope?.documentId || scope.result?.url !== doc.url || scope.result.name !== 'cosmic-gemini-document:' + nonce) continue;
        const rules = await chrome.declarativeNetRequest.getSessionRules();
        let ruleId = start; while ((rules.some(rule => rule.id === ruleId) || [...records.values()].some(record => record.ruleId === ruleId)) && ruleId < start + 32) ruleId++;
        if (ruleId >= start + 32) return null;
        const record = { tabId: tab.id, documentId: scope.documentId, id: doc.id, url: doc.url, nonce, ruleId };
        records.set(tab.id, record);
        try { await save(); } catch { records.delete(tab.id); return null; }
        return record;
      }
      return null;
    },
    async mount(record, workspace) {
      if (!record || !await live(record)) return false;
      const regexFilter = '^' + record.url.split('#')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      try {
        if (!(await chrome.declarativeNetRequest.isRegexSupported({ regex: regexFilter })).isSupported) throw Error('URL pattern unavailable');
        const existing = (await chrome.declarativeNetRequest.getSessionRules()).find(rule => rule.id === record.ruleId);
        if (existing && (existing.condition.tabIds?.length !== 1 || existing.condition.tabIds[0] !== record.tabId)) throw Error('Preview rule owner changed');
        // Reloads use the prepared extension page rather than repeat a download.
        // Access Control blocks retain their higher request priority.
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [record.ruleId], addRules: [{ id: record.ruleId, priority: 5,
          action: { type: 'redirect', redirect: { url: chrome.runtime.getURL('workspaces/document-preview/entry.html') + '#' + workspace.split('#')[1] } },
          condition: { tabIds: [record.tabId], resourceTypes: ['main_frame'], requestMethods: ['get'], regexFilter, isUrlFilterCaseSensitive: true } }] });
        let waiter;
        const ready = new Promise(resolve => { waiter = { resolve, started: false, timer: setTimeout(() => resolve(false), 3000) }; waiters.set(record.tabId, waiter); });
        try {
          await chrome.scripting.executeScript({ target: { tabId: record.tabId, documentIds: [record.documentId] }, world: 'ISOLATED',
            func: url => {
              const frame = document.createElement('iframe'); frame.src = url; frame.title = 'Document Preview';
              frame.referrerPolicy = 'no-referrer'; frame.allow = 'clipboard-write *';
              frame.allowFullscreen = true;
              frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;display:block';
              document.body.replaceChildren(frame);
            }, args: [workspace] });
          return await ready;
        } finally { clearTimeout(waiter.timer); waiters.delete(record.tabId); }
      } catch { return false; }
    },
    async authorize(sender, id) {
      await load(); const record = records.get(sender.tab?.id);
      if (!record || record.id !== id || !sender.documentId || !Number.isInteger(sender.frameId) || sender.frameId <= 0
        || sender.id !== chrome.runtime.id || sender.origin !== 'chrome-extension://' + chrome.runtime.id
        || sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active'
        || !await live(record)) throw Error('Document preview window unavailable.');
      const waiter = waiters.get(record.tabId);
      if (waiter && !waiter.started) { waiter.started = true; clearTimeout(waiter.timer); waiter.timer = setTimeout(() => waiter.resolve(false), 20000); }
      return true;
    },
    report(tabId, ready) { waiters.get(tabId)?.resolve(ready === true); },
    abandon: record => record ? forget(record, true) : Promise.resolve(),
    async reset() { await load(); for (const record of [...records.values()]) await forget(record); }
  };
}
