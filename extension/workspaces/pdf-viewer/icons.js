// All reader icons share a 24-unit grid, 20px size and the same stroke weight.
const paths = {
  print:'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z',
  download:'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5',
  moon:'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z',
  sun:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
  'sidebar-toggle':'M3 4h18v16H3zM9 4v16',
  rotate:'M5.25 9.5h9a1.25 1.25 0 0 1 1.25 1.25v9A1.25 1.25 0 0 1 14.25 21h-9A1.25 1.25 0 0 1 4 19.75v-9A1.25 1.25 0 0 1 5.25 9.5ZM20 9.75v-1A3.75 3.75 0 0 0 16.25 5h-3m2.5-2-2.5 2 2.5 2',
  fullscreen:'M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6',
  'fullscreen-exit':'M3 9h6V3M15 3v6h6M21 15h-6v6M9 21v-6H3',
  previous:'m15 4-8 8 8 8', next:'m9 4 8 8-8 8',
  'zoom-out':'M4 12h16', 'zoom-in':'M4 12h16M12 4v16',
};
export function setReaderIcon(button, name) {
  if (!button || !paths[name]) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path);
  button.classList.add('reader-icon'); button.replaceChildren(svg);
}
export function setReaderIcons(root) {
  for (const name of Object.keys(paths)) setReaderIcon(root.getElementById(name), name);
}
