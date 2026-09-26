import { normalizePdfSampling } from '../../core/document-preview/pdf-sampling.js';
// Read-only PDF policy shared by the host, viewer and regression tests.
export const PDF_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, pages: 10000, canvasPixels: 4 * 1024 * 1024, detailCanvasPixels: 36 * 1024 * 1024, printPages: 50, printPixels: 64 * 1024 * 1024 });
// Supersample vectors/text without changing layout, zoom or the browser's DPR.
// Allocate high resolution only near the viewport, scaled to the user's choice.
export function pdfDetailCanvasPixels(sampling) {
  return Math.min(PDF_LIMITS.detailCanvasPixels, normalizePdfSampling(sampling) ** 2 * 1024 * 1024);
}
export { externalLinkTarget as safePdfLink } from '../../shared/external-links-capture/target.js';
// Ignore partial/invalid edits rather than throwing in PDF.js or jumping to page 1.
export function pdfPageNumber(value, total, current) {
  if (typeof value === 'string' && !value.trim()) return current;
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, Math.min(total, number)) : current;
}
export function pdfScale(value) { return Math.max(0.25, Math.min(5, Number(value) || 1)); }
export function stepPdfScale(value, direction) { return pdfScale((Math.round(value * 100) + Math.sign(direction) * 10) / 100); }
export function rotateLeft(value) { return ((value - 90) % 360 + 360) % 360; }
export function pdfFileSize(bytes, locale = 'en-US') {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes < 1000) return `${bytes} ${locale === 'zh-CN' ? '字节' : bytes === 1 ? 'byte' : 'bytes'}`;
  return `${number.format(bytes / (bytes < 1000000 ? 1000 : 1000000))} ${bytes < 1000000 ? 'KB' : 'MB'}`;
}
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
