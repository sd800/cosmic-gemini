const NOOP = async () => undefined;

export function defineProvince({ id, products, ...implementation }) {
  if (!id || !products || typeof products !== 'object') throw new Error('A province requires an id and product registry.');
  return Object.freeze({
    id,
    products: Object.freeze({ ...products }),
    initialize: implementation.initialize || NOOP,
    getProductState: implementation.getProductState || NOOP,
    syncProduct: implementation.syncProduct || NOOP,
    handleMessage: implementation.handleMessage || NOOP,
    handleConnect: implementation.handleConnect || (() => false),
    handleTabUpdated: implementation.handleTabUpdated || NOOP,
    handleTabRemoved: implementation.handleTabRemoved || NOOP,
    handleDownloadChanged: implementation.handleDownloadChanged || NOOP,
    handleDeterminingFilename: implementation.handleDeterminingFilename || (() => false),
    handleHeadersReceived: implementation.handleHeadersReceived || NOOP,
    handleAlarm: implementation.handleAlarm || NOOP,
    handleStorageChanged: implementation.handleStorageChanged || NOOP,
    reset: implementation.reset || NOOP
  });
}
