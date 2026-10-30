// 地理院の標高タイル(dem_png, z14 ≒ 10mメッシュ)から標高を読む。
// タイルはService Workerのキャッシュ経由で取れるので、ダウンロード済みの範囲ならオフラインでも動く。
import { LAYERS, tileUrl, lon2tile, lat2tile } from './geo.js';

const Z = 14;
const tiles = new Map(); // "x/y" -> Promise<Uint8ClampedArray|null>
const MAX_TILES = 40;

async function loadTile(x, y) {
  try {
    const res = await fetch(tileUrl(LAYERS.dem.url, Z, x, y), { mode: 'cors' });
    if (!res.ok) return null; // 海域などはタイルが無い
    const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, 256, 256).data;
  } catch {
    return null;
  }
}

/** 標高(m)。取得できなければ null */
export async function elevationAt(lat, lng) {
  const fx = lon2tile(lng, Z), fy = lat2tile(lat, Z);
  const x = Math.floor(fx), y = Math.floor(fy);
  const key = `${x}/${y}`;
  if (!tiles.has(key)) {
    if (tiles.size >= MAX_TILES) tiles.delete(tiles.keys().next().value);
    tiles.set(key, loadTile(x, y));
  }
  const d = await tiles.get(key);
  if (!d) { tiles.delete(key); return null; }
  const px = Math.min(255, Math.floor((fx - x) * 256)), py = Math.min(255, Math.floor((fy - y) * 256));
  const i = (py * 256 + px) * 4;
  const v = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
  if (v === 8388608) return null; // 無効値
  return (v < 8388608 ? v : v - 16777216) * 0.01;
}
