// Keep native modality/Escape/focus restoration without the browser choosing
// an implicit autofocus target inside an opaque cross-origin frame. No paint
// occurs while inert: restore it synchronously, then focus our intended control.
export function showReaderDialog(dialog, target) {
  const inert = dialog.inert;
  dialog.inert = true;
  try { dialog.showModal(); }
  finally { dialog.inert = inert; }
  if (!inert) target?.focus({ preventScroll: true });
}
