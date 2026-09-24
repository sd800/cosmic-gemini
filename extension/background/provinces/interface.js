const NOOP = async () => undefined;

export function defineProvince({ id, products, ...implementation }) {
  if (!id || !products || typeof products !== 'object') throw new Error('A province requires an id and product registry.');
  const province = {
    id,
    products: Object.freeze({ ...products }),
    initialize: implementation.initialize || NOOP,
    getProductState: implementation.getProductState || NOOP,
    syncProduct: implementation.syncProduct || NOOP,
    handleMessage: implementation.handleMessage || NOOP,
    handleConnect: implementation.handleConnect || (() => false),
    handleTabCreated: implementation.handleTabCreated || NOOP,
    handleTabUpdated: implementation.handleTabUpdated || NOOP,
    handleTabRemoved: implementation.handleTabRemoved || NOOP,
    handleNavigationRequest: implementation.handleNavigationRequest || NOOP,
    handleActionClicked: implementation.handleActionClicked || NOOP,
    handleWindowCreated: implementation.handleWindowCreated || NOOP,
    handleWindowRemoved: implementation.handleWindowRemoved || NOOP,
    handleDownloadChanged: implementation.handleDownloadChanged || NOOP,
    handleDeterminingFilename: implementation.handleDeterminingFilename || (() => false),
    handleHeadersReceived: implementation.handleHeadersReceived || NOOP,
    handleAlarm: implementation.handleAlarm || NOOP,
    handleStorageChanged: implementation.handleStorageChanged || NOOP,
    reset: implementation.reset || NOOP
  };
  for (const hook of Object.keys(implementation)) {
    if (!(hook in province)) throw new Error(`Unknown province hook: ${hook}`);
  }
  return Object.freeze(province);
}
