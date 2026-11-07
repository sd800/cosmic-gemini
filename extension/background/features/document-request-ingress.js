function requestUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

export function documentReplayOrigins(urls) {
  return [...new Set(urls.map(value => requestUrl(value)?.origin).filter(Boolean))].slice(-8);
}

async function replayRequest(url, credentials, signal) {
  const redirects = chrome.webRequest?.onBeforeRedirect;
  const extensionOrigin = chrome.runtime.getURL('').slice(0, -1);
  let received, timeout;
  const destination = new Promise(resolve => { received = resolve; });
  const abort = () => received(null);
  const onRedirect = details => {
    if (details.initiator === extensionOrigin && details.tabId === -1 && details.method === 'GET'
      && details.url === url.href && [301, 302, 303, 307, 308].includes(details.statusCode)) {
      received(requestUrl(details.redirectUrl));
    }
  };
  if (redirects) redirects.addListener(onRedirect, { urls: [url.origin + '/*'], types: ['xmlhttprequest'] });
  try {
    const response = await fetch(url.href, { credentials, cache: 'no-store', redirect: 'manual', signal });
    if (response.type !== 'opaqueredirect') return { response };
    if (!redirects || signal.aborted) return {};
    // Fetch hides Location in a manual redirect. Chrome supplies the target
    // separately and may dispatch the event after the Fetch response resolves.
    timeout = setTimeout(abort, 500);
    signal.addEventListener('abort', abort, { once: true });
    return { next: await destination };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    redirects?.removeListener(onRedirect);
  }
}

export async function replayDocumentRequest(doc, signal) {
  let url = requestUrl(doc.url);
  const allowed = new Set(doc.replayOrigins);
  if (url) allowed.add(url.origin);
  const visited = new Set();
  for (let hop = 0; hop < 6 && url && allowed.has(url.origin) && !visited.has(url.href); hop++) {
    visited.add(url.href);
    const { response, next } = await replayRequest(url, url.origin === doc.sourceOrigin ? 'include' : 'omit', signal);
    if (response) return response;
    url = next;
  }
  throw Error('documentActionFailed');
}

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
    const roots = new Set(parents.map(value => JSON.stringify([value.originalUrl, value.initiator])));
    const previous = requests.get(details.requestId) || (roots.size === 1 ? parents.at(-1) : null);
    requests.set(details.requestId, {
      url: details.url, originalUrl: previous?.originalUrl || details.url,
      initiator: previous ? previous.initiator : details.initiator,
      origins: documentReplayOrigins([...(previous?.origins || []), details.url]),
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
      // One identical URL is insufficient to resolve downloads from different frames or origins.
      const sources = new Set(matches.map(([, value]) => JSON.stringify([value.tabId, value.frameId, value.initiator])));
      if (!matches.length || sources.size !== 1 || matches.some(([, value]) => value.method !== 'GET')) return null;
      return matches.at(-1)[1];
    }
  };
}
