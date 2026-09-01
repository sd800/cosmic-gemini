export function createPageRuntimeHost(platform) {
  const pendingSyncs = new Map();

  function runtimeName(productId) {
    return String(productId).replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
  }

  async function disposeMainRuntime(tabId, frameId, productId) {
    const name = runtimeName(productId);
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      injectImmediately: true,
      func: value => {
        const runtime = globalThis[Symbol.for(`cosmic-gemini.${value}.runtime`)];
        if (!runtime?.token) return;
        globalThis.dispatchEvent(new CustomEvent(`cosmic-gemini:${value}:dispose`, { detail: runtime.token }));
      },
      args: [name]
    });
  }

  async function setRuntime(tabId, frameId, product, active) {
    const options = { frameId };
    if (!active) {
      await platform.sendTabMessage(tabId, { type: 'CG_STOP_CENTRAL_FEATURE', featureId: product.id }, options);
      await disposeMainRuntime(tabId, frameId, product.id).catch(() => {});
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
