export const DOCUMENT_PREVIEW_PATH = 'workspaces/document-preview/document-preview.html';
export const DOCUMENT_TYPES = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  dotm: 'application/vnd.ms-word.template.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
  pdf: 'application/pdf'
});
export function documentKind(format) {
  if (!Object.hasOwn(DOCUMENT_TYPES, format)) return '';
  return format === 'pdf' ? 'pdf' : format.startsWith('do') ? 'docx' : format.startsWith('xl') ? 'xlsx' : 'pptx';
}
export function documentFormat(filename) {
  const format = String(filename || '').match(/\.([a-z]+)$/i)?.[1].toLowerCase();
  return Object.hasOwn(DOCUMENT_TYPES, format) ? format : '';
}
export const DOCUMENT_LIMIT = 24 * 1024 * 1024;
export const CACHE_LIMIT = 64 * 1024 * 1024;
export const DOCUMENT_CLEANUP_ALARM_PREFIX = 'documentPreviewCleanup:';
export const DOCUMENT_CLOSED_RETENTION = 3 * 60 * 60 * 1000;

export function documentFilename(item) {
  const name = String(item.filename || '').split(/[/\\]/).pop().replace(/[\x00-\x1f\x7f]/g, '').slice(-200);
  if (documentFormat(name)) return name;
  // A server may deliver a PDF without a filename suffix. Never relabel an
  // explicitly named executable or unsupported document as a supported file.
  if (String(item.mime || '').split(';')[0].trim().toLowerCase() === 'application/pdf' && !/\.[a-z0-9]{1,8}$/i.test(name)) {
    return (name || 'document') + '.pdf';
  }
  return '';
}

// Check the ZIP directory before handing the bounded package to the converter.
export function inspectOffice(buffer, format = 'docx') {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > DOCUMENT_LIMIT || buffer.byteLength < 22) throw Error('invalidDocument');
  const view = new DataView(buffer);
  let end = -1;
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === buffer.byteLength) { end = at; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error('invalidDocument');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const directoryEnd = at + view.getUint32(end + 12, true);
  if (!count || count > 2048 || directoryEnd !== end || view.getUint16(end + 8, true) !== count) throw Error('invalidDocument');
  const names = new Set(), files = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw Error('invalidDocument');
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 24, true), compressed = view.getUint32(at + 20, true);
    const length = view.getUint16(at + 28, true);
    const next = at + 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    if (next > end || (flags & 1) || ![0, 8].includes(method) || offset + 30 > at) throw Error('invalidDocument');
    const name = new TextDecoder().decode(new Uint8Array(buffer, at + 46, length));
    if (names.has(name) || name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw Error('invalidDocument');
    if (view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 8, true) !== method || view.getUint16(offset + 6, true) !== flags) throw Error('invalidDocument');
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + compressed > view.getUint32(end + 16, true) || (method === 0 && compressed !== size)) throw Error('invalidDocument');
    if (new TextDecoder().decode(new Uint8Array(buffer, offset + 30, view.getUint16(offset + 26, true))) !== name) throw Error('invalidDocument');
    total += size;
    if (size > 32 * 1024 * 1024 || total > 80 * 1024 * 1024 || size > Math.max(1024 * 1024, compressed * 300)) throw Error('documentTooLarge');
    names.add(name); files.push({ start, compressed, size, method }); at = next;
  }
  const main = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[documentKind(format)];
  if (!main || at !== end || !names.has('[Content_Types].xml') || !names.has(main)) throw Error('invalidDocument');
  // Macro formats expose static content only: the renderers never read or run
  // VBA, ActiveX or embedded objects. Do not accept them under a non-macro name.
  if (!format.endsWith('m') && [...names].some(name => /(?:^|\/)(?:vbaProject\.bin|activeX)(?:$|\/)/i.test(name))) throw Error('invalidDocument');
  return { entries: count, expandedBytes: total, files };
}

// Validate actual inflation in bounded streaming chunks before a third-party
// parser allocates entries. ZIP directory size claims alone are not trustworthy.
export async function validateOfficeContent(buffer, format = 'docx') {
  const { files } = inspectOffice(buffer, format);
  for (const file of files) {
    if (file.method === 0) continue;
    const stream = new Blob([new Uint8Array(buffer, file.start, file.compressed)]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > file.size) throw Error('invalidDocument');
      }
      if (size !== file.size) throw Error('invalidDocument');
    } finally { await reader.cancel().catch(() => {}); }
  }
}

export function inspectPdf(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > DOCUMENT_LIMIT || buffer.byteLength < 16) throw Error('invalidDocument');
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 8));
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  if (!/^%PDF-[12]\.[0-9]/.test(header) || !/%%EOF[\s\0]*$/.test(tail)) throw Error('invalidDocument');
}

export async function readDocumentResponse(response, format = 'docx') {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > DOCUMENT_LIMIT) throw Error('documentUnavailable');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DOCUMENT_LIMIT) throw Error('documentTooLarge');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (format === 'pdf') inspectPdf(bytes.buffer); else inspectOffice(bytes.buffer, format);
  return bytes.buffer;
}
