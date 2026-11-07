// Runs in the source document's isolated world. Drawing only already decoded
// images avoids a request and leaves cross-origin canvas protections intact.
export function readMediaThumbnail(url, frameUrl) {
  if (location.href !== frameUrl) return '';
  const target = url.split('#')[0];
  for (let index = 0; index < Math.min(4000, document.images.length); index++) {
    const image = document.images[index];
    if (!image.complete || !image.naturalWidth || !image.naturalHeight || image.currentSrc.split('#')[0] !== target) continue;
    try {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', .82);
    } catch {}
  }
  return '';
}
