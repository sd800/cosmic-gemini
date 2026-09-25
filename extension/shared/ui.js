export function icon(name) {
  const paths = {
    followListInstagram: '<g stroke-width="1.7"><path d="M2 7h3M3.5 7v10M2 17h3M14 8.5a4.5 5 0 1 0 0 7v-3h-3.5M17 10h5M19.5 7.5v5M17 16h5"/></g>',
    bolt: '<path d="m13 2-8 11h7l-1 9 8-12h-7z"/>',
    nativeScroll: '<path d="M12 3v18M7.5 7.5 12 3l4.5 4.5M7.5 16.5 12 21l4.5-4.5"/>',
    noAutoplay: '<path d="M6 5v14l10-7z"/><path d="M21 18A4 4 0 1 1 17 14a3.3 3.3 0 0 0 4 4Z" fill="currentColor" stroke="none"/>',
    anyCopy: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/>',
    anyCopyEnhanced: '<rect x="8" y="7" width="12" height="12" rx="2"/><rect x="4" y="3" width="12" height="12" rx="2" fill="var(--icon-surface, var(--surface))"/><path d="m17.6 10.6-5.8 7.8h4.5l-.7 4.7 6.6-8.6h-4.8z" fill="currentColor" stroke="var(--icon-surface, var(--surface))" stroke-width="1.8" paint-order="stroke fill"/>',
    imageDownload: '<rect x="2.75" y="3.75" width="12.75" height="12.75" rx="2"/><path d="m4.8 13.3 2.9-3.1 2.2 2.1 2.4-3.3 3.1 3.8"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    videoDownload: '<path d="M6 5v14l10-7z"/><path d="M16.5 13.5h3v3.75h3L18 21.75l-4.5-4.5h3z" fill="currentColor" stroke="none"/>',
    reduceWhitePoint: '<path d="M8.7 15.5A6.4 6.4 0 1 1 15.3 15.5C14.5 16.1 14 17 14 18H10c0-1-.5-1.9-1.3-2.5Z"/><path d="M10 21h4M9.5 18h5"/>',
    greyscale: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none"/>',
    mailtoCapture: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    // Cosmic PDF's document glyph, fitted to the shared 24-unit grid without its app-icon background.
    documentPreview: '<path d="M13.846 3H6.231a1.385 1.385 0 0 0-1.385 1.385v15.23A1.385 1.385 0 0 0 6.231 21h11.538a1.385 1.385 0 0 0 1.385-1.385V8.308Z"/><path d="M13.846 3v5.308h5.308M8.308 12.462h7.384M8.308 16.154h5.538"/>',
    moon: '<path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3 8.5 8.5 0 1 0 20.5 13.5Z"/>',
    whiteSofter: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 13c5-5 12 3 17-2M3.5 17c5-5 12 3 17-2"/>',
    clipboardProtect: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 5V3h6v2M9 9h6M9 13h6M9 17h4"/>',
    accessControl: '<path d="m5 3 13.5 9.1-6.1 1.25L9.5 20Z"/><path d="M12.4 13.35 15.952 18.318"/>',
    websiteKnowledgeControl: '<rect x="2.75" y="4" width="18.5" height="16" rx="2.5"/><path d="M3 8h18M6 6h.01M9 6h.01M12 6h.01"/><path d="M7 12h10M7 15.5h7"/>',
    websiteFixer: '<path d="M20 7.5a5.4 5.4 0 0 1-7.2 5.1l-6.6 6.6a2 2 0 0 1-2.8-2.8l6.6-6.6A5.4 5.4 0 0 1 15.1 2l-2.8 2.8.6 3 3 .6L20 4.3a5.4 5.4 0 0 1 0 3.2Z"/>',
    translateOverride: '<g stroke="none"><path d="M12.4 6H20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7.1l-1.2-3.8Z" fill="color-mix(in srgb, var(--muted) 28%, var(--surface))"/><path d="m11.7 18.2 1.2 3.8 3.4-3.8Z" fill="color-mix(in srgb, currentColor 68%, black)"/><path d="M11.1 2H4a2 2 0 0 0-2 2v12.2a2 2 0 0 0 2 2h12.3Z" fill="currentColor"/></g>',
    stayOnPage: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8h18M6 6h.01M9 6h.01M10 13v-1a2 2 0 0 1 4 0v1"/><rect x="9" y="13" width="6" height="5" rx="1"/>',
    adMarshal: '<path d="M12 2.75 20 6v5.2c0 5.1-3.1 8.55-8 10.05-4.9-1.5-8-4.95-8-10.05V6Z"/><path d="m8.5 12 2.25 2.25L16 9"/>',
    leetcodeDarkMode: '<path d="m5 6.5 6 5.5-6 5.5M13 17.5h6"/>',
    langGoogle: '<circle cx="10.7" cy="10.7" r="6.5"/><path d="m15.3 15.3 4.5 4.5"/>',
    biliDailyLogin: '<path d="m8 5-2.5-2M16 5l2.5-2"/><rect x="3" y="5" width="18" height="15.5" rx="3"/><path d="M8 12h.01M16 12h.01M8.5 16c2.1 1.15 4.9 1.15 7 0"/>',
    xhsImageDarkMode: '<path d="M12 5.1C9.1 3 6 2.6 2.8 4.2v12.1c1.7-.85 3.3-1.18 4.7-1.12"/><path d="M12 5.1C9.1 3 6 2.6 2.8 4.2v12.1c1.7-.85 3.3-1.18 4.7-1.12" transform="translate(24 0) scale(-1 1)"/><path d="M12 5.1v.9"/><g transform="translate(0 1.3)"><path d="M12 7.35c-2.35 0-4.1 1.8-4.1 4.15 0 1.65.68 2.88 1.5 4.05.54.76.88 1.5.88 2.3h3.44c0-.8.34-1.54.88-2.3.82-1.17 1.5-2.4 1.5-4.05 0-2.35-1.75-4.15-4.1-4.15Z" fill="var(--icon-surface, var(--surface))" stroke="var(--icon-surface, var(--surface))" stroke-width="3.8"/><path d="M12 7.35c-2.35 0-4.1 1.8-4.1 4.15 0 1.65.68 2.88 1.5 4.05.54.76.88 1.5.88 2.3h3.44c0-.8.34-1.54.88-2.3.82-1.17 1.5-2.4 1.5-4.05 0-2.35-1.75-4.15-4.1-4.15Z" fill="var(--icon-surface, var(--surface))"/><path d="M10.1 20h3.8"/></g>',
    xhsImageDarkModeActive: '<path d="M12 5.1C9.1 3 6 2.6 2.8 4.2v12.1c1.7-.85 3.3-1.18 4.7-1.12"/><path d="M12 5.1C9.1 3 6 2.6 2.8 4.2v12.1c1.7-.85 3.3-1.18 4.7-1.12" transform="translate(24 0) scale(-1 1)"/><path d="M12 5.1v.9"/><g transform="translate(0 1.3)"><path d="M12 7.35c-2.35 0-4.1 1.8-4.1 4.15 0 1.65.68 2.88 1.5 4.05.54.76.88 1.5.88 2.3h3.44c0-.8.34-1.54.88-2.3.82-1.17 1.5-2.4 1.5-4.05 0-2.35-1.75-4.15-4.1-4.15Z" fill="var(--icon-surface, var(--surface))" stroke="var(--icon-surface, var(--surface))" stroke-width="3.8"/><path d="M12 7.35c-2.35 0-4.1 1.8-4.1 4.15 0 1.65.68 2.88 1.5 4.05.54.76.88 1.5.88 2.3h3.44c0-.8.34-1.54.88-2.3.82-1.17 1.5-2.4 1.5-4.05 0-2.35-1.75-4.15-4.1-4.15Z" fill="currentColor" stroke="none"/><path d="M10.1 20h3.8"/></g>',
    chineseResponseClaude: '<path d="M17.3 7.1A6.7 6.7 0 1 0 17.3 16.9" stroke-width="2.35"/>',
    pageDisplay: '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
    satellites: '<path d="M15 2C15.6 8.1 17.9 11.4 22 12c-4.1.6-6.4 3.9-7 10-.6-6.1-2.9-9.4-7-10 4.1-.6 6.4-3.9 7-10Z" fill="currentColor" stroke="none"/><path d="M5.25 2c.25 1.95 1.05 2.75 3 3-1.95.25-2.75 1.05-3 3-.25-1.95-1.05-2.75-3-3 1.95-.25 2.75-1.05 3-3Z" fill="currentColor" stroke="none"/><path d="M6.25 12.25c.35 2.8 1.45 3.9 4.25 4.25-2.8.35-3.9 1.45-4.25 4.25-.35-2.8-1.45-3.9-4.25-4.25 2.8-.35 3.9-1.45 4.25-4.25Z" fill="currentColor" stroke="none"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    allSettings: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/>',
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

export async function retryReadUntil(task, accept, delays = [0, 80, 240]) {
  let lastValue;
  let lastError;
  let completedRead = false;
  for (const delay of delays) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      lastValue = await task();
      completedRead = true;
      if (accept(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
  }
  if (completedRead) return lastValue;
  throw lastError;
}
