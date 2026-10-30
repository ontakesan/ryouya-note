// 地理院タイルの定義と、タイル座標・距離の計算
const BASE = 'https://cyberjapandata.gsi.go.jp/xyz';

export const LAYERS = {
  std:       { name: '標準地図', url: `${BASE}/std/{z}/{x}/{y}.png`,          min: 5, max: 18, kb: 18 },
  pale:      { name: '淡色地図', url: `${BASE}/pale/{z}/{x}/{y}.png`,         min: 5, max: 18, kb: 12 },
  photo:     { name: '航空写真', url: `${BASE}/seamlessphoto/{z}/{x}/{y}.jpg`, min: 2, max: 18, kb: 35 },
  hillshade: { name: '陰影起伏', url: `${BASE}/hillshademap/{z}/{x}/{y}.png`,  min: 2, max: 16, kb: 10 },
  dem:       { name: '標高データ', url: `${BASE}/dem_png/{z}/{x}/{y}.png`,     min: 14, max: 14, kb: 12 },
};

export const ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';

export const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);

export const lon2tile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2tile = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/** 範囲 {s,w,n,e} を覆うタイルを列挙する */
export function tilesInBounds(b, z) {
  const x0 = Math.floor(lon2tile(b.w, z)), x1 = Math.floor(lon2tile(b.e, z));
  const y0 = Math.floor(lat2tile(b.n, z)), y1 = Math.floor(lat2tile(b.s, z));
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

/** 2点間の距離(m) */
export function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtDist = m => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

/** 方位(度) */
export function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
  const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
export const dirName = deg => ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][Math.round(deg / 45) % 8];
