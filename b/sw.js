// 以前の B版(/b/)の Service Worker を片付けるための版。
// 端末に残った古い B版がこれに更新されると、アプリ本体のキャッシュを消して登録を外し、正式版(../)へ移す。
// 地図の保存データ(b-tiles-*)、記録、取り込んだハンターマップは消さない。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('b-shell-')) await caches.delete(k);
    await self.registration.unregister();
    const top = new URL('../', self.registration.scope).href;
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(top).catch(() => {});
  })());
});
self.addEventListener('fetch', e => {
  // 片付けが終わるまでの間も、/b/ へのアクセスは正式版へ回す
  if (e.request.mode === 'navigate') e.respondWith(Response.redirect(new URL('../', self.registration.scope).href, 302));
});
