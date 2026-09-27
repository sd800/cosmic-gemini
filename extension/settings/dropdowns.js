(() => {
  if (!globalThis.CSS?.supports('appearance', 'base-select')) return;
  const enhance = select => {
    if (!(select instanceof HTMLSelectElement) || select.multiple || select.size > 1) return;
    let button = select.querySelector(':scope > button[data-settings-picker-button]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.settingsPickerButton = '';
      button.append(document.createElement('selectedcontent'));
    }
    if (select.firstElementChild !== button) select.prepend(button);
    select.dataset.settingsPicker = '';
  };
  const scan = node => {
    if (!(node instanceof Element)) return;
    enhance(node);
    for (const select of node.querySelectorAll('select')) enhance(select);
  };
  scan(document.body);
  // In-page navigation and option repopulation retain the same native select/value/change APIs.
  new MutationObserver(records => {
    for (const record of records) {
      enhance(record.target);
      for (const node of record.addedNodes) scan(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
