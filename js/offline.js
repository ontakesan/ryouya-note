// 範囲を指定して地理院タイルを端末に保存する
import { LAYERS, tilesInBounds, tileUrl } from './geo.js';
import { isNative } from './native.js';
import { tileStore, fetchRetry } from './tilestore.js';

export const OFFLINE_CACHE = 'b-tiles-offline-v1';
const LEGACY_CACHES = ['tiles-offline-v1']; // A版で保存した地図
export const MAX_TILES_PER_AREA = 6000;
const LOW_ZOOM = 10; // 周辺の見通し用に、ここから上を保存

/** 範囲・レイヤー・最大ズームから保存するURLの一覧を作る */
export function planArea(bounds, layerKeys, maxZoom) {
  const urls = [];
  let kb = 0;
  for (const key of layerKeys) {
    const L = LAYERS[key];
    const zFrom = key === 'dem' ? 14 : Math.max(L.min, LOW_ZOOM);
    const zTo = key === 'dem' ? 14 : Math.min(L.max, maxZoom);
    for (let z = zFrom; z <= zTo; z++) {
      for (const [tz, x, y] of tilesInBounds(bounds, z)) {
        urls.push(tileUrl(L.url, tz, x, y));
        kb += L.kb;
      }
    }
  }
  return { urls, mb: kb / 1024 };
}

/** 保存を実行。signal で中止できる。地理院への負荷を抑えるため同時4本まで
 *  ブラウザ版は Cache Storage、アプリ版(iPhone)は IndexedDB に保存する */
export async function downloadUrls(urls, { onProgress, signal } = {}) {
  const cache = isNative ? null : await caches.open(OFFLINE_CACHE);
  const has = isNative ? u => tileStore.hasOffline(u) : u => cache.match(u).then(Boolean);
  const put = isNative ? (u, res) => res.blob().then(b => tileStore.putOffline(u, b)) : (u, res) => cache.put(u, res);
  let done = 0, failed = 0, i = 0;
  async function worker() {
    while (i < urls.length) {
      if (signal?.aborted) return;
      const url = urls[i++];
      try {
        if (!(await has(url))) {
          const res = await fetchRetry(url, signal);
          if (res.ok) await put(url, res);
          else if (res.status !== 404) failed++; // 404は海域など、タイルが存在しない場所
        }
      } catch (e) {
        if (signal?.aborted) return;
        failed++;
      }
      done++;
      onProgress?.(done, urls.length, failed);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { done, failed, aborted: !!signal?.aborted };
}

export async function deleteUrls(urls) {
  if (isNative) { for (const u of urls) await tileStore.delOffline(u); return; }
  for (const name of [OFFLINE_CACHE, ...LEGACY_CACHES]) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    for (const u of urls) await cache.delete(u);
  }
}

export async function storageInfo() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usageMB: usage / 1048576, quotaMB: quota / 1048576 };
}

/** ブラウザに勝手に消されないよう永続化を頼む(許可されるかはブラウザ次第) */
export async function askPersist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
