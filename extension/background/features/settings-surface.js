// Only extension-owned Settings documents participate; no broad tabs permission.
// Document start times make delayed loading and concurrent openings deterministic.
export function createSettingsSurface(isSettingsPage, storageKey) {
  let queue = Promise.resolve();
  return function register(sender, openedAt) {
    if (sender?.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !sender.documentId ||
        !isSettingsPage(sender.url) || !Number.isFinite(openedAt) || openedAt <= 0) return Promise.resolve(false);
    const incognito = sender.tab.incognito === true, key = storageKey + (incognito ? ':private' : ':regular');
    const run = queue.catch(() => {}).then(async () => {
      const contexts = (await chrome.runtime.getContexts({ contextTypes: ['TAB'], incognito }))
        .filter(c => c.frameId === 0 && c.tabId >= 0 && isSettingsPage(c.documentUrl));
      if (!contexts.some(c => c.documentId === sender.documentId && c.tabId === sender.tab.id)) return false;
      const saved = (await chrome.storage.session.get(key))[key] || {}, records = {};
      for (const c of contexts) if (Number.isFinite(saved[c.documentId])) records[c.documentId] = saved[c.documentId];
      records[sender.documentId] = openedAt;
      // Unknown documents may be NEWER pages whose module has not started yet.
      // Let their own registration decide; never close them on a loading guess.
      const known = contexts.filter(c => Number.isFinite(records[c.documentId]));
      const newest = known.reduce((a,b) => records[b.documentId] > records[a.documentId] ||
        (records[b.documentId] === records[a.documentId] && b.documentId === sender.documentId) ? b : a);
      await chrome.storage.session.set({ [key]: records });
      for (const old of known) {
        if (old.documentId === newest.documentId || old.tabId === newest.tabId) continue;
        const live = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentIds: [old.documentId, newest.documentId], incognito });
        if (!live.some(c => c.documentId === newest.documentId && c.tabId === newest.tabId && isSettingsPage(c.documentUrl))) break;
        if (live.some(c => c.documentId === old.documentId && c.tabId === old.tabId && isSettingsPage(c.documentUrl))) {
          await chrome.tabs.remove(old.tabId).catch(() => {});
        }
        delete records[old.documentId];
      }
      await chrome.storage.session.set({ [key]: records });
      return true;
    });
    queue = run.catch(() => {});
    return run;
  };
}
