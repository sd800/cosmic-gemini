// Navigation targets only. Never use this validator for remote resources,
// executable document actions, embedded files, scripts or privileged commands.
const BLOCKED = new Set(['javascript:', 'vbscript:', 'data:', 'blob:', 'file:',
  'filesystem:', 'about:', 'view-source:', 'resource:', 'jar:', 'devtools:',
  'ms-msdt:', 'shell:', 'powershell:']);
export function externalLinkTarget(value) {
  if (typeof value !== 'string' || value.length > 8192 ||
      /[\u0000-\u001f\u007f-\u009f]|%00/i.test(value)) return null;
  const raw = value.trim();
  // A one-letter scheme is usually a local Windows drive, not an app link.
  if (!/^[a-z][a-z\d+.-]+:/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || BLOCKED.has(url.protocol) ||
        /^(?:chrome|edge|brave|opera|moz|safari)(?:-|:)/i.test(url.protocol)) return null;
    return url.href;
  } catch { return null; }
}
