// Fixed opaque frame, bounded one-way document data and fixed render-status messages.
// External links/clipboard stay in the frame; no arbitrary URL host command.
export function createDocumentContent(frame, locale, onError) {
  const channel = new MessageChannel(); let ready = false, closed = false, pending, dark = frame.style.colorScheme === 'dark';
  frame.style.visibility = 'hidden';
  const timeout = setTimeout(() => { if (!closed && !ready) onError(); }, 10000);
  const send = () => { if (!closed && ready && pending) { channel.port1.postMessage(pending); pending = null; } };
  channel.port1.onmessage = ({data}) => {
    if (closed) return;
    if (data?.type === 'ready') { ready = true; clearTimeout(timeout); channel.port1.postMessage({type:'theme',dark}); send(); }
    else if (data?.type === 'rendered') frame.style.visibility = 'visible';
    else if (data?.type === 'error') onError();
  };
  frame.addEventListener('load', () => {
    if (!closed) frame.contentWindow.postMessage({type:'CG_DOCUMENT_CONTENT_INIT'}, '*', [channel.port2]);
  }, {once:true});
  frame.allow = 'clipboard-write *';
  frame.src = new URL('content.html', import.meta.url).href;
  return {
    render(html, formatting) { if (!closed) { pending = {type:'render',html,formatting,locale}; send(); } },
    setTheme(value) { dark = value === true; if (!closed && ready) channel.port1.postMessage({type:'theme',dark}); },
    destroy() { closed = true; pending = null; clearTimeout(timeout); channel.port1.close(); frame.removeAttribute('src'); }
  };
}
