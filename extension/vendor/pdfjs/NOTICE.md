# PDF.js 6.3.289

Mozilla PDF.js, Apache-2.0. https://github.com/mozilla/pdf.js/tree/v6.3.289

Source: pdfjs-dist@6.3.289 from the npm registry. Package integrity: sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==

Reproduce with node scripts/vendor-pdf-viewer.mjs /path/to/unpacked/package. The legacy engine and viewer support the extension's Chrome baseline. The engine/worker are unmodified. The reusable viewer has a local, guarded rendering patch (scripts/pdf-viewer-rendering-patch.mjs): configurable sampling density, separate base/detail canvas budgets, bounded detail-canvas sampling with exact backing-to-display mapping, and a four-page minimum cache. Source maps, application UI, QuickJS, editing application and remote resources are not included. Standard fonts, CMaps and image codecs are local and load only as needed. Subcomponent licenses are in their respective folders. integrity.json records every shipped dependency asset.
