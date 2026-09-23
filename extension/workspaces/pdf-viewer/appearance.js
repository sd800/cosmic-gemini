// Execute before styles and the renderer module: the first paint already has
// the host's resolved appearance, even when the engine is cold or reloading.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const dark = params.get('dark') === '1';
  document.documentElement.dataset.dark = String(dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.lang = params.get('locale') === 'zh-CN' ? 'zh-CN' : 'en-US';
})();
