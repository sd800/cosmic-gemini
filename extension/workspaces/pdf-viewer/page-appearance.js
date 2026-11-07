// A new or reattached page inherits the document appearance immediately.
export function createPageAppearance({ root, getPage, thumbnails, getDark }) {
  const overrides = new Map();
  const dark = page => overrides.has(page) ? overrides.get(page) === 'dark' : getDark();
  function applyOverride(node, page) {
    if (!node) return;
    if (overrides.has(page)) node.dataset.paperDark = String(dark(page));
    else delete node.dataset.paperDark;
  }
  function set(page, mode) {
    if (!Number.isSafeInteger(page) || page < 1 || !['auto', 'light', 'dark', 'original'].includes(mode)) return;
    if (mode === 'auto') overrides.delete(page);
    else overrides.set(page, mode);
    applyOverride(getPage(page), page);
    applyOverride(thumbnails.children[page - 1], page);
  }
  return { dark, get: page => overrides.get(page) || 'auto', set, applyOverride,
    apply() { root.dataset.paperDark = String(getDark()); } };
}
