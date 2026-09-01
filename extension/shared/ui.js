export function icon(name) {
  const paths = {
    power: '<path d="M12 2v10M5.7 5.7a8 8 0 1 0 12.6 0"/>',
    bolt: '<path d="m13 2-8 11h7l-1 9 8-12h-7z"/>',
    nativeScroll: '<path d="M12 3v18M7.5 7.5 12 3l4.5 4.5M7.5 16.5 12 21l4.5-4.5"/>',
    noAutoplay: '<path d="M6 5v14l10-7z"/><path d="M21 18A4 4 0 1 1 17 14a3.3 3.3 0 0 0 4 4Z" fill="currentColor" stroke="none"/>',
    anyCopy: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/>',
    anyCopyEnhanced: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/><path d="m17.6 10.6-5.8 7.8h4.5l-.7 4.7 6.6-8.6h-4.8z" fill="currentColor" stroke="var(--icon-surface, var(--surface))" stroke-width="1.8" paint-order="stroke fill"/>',
    imageDownload: '<rect x="2.75" y="3.75" width="12.75" height="12.75" rx="2"/><path d="m4.8 13.3 2.9-3.1 2.2 2.1 2.4-3.3 3.1 3.8"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    videoDownload: '<path d="M6 5v14l10-7z"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    satellites: '<path d="M15 2C15.6 8.1 17.9 11.4 22 12c-4.1.6-6.4 3.9-7 10-.6-6.1-2.9-9.4-7-10 4.1-.6 6.4-3.9 7-10Z" fill="currentColor" stroke="none"/><path d="M5.25 2c.25 1.95 1.05 2.75 3 3-1.95.25-2.75 1.05-3 3-.25-1.95-1.05-2.75-3-3 1.95-.25 2.75-1.05 3-3Z" fill="currentColor" stroke="none"/><path d="M6.25 12.25c.35 2.8 1.45 3.9 4.25 4.25-2.8.35-3.9 1.45-4.25 4.25-.35-2.8-1.45-3.9-4.25-4.25 2.8-.35 3.9-1.45 4.25-4.25Z" fill="currentColor" stroke="none"/>',
    siteAdd: '<rect x="4" y="4" width="14" height="14" rx="2"/><path d="M4 8h14M7 6h.01M10 6h.01"/><circle cx="17.5" cy="17.5" r="3.5" fill="currentColor" stroke="none"/><path d="M17.5 15.5v4M15.5 17.5h4" stroke="var(--surface)"/>',
    siteRemove: '<rect x="4" y="4" width="14" height="14" rx="2"/><path d="M4 8h14M7 6h.01M10 6h.01"/><circle cx="17.5" cy="17.5" r="3.5" fill="currentColor" stroke="none"/><path d="M15.5 17.5h4" stroke="var(--surface)"/>',
    siteCovered: '<rect x="4" y="4" width="14" height="14" rx="2"/><path d="M4 8h14M7 6h.01M10 6h.01"/><circle cx="17.5" cy="17.5" r="3.5" fill="currentColor" stroke="none"/><path d="m15.6 17.5 1.3 1.3 2.5-2.8" stroke="var(--surface)"/>',
    settings: '<path d="M4 6h6M14 6h6M4 12h10M18 12h2M4 18h3M11 18h9"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    allSettings: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 5v6h-6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/>',
    scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M7 12h10"/>',
    capture: '<path d="M7 3v14a4 4 0 0 0 4 4h10M3 7h14a4 4 0 0 1 4 4v10"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
}

export async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Cosmic Gemini could not complete that action.');
  return response.result;
}

export async function retryRead(task, delays = [0, 80, 240]) {
  let lastError;
  for (const delay of delays) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
