importScripts('../../vendor/mammoth/mammoth.browser.min.js');
self.onmessage = async event => {
  try {
    const { validateDocxContent } = await import('../../core/document-preview.js');
    await validateDocxContent(event.data);
    const result = await mammoth.convertToHtml({ arrayBuffer: event.data }, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async image => {
        if (!/^image\/(?:png|jpeg|gif|webp)$/.test(image.contentType)) return { alt: image.altText || '' };
        return { src: 'data:' + image.contentType + ';base64,' + await image.readAsBase64String() };
      })
    });
    if (result.value.length > 48 * 1024 * 1024) throw Error('documentTooLarge');
    self.postMessage({ html: result.value });
  } catch { self.postMessage({ error: 'documentRenderFailed' }); }
};
