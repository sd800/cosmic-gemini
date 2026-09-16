// Session rules are shared by split-incognito workers. Scope each owner's rules
// to its own tab IDs, with separate rule IDs for regular and incognito contexts.
export const ALL_REQUEST_RESOURCE_TYPES = Object.freeze([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport',
  'webbundle', 'other'
]);

export function createRequestLanguageRules(platform, { regularIds, incognitoIds, priority, conditions }) {
  const incognito = platform.isIncognitoContext?.() === true;
  const ids = incognito ? incognitoIds : regularIds;
  let signature;
  let queue = Promise.resolve();
  return {
    sync(active, options = {}) {
      const operation = queue.then(async () => {
        if (!globalThis.chrome?.declarativeNetRequest?.updateSessionRules) return false;
        try {
          let targets = [];
          if (active && Array.isArray(options.targets)) {
            targets = options.targets.map(target => {
              let value = 'en-US';
              try { value = Intl.getCanonicalLocales(target?.value || value)[0]; } catch {}
              const tabIds = [...new Set((target?.tabIds || []).filter(tabId => Number.isInteger(tabId) && tabId >= 0))]
                .sort((a, b) => a - b);
              return { value, tabIds };
            }).filter(target => target.tabIds.length).sort((a, b) => a.value.localeCompare(b.value));
          } else if (active) {
            let value = 'en-US';
            try { value = Intl.getCanonicalLocales(options.value || value)[0]; } catch {}
            const tabs = await chrome.tabs.query({});
            const tabIds = tabs.filter(tab => Number.isInteger(tab.id) && tab.id >= 0
              && Boolean(tab.incognito) === incognito && tab.id !== options.excludeTabId)
              .map(tab => tab.id).sort((a, b) => a - b);
            if (tabIds.length) targets = [{ value, tabIds }];
          }
          // No empty tabIds rule: omitting the condition would leak into other contexts.
          const rules = targets.flatMap((target, targetIndex) => conditions.map((condition, conditionIndex) => {
            const id = ids[targetIndex * conditions.length + conditionIndex];
            if (!Number.isInteger(id)) throw new Error('Request-language rule capacity exceeded.');
            return {
              id, priority,
              action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Accept-Language', operation: 'set', value: target.value }] },
              condition: { ...condition, tabIds: target.tabIds }
            };
          }));
          const next = JSON.stringify(rules);
          if (signature === next) return true;
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [...ids], addRules: rules });
          signature = next;
          return true;
        } catch {
          signature = undefined;
          return false;
        }
      });
      queue = operation.catch(() => undefined);
      return operation;
    }
  };
}
