// A non-authoritative visual hint only. The product revalidates document/session
// ownership and reads current appearance settings before showing document bytes.
(() => {
  const value = new URLSearchParams(location.hash.slice(1)).get('appearance');
  const appearance = value === 'light' || value === 'dark' ? value : 'auto';
  const dark = appearance === 'dark' || (appearance === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.backgroundColor = dark ? '#24262a' : '#f7f8fa';
})();
