// These functions are serialized into the source tab's isolated world so the
// browser enforces the page's origin, CORS, and mixed-content rules on the read.
export async function readPageVideoResponse(pageUrl, url, method, id) {
  if (location.href !== pageUrl) return null;
  const key = Symbol.for('cosmic-gemini.video-download.probes');
  const requests = globalThis[key] ??= new Map();
  const controller = new AbortController();
  requests.set(id, controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
  try {
    const response = await fetch(url, { method, mode: 'cors', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal });
    if (method === 'HEAD') return { ok: response.ok, status: response.status, headers: [...response.headers] };
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes = 0, text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { text: text + decoder.decode() };
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    requests.delete(id);
    if (!requests.size) delete globalThis[key];
  }
}

export function abortPageVideoResponse(id) {
  globalThis[Symbol.for('cosmic-gemini.video-download.probes')]?.get(id)?.abort();
}
