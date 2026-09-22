import { withOffscreen } from './offscreen-host.js';
const request = async payload => {
  const response = await chrome.runtime.sendMessage({ target: 'ephemeral-blob-cache', ...payload });
  if (!response?.ok) throw Error(response?.error || 'Document cache unavailable.');
  return response.result;
};
export const documentStore = Object.freeze({
  exists: async () => (await withOffscreen(() => request({ operation: 'all' }), false))?.length > 0,
  get: id => withOffscreen(() => request({ operation: 'get', id }), false),
  all: async () => (await withOffscreen(() => request({ operation: 'all' }), false)) || [],
  async put(value) {
    return withOffscreen(async () => {
      const { blob, ...metadata } = value;
      await request({ operation: 'begin', id: value.id, size: blob.size, mime: blob.type, metadata });
      try {
        for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
          const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
          let raw = '';
          for (let at = 0; at < bytes.length; at += 8192) raw += String.fromCharCode(...bytes.subarray(at, at + 8192));
          await request({ operation: 'chunk', id: value.id, data: btoa(raw) });
        }
        return await request({ operation: 'finish', id: value.id });
      } catch (error) { await request({ operation: 'remove', id: value.id }).catch(() => {}); throw error; }
    });
  },
  remove: id => withOffscreen(() => request({ operation: 'remove', id }), false)
});
