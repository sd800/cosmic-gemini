import { FEATURE_IDS, updateFeature } from '../../../core/config.js';
import { zhihuImageAdjustmentState } from '../../../core/zhihu-image-adjustment.js';

export function createZhihuImageAdjustmentProduct(pageRuntimeHost, platform) {
  const product = Object.freeze({
    id: FEATURE_IDS.ZHIHU_IMAGE_ADJUSTMENT,
    bridge: 'content/zhihu-image-adjustment/zhihu-image-adjustment-bridge.js',
    runtime: 'content/zhihu-image-adjustment/zhihu-image-adjustment-runtime.js',
    runtimeDependencies: ['content/shared/image-reading-surface.js'],
    pageStyleFiles: ['content/zhihu-image-adjustment/zhihu-image-adjustment.css'],
    preservePageStylesOnRefresh: true, awaitConfiguration: true,
    async state(settings, url) {
      const state = zhihuImageAdjustmentState(settings, url);
      return state.active ? { ...state, locale: await platform.getLocale().catch(() => 'en-US') } : state;
    },
    async sync(context, settings) {
      const active = context.frameId === 0 && zhihuImageAdjustmentState(settings, context.topUrl).active;
      await pageRuntimeHost.sync(product, context, active, active ? product.pageStyleFiles : []);
      return active;
    },
    async handleMessage(message) {
      if (message.featureId !== product.id || !['UI_SET_ENABLED', 'UI_SET_ZHIHU_IMAGE_SETTING'].includes(message.type)
        || (message.type === 'UI_SET_ZHIHU_IMAGE_SETTING' && !['smallImages', 'darkImages', 'matchPageTheme'].includes(message.name))) {
        throw new Error('Unsupported Zhihu Image Display Adjustment command.');
      }
      const key = message.type === 'UI_SET_ENABLED' ? 'enabled' : message.name;
      const value = message.type === 'UI_SET_ENABLED' ? message.enabled : message.value;
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id,
        feature => ({ ...feature, [key]: value === true })), false);
      await platform.refreshOpenPages();
      return settings.zhihuImageAdjustment;
    }
  });
  return product;
}
