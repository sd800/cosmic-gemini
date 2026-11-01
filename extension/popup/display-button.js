// A hold fires once; its following click must not toggle the current site too.
export function bindDisplayButton(button, activate) {
  const view = button.ownerDocument.defaultView;
  let timer = 0, pointer = null, suppressClick = false;
  const cancel = () => {
    if (timer) view.clearTimeout(timer);
    timer = 0; pointer = null;
  };
  button.addEventListener('pointerdown', event => {
    cancel();
    if (button.disabled || event.button !== 0 || event.isPrimary === false) return;
    suppressClick = false;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { button.setPointerCapture(event.pointerId); } catch {}
    timer = view.setTimeout(() => {
      timer = 0;
      suppressClick = true;
      activate('global');
    }, 550);
  });
  button.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) {
      suppressClick = true; cancel();
    }
  });
  for (const name of ['pointerup', 'lostpointercapture']) button.addEventListener(name, cancel);
  button.addEventListener('pointercancel', () => { suppressClick = true; cancel(); });
  button.addEventListener('contextmenu', event => { if (timer || suppressClick) event.preventDefault(); cancel(); });
  button.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); return; }
    suppressClick = false;
    activate('site');
  });
  const abandon = () => { suppressClick = true; cancel(); };
  view.addEventListener('blur', abandon);
  view.addEventListener('pagehide', abandon);
}
