(() => {
  const KEY = Symbol.for('cosmic-gemini.white-tones');
  if (globalThis[KEY]) return;
  // One palette supplies settings menus, normalization and actual rendered colors.
  const tones = Object.freeze([
    { id: 'warm-minus-1', label: 'whiteSofterWarmMinus1', rgb: '236 235 233' },
    { id: 'warm', label: 'whiteSofterWarm', rgb: '232 230 227' },
    { id: 'warm-plus-1', label: 'whiteSofterWarmPlus1', rgb: '216 214 211' },
    { id: 'warm-plus-2', label: 'whiteSofterWarmPlus2', rgb: '208 206 203' },
    { id: 'cool', label: 'whiteSofterCool', rgb: '206 224 242' }
  ].map(Object.freeze));
  const get = id => tones.find(tone => tone.id === id) || tones.find(tone => tone.id === 'warm');
  const normalize = (id, allowOff = false) => allowOff && id === 'off' ? 'off' : get(id).id;
  function populateMenus(root, translate) {
    for (const select of root.querySelectorAll('select[data-white-tones]')) {
      const options = select.dataset.whiteTones === 'allow-off'
        ? [{ id: 'off', label: 'leetcodeDarkModeToneOff' }, ...tones] : tones;
      const signature = JSON.stringify(options.map(tone => [tone.id, translate(tone.label)]));
      if (select.dataset.toneOptions === signature) continue;
      const value = normalize(select.value, select.dataset.whiteTones === 'allow-off');
      select.replaceChildren(...options.map(tone => {
        const option = select.ownerDocument.createElement('option');
        option.value = tone.id; option.textContent = translate(tone.label);
        return option;
      }));
      select.value = value;
      select.dataset.toneOptions = signature;
    }
  }
  Object.defineProperty(globalThis, KEY, { value: Object.freeze({ tones, get, normalize, populateMenus }) });
})();
