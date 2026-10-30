// ハンターマップ画像のように大きなデータは localStorage に入らないので IndexedDB に保存する
const DB = 'ryouyaB', STORE = 'images';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const putImage = (id, blob) => run('readwrite', s => s.put(blob, id));
export const getImage = id => run('readonly', s => s.get(id));
export const delImage = id => run('readwrite', s => s.delete(id));
