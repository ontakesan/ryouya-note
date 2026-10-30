// ハンターマップ(県が配る画像)を地図に重ねる仕組みと、区域(保護区など)の判定
import { LAYERS, ATTRIBUTION } from './geo.js';

/* ---------------------------------------------------------
   区域の種類と、何が禁止されるか
   --------------------------------------------------------- */
export const ZONE_TYPES = {
  hogo:       { name: '鳥獣保護区',   color: '#c0392b', ban: { gun: true,  trap: true  }, rule: '狩猟禁止' },
  tokubetsu:  { name: '特別保護地区', color: '#7b1fa2', ban: { gun: true,  trap: true  }, rule: '狩猟禁止' },
  kyuryo:     { name: '休猟区',       color: '#6a1b9a', ban: { gun: true,  trap: true  }, rule: '狩猟禁止(特例休猟区は対象獣のみ可)' },
  jukinshi:   { name: '銃猟禁止区域', color: '#e8590c', ban: { gun: true,  trap: false }, rule: '銃の使用禁止・わなは可' },
  wanakinshi: { name: 'わな猟禁止区域', color: '#8a5a2b', ban: { gun: false, trap: true  }, rule: 'わなの使用禁止' },
  chui:       { name: 'その他・注意', color: '#2b6cb0', ban: { gun: false, trap: false }, rule: '注意' },
};

/* ---------------------------------------------------------
   画像 → 地図 の対応(アフィン変換)
   画像のピクセル(u,v) を、ズーム Z0 の世界ピクセル(x,y) に写す
   x = a*u + c*v + e,  y = b*u + d*v + f
   --------------------------------------------------------- */
export const Z0 = 18;
const world = (lat, lng) => L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lng), Z0);

function solve3(A, b) {
  // 3x3 の連立方程式をガウスの消去法で解く
  const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
    [m[i], m[p]] = [m[p], m[i]];
    if (Math.abs(m[i][i]) < 1e-12) return null;
    for (let k = 0; k < 3; k++) if (k !== i) {
      const f = m[k][i] / m[i][i];
      for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** 対応点(3点以上)から変換を求める。4点以上なら最小二乗で、誤差(m)も返す */
export function solveAffine(pairs) {
  if (pairs.length < 3) return null;
  const P = pairs.map(p => ({ u: p.u, v: p.v, ...world(p.lat, p.lng) }));
  const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const p of P) {
    const r = [p.u, p.v, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) N[i][j] += r[i] * r[j];
      bx[i] += r[i] * p.x; by[i] += r[i] * p.y;
    }
  }
  const sx = solve3(N, bx), sy = solve3(N, by);
  if (!sx || !sy) return null; // 3点が一直線に並んでいるなど
  const M = [sx[0], sy[0], sx[1], sy[1], sx[2], sy[2]]; // [a,b,c,d,e,f]
  // 誤差: 世界ピクセル → m
  const lat0 = pairs.reduce((s, p) => s + p.lat, 0) / pairs.length;
  const mPerPx = 156543.03392 * Math.cos((lat0 * Math.PI) / 180) / 2 ** Z0;
  const res = P.map(p => {
    const x = M[0] * p.u + M[2] * p.v + M[4], y = M[1] * p.u + M[3] * p.v + M[5];
    return Math.hypot(x - p.x, y - p.y) * mPerPx;
  });
  const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length);
  return { M, rms, residuals: res };
}

/** 位置合わせ済みの画像を地図に重ねるレイヤー */
export function geoImageLayer(url, w, h, M, opacity = 0.6) {
  const Layer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      if (!map.getPane('hmap')) {
        const p = map.createPane('hmap');
        p.style.zIndex = 350; // 地図の上、記録やGPSの下
        p.style.pointerEvents = 'none';
      }
      const img = (this._img = L.DomUtil.create('img', 'geoimg leaflet-zoom-hide', map.getPane('hmap')));
      img.src = url; img.width = w; img.height = h; img.alt = '';
      img.style.opacity = opacity;
      map.on('zoomend viewreset', this._update, this);
      this._update();
    },
    onRemove(map) {
      this._img.remove();
      map.off('zoomend viewreset', this._update, this);
    },
    setOpacity(o) { opacity = o; if (this._img) this._img.style.opacity = o; },
    _update() {
      const map = this._map, s = 2 ** (map.getZoom() - Z0), o = map.getPixelOrigin();
      const [a, b, c, d, e, f] = M;
      this._img.style.transform = `matrix(${a * s},${b * s},${c * s},${d * s},${e * s - o.x},${f * s - o.y})`;
    },
  });
  return new Layer();
}

/** 取り込んだ画像を、スマホで扱える大きさ(長辺4000px)に縮めて JPEG にする */
export async function shrinkImage(file, maxSide = 4000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  return { blob, w, h };
}

/* ---------------------------------------------------------
   位置合わせ画面: 上にハンターマップ、下に地図。
   それぞれ動かして十字を同じ場所に合わせ、「この点を合わせる」
   --------------------------------------------------------- */
