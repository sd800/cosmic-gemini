// Chrome's opaque extension sandbox cannot load a module worker through an
// origin redirect. Adapt only our pinned, self-contained PDF.js worker bundle
// to a classic worker; document data never supplies executable source or URLs.
export async function createPdfWorker(pdfjs, signal) {
  const source = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url);
  const response = await fetch(source, { signal });
  if (!response.ok) throw Error('PDF worker unavailable');
  const code = await response.text();
  signal.throwIfAborted();
  const footer = /export\{WorkerMessageHandler\};\s*$/;
  if (!footer.test(code)) throw Error('Unsupported PDF worker bundle');
  const classic = code.replace(footer, '').replaceAll('import.meta.url', JSON.stringify(source.href));
  const url = URL.createObjectURL(new Blob([classic], { type: 'text/javascript' }));
  let native, worker, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; signal.removeEventListener('abort', abort);
    native?.terminate(); URL.revokeObjectURL(url);
  };
  const abort = () => { if (worker) worker.destroy(); else dispose(); };
  try {
    native = new Worker(url);
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer); native.removeEventListener('message', ready);
        native.removeEventListener('error', failed); signal.removeEventListener('abort', cancelled);
        error ? reject(error) : resolve();
      };
      const ready = event => { if (event.data?.action === 'ready') finish(); };
      const failed = () => finish(Error('PDF worker startup failed'));
      const cancelled = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(() => finish(Error('PDF worker startup timed out')), 15000);
      native.addEventListener('message', ready); native.addEventListener('error', failed);
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled();
    });
    signal.throwIfAborted();
    worker = new pdfjs.PDFWorker({ port: native });
    // PDF.js does not own caller-supplied ports. Tie the native worker and blob
    // to its existing destroy lifecycle, including parse errors and page exit.
    const destroy = worker.destroy.bind(worker);
    worker.destroy = () => { try { destroy(); } finally { dispose(); } };
    signal.addEventListener('abort', abort, { once: true });
    await worker.promise;
    signal.throwIfAborted();
    return worker;
  } catch (error) { if (worker) worker.destroy(); else dispose(); throw error; }
}
