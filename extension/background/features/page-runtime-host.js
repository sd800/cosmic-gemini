export function createPageRuntimeHost(platform) {
  const pendingSyncs = new Map();
  const pendingDocuments = new Map();

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

  function declaredStyleFiles(product) {
    return Array.isArray(product.pageStyleFiles)
      ? product.pageStyleFiles.filter(file => typeof file === 'string' && file)
      : [];
  }

  function requestedStyleFiles(product, styleFiles) {
    const declared = declaredStyleFiles(product);
    const requested = Array.isArray(styleFiles) ? [...new Set(styleFiles)] : [];
    const allowed = new Set(declared);
    if (requested.some(file => !allowed.has(file))) throw new Error(`Undeclared page stylesheet for ${product.id}.`);
    return requested;
  }

  // Keep the receipt in the isolated document, not worker memory: navigation discards it,
  // while a service-worker restart must not make an unchanged stylesheet blink off.
  async function pageStyleReceipt(target, product, operation, files = []) {
    const results = await chrome.scripting.executeScript({
      target, world: 'ISOLATED', injectImmediately: true,
      func: (id, operation, files) => {
        const key = Symbol.for('cosmic-gemini.page-runtime-styles');
        if (operation === 'read') return globalThis[key]?.[id] ?? null;
        if (operation === 'clear') {
          if (globalThis[key]) delete globalThis[key][id];
        } else {
          const receipts = globalThis[key] || (globalThis[key] = Object.create(null));
          receipts[id] = files;
        }
        return true;
      },
      args: [product.id, operation, files]
    });
    return results[0]?.result ?? null;
  }

  async function removePageStyles(target, product) {
    const files = declaredStyleFiles(product);
    if (!files.length) return;
    if (product.preservePageStylesOnRefresh === true) await pageStyleReceipt(target, product, 'clear');
    await chrome.scripting.removeCSS({ target, files, origin: 'USER' });
  }

  async function insertPageStyles(target, files) {
    if (!files.length) return;
    await chrome.scripting.insertCSS({ target, files, origin: 'USER' });
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

  async function setRuntime(tabId, frameId, documentId, product, active, styleFiles, document) {
    const options = messageOptions(frameId, documentId);
    const target = executionTarget(tabId, frameId, documentId);
    const requestedStyles = requestedStyleFiles(product, styleFiles);
    if (!active) {
      const response = await platform.sendTabMessage(
        tabId,
        { type: 'CG_STOP_CENTRAL_FEATURE', featureId: product.id },
        options
      );
      if (response?.disposed === true) {
        await removePageStyles(target, product);
        if (frameId === 0 && !document.retired) await platform.setFeatureActivity(tabId, product.id, false);
      }
      return;
    }
    try {
      const preserveStyles = product.preservePageStylesOnRefresh === true;
      const previousStyles = preserveStyles ? await pageStyleReceipt(target, product, 'read') : null;
      const reuseStyles = Array.isArray(previousStyles)
        && JSON.stringify(previousStyles) === JSON.stringify(requestedStyles);
      if (!reuseStyles) await removePageStyles(target, product);
      await chrome.scripting.executeScript({ target, files: [product.bridge], world: 'ISOLATED', injectImmediately: true });
      await chrome.scripting.executeScript({ target, files: [...(product.runtimeDependencies || []), product.runtime], world: 'MAIN', injectImmediately: true });
      const response = await platform.sendTabMessage(
        tabId,
        { type: 'CG_REFRESH_FEATURE_CONFIG', featureId: product.id },
        options
      );
      if (product.awaitConfiguration === true && response?.configured !== true) {
        throw new Error('The page runtime did not apply its configuration.');
      }
      if (!reuseStyles) {
        await insertPageStyles(target, requestedStyles);
        if (preserveStyles) await pageStyleReceipt(target, product, 'write', requestedStyles);
      }
    } catch (error) {
      await platform.sendTabMessage(tabId, { type: 'CG_STOP_CENTRAL_FEATURE', featureId: product.id }, options).catch(() => {});
      await disposeMainRuntime(tabId, frameId, documentId, product.id).catch(() => {});
      await removePageStyles(target, product).catch(() => {});
      throw error;
    }
  }

  async function sync(product, context, active, styleFiles = []) {
    const { tabId, frameId, documentId = '' } = context;
    const key = `${tabId}:${frameId}:${documentId}:${product.id}`;
    const frameKey = `${tabId}:${frameId}:${product.id}`;
    let document = pendingDocuments.get(frameKey);
    if (!document || document.id !== documentId) {
      if (document) document.retired = true;
      document = { id: documentId, retired: false, pending: 0 };
      pendingDocuments.set(frameKey, document);
    }
    document.pending += 1;
    const previous = pendingSyncs.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => setRuntime(tabId, frameId, documentId, product, active, styleFiles, document));
    pendingSyncs.set(key, current);
    try { await current; }
    finally {
      if (pendingSyncs.get(key) === current) pendingSyncs.delete(key);
      document.pending -= 1;
      if (!document.pending && pendingDocuments.get(frameKey) === document) pendingDocuments.delete(frameKey);
    }
    return active;
  }

  return Object.freeze({ sync });
}
