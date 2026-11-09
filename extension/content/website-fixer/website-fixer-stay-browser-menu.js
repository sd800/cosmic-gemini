globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-activate')] = () => {
  const key = Symbol.for('cosmic-gemini.website-fixer.stay-menu');
  if (globalThis[key]?.activate) { globalThis[key].activate(); return; }
  const prefix = 'cosmic-gemini:website-fixer:stay:';
  let enabled = false;
  const pending = new Set();
  const activate = () => { if (enabled) window.dispatchEvent(new CustomEvent(prefix + 'activate')); };
  globalThis[key] = {
    activate() {
      enabled = true;
      window.addEventListener(prefix + 'ready', activate);
      window.addEventListener('contextmenu', onContextMenu, true);
      activate();
    },
    dispose() {
      enabled = false;
      window.removeEventListener(prefix + 'ready', activate);
      window.removeEventListener('contextmenu', onContextMenu, true);
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
      window.dispatchEvent(new CustomEvent(prefix + 'deactivate'));
    }
  };

  // This runs only in the extension's isolated world. Keep it separate from
  // the MAIN-world navigation guard so Chrome injects both registrations.
  function onContextMenu(event) {
    if (!enabled || !event.isTrusted) return;
    const focused = document.activeElement;
    if (focused?.type === 'password') return;
    const selected = String(window.getSelection?.() || '').trim()
      || (Number.isInteger(focused?.selectionStart) ? focused.value.slice(focused.selectionStart, focused.selectionEnd).trim() : '');
    // A page's custom context menu is not a browser command. Wait until
    // dispatch finishes so its preventDefault() can be observed.
    const timer = setTimeout(() => {
      pending.delete(timer);
      if (!enabled || event.defaultPrevented) return;
      try {
        const sent = chrome.runtime.sendMessage({ type: 'CG_WEBSITE_FIXER_CONTEXT_MENU',
          featureId: 'websiteFixer', kind: 'browser', search: selected.slice(0, 2049) });
        sent?.catch?.(() => {});
      } catch {}
    }, 0);
    pending.add(timer);
  }
  globalThis[key].activate();
};
