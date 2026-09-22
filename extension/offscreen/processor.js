import { blobCommand, hasBlobs } from './blob-cache.js';
import { isProcessorSender } from './security.js';
let media;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!isProcessorSender(sender, chrome.runtime)) return false;
  if (message?.target === 'ephemeral-blob-cache') {
    // Only the background product may mutate or read the cache. Web pages and
    // preview documents obtain bounded, authorized metadata through Central.
    try { reply({ ok: true, result: blobCommand(message) }); }
    catch (error) { reply({ ok: false, error: error.message }); }
    return false;
  }
  if (message?.target === 'offscreen-resource-status') { reply({ ok: true, retained: hasBlobs() }); return false; }
  if (!['video-download-offscreen', 'image-download-offscreen'].includes(message?.target)) return false;
  // Document Preview does not load the media parsers.
  media ||= import('./video-download.js');
  void media.then(module => module.handleMediaMessage(message, sender, reply)).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
