import { siteKey } from '../../../core/site-key.js';

const LIMIT = 100;
const FRAME_SANDBOX = 'sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock allow-presentation allow-storage-access-by-user-activation';
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function stayDomains(settings) {
  const feature = settings.websiteFixer;
  return feature?.enabled && feature.stayOnPage?.enabled ? feature.stayOnPage.whitelistDomains : [];
}

export function stayRules(domains, incognito = false) {
  const start = incognito ? 931_001 : 930_001;
  return domains.flatMap((domain, index) => [{
    id: start + index * 2, priority: 300,
    action: { type: 'block' },
    condition: { initiatorDomains: [domain], excludedRequestDomains: [domain], resourceTypes: ['main_frame'] }
  }, {
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
  const permitted = (url, site) => {
    try { const parsed = new URL(url); return siteKey(parsed.protocol === 'blob:' ? parsed.origin : parsed.href) === site; }
    catch { return false; }
  };
  async function checkPopup(tabId, url) {
    const record = pending.get(tabId);
    if (!record) return;
    if (Date.now() > record.until) { pending.delete(tabId); return; }
    if (!url || url === 'about:blank') return;
    pending.delete(tabId);
    if (!permitted(url, record.site)) await chrome.tabs.remove(tabId).catch(() => {});
  }
  return {
    async reconcile(settings) {
      const old = (await chrome.declarativeNetRequest.getSessionRules()).filter(owns);
      const next = stayRules(stayDomains(settings), incognito);
      if (stable(old.sort((a, b) => a.id - b.id)) !== stable(next)) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old.map(rule => rule.id), addRules: next });
        pending.clear();
      }
    },
    async handleTabCreated(tab) {
      if (!Number.isInteger(tab.openerTabId) || !!tab.incognito !== incognito) return;
      const domains = stayDomains(await platform.readSettings());
      if (!domains.length) return;
      const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
      const site = siteKey(opener?.url || '');
      if (!domains.includes(site)) return;
      for (const [id, record] of pending) if (record.until < Date.now()) pending.delete(id);
      pending.set(tab.id, { site, until: Date.now() + 30_000 });
      const latest = await chrome.tabs.get(tab.id).catch(() => null);
      if (!latest) { pending.delete(tab.id); return; }
      await checkPopup(tab.id, latest.pendingUrl || latest.url || tab.pendingUrl || tab.url);
    },
    handleTabUpdated(tabId, change, tab) { return checkPopup(tabId, change.url || tab.pendingUrl || tab.url); },
    handleTabRemoved(tabId) { pending.delete(tabId); },
    async reset() {
      pending.clear();
      const rules = (await chrome.declarativeNetRequest.getSessionRules()).filter(owns);
      if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id) });
    }
  };
}
