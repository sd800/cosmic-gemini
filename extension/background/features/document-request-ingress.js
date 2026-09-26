// Only navigation/download requests are observed while Document Preview is enabled.
// No response bodies, XHR, media or page DOM are scanned here.
export function createDocumentRequestIngress() {
  const requests = new Map();
  function remember(details) {
    if (details.tabId < 0 || details.initiator?.startsWith('chrome-extension:')) return;
    const now = Date.now();
    for (const [id, value] of requests) if (now - value.at > 60000) requests.delete(id);
    // Chrome can start a new request ID when a cross-origin download turns
    // into a navigation. Join only an exact, observed redirect in this frame.
    const parents = requests.has(details.requestId) ? [] : [...requests.values()].filter(value =>
      value.redirectUrl === details.url && value.tabId === details.tabId && value.frameId === details.frameId);
    const roots = new Set(parents.map(value => value.originalUrl));
    const previous = requests.get(details.requestId) || (roots.size === 1 ? parents.at(-1) : null);
    requests.set(details.requestId, {
      url: details.url, originalUrl: previous?.originalUrl || details.url,
      // A POST redirected to GET must not become replayable.
      method: roots.size > 1 || parents.some(value => value.method !== 'GET') ? 'AMBIGUOUS'
        : previous?.method && previous.method !== 'GET' ? previous.method : details.method,
      tabId: details.tabId, frameId: details.frameId, at: now
    });
    while (requests.size > 256) requests.delete(requests.keys().next().value);
  }
  function redirect(details) {
    const request = requests.get(details.requestId);
    if (request && request.url === details.url && request.tabId === details.tabId
      && /^https?:\/\//i.test(details.redirectUrl || '')) request.redirectUrl = details.redirectUrl;
  }
  return {
    setEnabled(enabled) {
      const event = globalThis.chrome?.webRequest?.onBeforeRequest;
      if (!event) return;
      const filter = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'other'] };
      const redirects = globalThis.chrome?.webRequest?.onBeforeRedirect;
      if (enabled && !event.hasListener(remember)) event.addListener(remember, filter);
      if (enabled && redirects && !redirects.hasListener(redirect)) redirects.addListener(redirect, filter);
      if (!enabled) {
        if (event.hasListener(remember)) event.removeListener(remember);
        if (redirects?.hasListener(redirect)) redirects.removeListener(redirect);
        requests.clear();
      }
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
