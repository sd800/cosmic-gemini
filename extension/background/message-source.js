const PAGE_MESSAGE_TYPES = new Set([
  'CG_SYNC_CENTRAL',
  'CG_PAGE_STATE',
  'CG_DOCUMENT_CHOICE',
  'CG_CONFIG_APPLIED',
  'CG_FEATURE_INTERVENED',
  'CG_FEATURE_ACTIVITY',
  'CG_XHS_IMAGE_DARK_MODE_STATUS',
  'CG_WEBSITE_FIXER_CONTEXT_MENU',
  'CG_WEBSITE_FIXER_ACTIVATE',
  'CG_IMAGE_CAPTURE_RECT',
  'CG_VIDEO_CANDIDATES',
  'CG_VIDEO_SELECT_TWITTER',
  'CG_VIDEO_TWITTER_CONTROLS_STATE',
  'CG_VIDEO_INLINE_MANIFESTS',
  'CG_VIDEO_WRAPPED_MANIFEST'
]);

const OFFSCREEN_MESSAGE_TYPES = new Set(['CG_VIDEO_DOWNLOAD_PROGRESS']);
const UI_PATHS = new Set([
  '/popup/index.html',
  ...['all-settings','satellites','satellites-site-specific','native-scroll','no-autoplay','any-copy','page-display','image-download','video-download']
    .map(name => `/settings/${name}.html`),
  '/workspaces/document-preview/document-preview.html',
  '/workspaces/image-download/image-download.html',
  '/workspaces/follow-list-instagram/follow-list-instagram.html'
]);

function isUiSender(sender, extensionBase) {
  try {
    const base = new URL(extensionBase), url = new URL(sender?.url);
    const origin = `chrome-extension://${base.host}`;
    return base.protocol === 'chrome-extension:' && url.protocol === base.protocol && url.host === base.host &&
      (!sender.id || sender.id === base.host) && (sender.origin === undefined || sender.origin === origin) &&
      (sender.frameId === undefined || sender.frameId === 0) &&
      (sender.documentLifecycle === undefined || sender.documentLifecycle === 'active') &&
      !url.username && !url.password &&
      UI_PATHS.has(url.pathname);
  } catch { return false; }
}

function isWebPageSender(sender) {
  if (!Number.isInteger(sender?.tab?.id) || sender.tab.id < 0) return false;
  try {
    return ['http:', 'https:'].includes(new URL(String(sender.url || '')).protocol);
  } catch { return false; }
}

export function validateMessageSource(message, sender, extensionBase) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string'
    || message.type.length > 128) {
    throw new Error('Invalid extension message.');
  }
  const type = message.type;
  const senderUrl = String(sender?.url || '');
  if (type.startsWith('UI_')) {
    if (!isUiSender(sender, extensionBase)) throw new Error('Extension commands are available only to trusted extension pages.');
    return true;
  }
  if (PAGE_MESSAGE_TYPES.has(type)) {
    if (!isWebPageSender(sender) || sender.id && sender.id !== new URL(extensionBase).host
      || sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active') {
      throw new Error('Page events are available only to webpage runtimes.');
    }
    return true;
  }
  if (OFFSCREEN_MESSAGE_TYPES.has(type)) {
    if (senderUrl !== extensionBase + 'offscreen/video-download.html'
      || sender.id && sender.id !== new URL(extensionBase).host
      || sender.origin !== undefined && sender.origin !== `chrome-extension://${new URL(extensionBase).host}`) {
      throw new Error('Media progress is available only to the local processor.');
    }
    return true;
  }
  throw new Error('Unknown extension message.');
}

export function validatePortSource(port, extensionBase) {
  return isUiSender(port?.sender, extensionBase);
}
