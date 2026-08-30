(() => {
  const view = new URL(location.href).searchParams.get('view');
  document.documentElement.dataset.workspaceView = view === 'side-panel' ? 'side-panel' : 'page';
})();
