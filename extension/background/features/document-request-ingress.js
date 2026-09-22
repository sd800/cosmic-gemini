// Only navigation/download requests are observed while Document Preview is enabled.
// No response bodies, XHR, media or page DOM are scanned here.
export function createDocumentRequestIngress() {
  const requests = new Map();
  function remember(details) {
    if (details.tabId < 0 || details.initiator?.startsWith('chrome-extension:')) return;
    const now = Date.now();
    for (const [id, value] of requests) if (now - value.at > 60000) requests.delete(id);
    requests.set(details.requestId, { url: details.url, method: details.method, tabId: details.tabId, at: now });
    while (requests.size > 256) requests.delete(requests.keys().next().value);
  }
  return {
    setEnabled(enabled) {
      const event = globalThis.chrome?.webRequest?.onBeforeRequest;
      if (!event) return;
      if (enabled && !event.hasListener(remember)) event.addListener(remember, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'other'] });
      if (!enabled) { if (event.hasListener(remember)) event.removeListener(remember); requests.clear(); }
    },
    take(item) {
      const matches = [...requests.entries()].filter(([, value]) => Date.now() - value.at < 60000 && [item.url, item.finalUrl].includes(value.url));
      for (const [id] of matches) requests.delete(id);
      // Ambiguous source tabs or any non-GET request are deliberately left to Chrome.
      if (!matches.length || matches.some(([, value]) => value.method !== 'GET') || new Set(matches.map(([, value]) => value.tabId)).size !== 1) return null;
      return matches.at(-1)[1];
    }
  };
}
