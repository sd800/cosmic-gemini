// Offscreen processors accept work only from Central, never from a workspace
// or content script. Products must authorize requests before forwarding them.
export function isProcessorSender(sender, runtime) {
  return sender?.id === runtime.id && sender.url === runtime.getURL('background/central.js');
}

export async function readBoundedBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw Error('Media exceeds the processing size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Media response is empty.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error('Media exceeds the processing size limit.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
