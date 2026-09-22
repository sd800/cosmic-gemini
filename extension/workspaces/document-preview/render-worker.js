importScripts('../../vendor/mammoth/mammoth.browser.min.js');
self.onmessage = async event => {
  try {
    const { validateOfficeContent, documentKind } = await import('../../core/document-preview.js');
    const { bytes, format } = event.data;
    await validateOfficeContent(bytes, format);
    const result = documentKind(format) === 'xlsx' ? await mammoth.convertSpreadsheet(bytes)
      : documentKind(format) === 'pptx' ? await mammoth.convertPresentation(bytes)
      : await mammoth.convertToHtml({ arrayBuffer: bytes }, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async image => {
        if (!/^image\/(?:png|jpeg|gif|webp)$/.test(image.contentType)) return { alt: image.altText || '' };
        return { src: 'data:' + image.contentType + ';base64,' + await image.readAsBase64String() };
      })
    });
    if ((result.value?.length || result.parts?.reduce((sum, part) => sum + part.html.length, 0) || 0) > 48 * 1024 * 1024) throw Error('documentTooLarge');
    self.postMessage({ html: result.value, parts: result.parts, formatting: result.formatting });
  } catch { self.postMessage({ error: 'documentRenderFailed' }); }
};
