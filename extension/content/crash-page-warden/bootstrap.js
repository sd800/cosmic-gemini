(() => {
  const key = Symbol.for('cosmic-gemini.crash-page-warden.static');
  if (globalThis[key]) return;
  const state = { started: false, ready: false, reply: null };
  state.start = () => {
    if (state.started || window !== top || !/^https?:$/.test(location.protocol)
      || !/^(?:text\/html|application\/xhtml\+xml)$/i.test(document.contentType || '')) return;
    state.started = true;
    // Also cover documents served from a site's pre-existing service worker.
    // These local guards are applied synchronously before website scripts run.
    const head = document.head || document.documentElement.insertBefore(document.createElement('head'), document.documentElement.firstChild);
    const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "script-src 'none'; style-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; media-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'";
    head.prepend(policy);
    document.documentElement.dataset.cgWarden = 'loading';
    state.whiteSofter?.start();
    state.reply = chrome.runtime.sendMessage({ type: 'CG_WEBSITE_FIXER_ACTIVATE', featureId: 'websiteFixer', kind: 'crashPageWarden' }).catch(() => null);
  };
  Object.defineProperty(globalThis, key, { value: state });
})();
