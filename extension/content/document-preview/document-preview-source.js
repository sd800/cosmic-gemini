// Executed only for an intercepted download, in the source page's isolated world.
// Canvas can hand Chrome a short-lived CDN URL instead of its stable file route.
// Recognize the application DOM, not a school's hostname, and read links only.
export function canvasDocumentSource(expectedPage, filename, observedUrls) {
  if (location.href !== expectedPage || !document.querySelector('#application.ic-app')
    || !document.querySelector('#header.ic-app-header #global_nav_dashboard_link')) return null;
  const route = value => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin || url.username || url.password
        || !/^\/(?:\w+\/\d+\/)?files\/\d+\/download\/?$/.test(url.pathname)) return null;
      url.hash = ''; return url.href;
    } catch { return null; }
  };
  // An observed request is stronger evidence than a potentially abbreviated label.
  for (const value of observedUrls) { const url = route(value); if (url) return url; }
  const matches = new Set();
  const links = document.querySelectorAll('a.ef-name-col__link, a.instructure_file_link');
  for (let i = 0; i < Math.min(links.length, 2000); i++) {
    const link = links[i];
    if (![link.textContent, link.getAttribute('title'), link.getAttribute('download')]
      .some(value => value?.trim() === filename)) continue;
    const url = route(link.href); if (url) matches.add(url);
  }
  return matches.size === 1 ? [...matches][0] : null;
}
