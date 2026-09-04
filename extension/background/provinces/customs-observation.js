export function createCustomsObservationRegistry(responseIngress) {
  const collecting = new Set();
  let initialized = false;
  let restorationReliable = true;
  let ingressSignature = null;

  function key(productId, tabId) { return `${productId}:${tabId}`; }

  function syncIngress() {
    const tabIds = new Set([...collecting]
      .map(value => Number(value.slice(value.lastIndexOf(':') + 1)))
      .filter(tabId => Number.isInteger(tabId) && tabId >= 0));
    const signature = [...tabIds].sort((left, right) => left - right).join(',');
    if (signature === ingressSignature) return tabIds.size;
    ingressSignature = signature;
    return responseIngress.setTabs(tabIds);
  }

  function setCollecting(productId, tabId, active) {
    if (!productId || !Number.isInteger(tabId)) return false;
    const sessionKey = key(productId, tabId);
    const changed = active === true ? !collecting.has(sessionKey) : collecting.has(sessionKey);
    if (!changed) return false;
    if (active === true) collecting.add(sessionKey);
    else collecting.delete(sessionKey);
    if (initialized) syncIngress();
    return true;
  }

  function completeInitialization(results) {
    initialized = true;
    restorationReliable = results.every(result => result === true);
    syncIngress();
    return Object.freeze({ reliable: restorationReliable, collecting: collecting.size });
  }

  return Object.freeze({
    setCollecting,
    completeInitialization,
    needsRestoration() { return !initialized || !restorationReliable; },
    isCollecting(productId, tabId) { return collecting.has(key(productId, tabId)); },
    size() { return collecting.size; }
  });
}
