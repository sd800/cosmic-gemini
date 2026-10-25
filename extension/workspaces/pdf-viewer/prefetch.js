// Bounded base-page read-ahead through PDF.js's own sequential rendering queue.
// No parallel renderer, timers, full-document scan, or separate PDF parsing.
export function selectNearbyPage(visible, views, forward, finished = 3) {
  const first = visible?.first?.id, last = visible?.last?.id;
  if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
  for (const [direction, count] of [[forward ? 1 : -1, 4], [forward ? -1 : 1, 2]]) {
    for (let offset = 1; offset <= count; offset++) {
      const id = direction > 0 ? last + offset : first - offset;
      const view = views[id - 1];
      if (view && view.renderingState !== finished) return view;
    }
  }
  return null;
}

export function installPagePrefetch(viewer) {
  const queue = viewer.renderingQueue, original = queue.getHighestPriority.bind(queue);
  queue.getHighestPriority = (visible, views, forward, extra, ignoreDetail) => {
    const priority = original(visible, views, forward, extra, ignoreDetail);
    // First paint and visible high-resolution detail keep their normal priority.
    if (priority && visible.views.some(({ view }) => view === priority || view.detailView === priority)) return priority;
    return selectNearbyPage(visible, views, forward) || priority;
  };
}
