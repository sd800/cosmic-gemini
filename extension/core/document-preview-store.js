let connection;
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('cosmic-gemini-document-preview', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { connection = null; throw error; });
  return connection;
}
async function run(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', mode);
    const request = operation(tx.objectStore('documents'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Document storage unavailable.'));
  });
}
export const documentStore = Object.freeze({
  exists: async () => (await indexedDB.databases()).some(db => db.name === 'cosmic-gemini-document-preview'),
  get: id => run('readonly', store => store.get(id)),
  all: () => run('readonly', store => store.getAll()),
  put: value => run('readwrite', store => store.put(value)),
  remove: id => run('readwrite', store => store.delete(id))
});
