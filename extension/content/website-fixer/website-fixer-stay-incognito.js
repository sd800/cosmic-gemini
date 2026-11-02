// Revalidate saved and session policy in the owning browser context.
if (chrome.extension.inIncognitoContext === true) {
try {
  void chrome.runtime.sendMessage({ type: 'CG_WEBSITE_FIXER_ACTIVATE', featureId: 'websiteFixer', kind: 'stayOnPage' })
    .then(reply => { if (reply?.ok && reply.result?.active) globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-activate')]?.(); })
    .catch(() => {});
} catch {}
}
