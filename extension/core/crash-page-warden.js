// The response sandbox blocks scripts and automatic navigation while extension
// isolated-world code can still rebuild the document at its original address.
export const WARDEN_CSP = "sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals; script-src 'none'; style-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; media-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'";
export const WARDEN_META_CSP = WARDEN_CSP.slice(WARDEN_CSP.indexOf(';') + 2);
export const WARDEN_KEY = 'cosmic-gemini.crash-page-warden.static';
export const WARDEN_BINARY = /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|xml|json|eml|msg|mbox|zip|gz|rar|7z|png|jpe?g|gif|webp|avif|svg|ico|mp[34]|webm|ogg|wav|m4a|mov)$/i;
export function wardenPageUrl(value) {
  if (typeof value !== 'string' || value.length > 16_384) return '';
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !WARDEN_BINARY.test(url.pathname) ? url.href : '';
  } catch { return ''; }
}
export function sameWardenPage(left, right) {
  try { const a = new URL(left), b = new URL(right); a.hash = ''; b.hash = ''; return a.href === b.href; }
  catch { return false; }
}
