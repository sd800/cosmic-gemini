import { siteKey } from '../../../core/site-key.js';

const LIMIT = 100;
const FRAME_SANDBOX = 'sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock allow-presentation allow-storage-access-by-user-activation';
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function stayDomains(settings) {
  const feature = settings.websiteFixer;
  return feature?.enabled && feature.stayOnPage?.enabled ? feature.stayOnPage.whitelistDomains : [];
}

export function stayRules(domains, incognito = false, tabIdsBySite = new Map()) {
  const start = incognito ? 931_001 : 930_001;
  return domains.flatMap((domain, index) => [...(tabIdsBySite.get(domain)?.length ? [{
    id: start + index * 2, priority: 300,
    action: { type: 'block' },
    // A browser-created tab has a different ID and must remain free to navigate.
    condition: { initiatorDomains: [domain], excludedRequestDomains: [domain],
      resourceTypes: ['main_frame'], tabIds: tabIdsBySite.get(domain) }
  }] : []), {
    id: start + index * 2 + 1, priority: 300,
    // Cross-site embeds may load and play, but cannot escape into top-level
    // pages/popups. The sandbox is inherited by their descendants and blobs.
    action: { type: 'modifyHeaders', responseHeaders: [{ header: 'content-security-policy', operation: 'append', value: FRAME_SANDBOX }] },
    condition: { initiatorDomains: [domain], excludedRequestDomains: [domain], resourceTypes: ['sub_frame'] }
  }]);
}

