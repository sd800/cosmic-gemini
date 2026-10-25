// Session registrations never persist across Chrome restarts. Revalidate their
// current authorization before activating in either ordinary or private tabs.
try {
  void chrome.runtime.sendMessage({ type: 'CG_WEBSITE_FIXER_ACTIVATE', featureId: 'websiteFixer', kind: 'translateOverride' })
    .then(reply => { if (reply?.ok && reply.result?.active) globalThis[Symbol.for('cosmic-gemini.website-fixer.translate-activate')]?.(); })
    .catch(() => {});
} catch {}
