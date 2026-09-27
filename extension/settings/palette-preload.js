(() => {
  const key = Symbol.for('cosmic-gemini.settings.white-softer-palette');
  const root = document.documentElement;
  const apply = preference => {
    if (preference?.enabled === true) root.dataset.whiteSofterTone = preference.tone || 'warm-minus-1';
    else delete root.dataset.whiteSofterTone;
  };
  if (chrome.extension?.inIncognitoContext !== true) {
    try {
      const cached = JSON.parse(localStorage.getItem('cosmicGeminiSettingsViewCache') || '{}');
      apply(cached?.whiteSofter);
    } catch {}
  }
  Object.defineProperty(globalThis, key, { value: Object.freeze({ apply }) });
})();
