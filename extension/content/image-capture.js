(() => {
  const existing = document.querySelector('[data-cosmic-gemini-image-capture]');
  if (existing) existing.remove();
  const zh = (navigator.languages || [navigator.language]).some(value => String(value).toLowerCase().startsWith('zh'));
  const overlay = document.createElement('div');
  overlay.dataset.cosmicGeminiImageCapture = 'true';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.22);touch-action:none;user-select:none;';
  const hint = document.createElement('div');
  hint.textContent = zh ? '拖动选择要保存的区域 · 按 Esc 取消' : 'Drag to select an area · Press Esc to cancel';
  hint.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:9px 13px;border-radius:9px;background:rgba(24,25,27,.92);color:#fff;font:600 13px/1.35 system-ui,sans-serif;letter-spacing:normal;box-shadow:0 3px 16px rgba(0,0,0,.28);pointer-events:none;';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;display:none;border:2px solid #8ab4f8;background:rgba(138,180,248,.12);box-shadow:0 0 0 99999px rgba(0,0,0,.35);pointer-events:none;';
  overlay.append(hint, box);
  document.documentElement.append(overlay);
  let start = null;
  const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
  const draw = current => {
    if (!start) return;
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    box.style.display = 'block';
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${Math.abs(current.x - start.x)}px`;
    box.style.height = `${Math.abs(current.y - start.y)}px`;
  };
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  overlay.addEventListener('pointerdown', event => {
    stop(event);
    start = point(event);
    overlay.setPointerCapture(event.pointerId);
    draw(start);
  }, true);
  overlay.addEventListener('pointermove', event => { if (start) { stop(event); draw(point(event)); } }, true);
  overlay.addEventListener('pointerup', event => {
    if (!start) return;
    stop(event);
    const end = point(event);
    const rect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight
    };
    overlay.remove();
    if (rect.width < 8 || rect.height < 8) return;
    setTimeout(() => void chrome.runtime.sendMessage({ type: 'CG_IMAGE_CAPTURE_RECT', rect }), 80);
  }, true);
  const cancel = event => {
    if (event.key !== 'Escape') return;
    stop(event);
    overlay.remove();
  };
  addEventListener('keydown', cancel, { capture: true, once: true });
  return true;
})();
