import { createImageDownloadProduct } from '../products/customs/image-download.js';
import { createVideoDownloadProduct } from '../products/customs/video-download.js';
import { createCustomsOffscreenCoordinator } from './customs-offscreen.js';
import { defineProvince } from './interface.js';

export function createCustomsProvince(platform) {
  const offscreen = createCustomsOffscreenCoordinator();
  const imageDownload = createImageDownloadProduct(platform, offscreen);
  const videoDownload = createVideoDownloadProduct(platform, offscreen);
  const products = {
    [imageDownload.id]: imageDownload,
    [videoDownload.id]: videoDownload
  };

  function product(productId) {
    const value = products[productId];
    if (!value) throw new Error('Customs Province does not govern this product.');
    return value;
  }

  return defineProvince({
    id: 'customs',
    products,
    async getProductState(productId, context) {
      const governed = product(productId);
      const state = await governed.state(context.settings, context.tabId, context.url);
      if (productId === imageDownload.id && context.prepareWorkspace && Number.isInteger(context.tabId)
        && state.supported && state.workspaceMode !== 'page') {
        await governed.prepareWorkspace(context.tabId).catch(() => {});
      }
      return state;
    },
    handleMessage(productId, message, context) {
      return product(productId).handleMessage(message, context);
    },
    handleConnect(port) {
      return imageDownload.connect(port) || videoDownload.connect(port);
    },
    async handleTabUpdated(tabId, change, tab) {
      await Promise.allSettled([
        imageDownload.handleTabUpdated(tabId, change, tab),
        videoDownload.handleTabUpdated(tabId, change, tab)
      ]);
    },
    async handleTabRemoved(tabId) {
      await Promise.allSettled([
        imageDownload.handleTabRemoved(tabId),
        videoDownload.handleTabRemoved(tabId)
      ]);
    },
    async handleDownloadChanged(delta) {
      await Promise.allSettled([
        imageDownload.handleDownloadChanged(delta),
        videoDownload.handleDownloadChanged(delta)
      ]);
    },
    handleDeterminingFilename(item, suggest) {
      return videoDownload.handleDeterminingFilename(item, suggest);
    },
    async handleHeadersReceived(details) {
      if (details.type === 'image') await imageDownload.handleHeadersReceived(details);
      else await videoDownload.handleHeadersReceived(details);
    },
    async handleAlarm(alarm) {
      if (await imageDownload.handleAlarm(alarm)) return true;
      return videoDownload.handleAlarm(alarm);
    },
    async reset() {
      await Promise.allSettled([imageDownload.reset(), videoDownload.reset()]);
      await offscreen.maybeClose();
    }
  });
}
