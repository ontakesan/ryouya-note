// 範囲を指定して地理院タイルを端末に保存する
import { LAYERS, tilesInBounds, tileUrl } from './geo.js';

export const OFFLINE_CACHE = 'tiles-offline-v1';
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

/** 保存を実行。signal で中止できる。地理院への負荷を抑えるため同時4本まで */
export async function downloadUrls(urls, { onProgress, signal } = {}) {
  const cache = await caches.open(OFFLINE_CACHE);
  let done = 0, failed = 0, i = 0;
  async function worker() {
    while (i < urls.length) {
      if (signal?.aborted) return;
      const url = urls[i++];
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'cors', signal });
          if (res.ok) await cache.put(url, res);
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
  const cache = await caches.open(OFFLINE_CACHE);
  for (const u of urls) await cache.delete(u);
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
