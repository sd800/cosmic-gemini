import { DOCUMENT_LIMIT, DOCUMENT_TYPES, DOCUMENT_LOCAL_CHANNEL, documentFormat } from '../core/document-preview/document-preview.js';
import { send } from '../shared/ui.js';

// Browser-selected bytes only: no path, upload, file:// access or new permission.
export function bindDocumentOpen(container, translate, isCurrent) {
  const button = container.querySelector('button');
  const input = container.querySelector('input');
  const status = container.closest('.card').querySelector('.document-open-message');
  input.accept = Object.keys(DOCUMENT_TYPES).map(format => '.' + format).join(',');
  button.addEventListener('click', () => {
    if (button.disabled || !isCurrent()) return;
    status.textContent = '';
    input.value = '';
    input.click();
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || button.disabled || !isCurrent()) return;
    const t = translate();
    if (!documentFormat(file.name)) { status.textContent = t('documentLocalUnsupported'); return; }
    if (!file.size || file.size > DOCUMENT_LIMIT) { status.textContent = t('documentLocalSize'); return; }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const id = crypto.randomUUID();
    const channel = new BroadcastChannel(DOCUMENT_LOCAL_CHANNEL + id);
    // Structured-clone the browser File reference, not an ArrayBuffer/base64
    // copy. The receiver reads the selected local file; Central sees no bytes.
    let timer, finish;
    const received = new Promise((resolve, reject) => {
      finish = reject;
      timer = setTimeout(() => reject(Error('Local preview unavailable.')), 15000);
      channel.onmessage = ({data}) => {
        if (data?.type === 'ready') channel.postMessage({type:'file',file});
        if (data?.type === 'accepted') resolve();
      };
    });
    // Register rejection handling before opening the new tab.
    received.catch(() => {});
    const departed = () => finish(Error('Settings closed.'));
    addEventListener('pagehide', departed, { once: true });
    try {
      await send({ type: 'UI_DOCUMENT_OPEN_LOCAL', featureId: 'documentPreview', id, filename:file.name, size:file.size });
      await received;
      if (isCurrent()) status.textContent = '';
    } catch (error) {
      if (isCurrent()) status.textContent = translate()('documentLocalFailed');
    } finally {
      clearTimeout(timer); channel.close(); removeEventListener('pagehide', departed);
      button.disabled = false; button.removeAttribute('aria-busy');
    }
  });
}
