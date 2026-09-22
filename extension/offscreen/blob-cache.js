// Memory only: neither document bytes nor blob URLs are written to disk.
// Browser shutdown destroys this context and all of its cached document data.
const records = new Map();
const uploads = new Map();
const LIMIT = 64 * 1024 * 1024;
function discardUpload(id) { clearTimeout(uploads.get(id)?.timer); uploads.delete(id); }
const used = () => [...records.values()].reduce((n, value) => n + value.size, 0) + [...uploads.values()].reduce((n, value) => n + value.expected, 0);
export function hasBlobs() { return records.size > 0 || uploads.size > 0; }
export function blobCommand(message) {
  const { operation, id } = message;
  if (operation === 'all') return [...records.values()];
  if (operation === 'get') return records.get(id) || null;
  if (operation === 'remove') {
    const existing = records.get(id);
    if (existing) URL.revokeObjectURL(existing.blobUrl);
    records.delete(id); discardUpload(id); return true;
  }
  if (operation === 'begin') {
    if (!id || !Number.isSafeInteger(message.size) || message.size <= 0 || message.size > 24 * 1024 * 1024
      || uploads.has(id) || records.has(id) || used() + message.size > LIMIT || records.size + uploads.size >= 24) throw Error('documentCacheFull');
    // A stopped service worker must not strand partially transferred bytes.
    const timer = setTimeout(() => discardUpload(id), 60000);
    timer.unref?.();
    uploads.set(id, { expected: message.size, type: message.mime, received: 0, chunks: [], metadata: message.metadata, timer });
    return true;
  }
  const upload = uploads.get(id);
  if (!upload) throw Error('documentExpired');
  if (operation === 'chunk') {
    try {
      if (message.offset !== upload.received || typeof message.data !== 'string' || !message.data.length
        || message.data.length > 1398104 || message.data.length % 4 !== 0) throw Error('invalidDocument');
      const raw = atob(message.data);
      if (btoa(raw) !== message.data || raw.length > 1024 * 1024 || upload.received + raw.length > upload.expected) throw Error('invalidDocument');
      const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
      upload.chunks.push(bytes); upload.received += bytes.length; return true;
    } catch (error) { discardUpload(id); throw error; }
  }
  if (operation === 'finish') {
    if (upload.received !== upload.expected) throw Error('invalidDocument');
    const blob = new Blob(upload.chunks, { type: upload.type });
    const record = { ...upload.metadata, id, size: blob.size, blobUrl: URL.createObjectURL(blob) };
    records.set(id, record); discardUpload(id); return record;
  }
  throw Error('Unknown cache operation.');
}
