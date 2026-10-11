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
    try {
      const result = responseIngress.setTabs(tabIds);
      ingressSignature = signature;
      return result;
    } catch (error) {
      // Listener updates may have partially succeeded. Do not reuse any prior
      // signature until Chrome acknowledges the complete desired tab set.
      ingressSignature = null;
      throw error;
    }
  }

  function setCollecting(productId, tabId, active) {
    if (!productId || !Number.isInteger(tabId) || tabId < 0) return false;
    const sessionKey = key(productId, tabId);
    const changed = active === true ? !collecting.has(sessionKey) : collecting.has(sessionKey);
    if (!changed) {
      if (initialized) syncIngress();
      return false;
    }
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
    needsRestoration() { return !initialized || !restorationReliable || ingressSignature === null; },
    isCollecting(productId, tabId) { return collecting.has(key(productId, tabId)); },
    size() { return collecting.size; }
  });
}
