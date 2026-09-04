(() => {
  const client = {
    config() { return client; },
    send() { return client; }
  };
  const emonitor = {
    create() { return client; },
    getUrlParam() { return ''; },
    injectVconsole() {}
  };
  Object.defineProperty(globalThis, 'emonitor', {
    value: emonitor,
    configurable: true,
    writable: true
  });
})();
