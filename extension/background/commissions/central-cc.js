// Chrome shares storage.session between split-incognito workers, while tabs.query
// only sees the caller's context. Never mistake the other context's records for
// orphaned tabs, or let a reset/cache read cross that boundary.
export const REGULAR_TABS_KEY = 'cosmicGeminiRegularTabs';
export const PRIVATE_TABS_KEY = 'cosmicGeminiPrivateTabs';
const PRIVATE_PREFIX = 'cosmicGeminiPrivate:';

// Session Isolation Section: session records and their cleanup boundary.
export function createContextSessionStorage(incognito = false) {
  const encode = key => (incognito ? PRIVATE_PREFIX : '') + key;
  const owns = key => incognito ? key.startsWith(PRIVATE_PREFIX) : !key.startsWith(PRIVATE_PREFIX);
  const decode = key => incognito ? key.slice(PRIVATE_PREFIX.length) : key;
  const decodeValues = values => Object.fromEntries(Object.entries(values).filter(([key]) => owns(key)).map(([key, value]) => [decode(key), value]));
  async function keys(prefixes = null) {
    const area = chrome.storage.session;
    // Enumerate names without cloning every product's potentially large media
    // session. Older supported Chrome builds retain the existing fallback.
    const names = typeof area.getKeys === 'function' ? await area.getKeys() : Object.keys(await area.get(null));
    const selected = prefixes == null ? null : Array.isArray(prefixes) ? prefixes : [prefixes];
    return names.filter(owns).map(decode).filter(key => !selected || selected.some(prefix => key.startsWith(prefix)));
  }
  return Object.freeze({
    keys,
    getByPrefix(prefixes) {
      const area = chrome.storage.session;
      if (typeof area.getKeys !== 'function') {
        const selected = Array.isArray(prefixes) ? prefixes : [prefixes];
        return area.get(null).then(values => Object.fromEntries(Object.entries(decodeValues(values))
          .filter(([key]) => selected.some(prefix => key.startsWith(prefix)))));
      }
      return keys(prefixes).then(names => names.length ? area.get(names.map(encode)).then(decodeValues) : {});
    },
    get(keys) {
      const request = keys == null ? null : typeof keys === 'string' ? encode(keys)
        : Array.isArray(keys) ? keys.map(encode)
          : Object.fromEntries(Object.entries(keys).map(([key, value]) => [encode(key), value]));
      return chrome.storage.session.get(request).then(decodeValues);
    },
    set(values) { return chrome.storage.session.set(Object.fromEntries(Object.entries(values).map(([key, value]) => [encode(key), value]))); },
    remove(keys) { return chrome.storage.session.remove(Array.isArray(keys) ? keys.map(encode) : encode(keys)); }
  });
}

// Neutral infrastructure authorized by Central through createPlatform. Product
// policy stays with its Province; the commission only supplies context scope.
export function createCentralCoordinationCommission(incognito) {
  const session = createContextSessionStorage(incognito);
  return Object.freeze({
    session,
    // Network Scope Section: distinguish split-context tab scopes.
    async networkScope() {
      const ownKey = incognito ? PRIVATE_TABS_KEY : REGULAR_TABS_KEY;
      const otherKey = incognito ? REGULAR_TABS_KEY : PRIVATE_TABS_KEY;
      const ids = (await chrome.tabs.query({})).filter(tab => !!tab.incognito === incognito && Number.isInteger(tab.id)).map(tab => tab.id).sort((a, b) => a - b);
      const stored = await chrome.storage.session.get([ownKey, otherKey]);
      if (JSON.stringify(stored[ownKey]) !== JSON.stringify(ids)) await chrome.storage.session.set({ [ownKey]: ids });
      const other = Array.isArray(stored[otherKey]) ? stored[otherKey].filter(Number.isInteger) : [];
      // Both contexts fail closed on the first request of an as-yet-unknown
      // tab. A product may retry a confirmed foreign-context block only after
      // the other context has acknowledged its exclusion.
      return other.length ? { excludedTabIds: other } : {};
    },
    async endPrivateSession() {
      const storage = createContextSessionStorage(true);
      const keys = await storage.keys();
      if (keys.length) await storage.remove(keys);
      await chrome.storage.session.remove(PRIVATE_TABS_KEY);
    }
  });
}
