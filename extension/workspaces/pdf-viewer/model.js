// Read-only PDF policy shared by the host, viewer and regression tests.
export const PDF_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, pages: 10000, canvasPixels: 5 * 1024 * 1024, printPages: 50, printPixels: 64 * 1024 * 1024 });
export function safePdfLink(value) {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function pdfScale(value) { return Math.max(0.25, Math.min(5, Number(value) || 1)); }
export function stepPdfScale(value, direction) { return pdfScale((Math.round(value * 100) + Math.sign(direction) * 10) / 100); }
export function rotateLeft(value) { return ((value - 90) % 360 + 360) % 360; }
export function printRange(from, to, total) {
  from = Number(from); to = Number(to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > total || to - from + 1 > PDF_LIMITS.printPages) return null;
  return { from, to };
}
export function pdfOptions(data, assetRoot) {
  return { data, isEvalSupported: false, enableXfa: false, useSystemFonts: true,
    cMapUrl: assetRoot + 'cmaps/', cMapPacked: true, standardFontDataUrl: assetRoot + 'standard_fonts/',
    wasmUrl: assetRoot + 'wasm/', useWorkerFetch: false, maxImageSize: 32 * 1024 * 1024,
    canvasMaxAreaInBytes: 32 * 1024 * 1024, disableAutoFetch: true, verbosity: 0 };
}
