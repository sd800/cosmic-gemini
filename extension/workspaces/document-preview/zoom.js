export const boundedDocumentZoom = value => Math.max(.5,Math.min(2,value));

// Chrome delivers trackpad pinches as ctrl-wheel. Ordinary wheel scrolling and
// horizontal history gestures remain with the browser. No polling or reparse.
export function createDocumentZoom({signal,onChange,slides}) {
  let zoom = 1, factor = 1, origin, frame = 0;
  function cancel() { cancelAnimationFrame(frame); frame = 0; factor = 1; origin = null; }
  function setZoom(value, point) {
    if (signal.aborted || !Number.isFinite(value)) return;
    const next = boundedDocumentZoom(value);
    if (next === zoom) return;
    const deck = slides();
    const before = point && !deck && document.body.getBoundingClientRect();
    const ratio = next / zoom; zoom = next;
    if (deck) deck.setZoom(zoom,point);
    else {
      document.body.style.zoom = String(zoom);
      if (point) {
        const after = document.body.getBoundingClientRect();
        window.scrollBy(after.left + (point[0]-before.left)*ratio - point[0],after.top + (point[1]-before.top)*ratio - point[1]);
      }
    }
  }
  window.addEventListener('wheel', event => {
    if ((!event.ctrlKey && !event.metaKey) || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    factor *= Math.exp(-Math.max(-100,Math.min(100,event.deltaY*unit))*.004);
    factor = Math.max(.25,Math.min(4,factor));
    origin = [event.clientX,event.clientY];
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      const previous = zoom, next = zoom * factor, point = origin; factor = 1; origin = null;
      setZoom(next,point); if (zoom !== previous) onChange(zoom);
    });
  },{passive:false,signal});
  signal.addEventListener('abort',cancel,{once:true});
  return {
    setZoom(value) { cancel(); setZoom(value); },
    reset(value) { cancel(); zoom = Number.isFinite(value) ? boundedDocumentZoom(value) : 1; document.body.style.zoom = slides() ? '1' : String(zoom); }
  };
}
