// Opaque sandboxes have no extension APIs. Authenticate the owning extension
// origin from the packaged module URL, never from an initialization payload.
export function isSandboxHost(origin, moduleURL) {
  try {
    const module = new URL(moduleURL);
    return module.protocol === 'chrome-extension:' && origin === `chrome-extension://${module.host}`;
  } catch { return false; }
}
