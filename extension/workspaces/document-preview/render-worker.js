importScripts('../../vendor/mammoth/mammoth.browser.min.js');
self.onmessage = async event => {
  try {
    const { validateOfficeContent, documentKind } = await import('../../core/document-preview/document-preview.js');
    const { bytes, format, labels } = event.data;
    await validateOfficeContent(bytes, format);
    if (format === 'xls') importScripts('../../vendor/sheetjs/xlsx.full.min.js');
    const rtf = format === 'rtf' || (format === 'doc' && new Uint8Array(bytes)[0] === 123);
    const result = rtf ? mammoth.convertRtf(bytes)
      : format === 'doc' ? mammoth.convertLegacyWord(bytes)
      : format === 'xls' ? mammoth.convertLegacySpreadsheet(bytes, XLSX)
      : format === 'ppt' ? mammoth.convertLegacyPresentation(bytes)
      : ['odt', 'ods', 'odp'].includes(format) ? await mammoth.convertOpenDocument(bytes, format)
      : format === 'eml' ? await mammoth.convertEmail(bytes, labels)
      : documentKind(format) === 'xlsx' ? await mammoth.convertSpreadsheet(bytes)
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
