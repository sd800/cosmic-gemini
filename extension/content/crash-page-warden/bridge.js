(() => {
  const key = Symbol.for('cosmic-gemini.crash-page-warden.bridge');
  if (globalThis[key]) return;
  let active = false, timer = 0, retired = false, printing = false, sending = false;
  const send = message => { try { return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null); } catch { return Promise.resolve(null); } };
  async function heartbeat() {
    if (!active || retired || sending || window !== top) return;
    sending = true;
    try { await send({ type: 'CG_CRASH_PAGE_WARDEN_HEARTBEAT', featureId: 'websiteFixer', visible: !document.hidden && !printing }); }
    finally { sending = false; }
  }
  async function activate() {
    if (retired) return;
    const reply = await send({ type: 'CG_WEBSITE_FIXER_ACTIVATE', featureId: 'websiteFixer', kind: 'crashPageWarden' });
    if (!reply?.ok || !reply.result?.active || retired) return;
    active = true;
    if (!timer && window === top) timer = setInterval(() => { void heartbeat(); }, 2000);
    void heartbeat();
  }
  document.addEventListener('visibilitychange', () => { void heartbeat(); });
  addEventListener('beforeprint', event => { if (event.isTrusted) {
    printing = true;
    // Do not wait for an older heartbeat response: native printing may suspend
    // this renderer immediately after beforeprint returns.
    if (active && !retired && window === top) void send({ type: 'CG_CRASH_PAGE_WARDEN_HEARTBEAT', featureId: 'websiteFixer', visible: false });
  } });
  addEventListener('afterprint', event => { if (event.isTrusted) { printing = false; void heartbeat(); } });
  addEventListener('pagehide', () => { retired = true; if (timer) clearInterval(timer); timer = 0;
    if (active) void send({ type: 'CG_CRASH_PAGE_WARDEN_HEARTBEAT', featureId: 'websiteFixer', visible: false }); });
  addEventListener('pageshow', event => { if (event.persisted) { retired = false; void activate(); } });
  Object.defineProperty(globalThis, key, { value: { activate }, configurable: false });
})();
