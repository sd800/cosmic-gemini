export function createCustomsOffscreenCoordinator() {
  let activeAssemblies = 0;
  let activeRequests = 0;
  const retainedArtifacts = new Set();
  let documentLifecycle = Promise.resolve();

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

  async function send(target, message) {
    activeRequests += 1;
    try {
      await ensureDocument();
      const response = await chrome.runtime.sendMessage({ ...message, target });
      if (!response?.ok) {
        const error = new Error(response?.error || 'Media processing failed.');
        error.cancelled = response?.cancelled === true;
        throw error;
      }
      return response.result;
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
    }
  }

  function maybeClose() {
    return queueDocumentLifecycle(async () => {
      if (activeAssemblies > 0 || activeRequests > 0 || retainedArtifacts.size > 0) return;
      const values = await chrome.storage.session.get(null);
      if (activeAssemblies > 0 || activeRequests > 0 || retainedArtifacts.size > 0) return;
      const hasArtifact = Object.entries(values).some(([key, session]) =>
        (key.startsWith('videoDownloadSession:') && session?.candidates?.some(candidate => candidate.artifactId))
        || (key.startsWith('videoDownloadArtifact:') && session?.artifactId)
        || (key.startsWith('imageDownloadArtifact:') && session?.artifactId)
        || (key.startsWith('imageCaptureArtifact:') && session?.artifactId));
      if (hasArtifact) return;
      try { await chrome.offscreen.closeDocument(); } catch {}
    });
  }

  return Object.freeze({
    beginAssembly() { activeAssemblies += 1; },
    endAssembly() { activeAssemblies = Math.max(0, activeAssemblies - 1); },
    retainArtifact(artifactId) { if (artifactId) retainedArtifacts.add(artifactId); },
    releaseArtifact(artifactId) { if (artifactId) retainedArtifacts.delete(artifactId); },
    sendVideo(message) { return send('video-download-offscreen', message); },
    sendImage(message) { return send('image-download-offscreen', message); },
    maybeClose
  });
}
