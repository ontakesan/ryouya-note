// 熊本県 鳥獣保護区等位置図(令和7年度版 JPG)の自動位置合わせ用データ
//
// 県の地図には標準地域メッシュ(5倍メッシュ: 経度3.75分 × 緯度2.5分)の格子線が引かれ、
// マスごとに「4930033」のような番号が振られている。格子線はちょうどその緯度経度の線なので、
// 画像の中の格子線の位置(VX: 縦線のx, HY: 横線のy)と、基準にしたマスの番号(ref)から、
// すべての交点の緯度経度がわかる。そこから地図に重ねるための変換を求める。
//
// ref = [基準マスの番号, そのマスの左の縦線が VX の何番目か, 下の横線が HY の何番目か]
// angV / angH は格子線のわずかな傾き(度)。
// 画像そのものは県の著作物なので、このアプリには含めない。利用者が県のサイトから保存して取り込む。

export const SOURCE_PAGE = 'https://www.pref.kumamoto.jp/soshiki/52/249903.html';
const BASE = 'https://www.pref.kumamoto.jp/uploaded/attachment/';

export const SHEETS = [
  { id: '294097', title: 'P3-4 荒尾・玉名・山鹿・菊池・熊本市周辺', w: 4677, h: 3307, bytes: 5503069,
    sha256: '8d913094470bf89c557491b040de484e5c6aa4ff2e86eb4043e684dab136a253',
    angV: 0.2, angH: 0.1, VX: [513, 973, 1432, 1889, 2351, 2810, 3269, 3729, 4189], HY: [212, 576, 939, 1303, 1667, 2031, 2394, 2758, 3121], ref: ['4930541', 1, 2] },
  { id: '294099', title: 'P5-6 阿蘇・阿蘇郡・菊池周辺', w: 4677, h: 3307, bytes: 5302975,
    sha256: 'fd00f6b08030d0b65337e83c40f58302b42ce4cec83b8d1c1b956f11b68f8569',
    angV: 0.38, angH: 0.3, VX: [141, 601, 1060, 1518, 1977, 2437, 2896, 3355, 3815, 4275], HY: [211, 574, 938, 1302, 1666, 2030, 2393, 2757, 3121], ref: ['4930571', 2, 2] },
  { id: '294101', title: 'P7-8 熊本市・上益城・下益城・八代周辺', w: 4677, h: 3307, bytes: 4981112,
    sha256: '7fe1d37590d65c39d573d3cc2a2ea1fc6fa5b6282a6b1513df69082bbd9a28b6',
    angV: 0.04, angH: 0.08, VX: [89, 551, 1013, 1474, 1936, 2398, 2860, 3322, 3780, 4245], HY: [336, 699, 1063, 1427, 1790, 2154, 2518, 2882], ref: ['4930033', 0, 2] },
  { id: '261508', title: 'P9-10 上益城・下益城・八代周辺', w: 7018, h: 4963, bytes: 6586481,
    sha256: '25ec981d1c009afb0a8baeca407d6a2f6277a8933974a773f480c89eaf3bdb1c',
    angV: 0.36, angH: 0.26, VX: [916, 1605, 2292, 2989, 3681, 4373, 5066, 5758, 6449], HY: [502, 1047, 1594, 2139, 2685, 3231, 3776, 4323], ref: ['4930073', 1, 2] },
  { id: '294108', title: 'P11-12 上天草・天草北部', w: 4677, h: 3307, bytes: 3024242,
    sha256: 'bf64a7a59c946d595352c0c871bc011260297b55036b84cc969ce15abd023bdd',
    angV: -0.08, angH: -0.14, VX: [497, 959, 1422, 1883, 2344, 2806, 3269, 3731, 4193], HY: [325, 688, 1052, 1416, 1779, 2143, 2507, 2870], ref: ['4830721', 4, 2] },
  { id: '294106', title: 'P13-14 天草南部・水俣・葦北', w: 4677, h: 3307, bytes: 3507014,
    sha256: '7930f02d9c70e22918e807b6bcb751136178a850bdd2054c5b98b126c6f7b484',
    angV: -0.2, angH: -0.18, VX: [508, 972, 1436, 1899, 2362, 2826, 3289, 3751, 4220], HY: [368, 732, 1095, 1459, 1823, 2186, 2550, 2914], ref: ['4830421', 4, 2] },
  { id: '294103', title: 'P15-16 八代・葦北・球磨・人吉', w: 4677, h: 3307, bytes: 5986255,
    sha256: '7d7297dec87efd958be8ff15f58022ad71bbaa5ba08e15ba978b913769dc54b6',
    angV: 0.08, angH: 0.14, VX: [439, 902, 1366, 1829, 2292, 2757, 3220, 3681, 4145], HY: [96, 460, 824, 1188, 1551, 1915, 2278, 2642, 3006], ref: ['4830462', 4, 3] },
].map(s => ({ ...s, url: `${BASE}${s.id}.jpg` }));

