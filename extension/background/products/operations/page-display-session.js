import { normalizePageDisplaySite } from '../../../core/config.js';

const KEY = 'cosmicGeminiPageDisplaySites';
export const DISPLAY_KINDS = Object.freeze(['reduceWhitePoint', 'greyscale']);
const LIMIT = 1000;

// Context-scoped session storage survives worker suspension, never browser exit.
export function createPageDisplaySession(platform) {
  const storage = platform.sessionStorage;
  return {
    async read() {
      const raw = storage ? (await storage.get(KEY))[KEY] : null;
      return Object.fromEntries(DISPLAY_KINDS.map(kind => {
        const sites = new Map();
        for (const entry of Array.isArray(raw?.[kind]) ? raw[kind].slice(0, LIMIT) : []) {
          if (typeof entry?.site !== 'string' || typeof entry.enabled !== 'boolean') continue;
          try { sites.set(normalizePageDisplaySite(entry.site), entry.enabled); } catch {}
        }
        return [kind, [...sites].map(([site, enabled]) => ({ site, enabled }))];
      }));
    },
    async set(kind, site, enabled) {
      if (!storage) throw new Error('Browser session storage is unavailable.');
      const state = await this.read();
      const entries = state[kind];
      if (!entries.some(entry => entry.site === site) && entries.length >= LIMIT) {
        throw new Error('The website session list is full.');
      }
      state[kind] = [...entries.filter(entry => entry.site !== site), { site, enabled }];
      await storage.set({ [KEY]: state });
    },
    clear: () => storage?.remove(KEY)
  };
}
