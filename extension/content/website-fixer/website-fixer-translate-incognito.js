// A registration can outlive the last private window. Revalidate its session
// before activating; ordinary document-start activation stays synchronous.
if (chrome.extension.inIncognitoContext) {
  try {
    void chrome.runtime.sendMessage({ type: 'CG_WEBSITE_FIXER_ACTIVATE', featureId: 'websiteFixer', kind: 'translateOverride' })
      .then(reply => { if (reply?.ok && reply.result?.active) globalThis[Symbol.for('cosmic-gemini.website-fixer.translate-activate')]?.(); })
      .catch(() => {});
  } catch {}
}
