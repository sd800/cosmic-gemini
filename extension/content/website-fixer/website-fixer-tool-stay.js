// Revalidate authorization and invalidate replies superseded by live shutdown.
if (true) {
  const key = Symbol.for('cosmic-gemini.website-fixer.stay-pending');
  const pending = globalThis[key] || (globalThis[key] = { revision: 0 });
  const revision = ++pending.revision;
  try {
    void chrome.runtime.sendMessage({ type: 'CG_WEBSITE_FIXER_ACTIVATE', featureId: 'websiteFixer', kind: 'stayOnPage' })
      .then(reply => {
        if (pending.revision === revision && reply?.ok && reply.result?.active)
          globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-activate')]?.();
      }).catch(() => {});
  } catch {}
}
