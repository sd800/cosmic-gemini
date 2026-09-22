// One Chrome offscreen document per browser context. This neutral host only
// serializes resource operations; product policy remains in its province.
export const OFFSCREEN_PATH = 'offscreen/video-download.html';
let lifecycle = Promise.resolve();
export function withOffscreen(task, create = true) {
  const operation = lifecycle.catch(() => {}).then(async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)] });
    if (!contexts.length) {
      if (!create) return undefined;
      await chrome.offscreen.createDocument({ url: OFFSCREEN_PATH, reasons: ['BLOBS'], justification: 'Hold temporary user-requested files in memory and process media locally.' });
    }
    return task();
  });
  lifecycle = operation.catch(() => {});
  return operation;
}
