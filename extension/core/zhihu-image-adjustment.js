export function isZhihuPage(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol)
    && (url.hostname === 'zhihu.com' || url.hostname.endsWith('.zhihu.com')); } catch { return false; }
}
export function zhihuImageAdjustmentState(settings, url) {
  const preference = settings.zhihuImageAdjustment || {}, supported = isZhihuPage(url);
  const smallImages = preference.smallImages !== false, darkImages = preference.darkImages !== false;
  return { enabled: preference.enabled === true, supported, smallImages, darkImages, matchPageTheme: preference.matchPageTheme !== false,
    active: preference.enabled === true && supported && (smallImages || darkImages) };
}
