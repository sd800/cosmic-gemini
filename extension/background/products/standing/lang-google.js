import { FEATURE_IDS } from '../../../core/config.js';
import { googleSearchUrl, rewriteGoogleSearchUrl } from '../../../core/lang-google.js';

export function createLangGoogleProduct(platform) {
  const pending = new Map();

  async function apply(tabId, url, documentId = '') {
    const destination = rewriteGoogleSearchUrl(url);
    if (!destination || !Number.isInteger(tabId)) return false;
    const key = `${tabId}:${documentId}:${url}`;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      // Read at execution time, so a disabled switch never authorizes a queued navigation.
      if (!(await platform.readSettings()).langGoogle?.enabled) return false;
      try {
        const results = await chrome.scripting.executeScript({
          target: documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] },
          world: 'ISOLATED',
          injectImmediately: true,
          func: (expected, replacement) => {
            if (window !== window.top || location.href !== expected) return false;
            // Document-start sync and URL updates can arrive together. Keep a
            // document-local guard, not a persistent query/history cache.
            const key = Symbol.for('cosmic-gemini.lang-google.navigation');
            if (globalThis[key] === expected) return false;
            globalThis[key] = expected;
            try { location.replace(replacement); } catch {
              delete globalThis[key];
              return false;
            }
            return true;
          },
          args: [url, destination]
        });
        return results.some(frame => frame.result === true);
      } catch { return false; } // A closed tab or superseded document needs no retry.
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  return Object.freeze({
    id: FEATURE_IDS.LANG_GOOGLE,
    state(settings, url) {
      const enabled = settings.langGoogle?.enabled === true;
      const supported = !!googleSearchUrl(url);
      return { enabled, supported, active: enabled && supported };
    },
    sync(context, settings) {
      if (!settings.langGoogle?.enabled || context.frameId !== 0) return false;
      return apply(context.tabId, context.frameUrl, context.documentId);
    },
    handleTabUpdated(tabId, change, tab) {
      // The existing Central event also covers same-document search navigation.
      // Non-search URLs do not read storage or inject anything.
      if (!change.url || (tab.url && tab.url !== change.url)
        || (tab.pendingUrl && tab.pendingUrl !== change.url)) return false;
      return apply(tabId, change.url);
    }
  });
}
