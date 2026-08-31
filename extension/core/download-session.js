export const DOWNLOAD_SCAN_GRACE_MS = 120_000;
export const DOWNLOAD_SCAN_ALARM_PREFIX = 'downloadScanPause:';
export const DOWNLOAD_SCAN_PRODUCTS = Object.freeze(['videoDownload', 'imageDownload']);

export function downloadScanAlarmName(product, tabId) {
  if (!DOWNLOAD_SCAN_PRODUCTS.includes(product) || !Number.isInteger(tabId)) return '';
  return `${DOWNLOAD_SCAN_ALARM_PREFIX}${product}:${tabId}`;
}

export function parseDownloadScanAlarm(name) {
  const match = String(name || '').match(/^downloadScanPause:(videoDownload|imageDownload):(\d+)$/);
  if (!match) return null;
  return { product: match[1], tabId: Number(match[2]) };
}

export function downloadScanState(session, now = Date.now()) {
  if (!session || typeof session !== 'object') return 'paused';
  const state = ['active', 'grace', 'paused'].includes(session?.scanState) ? session.scanState : 'active';
  if (state === 'grace' && Number(session?.scanDeadline || 0) <= now) return 'paused';
  return state;
}

export function downloadScanCollects(session, now = Date.now()) {
  return downloadScanState(session, now) !== 'paused';
}

export function activateDownloadScan(session) {
  return { ...session, scanState: 'active', scanDeadline: 0 };
}

export function deferDownloadScan(session, now = Date.now()) {
  if (downloadScanState(session, now) === 'paused') return { ...session, scanState: 'paused', scanDeadline: 0 };
  return { ...session, scanState: 'grace', scanDeadline: now + DOWNLOAD_SCAN_GRACE_MS };
}

export function pauseDownloadScan(session) {
  return { ...session, scanState: 'paused', scanDeadline: 0 };
}
