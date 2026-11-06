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
const pendingPageSources = new Map();

function readPageDocumentSource({ tabId, documentId }) {
  return chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, world: 'ISOLATED', injectImmediately: true,
    func: () => ({ url: location.href, origin: location.origin }) });
}

// Chrome can retain an initial blank URL in an otherwise active child sender.
// Resolve only that ambiguity, in the exact browser-owned document, before
// applying the ordinary source validation. Never use a message's claimed URL.
export function resolvePageMessageSource(message, sender, extensionBase, readDocument = readPageDocumentSource) {
  if (!PAGE_MESSAGE_TYPES.has(message?.type) || !['about:blank', 'about:srcdoc'].includes(sender?.url)) return sender;
  if (!Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || !Number.isInteger(sender.frameId) || sender.frameId < 0
    || typeof sender.documentId !== 'string' || !sender.documentId || sender.documentId.length > 128
    || sender.documentLifecycle !== 'active') return sender;
  try {
    const base = new URL(extensionBase), origin = new URL(sender.origin);
    if (base.protocol !== 'chrome-extension:' || sender.id !== base.host || !['http:', 'https:'].includes(origin.protocol) || origin.origin !== sender.origin) return sender;
    const key = `${base.host}:${sender.tab.id}:${sender.frameId}:${sender.documentId}:${origin.origin}`;
    let pending = pendingPageSources.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => readDocument({ tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId }));
      pendingPageSources.set(key, pending);
      void pending.finally(() => { if (pendingPageSources.get(key) === pending) pendingPageSources.delete(key); }).catch(() => {});
    }
    return pending.then(results => {
      const verified = results.find(item => item.documentId === sender.documentId && item.frameId === sender.frameId)?.result;
      const url = new URL(verified?.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.origin || verified.origin !== origin.origin) return sender;
      return { ...sender, url: url.href };
    }).catch(() => sender);
  } catch { return sender; }
}

const UI_PATHS = new Set([
  '/popup/index.html',
  ...['all-settings','satellites','orbiters','native-scroll','no-autoplay','any-copy','page-display','image-download','video-download']
    .map(name => `/settings/${name}.html`),
  '/workspaces/document-preview/document-preview.html',
  '/workspaces/image-download/image-download.html',
  '/workspaces/follow-list-instagram/follow-list-instagram.html'
]);

const FRAMED_DOCUMENT_MESSAGES = new Set(['UI_GET_LOCALE', 'UI_DOCUMENT_GET', 'UI_DOCUMENT_PREPARE', 'UI_DOCUMENT_SET_THEME', 'UI_DOCUMENT_DOWNLOAD', 'UI_DOCUMENT_URL_READY']);
function isUiSender(sender, extensionBase, framedDocument = false) {
  try {
    const base = new URL(extensionBase), url = new URL(sender?.url);
    const origin = `chrome-extension://${base.host}`;
    return base.protocol === 'chrome-extension:' && url.protocol === base.protocol && url.host === base.host &&
      (!sender.id || sender.id === base.host) && (sender.origin === undefined || sender.origin === origin) &&
      (sender.frameId === undefined || sender.frameId === 0 || framedDocument && Number.isInteger(sender.frameId)
        && sender.frameId > 0 && url.pathname === '/workspaces/document-preview/document-preview.html') &&
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
    if (!isUiSender(sender, extensionBase, FRAMED_DOCUMENT_MESSAGES.has(type))) throw new Error('Extension commands are available only to trusted extension pages.');
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
