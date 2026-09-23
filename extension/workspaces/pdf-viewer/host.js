import { PDF_LIMITS } from './model.js';
// This host is the only connection to a product. The opaque viewer has no
// extension APIs, storage access, document URL, or arbitrary command channel.
export function createPdfViewer({ container, bytes, filename, locale, sampling, sharpening = false, dark, onDownload, onTheme, onError }) {
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
  const url = new URL('viewer.html', import.meta.url);
  url.hash = new URLSearchParams({ dark: dark ? '1' : '0', locale });
  iframe.src = url.href;
  const channel = new MessageChannel(); let closed = false, loaded = false, frameLoaded = false, opened = bytes !== undefined, pending = bytes, timeout;
  function sendDocument() {
    if (closed || !frameLoaded || !pending) return;
    const data = pending; pending = null;
    channel.port1.postMessage({ type: 'document', bytes: data }, [data]);
  }
  const fullscreenChanged = () => {
    if (!closed) channel.port1.postMessage({ type: 'fullscreen', active: document.fullscreenElement === container });
  };
  document.addEventListener('fullscreenchange', fullscreenChanged);
  const armTimeout = () => { timeout = setTimeout(() => {
    if (!loaded && !closed) { destroy(); onError(); }
  }, 30000); };
  if (opened) armTimeout();
  function destroy() {
    if (closed) return; closed = true; pending = null; clearTimeout(timeout);
    document.removeEventListener('fullscreenchange', fullscreenChanged);
    if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => {});
    channel.port1.close(); iframe.remove();
  }
  channel.port1.onmessage = ({ data }) => {
    if (closed || !data || typeof data.type !== 'string') return;
    if (data.type === 'shell-ready') iframe.style.visibility = 'visible';
    else if (data.type === 'parsed') clearTimeout(timeout);
    else if (data.type === 'ready' || data.type === 'password') { loaded = true; clearTimeout(timeout); }
    else if (data.type === 'download') onDownload();
    else if (data.type === 'theme') onTheme();
    else if (data.type === 'fullscreen') {
      // User activation from the reader reaches its ancestor. Fullscreen belongs
      // to the trusted host; the opaque sandbox never receives extra privileges.
      const operation = document.fullscreenElement === container ? document.exitFullscreen() : container.requestFullscreen();
      void operation.catch(() => { if (!closed) channel.port1.postMessage({ type: 'fullscreen-error' }); });
    }
    else if (data.type === 'error') { clearTimeout(timeout); onError(); }
  };
  iframe.addEventListener('load', () => {
    if (closed) return;
    iframe.contentWindow.postMessage({ type: 'CG_PDF_INIT', filename, locale, sampling, sharpening: sharpening === true, dark }, '*', [channel.port2]);
    frameLoaded = true; sendDocument();
  }, { once: true });
  container.append(iframe);
  return {
    open(data) {
      if (closed || opened || !validBytes(data)) throw Error('Invalid PDF open');
      opened = true; pending = data; armTimeout(); sendDocument();
    },
    setSharpening(value) { if (!closed) { sharpening = value === true; channel.port1.postMessage({ type: 'sharpening', enabled: sharpening }); } },
    setTheme(value) { dark = !!value; if (!closed) channel.port1.postMessage({ type: 'theme', dark }); },
    destroy
  };
}
