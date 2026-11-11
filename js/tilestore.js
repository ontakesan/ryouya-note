// 地図タイルの保存。
// ブラウザ版: Service Worker と Cache Storage(sw.js / offline.js が担当)
// アプリ版:   iPhone のアプリでは Service Worker が動かないので、IndexedDB に保存してここから出す
import { isNative } from './native.js';

const DB = 'ryouyaTiles', OFFLINE = 'offline', BROWSE = 'browse';
const BROWSE_MAX = 3000;
let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(OFFLINE);
      r.result.createObjectStore(BROWSE).createIndex('t', 't');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
function req(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const q = fn(t.objectStore(store));
    t.oncomplete = () => resolve(q?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// 保存した範囲の地図(offline)に入っているURLの一覧。起動時に一度だけ読み、
// 地図の画像ごとに保存庫を調べなくて済むようにする
let offlineKeys = null;
function loadOfflineKeys() {
  return req(OFFLINE, 'readonly', s => s.getAllKeys())
    .then(keys => { offlineKeys = new Set(keys); })
    .catch(() => { offlineKeys = new Set(); });
}
if (isNative) loadOfflineKeys();

export const tileStore = {
  async get(url) {
    const off = await req(OFFLINE, 'readonly', s => s.get(url));
    if (off) return off;
    const b = await req(BROWSE, 'readonly', s => s.get(url));
    return b?.blob || null;
  },
  hasOffline: url => req(OFFLINE, 'readonly', s => s.count(url)).then(n => n > 0),
  putOffline: (url, blob) => req(OFFLINE, 'readwrite', s => s.put(blob, url)).then(() => offlineKeys?.add(url)),
  delOffline: url => req(OFFLINE, 'readwrite', s => s.delete(url)).then(() => offlineKeys?.delete(url)),
  async putBrowse(url, blob) {
    await req(BROWSE, 'readwrite', s => s.put({ blob, t: Date.now() }, url));
    if (++puts % 100 === 0) trimBrowse();
  },
};
let puts = 0;
async function trimBrowse() {
  const n = await req(BROWSE, 'readonly', s => s.count());
  if (n <= BROWSE_MAX) return;
  let extra = n - BROWSE_MAX;
  await req(BROWSE, 'readwrite', s => {
    const cur = s.index('t').openCursor(); // 古い順に消す
    cur.onsuccess = () => { const c = cur.result; if (c && extra-- > 0) { c.delete(); c.continue(); } };
    return cur;
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** 地理院の混雑(503)や圏外に備えて、待って最大3回取り直す */
export async function fetchRetry(url, signal) {
  let last = null;
  for (const wait of [0, 500, 1500, 3500]) {
    if (wait) await sleep(wait + Math.random() * 300);
    try {
      const res = await fetch(url, { mode: 'cors', signal });
      if (res.ok || res.status === 404) return res;
      last = res;
      if (res.status < 500 && res.status !== 429) return res;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = null;
    }
  }
  return last || new Response('', { status: 504 });
}

/**
 * タイル画像を取る。アプリ版は端末の保存分を優先し、なければ取りに行って保存する。
 * ブラウザ版はそのまま fetch(Service Worker が保存を担当)。404 などは null
 */
export async function getTileBlob(url) {
  if (!isNative) {
    const res = await fetch(url, { mode: 'cors' });
    return res.ok ? res.blob() : null;
  }
  const hit = await tileStore.get(url).catch(() => null);
  if (hit) return hit;
  const res = await fetchRetry(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  tileStore.putBrowse(url, blob).catch(() => {});
  return blob;
}

/**
 * アプリ版で使う Leaflet のタイルレイヤー。
 * ふだんは iPhone の画像読み込みにそのまま任せる(速い)。
 * 保存した範囲の画像と、圏外などで読めなかった画像だけ、端末の保存庫から出す
 */
export function cachedTileLayer(url, opts) {
  if (!isNative) return L.tileLayer(url, opts);
  const Layer = L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      const src = this.getTileUrl(coords);
      const fromStore = () => tileStore.get(src).then(blob => {
        if (!blob) { done(new Error('no tile'), img); return; }
        const obj = URL.createObjectURL(blob);
        img.onload = () => { URL.revokeObjectURL(obj); done(null, img); };
        img.onerror = () => { URL.revokeObjectURL(obj); done(new Error('bad tile'), img); };
        img.src = obj;
      }).catch(err => done(err, img));
      if (offlineKeys?.has(src)) { fromStore(); return img; }
      img.onload = () => done(null, img);
      img.onerror = () => { img.onload = img.onerror = null; fromStore(); };
      img.src = src;
      return img;
    },
  });
  return new Layer(url, opts);
}
