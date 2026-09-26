// Fixed opaque frame, bounded document data and fixed status/slide-index messages.
// External links/clipboard stay in the frame; no arbitrary URL host command.
export function createDocumentContent(frame, locale, onError, onSlide = () => {}) {
  const channel = new MessageChannel(); let ready = false, closed = false, pending, dark = frame.style.colorScheme === 'dark';
  let renderId = 0, slideCount = 0, zoom = 1;
  frame.style.visibility = 'hidden';
  const timeout = setTimeout(() => { if (!closed && !ready) onError(); }, 10000);
  const send = () => { if (!closed && ready && pending) { channel.port1.postMessage(pending); pending = null; } };
  channel.port1.onmessage = ({data}) => {
    if (closed) return;
    if (data?.type === 'ready') { ready = true; clearTimeout(timeout); channel.port1.postMessage({type:'theme',dark}); send(); }
    else if (data?.id === renderId) {
      if (data.type === 'rendered') frame.style.visibility = 'visible';
      else if (data.type === 'error') onError();
      else if (data.type === 'slide' && Number.isInteger(data.index) && data.index >= 0 && data.index < slideCount) onSlide(data.index);
    }
  };
  frame.addEventListener('load', () => {
    if (!closed) frame.contentWindow.postMessage({type:'CG_DOCUMENT_CONTENT_INIT'}, '*', [channel.port2]);
  }, {once:true});
  frame.allow = 'clipboard-write *';
  frame.src = new URL('content.html', import.meta.url).href;
  return {
    render(html, formatting) { if (!closed) { slideCount = 0; pending = {type:'render',id:++renderId,html,formatting,locale}; send(); } },
    renderSlides(parts, formatting, label) {
      if (closed) return;
      slideCount = parts.length;
      pending = {type:'slides',id:++renderId,parts,formatting,locale,label,index:0,zoom}; send();
    },
    selectSlide(index) {
      if (closed || !Number.isInteger(index) || index < 0 || index >= slideCount) return;
      if (pending?.type === 'slides') pending.index = index;
      else if (ready) channel.port1.postMessage({type:'select-slide',id:renderId,index});
    },
    setZoom(value) {
      if (!Number.isFinite(value)) return;
      zoom = Math.max(.5, Math.min(2, value));
      if (pending?.type === 'slides') pending.zoom = zoom;
      else if (!closed && ready && slideCount) channel.port1.postMessage({type:'slide-zoom',id:renderId,zoom});
    },
    setTheme(value) { dark = value === true; if (!closed && ready) channel.port1.postMessage({type:'theme',dark}); },
    destroy() { closed = true; pending = null; clearTimeout(timeout); channel.port1.close(); frame.removeAttribute('src'); }
  };
}
