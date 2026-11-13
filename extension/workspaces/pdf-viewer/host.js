import { isPdfAppearance } from '../../core/document-preview/document-appearance.js';
import { PDF_LIMITS } from './model.js';
// This host is the only connection to a product. The opaque viewer has no
// extension APIs, storage access, network capability, or arbitrary command channel.
// The source URL crosses this boundary only as inert text for Document properties.
export function createPdfViewer({ container, bytes, filename, documentUrl = '', locale, sampling, dark, themeMode = 'auto', onDownload, onTheme, onError, onReady = () => {}, onShellReady = () => {} }) {
  const validBytes = value => value instanceof ArrayBuffer && value.byteLength > 0 && value.byteLength <= PDF_LIMITS.bytes;
  if (bytes !== undefined && !validBytes(bytes)) throw Error('Invalid PDF size');
  const iframe = document.createElement('iframe');
  iframe.className = 'pdf-viewer-frame'; iframe.title = 'PDF Viewer';
  iframe.referrerPolicy = 'no-referrer';
  // Grant write-only clipboard access to this fixed opaque reader (e.g. Copy
  // all PDF text). No clipboard read access or privileged host copy command.
  iframe.allow = 'clipboard-write *';
  iframe.style.visibility = 'hidden';
  iframe.style.background = dark ? '#121416' : '#e8eaed';
  iframe.style.colorScheme = dark ? 'dark' : 'light';
  const url = new URL('viewer.html', import.meta.url);
  url.hash = new URLSearchParams({ dark: dark ? '1' : '0', locale });
  iframe.src = url.href;
  const channel = new MessageChannel(); let closed = false, frameLoaded = false, opened = bytes !== undefined, pending = bytes, timeout, shellTimeout;
  let awaitingPage = opened, interactive = false;
  function fail() { destroy(); onError(); }
  function updatePageDeadline() {
    clearTimeout(timeout);
    // The viewer intentionally pauses painting in a background tab.
    if (awaitingPage && !document.hidden) timeout = setTimeout(fail, 30000);
  }
  document.addEventListener('visibilitychange', updatePageDeadline);
  updatePageDeadline();
  function sendDocument() {
    if (closed || !frameLoaded || !pending) return;
    const data = pending; pending = null;
    channel.port1.postMessage({ type: 'document', bytes: data }, [data]);
  }
  const fullscreenChanged = () => {
    if (!closed) channel.port1.postMessage({ type: 'fullscreen', active: document.fullscreenElement === container });
  };
  document.addEventListener('fullscreenchange', fullscreenChanged);
  function destroy() {
    if (closed) return; closed = true; pending = null; clearTimeout(timeout); clearTimeout(shellTimeout);
    document.removeEventListener('visibilitychange', updatePageDeadline);
    document.removeEventListener('fullscreenchange', fullscreenChanged);
    if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => {});
    channel.port1.close(); iframe.remove();
  }
  channel.port1.onmessage = ({ data }) => {
    if (closed || !data || typeof data.type !== 'string') return;
    if (data.type === 'shell-ready') { clearTimeout(shellTimeout); iframe.style.visibility = 'visible'; onShellReady(); }
    else if (data.type === 'opening') { awaitingPage = true; updatePageDeadline(); }
    else if (data.type === 'ready' || data.type === 'password') {
      awaitingPage = false; clearTimeout(timeout);
      if (!interactive) { interactive = true; onReady(); }
    }
    else if (data.type === 'download') onDownload();
    else if (data.type === 'theme') {if(data.mode===undefined)onTheme();else if(isPdfAppearance(data.mode))onTheme(data.mode);}
    else if (data.type === 'fullscreen') {
      // User activation from the reader reaches its ancestor. Fullscreen belongs
      // to the trusted host; the opaque sandbox never receives extra privileges.
      const operation = document.fullscreenElement === container ? document.exitFullscreen() : container.requestFullscreen();
      void operation.catch(() => { if (!closed) channel.port1.postMessage({ type: 'fullscreen-error' }); });
    }
    else if (data.type === 'error') fail();
  };
  iframe.addEventListener('load', () => {
    if (closed) return;
    iframe.contentWindow.postMessage({ type: 'CG_PDF_INIT', filename, documentUrl, locale, sampling, dark, themeMode }, '*', [channel.port2]);
    frameLoaded = true; sendDocument();
  }, { once: true });
  shellTimeout = setTimeout(fail, 10000);
  container.append(iframe);
  return {
    open(data) {
      if (closed || opened || !validBytes(data)) throw Error('Invalid PDF open');
      opened = true; pending = data; awaitingPage = true; updatePageDeadline(); sendDocument();
    },
    setTheme(value, mode = themeMode) {
      if (closed) return;
      dark = !!value; if(isPdfAppearance(mode))themeMode=mode;
      iframe.style.background = dark ? '#121416' : '#e8eaed';
      iframe.style.colorScheme = dark ? 'dark' : 'light';
      channel.port1.postMessage({ type: 'theme', dark, themeMode });
    },
    destroy
  };
}