export function openCalibrator({ url, w, h, pairs: initial = [], center, title, onDone }) {
  const pairs = initial.map(p => ({ ...p }));
  const root = document.createElement('div');
  root.className = 'calib';
  root.innerHTML = `
    <div class="calib-head">
      <div class="grow"><b>位置合わせ</b><span class="note">${title ? ' ・ ' + title.replace(/[<>&]/g, '') : ''}</span></div>
      <button class="btn ghost" data-c="cancel">やめる</button>
      <button class="btn primary" data-c="done" disabled>完成</button>
    </div>
    <p class="calib-help">上と下で<b>同じ場所</b>(交差点・橋・山頂・海岸の角など)を十字に合わせて「この点を合わせる」。<b>離れた3か所以上</b>で行います。4か所以上だと誤差がわかります。</p>
    <div class="calib-panes">
      <div class="cpane"><div class="cmap" data-m="img"></div><div class="cx" aria-hidden="true"></div><span class="ctag">ハンターマップ</span></div>
      <div class="cpane"><div class="cmap" data-m="map"></div><div class="cx" aria-hidden="true"></div><span class="ctag">地図</span></div>
    </div>
    <div class="calib-foot">
      <button class="btn" data-c="undo">1つ戻す</button>
      <span class="mono note grow" data-c="status"></span>
      <button class="btn primary big" data-c="add">この点を合わせる</button>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('calibrating');

  const im = L.map(root.querySelector('[data-m=img]'), {
    crs: L.CRS.Simple, minZoom: -6, maxZoom: 3, zoomSnap: 0.25, zoomControl: false, attributionControl: false,
    inertia: false, // 指を離した後に滑ると、十字の位置がずれて合わせにくい
  });
  const imgBounds = [[0, 0], [-h, w]]; // Simple座標では緯度= -v, 経度= u として扱う
  L.imageOverlay(url, imgBounds).addTo(im);
  im.setMaxBounds(L.latLngBounds(imgBounds).pad(0.15)); // 画像を見失わないように
  im.fitBounds(imgBounds);

  const mm = L.map(root.querySelector('[data-m=map]'), { zoomControl: false, attributionControl: true, maxZoom: 18, inertia: false }).setView(center, 13);
  mm.attributionControl.setPrefix(false);
  L.tileLayer(LAYERS.std.url, { maxZoom: 18, maxNativeZoom: 18, crossOrigin: 'anonymous', attribution: ATTRIBUTION }).addTo(mm);

  const marksImg = L.layerGroup().addTo(im), marksMap = L.layerGroup().addTo(mm);
  const $ = s => root.querySelector(`[data-c=${s}]`);

  function redraw() {
    marksImg.clearLayers(); marksMap.clearLayers();
    pairs.forEach((p, i) => {
      const icon = L.divIcon({ className: 'cmark', html: `<span>${i + 1}</span>`, iconSize: [24, 24] });
      L.marker([-p.v, p.u], { icon, interactive: false }).addTo(marksImg);
      L.marker([p.lat, p.lng], { icon, interactive: false }).addTo(marksMap);
    });
    const sol = solveAffine(pairs);
    let msg = `${pairs.length}点`;
    if (pairs.length < 3) msg += ` ・ あと${3 - pairs.length}点`;
    else if (!sol) msg += ' ・ 点が一直線に並んでいます。離れた場所を足してください';
    else if (pairs.length === 3) msg += ' ・ 完成できます(4点目で誤差を確認できます)';
    else msg += ` ・ 誤差 約${Math.round(sol.rms)}m`;
    $('status').textContent = msg;
    $('done').disabled = !sol;
    $('undo').disabled = !pairs.length;
  }

  // 3点以上合わせたら、ハンターマップを動かすと下の地図も同じ場所へついていく
  im.on('moveend', () => {
    const sol = solveAffine(pairs);
    if (!sol || !follow) return;
    const c = im.getCenter(), u = c.lng, v = -c.lat;
    const [a, b, cc, d, e, f] = sol.M;
    const pt = L.point(a * u + cc * v + e, b * u + d * v + f);
    mm.setView(L.CRS.EPSG3857.pointToLatLng(pt, Z0), mm.getZoom(), { animate: false });
  });
  let follow = true;
  mm.on('dragstart', () => (follow = false));
  im.on('dragstart', () => (follow = true));

  function close() {
    im.remove(); mm.remove(); root.remove();
    document.body.classList.remove('calibrating');
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b || b.disabled) return;
    const c = b.dataset.c;
    if (c === 'add') {
      const ic = im.getCenter(), u = ic.lng, v = -ic.lat;
      if (u < 0 || v < 0 || u > w || v > h) { $('status').textContent = '十字がハンターマップの外にあります'; return; }
      const g = mm.getCenter();
      pairs.push({ u, v, lat: g.lat, lng: g.lng });
      navigator.vibrate?.(20);
      redraw();
    } else if (c === 'undo') { pairs.pop(); redraw(); }
    else if (c === 'cancel') close();
    else if (c === 'done') {
      const sol = solveAffine(pairs);
      close();
      onDone?.({ pairs, ...sol });
    }
  });
  setTimeout(() => { im.invalidateSize(); mm.invalidateSize(); im.fitBounds(imgBounds); }, 60);
  redraw();
}

/* ---------------------------------------------------------
   区域の判定
   --------------------------------------------------------- */
/** 点が多角形の中か(座標は [lat,lng]) */
export function inPolygon([y, x], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 点から多角形の境界までの最短距離(m) */
export function distToEdge([lat, lng], poly) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const P = poly.map(([la, ln]) => [(ln - lng) * kx, (la - lat) * ky]); // 点を原点とした平面座標
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [x1, y1] = P[j], [x2, y2] = P[i];
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy));
  }
  return best;
}

/** 点に関係する区域: 中にいる区域と、近い(既定150m以内)区域 */
export function zonesAt(pt, zones, nearM = 150) {
  const inside = [], near = [];
  for (const z of zones) {
    if (z.coords.length < 3) continue;
    if (inPolygon(pt, z.coords)) inside.push(z);
    else {
      const d = distToEdge(pt, z.coords);
      if (d <= nearM) near.push({ zone: z, d });
    }
  }
  near.sort((a, b) => a.d - b.d);
  return { inside, near };
}
