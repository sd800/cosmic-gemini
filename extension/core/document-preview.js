export const DOCUMENT_PREVIEW_PATH = 'workspaces/document-preview/document-preview.html';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCUMENT_LIMIT = 24 * 1024 * 1024;
export const CACHE_LIMIT = 64 * 1024 * 1024;
export const DOCUMENT_CLEANUP_ALARM_PREFIX = 'documentPreviewCleanup:';
export const DOCUMENT_CLOSED_RETENTION = 10 * 60 * 60 * 1000;

export function docxFilename(item) {
  const name = String(item.filename || '').split(/[/\\]/).pop();
  if (/\.docx$/i.test(name)) return name.replace(/[\x00-\x1f\x7f]/g, '').slice(-200);
  return '';
}

// Check the ZIP directory before handing the bounded package to the converter.
export function inspectDocx(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > DOCUMENT_LIMIT || buffer.byteLength < 22) throw Error('invalidDocx');
  const view = new DataView(buffer);
  let end = -1;
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === buffer.byteLength) { end = at; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error('invalidDocx');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const directoryEnd = at + view.getUint32(end + 12, true);
  if (!count || count > 2048 || directoryEnd !== end || view.getUint16(end + 8, true) !== count) throw Error('invalidDocx');
  const names = new Set(), files = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw Error('invalidDocx');
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 24, true), compressed = view.getUint32(at + 20, true);
    const length = view.getUint16(at + 28, true);
    const next = at + 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    if (next > end || (flags & 1) || ![0, 8].includes(method) || offset + 30 > at) throw Error('invalidDocx');
    const name = new TextDecoder().decode(new Uint8Array(buffer, at + 46, length));
    if (names.has(name) || name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw Error('invalidDocx');
    if (view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 8, true) !== method || view.getUint16(offset + 6, true) !== flags) throw Error('invalidDocx');
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + compressed > view.getUint32(end + 16, true) || (method === 0 && compressed !== size)) throw Error('invalidDocx');
    if (new TextDecoder().decode(new Uint8Array(buffer, offset + 30, view.getUint16(offset + 26, true))) !== name) throw Error('invalidDocx');
    total += size;
    if (size > 32 * 1024 * 1024 || total > 80 * 1024 * 1024 || size > Math.max(1024 * 1024, compressed * 300)) throw Error('documentTooLarge');
    names.add(name); files.push({ start, compressed, size, method }); at = next;
  }
  if (at !== end || !names.has('[Content_Types].xml') || !names.has('word/document.xml') || names.has('word/vbaProject.bin')) throw Error('invalidDocx');
  return { entries: count, expandedBytes: total, files };
}

// Validate actual inflation in bounded streaming chunks before a third-party
// parser allocates entries. ZIP directory size claims alone are not trustworthy.
export async function validateDocxContent(buffer) {
  const { files } = inspectDocx(buffer);
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
        if (size > file.size) throw Error('invalidDocx');
      }
      if (size !== file.size) throw Error('invalidDocx');
    } finally { await reader.cancel().catch(() => {}); }
  }
}

export async function readDocumentResponse(response) {
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
  inspectDocx(bytes.buffer);
  return bytes.buffer;
}
