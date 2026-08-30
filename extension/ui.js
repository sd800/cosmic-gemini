export function icon(name) {
  const paths = {
    power: '<path d="M12 2v10M5.7 5.7a8 8 0 1 0 12.6 0"/>',
    bolt: '<path d="m13 2-8 11h7l-1 9 8-12h-7z"/>',
    siteAdd: '<rect x="4" y="4" width="14" height="14" rx="2"/><path d="M4 8h14M7 6h.01M10 6h.01"/><circle cx="17.5" cy="17.5" r="3.5" fill="currentColor" stroke="none"/><path d="M17.5 15.5v4M15.5 17.5h4" stroke="var(--surface)"/>',
    siteRemove: '<rect x="4" y="4" width="14" height="14" rx="2"/><path d="M4 8h14M7 6h.01M10 6h.01"/><circle cx="17.5" cy="17.5" r="3.5" fill="currentColor" stroke="none"/><path d="M15.5 17.5h4" stroke="var(--surface)"/>',
    siteCovered: '<rect x="4" y="4" width="14" height="14" rx="2"/><path d="M4 8h14M7 6h.01M10 6h.01"/><circle cx="17.5" cy="17.5" r="3.5" fill="currentColor" stroke="none"/><path d="m15.6 17.5 1.3 1.3 2.5-2.8" stroke="var(--surface)"/>',
    settings: '<path d="M4 6h6M14 6h6M4 12h10M18 12h2M4 18h3M11 18h9"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
}

export async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Native Scroll could not complete that action.');
  return response.result;
}
