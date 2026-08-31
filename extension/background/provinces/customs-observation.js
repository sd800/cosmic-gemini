export function createCustomsObservationRegistry(responseIngress) {
  const collecting = new Set();
  let initialized = false;
  let restorationReliable = true;

  function key(productId, tabId) { return `${productId}:${tabId}`; }

  function syncIngress() {
    return responseIngress.setEnabled(!initialized || !restorationReliable || collecting.size > 0);
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
