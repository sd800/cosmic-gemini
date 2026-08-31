export function createCustomsOffscreenCoordinator() {
  let activeAssemblies = 0;

  async function ensureDocument() {
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
  }

  async function send(target, message) {
    await ensureDocument();
    const response = await chrome.runtime.sendMessage({ ...message, target });
    if (!response?.ok) {
      const error = new Error(response?.error || 'Media processing failed.');
      error.cancelled = response?.cancelled === true;
      throw error;
    }
    return response.result;
  }

  async function maybeClose() {
    if (activeAssemblies > 0) return;
    const values = await chrome.storage.session.get(null);
    const hasArtifact = Object.entries(values).some(([key, session]) =>
      (key.startsWith('videoDownloadSession:') && session?.candidates?.some(candidate => candidate.artifactId))
      || (key.startsWith('imageDownloadArtifact:') && session?.artifactId)
      || (key.startsWith('imageCaptureArtifact:') && session?.artifactId));
    if (hasArtifact) return;
    try { await chrome.offscreen.closeDocument(); } catch {}
  }

  return Object.freeze({
    beginAssembly() { activeAssemblies += 1; },
    endAssembly() { activeAssemblies = Math.max(0, activeAssemblies - 1); },
    sendVideo(message) { return send('video-download-offscreen', message); },
    sendImage(message) { return send('image-download-offscreen', message); },
    maybeClose
  });
}
