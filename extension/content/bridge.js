(() => {
  const READY = 'native-scroll:bridge-ready';
  const MAIN_READY = 'native-scroll:main-ready';
  const CONFIGURE = 'native-scroll:configure';
  const SUPPRESSED = 'native-scroll:suppressed';
  let token = '';

  async function requestConfig() {
    if (!token) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'NS_PAGE_STATE' });
      if (!response?.ok) throw new Error(response?.error || 'Unable to load Native Scroll.');
      window.dispatchEvent(new CustomEvent(CONFIGURE, { detail: JSON.stringify({ token, config: response.result }) }));
      void chrome.runtime.sendMessage({ type: 'NS_CONFIG_APPLIED', active: response.result.active }).catch(() => {});
    } catch {}
  }

  window.addEventListener(MAIN_READY, event => {
    if (typeof event.detail !== 'string' || !event.detail) return;
    token = event.detail;
    void requestConfig();
  }, true);

  window.addEventListener(SUPPRESSED, event => {
    if (!token || event.detail !== token) return;
    void chrome.runtime.sendMessage({ type: 'NS_SUPPRESSED' }).catch(() => {});
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'NS_REFRESH_CONFIG') void requestConfig();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, 'settings')) void requestConfig();
  });

  window.dispatchEvent(new CustomEvent(READY));
})();
