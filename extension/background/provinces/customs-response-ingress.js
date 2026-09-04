const RESPONSE_TYPES = Object.freeze(['media', 'xmlhttprequest', 'other', 'image']);

export function createCustomsResponseIngress(handleDetails, event = chrome.webRequest.onHeadersReceived) {
  const listeners = new Map();

  function setTabs(tabIds) {
    const nextTabs = new Set([...tabIds].filter(tabId => Number.isInteger(tabId) && tabId >= 0));
    for (const [tabId, listener] of listeners) {
      if (nextTabs.has(tabId)) continue;
      event.removeListener(listener);
      listeners.delete(tabId);
    }
    for (const tabId of nextTabs) {
      if (listeners.has(tabId)) continue;
      const listener = details => void handleDetails(details);
      event.addListener(listener, {
        urls: ['http://*/*', 'https://*/*'],
        types: RESPONSE_TYPES,
        tabId
      }, ['responseHeaders']);
      listeners.set(tabId, listener);
    }
    return listeners.size;
  }

  return Object.freeze({
    setTabs,
    size() { return listeners.size; }
  });
}