export function createStayOnPage(platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const start = incognito ? 931_001 : 930_001;
  const owns = rule => rule.id >= start && rule.id < start + LIMIT * 2;
  const pending = new Map();
  const contextIntents = new Map();
  const navigationOrigins = new Map();
  let domainSignature = null;
  const INTENT_MS = 90_000;
  function contextMatch(url, intent) {
    try {
      const target = new URL(url);
      if (!/^https?:$/.test(target.protocol)) return false;
      if (intent.kind === 'link') {
        const chosen = new URL(intent.url);
        target.hash = '';
        chosen.hash = '';
        if (target.href === chosen.href) return true;
      }
      return (intent.kind === 'search' || intent.search === true)
        && /^google\.[a-z.]+$/.test(target.hostname.replace(/^www\./, ''))
        && target.pathname === '/search' && target.searchParams.has('q');
    } catch { return false; }
  }
  const permitted = (url, site) => {
    try { const parsed = new URL(url); return siteKey(parsed.protocol === 'blob:' ? parsed.origin : parsed.href) === site; }
    catch { return false; }
  };
  async function checkPopup(tabId, url) {
    const record = pending.get(tabId);
    if (!record) return;
    if (Date.now() > record.until) { pending.delete(tabId); return; }
    if (!url || url === 'about:blank') return;
    if (permitted(url, record.site)) { pending.delete(tabId); navigationOrigins.delete(tabId); return; }
    let target;
    try { target = new URL(url); } catch { return; }
    if (['chrome:', 'chrome-extension:', 'file:'].includes(target.protocol)
      || (target.protocol === 'blob:' && target.origin.startsWith('chrome-extension:'))) {
      pending.delete(tabId);
      navigationOrigins.delete(tabId);
      return;
    }
    if (record.intent && contextMatch(url, record.intent)) {
      pending.delete(tabId);
      navigationOrigins.delete(tabId);
      contextIntents.delete(record.openerTabId);
      return;
    }
    if (/^https?:$/.test(target.protocol)) {
      const navigation = navigationOrigins.get(tabId);
      if (!navigation || Date.now() - navigation.at > 30_000) return;
      if (!navigation.initiator || navigation.initiator.startsWith('chrome-extension:')) {
        pending.delete(tabId);
        navigationOrigins.delete(tabId);
        return;
      }
    }
    pending.delete(tabId);
    navigationOrigins.delete(tabId);
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  return {
    async reconcile(settings) {
      const old = (await chrome.declarativeNetRequest.getSessionRules()).filter(owns);
      const domains = stayDomains(settings);
      const signature = domains.join('\0');
      if (domainSignature !== null && signature !== domainSignature) {
        pending.clear();
        contextIntents.clear();
        navigationOrigins.clear();
      }
      domainSignature = signature;
      const tabIdsBySite = new Map(domains.map(domain => [domain, []]));
      if (domains.length) {
        for (const tab of await chrome.tabs.query({})) {
          if (!!tab.incognito !== incognito || !Number.isInteger(tab.id)) continue;
          tabIdsBySite.get(siteKey(tab.url || tab.pendingUrl || ''))?.push(tab.id);
        }
      }
      const next = stayRules(domains, incognito, tabIdsBySite);
      if (stable(old.sort((a, b) => a.id - b.id)) !== stable(next)) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old.map(rule => rule.id), addRules: next });
      }
    },
    async handleContextMenu(message, sender) {
      const tabId = sender.tab?.id;
      if (!Number.isInteger(tabId) || !!sender.tab.incognito !== incognito) return false;
      const site = siteKey(sender.tab.url || '');
      if (!stayDomains(await platform.readSettings()).includes(site)) return false;
      const kind = message.kind;
      if (kind !== 'link' && kind !== 'search') return false;
      let url = '';
      if (kind === 'link') {
        try {
          const parsed = new URL(message.url);
          if (!/^https?:$/.test(parsed.protocol) || siteKey(parsed.href) === site) return false;
          url = parsed.href;
        } catch { return false; }
      }
      contextIntents.set(tabId, { kind, url, search: message.search === true,
        until: Date.now() + INTENT_MS });
      return true;
    },
    handleNavigationRequest(details) {
      if (!Number.isInteger(details?.tabId) || details.tabId < 0) return;
      const now = Date.now();
      for (const [id, record] of navigationOrigins) if (now - record.at > 30_000) navigationOrigins.delete(id);
      navigationOrigins.set(details.tabId, { initiator: String(details.initiator || ''), at: now });
      while (navigationOrigins.size > 256) navigationOrigins.delete(navigationOrigins.keys().next().value);
      if (pending.has(details.tabId)) void checkPopup(details.tabId, details.url);
    },
    async handleTabCreated(tab) {
      if (!Number.isInteger(tab.openerTabId) || !!tab.incognito !== incognito) return;
      if (/^(?:chrome:\/\/newtab|about:newtab)/.test(tab.pendingUrl || tab.url || '')) return;
      const domains = stayDomains(await platform.readSettings());
      if (!domains.length) return;
      const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
      const site = siteKey(opener?.url || '');
      if (!domains.includes(site)) return;
      for (const [id, record] of pending) if (record.until < Date.now()) pending.delete(id);
      const intent = contextIntents.get(tab.openerTabId);
      if (intent && intent.until < Date.now()) contextIntents.delete(tab.openerTabId);
      pending.set(tab.id, { site, openerTabId: tab.openerTabId,
        intent: intent?.until >= Date.now() ? intent : null, until: Date.now() + 30_000 });
      const latest = await chrome.tabs.get(tab.id).catch(() => null);
      if (!latest) { pending.delete(tab.id); return; }
      await checkPopup(tab.id, latest.pendingUrl || latest.url || tab.pendingUrl || tab.url);
    },
    handleTabUpdated(tabId, change, tab) { return checkPopup(tabId, change.url || tab.pendingUrl || tab.url); },
    handleTabRemoved(tabId) { pending.delete(tabId); contextIntents.delete(tabId); navigationOrigins.delete(tabId); },
    async reset() {
      pending.clear();
      contextIntents.clear();
      navigationOrigins.clear();
      domainSignature = null;
      const rules = (await chrome.declarativeNetRequest.getSessionRules()).filter(owns);
      if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id) });
    }
  };
}