/** 5倍メッシュ番号(7桁) → そのマスの南西の角の緯度経度 */
export function meshSW(code) {
  const s = String(code);
  const p = +s.slice(0, 2), u = +s.slice(2, 4), q = +s[4], v = +s[5], m = +s[6];
  return {
    lat: p / 1.5 + (q * 5) / 60 + (m === 3 || m === 4 ? 2.5 / 60 : 0),
    lng: 100 + u + (v * 7.5) / 60 + (m === 2 || m === 4 ? 3.75 / 60 : 0),
  };
}

/** 格子線の位置から、交点ごとの「画像の位置 ↔ 緯度経度」の組を作る。k は画像を縮めた倍率 */
export function gridPairs({ VX, HY, angV, angH, ref }, k = 1) {
  const [code, ci, rj] = ref;
  const sw = meshSW(code);
  const tv = Math.tan((angV * Math.PI) / 180), th = Math.tan((angH * Math.PI) / 180);
  const pairs = [];
  VX.forEach((x0, i) => HY.forEach((y0, j) => {
    // 縦線 x = x0 + y*tv と 横線 y = y0 - x*th の交点
    const y = (y0 - x0 * th) / (1 + tv * th), x = x0 + y * tv;
    pairs.push({ u: x * k, v: y * k, lat: sw.lat + ((rj - j) * 2.5) / 60, lng: sw.lng + ((i - ci) * 3.75) / 60 });
  }));
  return pairs;
}

