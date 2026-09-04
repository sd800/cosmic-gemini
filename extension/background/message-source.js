const PAGE_MESSAGE_TYPES = new Set([
  'CG_SYNC_CENTRAL',
  'CG_PAGE_STATE',
  'CG_CONFIG_APPLIED',
  'CG_FEATURE_INTERVENED',
  'CG_XHS_IMAGE_DARK_READER_STATUS',
  'CG_IMAGE_CAPTURE_RECT',
  'CG_VIDEO_CANDIDATES',
  'CG_VIDEO_INLINE_MANIFESTS',
  'CG_VIDEO_WRAPPED_MANIFEST'
]);

const OFFSCREEN_MESSAGE_TYPES = new Set(['CG_VIDEO_DOWNLOAD_PROGRESS']);

function isWebPageSender(sender) {
  if (!Number.isInteger(sender?.tab?.id)) return false;
  try {
    return ['http:', 'https:'].includes(new URL(String(sender.url || '')).protocol);
  } catch { return false; }
}

export function validateMessageSource(message, sender, extensionBase) {
  const type = String(message?.type || '');
  const senderUrl = String(sender?.url || '');
  if (type.startsWith('UI_')) {
    if (!senderUrl.startsWith(extensionBase)) throw new Error('Extension commands are available only to extension pages.');
    return true;
  }
  if (PAGE_MESSAGE_TYPES.has(type)) {
    if (!isWebPageSender(sender)) throw new Error('Page events are available only to webpage runtimes.');
    return true;
  }
  if (OFFSCREEN_MESSAGE_TYPES.has(type)) {
    if (senderUrl !== extensionBase + 'offscreen/video-download.html') {
      throw new Error('Media progress is available only to the local processor.');
    }
    return true;
  }
  return true;
}

export function validatePortSource(port, extensionBase) {
  const senderUrl = String(port?.sender?.url || '');
  return senderUrl.startsWith(extensionBase);
}
