export function createCustomsOffscreenCoordinator() {
  let activeAssemblies = 0;
  let activeRequests = 0;
  const retainedArtifacts = new Set();
  let documentLifecycle = Promise.resolve();
  let requestKeepAlive = 0;

  function pingServiceWorker() {
    try {
      const result = chrome.runtime.getPlatformInfo?.();
      result?.catch?.(() => {});
    } catch {}
  }

  function syncRequestKeepAlive() {
    if (activeRequests > 0) {
      if (requestKeepAlive) return;
      pingServiceWorker();
      requestKeepAlive = setInterval(pingServiceWorker, 25_000);
      return;
    }
    if (requestKeepAlive) clearInterval(requestKeepAlive);
    requestKeepAlive = 0;
  }

  function queueDocumentLifecycle(task) {
    const operation = documentLifecycle.catch(() => undefined).then(task);
    documentLifecycle = operation.catch(() => undefined);
    return operation;
  }

  function ensureDocument() {
    return queueDocumentLifecycle(async () => {
      const path = 'offscreen/video-download.html';
      if (typeof chrome.runtime.getContexts === 'function') {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [chrome.runtime.getURL(path)]
        });
        if (contexts.length) return;
      }
      try {
        await chrome.offscreen.createDocument({
          url: path,
          reasons: ['BLOBS'],
          justification: 'Process user-requested media into local downloadable files.'
        });
      } catch (error) {
        if (!String(error?.message || '').includes('single offscreen')) throw error;
      }
    });
  }

  async function send(target, message, retainResultArtifact = false) {
    activeRequests += 1;
    syncRequestKeepAlive();
    try {
      await ensureDocument();
      const response = await chrome.runtime.sendMessage({ ...message, target });
      if (!response?.ok) {
        const error = new Error(response?.error || 'Media processing failed.');
        error.cancelled = response?.cancelled === true;
        throw error;
      }
      const result = response.result;
      if (retainResultArtifact && result?.artifactId) retainedArtifacts.add(result.artifactId);
      return result;
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
      syncRequestKeepAlive();
    }
  }

  function maybeClose() {
    return queueDocumentLifecycle(async () => {
      try {
        if (activeAssemblies > 0 || activeRequests > 0 || retainedArtifacts.size > 0) return;
        const values = await chrome.storage.session.get(null);
        if (activeAssemblies > 0 || activeRequests > 0 || retainedArtifacts.size > 0) return;
        const hasArtifact = Object.entries(values).some(([key, session]) =>
          (key.startsWith('videoDownloadSession:') && session?.candidates?.some(candidate => candidate.artifactId))
          || (key.startsWith('videoDownloadArtifact:') && session?.artifactId)
          || (key.startsWith('imageDownloadArtifact:') && session?.artifactId)
          || (key.startsWith('imageCaptureArtifact:') && session?.artifactId));
        if (hasArtifact) return;
        await chrome.offscreen.closeDocument();
      } catch {}
    });
  }

  return Object.freeze({
    beginAssembly() { activeAssemblies += 1; },
    endAssembly() { activeAssemblies = Math.max(0, activeAssemblies - 1); },
    retainArtifact(artifactId) { if (artifactId) retainedArtifacts.add(artifactId); },
    releaseArtifact(artifactId) { if (artifactId) retainedArtifacts.delete(artifactId); },
    sendVideo(message) { return send('video-download-offscreen', message); },
    sendVideoArtifact(message) { return send('video-download-offscreen', message, true); },
    sendImage(message) { return send('image-download-offscreen', message); },
    sendImageArtifact(message) { return send('image-download-offscreen', message, true); },
    maybeClose
  });
}
