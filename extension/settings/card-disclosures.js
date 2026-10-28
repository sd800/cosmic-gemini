// The synchronous preloader restores saved layout before revealing Settings.
export function createCardDisclosures(primary) {
  const layout = globalThis[Symbol.for('cosmic-gemini.settings.card-layout')];
  const collapsed = layout?.read() || new Set();
  let cards = new Map(), translate = key => key;

  function update(record, closed) {
    if (closed) {
      collapsed.add(record.card.id);
      record.card.dataset.cardCollapsed = 'true';
    } else {
      collapsed.delete(record.card.id);
      delete record.card.dataset.cardCollapsed;
    }
    record.button.setAttribute('aria-expanded', String(!closed));
    const label = translate(closed ? 'settingsExpandDetails' : 'settingsCollapseDetails');
    record.button.title = label;
    record.button.setAttribute('aria-label', `${label}: ${record.title.textContent}`);
  }

  primary.addEventListener('click', event => {
    const button = event.target.closest('[data-card-disclosure]');
    if (!button || !primary.contains(button)) return;
    const record = cards.get(button.dataset.cardDisclosure);
    if (!record || record.button !== button) return;
    const closed = !collapsed.has(record.card.id);
    update(record, closed);
    layout?.write(record.card.id, closed);
    primary.dispatchEvent(new Event('settings-card-toggle', { bubbles: true }));
  });

  return {
    mount() {
      cards = new Map();
      for (const card of primary.querySelectorAll(':scope > .satellite-card, :scope > .satellite-card > .xhs-navigation-item')) {
        const heading = card.querySelector(':scope > .section-heading');
        const column = heading?.firstElementChild;
        const title = column?.querySelector(':scope > h1, .satellite-title h1');
        if (!card.id || !title) continue;
        let button = heading.querySelector(':scope > [data-card-disclosure]');
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'icon-button card-disclosure';
          button.dataset.cardDisclosure = card.id;
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
          heading.append(button);
        }
        const content = [...column.children].filter(node => node !== title && !node.matches('.satellite-title, [data-card-disclosure]'));
        content.push(...[...card.children].filter(node => node !== heading && !node.matches('.xhs-navigation-item')));
        content.push(...heading.querySelectorAll(':scope > .satellite-control > .document-open'));
        button.setAttribute('aria-controls', content.map((node, index) => {
          if (!node.id) node.id = `${card.id}-details-${index + 1}`;
          return node.id;
        }).join(' '));
        const record = { card, button, title };
        cards.set(card.id, record);
        update(record, collapsed.has(card.id));
      }
    },
    localize(t) {
      translate = t;
      for (const record of cards.values()) update(record, collapsed.has(record.card.id));
    },
    reveal(target) {
      const record = cards.get(target.closest('.satellite-card, .xhs-navigation-item')?.id);
      if (record && collapsed.has(record.card.id)) {
        update(record, false);
        layout?.write(record.card.id, false);
        primary.dispatchEvent(new Event('settings-card-toggle', { bubbles: true }));
      }
    },
    reset() {
      collapsed.clear();
      layout?.reset();
    }
  };
}
