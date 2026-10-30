// 猟野ノート B版 Service Worker (scope: /b/)
// ・アプリ本体: 先に保存し、裏で更新(stale-while-revalidate)
// ・地理院タイル: 端末にあればそれを使い、無ければ取りに行って閲覧キャッシュに入れる
const VERSION = 'v1.0.1';
const SHELL = `b-shell-${VERSION}`;
const BROWSE = 'b-tiles-browse-v1';
const BROWSE_MAX = 3000;

const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/geo.js', './js/dem.js', './js/sun.js', './js/store.js', './js/offline.js',
  './js/idb.js', './js/seasons.js', './js/hmap.js',
  './icons/icon-192.png', './icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  // cache:'reload' で、ブラウザに残った古いファイルではなく必ず最新を取る
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('b-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

let putsSinceTrim = 0;
async function trimBrowse() {
  const c = await caches.open(BROWSE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - BROWSE_MAX; i++) await c.delete(keys[i]);
}

// 地理院サーバーは一度に大量に頼むと 503(混雑)を返すことがあるので、
// 同時に取りに行く数を絞り、断られたら少し待って取り直す
const MAX_INFLIGHT = 6;
let inflight = 0;
const queue = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function slot() {
  if (inflight < MAX_INFLIGHT) { inflight++; return; }
  await new Promise(r => queue.push(r));
  inflight++;
}
function release() { inflight--; const next = queue.shift(); if (next) next(); }

async function fetchTile(url) {
  let last = null;
  for (const wait of [0, 500, 1500, 3500]) {
    if (wait) await sleep(wait + Math.random() * 300);
    await slot();
    try {
      const res = await fetch(url, { mode: 'cors' });
      // 成功、またはタイルが存在しない(海域など)ならそこで終わり
      if (res.ok || res.status === 404) return res;
      last = res;
      if (res.status < 500 && res.status !== 429) return res; // 取り直しても無駄な失敗
    } catch {
      last = null; // 圏外など
    } finally {
      release();
    }
  }
  return last || new Response('', { status: 504, statusText: 'offline' });
}

async function tile(req) {
  const hit = await caches.match(req.url); // オフライン保存分と閲覧キャッシュの両方を探す
  if (hit) return hit;
  const res = await fetchTile(req.url);
  if (res.ok) {
    const c = await caches.open(BROWSE);
    c.put(req.url, res.clone());
    if (++putsSinceTrim > 100) { putsSinceTrim = 0; trimBrowse(); }
  }
  return res;
}

async function shell(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || (await cache.match('./index.html')) || new Response('オフラインです', { status: 503 });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'cyberjapandata.gsi.go.jp') e.respondWith(tile(req));
  else if (url.origin === location.origin || url.hostname === 'unpkg.com') e.respondWith(shell(req));
});
