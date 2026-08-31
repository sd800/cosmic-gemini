export function createPageRuntimeHost(platform) {
  const pendingSyncs = new Map();

  async function setRuntime(tabId, frameId, product, active) {
    const options = { frameId };
    if (!active) {
      await platform.sendTabMessage(tabId, { type: 'CG_STOP_CENTRAL_FEATURE', featureId: product.id }, options);
      if (frameId === 0) await platform.setFeatureActivity(tabId, product.id, false);
      return;
    }
    const target = { tabId, frameIds: [frameId] };
    await chrome.scripting.executeScript({ target, files: [product.bridge], world: 'ISOLATED', injectImmediately: true });
    await chrome.scripting.executeScript({ target, files: [product.runtime], world: 'MAIN', injectImmediately: true });
    await platform.sendTabMessage(tabId, { type: 'CG_REFRESH_FEATURE_CONFIG', featureId: product.id }, options);
  }

  async function sync(product, context, active) {
    const { tabId, frameId } = context;
    const key = `${tabId}:${frameId}:${product.id}`;
    const previous = pendingSyncs.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => setRuntime(tabId, frameId, product, active));
    pendingSyncs.set(key, current);
    try { await current; }
    finally { if (pendingSyncs.get(key) === current) pendingSyncs.delete(key); }
    return active;
  }

  return Object.freeze({ sync });
}
