export function createPageRuntimeHost(platform) {
  const pendingSyncs = new Map();

  function runtimeName(productId) {
    return String(productId).replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
  }

  function executionTarget(tabId, frameId, documentId) {
    return documentId
      ? { tabId, documentIds: [documentId] }
      : { tabId, frameIds: [frameId] };
  }

  function messageOptions(frameId, documentId) {
    return documentId ? { documentId } : { frameId };
  }

  async function disposeMainRuntime(tabId, frameId, documentId, productId) {
    const name = runtimeName(productId);
    const results = await chrome.scripting.executeScript({
      target: executionTarget(tabId, frameId, documentId),
      world: 'MAIN',
      injectImmediately: true,
      func: value => {
        const runtime = globalThis[Symbol.for(`cosmic-gemini.${value}.runtime`)];
        if (runtime?.token) {
          globalThis.dispatchEvent(new CustomEvent(`cosmic-gemini:${value}:dispose`, { detail: runtime.token }));
        }
        return true;
      },
      args: [name]
    });
    return results.some(result => result?.result === true);
  }

  async function setRuntime(tabId, frameId, documentId, product, active) {
    const options = messageOptions(frameId, documentId);
    if (!active) {
      const response = await platform.sendTabMessage(
        tabId,
        { type: 'CG_STOP_CENTRAL_FEATURE', featureId: product.id },
        options
      );
      if (frameId === 0 && response?.disposed === true) await platform.setFeatureActivity(tabId, product.id, false);
      return;
    }
    const target = executionTarget(tabId, frameId, documentId);
    try {
      await chrome.scripting.executeScript({ target, files: [product.bridge], world: 'ISOLATED', injectImmediately: true });
      await chrome.scripting.executeScript({ target, files: [product.runtime], world: 'MAIN', injectImmediately: true });
      const response = await platform.sendTabMessage(
        tabId,
        { type: 'CG_REFRESH_FEATURE_CONFIG', featureId: product.id },
        options
      );
      if (product.awaitConfiguration === true && response?.configured !== true) {
        throw new Error('The page runtime did not apply its configuration.');
      }
    } catch (error) {
      await platform.sendTabMessage(tabId, { type: 'CG_STOP_CENTRAL_FEATURE', featureId: product.id }, options).catch(() => {});
      await disposeMainRuntime(tabId, frameId, documentId, product.id).catch(() => {});
      throw error;
    }
  }

  async function sync(product, context, active) {
    const { tabId, frameId, documentId = '' } = context;
    const key = `${tabId}:${frameId}:${documentId}:${product.id}`;
    const previous = pendingSyncs.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => setRuntime(tabId, frameId, documentId, product, active));
    pendingSyncs.set(key, current);
    try { await current; }
    finally { if (pendingSyncs.get(key) === current) pendingSyncs.delete(key); }
    return active;
  }

  return Object.freeze({ sync });
}