export async function sha256(blob) {
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 取り込んだファイルが、どの図葉か(完全に同じファイル → ファイル名の番号 の順で探す) */
export async function identify(file) {
  const bySize = SHEETS.filter(s => s.bytes === file.size);
  if (bySize.length) {
    const h = await sha256(file);
    const hit = bySize.find(s => s.sha256 === h);
    if (hit) return { sheet: hit, how: 'exact' };
  }
  const byName = SHEETS.find(s => file.name.includes(s.id));
  if (byName) return { sheet: byName, how: 'name' };
  return null;
}

/* ---------------------------------------------------------
   新しい年度の地図など、ファイルが違うとき用:
   画像の中の格子線を探し直して、図葉の格子に合わせる
   --------------------------------------------------------- */
function detectLines(data, W, H) {
  const lum = new Uint8ClampedArray(W * H), gray = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    lum[p] = (r + g + b) / 3;
    gray[p] = Math.max(r, g, b) - Math.min(r, g, b) < 30 && lum[p] > 90 && lum[p] < 190 ? 1 : 0;
  }
  const out = {};
  for (const dir of ['v', 'h']) {
    const xs = [], ys = [];
    const step = dir === 'v' ? 1 : W;
    for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
      const p = y * W + x;
      if (!gray[p]) continue;
      const l = lum[p];
      if (lum[p - 4 * step] - l > 30 && lum[p + 4 * step] - l > 30) { xs.push(x); ys.push(y); }
    }
    let best = null;
    for (let ang = -1; ang <= 1.0001; ang += 0.04) {
      const t = Math.tan((ang * Math.PI) / 180), L = (dir === 'v' ? W : H) + 400, bins = new Int32Array(L);
      for (let k = 0; k < xs.length; k++) {
        const q = dir === 'v' ? xs[k] - ys[k] * t : ys[k] + xs[k] * t;
        const bi = Math.round(q) + 200;
        if (bi >= 0 && bi < L) bins[bi]++;
      }
      const span = dir === 'v' ? H : W, pk = [];
      for (let i = 1; i < L - 1; i++) {
        const s = bins[i - 1] + bins[i] + bins[i + 1];
        if (s > span * 0.2 && bins[i] >= bins[i - 1] && bins[i] > bins[i + 1]) pk.push([i - 200, s]);
      }
      const sc = pk.reduce((s, p) => s + p[1] * p[1], 0);
      if (!best || sc > best.sc) best = { ang, pk, sc };
    }
    const m = [];
    for (const p of best.pk) {
      const q = m.find(z => Math.abs(z[0] - p[0]) < 6);
      if (q) { if (p[1] > q[1]) { q[0] = p[0]; q[1] = p[1]; } } else m.push([...p]);
    }
    out[dir] = { angle: best.ang, lines: m.map(p => p[0]) };
  }
  return out;
}

/**
 * 縮めた画像(canvas)の格子線を探し、図葉の格子(縮尺 k)と対応づける。
 * 地図のレイアウトが少しずれていても(半マス未満)合わせられる。うまくいかなければ null
 */
export function refineGrid(canvas, sheet, k) {
  const W = canvas.width, H = canvas.height;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const det = detectLines(data, W, H);
  const match = (expected, found, spacing) => {
    let bestOff = 0, bestN = -1;
    for (let off = -spacing / 2; off <= spacing / 2; off += 1) {
      const n = expected.filter(e => found.some(f => Math.abs(f - (e + off)) <= 4)).length;
      if (n > bestN) { bestN = n; bestOff = off; }
    }
    return expected.map(e => found.reduce((b, f) => (Math.abs(f - (e + bestOff)) <= 4 && (b == null || Math.abs(f - e - bestOff) < Math.abs(b - e - bestOff)) ? f : b), null));
  };
  const ex = sheet.VX.map(x => x * k), ey = sheet.HY.map(y => y * k);
  const mx = match(ex, det.v.lines, (sheet.VX[1] - sheet.VX[0]) * k);
  const my = match(ey, det.h.lines, (sheet.HY[1] - sheet.HY[0]) * k);
  // 見つかった線だけ使う(番号の対応は保つ)
  const VX = [], HY = [];
  let ci = null, rj = null;
  mx.forEach((x, i) => { if (x != null) { if (i === sheet.ref[1]) ci = VX.length; VX.push({ x, i }); } });
  my.forEach((y, j) => { if (y != null) { if (j === sheet.ref[2]) rj = HY.length; HY.push({ y, j }); } });
  if (VX.length < 3 || HY.length < 3) return null;
  const sw = meshSW(sheet.ref[0]);
  const tv = Math.tan((det.v.angle * Math.PI) / 180), th = Math.tan((det.h.angle * Math.PI) / 180);
  const pairs = [];
  for (const { x: x0, i } of VX) for (const { y: y0, j } of HY) {
    const y = (y0 - x0 * th) / (1 + tv * th), x = x0 + y * tv;
    pairs.push({ u: x, v: y, lat: sw.lat + ((sheet.ref[2] - j) * 2.5) / 60, lng: sw.lng + ((i - sheet.ref[1]) * 3.75) / 60 });
  }
  return { pairs, found: [VX.length, HY.length], expected: [sheet.VX.length, sheet.HY.length] };
}
