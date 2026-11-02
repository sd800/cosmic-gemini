import { createMediaSourcePolicy } from '../features/media-source.js';
import { createDocumentPreviewProduct } from '../products/customs/document-preview.js';
import { createImageDownloadProduct } from '../products/customs/image-download.js';
import { createVideoDownloadProduct } from '../products/customs/video-download.js';
import { createCustomsOffscreenCoordinator } from './customs-offscreen.js';
import { createCustomsObservationRegistry } from './customs-observation.js';
import { defineProvince } from './interface.js';

export function createCustomsProvince(platform, responseIngress) {
  const offscreen = createCustomsOffscreenCoordinator();
  const mediaSources = createMediaSourcePolicy();
  const documentPreview = createDocumentPreviewProduct(platform);
  const observation = createCustomsObservationRegistry(responseIngress);
  const imageDownload = createImageDownloadProduct(platform, offscreen, observation, mediaSources);
  const videoDownload = createVideoDownloadProduct(platform, offscreen, observation, mediaSources);
  const products = {
    [imageDownload.id]: imageDownload,
    [videoDownload.id]: videoDownload,
    [documentPreview.id]: documentPreview
  };
  let restorationTask = null;

  function product(productId) {
    const value = products[productId];
    if (!value) throw new Error('Customs Province does not govern this product.');
    return value;
  }

  function restoreObservation() {
    if (restorationTask) return restorationTask;
    restorationTask = Promise.all([imageDownload.initialize(), videoDownload.initialize()])
      .then(results => observation.completeInitialization(results))
      .finally(() => { restorationTask = null; });
    return restorationTask;
  }

  return defineProvince({
    id: 'customs',
    products,
    initialize: () => Promise.allSettled([restoreObservation(), documentPreview.initialize()]),
    async getProductState(productId, context) {
      const governed = product(productId);
      const state = await governed.state(context.settings, context.tabId, context.url);
      if ([imageDownload.id, videoDownload.id].includes(productId)
        && !await mediaSources.inspect(context.tabId, context.url, context.refreshMediaSource)) {
        return { ...state, supported: false, active: false };
      }
      if (productId === imageDownload.id && context.prepareWorkspace && Number.isInteger(context.tabId)
        && state.supported && state.workspaceMode !== 'page') {
        await governed.prepareWorkspace(context.tabId).catch(() => {});
      }
      return state;
    },
    handleMessage(productId, message, context) {
      if (['UI_IMAGE_OPEN', 'UI_VIDEO_OPEN'].includes(message.type)
        && !mediaSources.allows(Number(message.tabId), message.url || '')) {
        throw new Error('Media tools are unavailable on this page.');
      }
      return product(productId).handleMessage(message, context);
    },
    handleConnect(port) {
      return imageDownload.connect(port) || videoDownload.connect(port);
    },
    handleTabCreated: tab => documentPreview.handleTabCreated(tab),
    handleStorageChanged: (changes, area) => documentPreview.handleStorageChanged(changes, area),
    async handleTabUpdated(tabId, change, tab) {
      if (change.url || change.status) mediaSources.invalidate(tabId);
      await Promise.allSettled([
        imageDownload.handleTabUpdated(tabId, change, tab),
        videoDownload.handleTabUpdated(tabId, change, tab),
        documentPreview.handleTabUpdated(tabId, change, tab)
      ]);
    },
    async handleTabRemoved(tabId) {
      mediaSources.invalidate(tabId);
      await Promise.allSettled([
        imageDownload.handleTabRemoved(tabId),
        videoDownload.handleTabRemoved(tabId),
        documentPreview.handleTabRemoved(tabId)
      ]);
    },
    async handleDownloadChanged(delta) {
      await Promise.allSettled([
        imageDownload.handleDownloadChanged(delta),
        videoDownload.handleDownloadChanged(delta)
      ]);
    },
    handleDeterminingFilename(item, suggest) {
      return videoDownload.handleDeterminingFilename(item, suggest) || documentPreview.handleDeterminingFilename(item, suggest);
    },
    async handleHeadersReceived(details) {
      if (observation.needsRestoration()) await restoreObservation();
      if (details.type === 'image') await imageDownload.handleHeadersReceived(details);
      else await videoDownload.handleHeadersReceived(details);
    },
    async handleAlarm(alarm) {
      if (await imageDownload.handleAlarm(alarm)) return true;
      if (await videoDownload.handleAlarm(alarm)) return true;
      return documentPreview.handleAlarm(alarm);
    },
    async reset() {
      await Promise.allSettled([imageDownload.reset(), videoDownload.reset(), documentPreview.reset()]);
      await offscreen.maybeClose();
    }
  });
}
