export function bindSettingsButton(button, { openSettings, reloadExtension, settingsTitle, reloadTitle }) {
  const document = button.ownerDocument;
  const window = document.defaultView;
  const originalContent = button.innerHTML;
  let armed = false, pending = false, timer = 0, suppressClick = false, pointer = null;
  function render() {
    button.dataset.reloadArmed = String(armed);
    if (armed) button.textContent = 'Reload';
    else button.innerHTML = originalContent;
    button.title = armed ? reloadTitle : settingsTitle;
    button.setAttribute('aria-label', button.title);
  }
  function cancelHold() {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    pointer = null;
  }
  function reset() {
    cancelHold();
    if (armed) { armed = false; render(); }
  }
  button.addEventListener('pointerdown', event => {
    cancelHold();
    if (pending || event.button !== 0 || event.isPrimary === false) return;
    suppressClick = false;
    if (armed) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { button.setPointerCapture(event.pointerId); } catch {}
    timer = window.setTimeout(() => {
      timer = 0;
      armed = true;
      // Releasing this same press must never confirm the reload.
      suppressClick = true;
      render();
    }, 550);
  });
  button.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) {
      suppressClick = true;
      reset();
    }
  });
  button.addEventListener('pointerup', cancelHold);
  button.addEventListener('lostpointercapture', cancelHold);
  button.addEventListener('pointercancel', () => { suppressClick = true; reset(); });
  button.addEventListener('contextmenu', event => {
    if (timer || armed || suppressClick) event.preventDefault();
  });
  button.addEventListener('click', async event => {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    if (pending) return;
    cancelHold();
    suppressClick = false;
    pending = true;
    button.disabled = true;
    try { await (armed ? reloadExtension() : openSettings()); }
    finally { pending = false; button.disabled = false; }
  });
  document.addEventListener('pointerdown', event => { if (!button.contains(event.target)) reset(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') reset(); });
  window.addEventListener('blur', reset);
  window.addEventListener('pagehide', reset);
  render();
  return {
    setLabels(settings, reload) { settingsTitle = settings; reloadTitle = reload; render(); }
  };
}
