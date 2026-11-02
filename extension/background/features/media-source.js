// Read-only eligibility shared by the two media tools. No content or page styles
// are changed; cached decisions are invalidated by the owning Province on navigation.
export function createMediaSourcePolicy() {
  const pages = new Map();
  function eligibleUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !/\.pdf(?:;[^/]*)?$/i.test(url.pathname);
    } catch { return false; }
  }
  return {
    async inspect(tabId, url, refresh = false) {
      if (!Number.isInteger(tabId) || tabId < 0 || !eligibleUrl(url)) return false;
      const previous = pages.get(tabId);
      if (previous?.url === url && (!refresh || previous.pending)) return previous.promise;
      const entry = { url, allowed: false, pending: true };
      pages.set(tabId, entry);
      entry.promise = (async () => {
        try {
          const frames = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', injectImmediately: true, func: () => {
            const mime = String(document.contentType || '').split(';')[0].toLowerCase();
            const pdf = mime === 'application/pdf' || mime === 'application/x-pdf'
              || [...document.querySelectorAll('embed[type="application/pdf"], object[type="application/pdf"], iframe[src]')].some(node => {
                if (node.localName === 'iframe') {
                  try {
                    const source = new URL(node.getAttribute('src'), location.href);
                    if (!/\.pdf(?:;[^/]*)?$/i.test(source.pathname)
                      && !(source.protocol === 'chrome-extension:' && /\/(?:pdf-(?:reader|viewer)|document-preview)\//i.test(source.pathname))) return false;
                  } catch { return false; }
                }
                const rect = node.getBoundingClientRect();
                return rect.width >= innerWidth * .8 && rect.height >= innerHeight * .8;
              });
            const mediaDocument = /^(?:text\/html$|application\/xhtml\+xml$|image\/|audio\/|video\/)/.test(mime);
            return { href: location.href, eligible: mediaDocument && !pdf };
          } });
          const frame = frames.find(frame => frame.frameId === 0);
          entry.allowed = frame?.result?.eligible === true && eligibleUrl(frame.result.href)
            && frame.result.href.split('#')[0] === url.split('#')[0];
        } catch { entry.allowed = false; }
        entry.pending = false;
        return pages.get(tabId) === entry && entry.allowed;
      })();
      return entry.promise;
    },
    allows: (tabId, url) => eligibleUrl(url) && pages.get(tabId)?.url === url && pages.get(tabId)?.allowed === true,
    invalidate: tabId => pages.delete(tabId),
    clear: () => pages.clear()
  };
}
