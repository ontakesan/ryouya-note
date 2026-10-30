import { LAYERS, ATTRIBUTION, distance, fmtDist, bearing, dirName } from './geo.js';
import { elevationAt } from './dem.js';
import { sunTimes, hhmm, span } from './sun.js';
import { store, uid, migrateFromA } from './store.js';
import { seasonStatus, animalOpen, PREFS } from './seasons.js';
import { ZONE_TYPES, geoImageLayer, shrinkImage, openCalibrator, zonesAt, inPolygon } from './hmap.js';
import { putImage, getImage, delImage } from './idb.js';
import * as off from './offline.js';

/* =========================================================
   種類の定義
   ========================================================= */
const TYPES = {
  kukuri: { name: 'くくり罠', short: 'く', color: '#8a5a2b', trap: true },
  hako:   { name: '箱罠',     short: '箱', color: '#5b4a8a', trap: true },
  ashi:   { name: '足跡',     short: '足', color: '#2f7d4a' },
  fun:    { name: '糞',       short: '糞', color: '#7a6a2a' },
  nuta:   { name: 'ヌタ場',   short: 'ヌ', color: '#3a7090' },
  kemono: { name: '獣道',     short: '道', color: '#6b7a3a' },
  catch:  { name: '捕獲',     short: '獲', color: '#c0392b' },
};
const HOUR = 3600e3;
const PREF = 'kumamoto';
var overlaysReady = false; // var: 宣言より前に参照されても undefined で済むように
const migratedCount = migrateFromA();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = t => { const h = (Date.now() - t) / HOUR; return h < 1 ? '1時間以内' : h < 24 ? `${Math.floor(h)}時間前` : `${Math.floor(h / 24)}日前`; };

/* =========================================================
   状態
   ========================================================= */
const S = {
  records: store.get('records', []),
  tracks: store.get('tracks', []),
  active: store.get('activeTrack', null),   // 記録中の軌跡
  areas: store.get('areas', []),            // オフライン保存した範囲
  settings: { showHmap: true, showZones: true, ...store.get('settings', { base: 'std', hillshade: true, showAreas: false }) },
  sheets: store.get('sheets', []),          // 取り込んだハンターマップ画像(本体はIndexedDB)
  zones: store.get('zones', []),            // 登録した区域
  draw: null, zoneState: '',
  pos: null, follow: false, watchId: null,
  view: 'track', editing: null, stamp: null, dl: null,
};
const saveRecords = () => store.set('records', S.records);
const saveTracks = () => store.set('tracks', S.tracks);
const saveActive = () => store.set('activeTrack', S.active);
const saveAreas = () => store.set('areas', S.areas);
const saveSettings = () => store.set('settings', S.settings);

/* =========================================================
   地図
   ========================================================= */
const v0 = store.get('view', { lat: PREFS[PREF].center[0], lng: PREFS[PREF].center[1], z: 10 });
const map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 18, tapHold: true }).setView([v0.lat, v0.lng], v0.z);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
map.attributionControl.setPrefix(false);

// 読み込みに失敗した地図画像は、少し待って最大3回まで取り直す(電波の弱い山中や、サーバー混雑への対策)
function retryTiles(layer) {
  layer.on('tileerror', ({ tile, coords }) => {
    const n = +(tile.dataset.retry || 0);
    if (n >= 3) return;
    tile.dataset.retry = n + 1;
    const src = layer.getTileUrl(coords);
    setTimeout(() => { tile.src = ''; tile.src = src; }, 1500 * (n + 1));
  });
  return layer;
}
const tile = key => retryTiles(L.tileLayer(LAYERS[key].url, {
  minZoom: 5, maxZoom: 18, maxNativeZoom: LAYERS[key].max, attribution: ATTRIBUTION, crossOrigin: 'anonymous',
}));
const bases = { std: tile('std'), pale: tile('pale'), photo: tile('photo') };
const hillshade = retryTiles(L.tileLayer(LAYERS.hillshade.url, { maxZoom: 18, maxNativeZoom: 16, opacity: 0.35, crossOrigin: 'anonymous' }));
// 電波が戻ったら、欠けている地図を取り直す
addEventListener('online', () => { Object.values(bases).forEach(l => map.hasLayer(l) && l.redraw()); if (map.hasLayer(hillshade)) hillshade.redraw(); });
const areaLayer = L.layerGroup();
const recordLayer = L.layerGroup().addTo(map);
const trackLayer = L.layerGroup().addTo(map);
const activeLine = L.polyline([], { color: '#e8590c', weight: 5, opacity: 0.9 }).addTo(map);

function applyLayers() {
  for (const [k, l] of Object.entries(bases)) (k === S.settings.base ? map.addLayer(l) : map.removeLayer(l));
  S.settings.hillshade ? hillshade.addTo(map) : map.removeLayer(hillshade);
  S.settings.showAreas ? areaLayer.addTo(map) : map.removeLayer(areaLayer);
  $(`#base-${S.settings.base}`).checked = true;
  $('#ovHillshade').checked = S.settings.hillshade;
  $('#ovAreas').checked = S.settings.showAreas;
  $('#ovHmap').checked = S.settings.showHmap;
  $('#ovZones').checked = S.settings.showZones;
  if (overlaysReady) refreshOverlays(); // 区域の部品ができる前(起動直後)は呼ばない
}
applyLayers();

map.on('moveend', () => {
  const c = map.getCenter();
  store.set('view', { lat: c.lat, lng: c.lng, z: map.getZoom() });
  renderTop();
  if (S.view === 'offline') renderOfflinePlan();
});
map.on('dragstart', () => { if (S.follow) setFollow(false); });

/* レイヤーメニュー */
$('#btnLayers').onclick = () => {
  const m = $('#layerMenu'); m.hidden = !m.hidden;
  $('#btnLayers').setAttribute('aria-expanded', String(!m.hidden));
};
$('#layerMenu').addEventListener('change', e => {
  if (e.target.name === 'base') S.settings.base = e.target.value;
  if (e.target.id === 'ovHillshade') S.settings.hillshade = e.target.checked;
  if (e.target.id === 'ovAreas') S.settings.showAreas = e.target.checked;
  if (e.target.id === 'ovHmap') S.settings.showHmap = e.target.checked;
  if (e.target.id === 'ovZones') S.settings.showZones = e.target.checked;
  saveSettings(); applyLayers();
});
map.on('click', () => { $('#layerMenu').hidden = true; });

/* =========================================================
   トースト
   ========================================================= */
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/* =========================================================
   上の帯: 猟期・日の出日没・GPS・通信
   ========================================================= */
function renderTop() {
  const now = new Date();
  const ref = S.pos ? [S.pos.lat, S.pos.lng] : [map.getCenter().lat, map.getCenter().lng];
  const se = seasonStatus(now, PREF);
  const sc = $('#seasonChip');
  sc.textContent = se.text;
  sc.className = 'chip season' + (se.open ? '' : ' off');
  sc.title = `${se.pref.name}の猟期(県の告示で最終確認してください)`;

  const st = sunTimes(now, ref[0], ref[1]);
  const sun = $('#sunChip');
  let tail = '';
  if (now < st.rise) tail = ' ・日の出前';
  else if (now < st.set) tail = ` ・日没まで${span(st.set - now)}`;
  else tail = ' ・本日終了';
  sun.textContent = `銃猟 ${hhmm(st.rise)}–${hhmm(st.set)}${tail}`;
  sun.className = 'chip' + (now >= st.rise && now < st.set ? (st.set - now < HOUR ? ' warn' : ' good') : '');

  const g = $('#gpsChip');
  if (!S.watchId && S.watchId !== 0) { g.textContent = 'GPS オフ'; g.className = 'chip'; }
  else if (!S.pos) { g.textContent = 'GPS 測位中…'; g.className = 'chip warn'; }
  else { g.textContent = `GPS ±${Math.round(S.pos.acc)}m`; g.className = 'chip ' + (S.pos.acc <= 20 ? 'good' : S.pos.acc <= 50 ? 'warn' : 'bad'); }

  $('#netChip').hidden = navigator.onLine;
}
addEventListener('online', renderTop);
addEventListener('offline', renderTop);
setInterval(renderTop, 30e3);

/* =========================================================
   GPS
   ========================================================= */
const meIcon = L.divIcon({ className: 'me', html: '<div class="dot"><div class="cone" hidden></div></div>', iconSize: [18, 18] });
const meMarker = L.marker([0, 0], { icon: meIcon, interactive: false, keyboard: false, zIndexOffset: 1000 });
const accCircle = L.circle([0, 0], { radius: 0, color: '#2b6cb0', weight: 1, fillOpacity: 0.1, interactive: false });

function startGPS() {
  if (!('geolocation' in navigator)) { toast('この端末では位置情報が使えません'); return false; }
  if (S.watchId != null) return true;
  S.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  renderTop();
  return true;
}
function stopGPS() {
  if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = null; S.pos = null;
  map.removeLayer(meMarker); map.removeLayer(accCircle);
  renderTop();
}
function onPos(p) {
  const { latitude: lat, longitude: lng, accuracy: acc, heading } = p.coords;
  const first = !S.pos;
  S.pos = { lat, lng, acc, heading, t: p.timestamp };
  meMarker.setLatLng([lat, lng]).addTo(map);
  accCircle.setLatLng([lat, lng]).setRadius(acc).addTo(map);
  const cone = meMarker.getElement()?.querySelector('.cone');
  if (cone) {
    const ok = heading != null && !Number.isNaN(heading);
    cone.hidden = !ok;
    if (ok) cone.style.transform = `translate(-50%,-100%) rotate(${heading}deg)`;
  }
  if (S.follow || first) map.setView([lat, lng], Math.max(map.getZoom(), first ? 15 : 0), { animate: !first });
  if (S.active && !S.active.paused) addTrackPoint(S.pos);
  if (S.stamp) $('#addHere').disabled = false;
  checkZones();
  renderTop();
  throttledPanel();
}
function onPosErr(e) {
  const msg = {
    1: '位置情報が許可されていません。ブラウザ(またはホーム画面のアプリ)の設定で位置情報を「許可」にしてください。',
    2: '現在地を取得できません。空が開けた場所で試してください。',
    3: '測位に時間がかかっています。そのまま待つか、場所を変えてください。',
  }[e.code] || '位置情報でエラーが起きました';
  toast(msg, 6000);
  if (e.code === 1) { stopGPS(); setFollow(false); }
}
function setFollow(on) {
  S.follow = on;
  $('#btnLocate').setAttribute('aria-pressed', String(on));
}
$('#btnLocate').onclick = () => {
  if (!startGPS()) return;
  if (S.pos) map.setView([S.pos.lat, S.pos.lng], Math.max(map.getZoom(), 15));
  setFollow(!S.follow || !S.pos ? true : false);
};

let panelTimer = 0;
function throttledPanel() {
  if (Date.now() - panelTimer < 4000) return;
  if (view.querySelector('[data-armed="1"]')) return; // 確認待ちのボタンを消さない
  panelTimer = Date.now();
  if (S.view === 'track' || S.view === 'traps') renderPanel();
}

/* =========================================================
   軌跡の記録
   ========================================================= */
function trackStats(points) {
  let dist = 0, gain = 0, loss = 0, ref = null;
  for (let i = 0; i < points.length; i++) {
    if (i) dist += distance(points[i - 1], points[i]);
    const e = points[i][3];
    if (e == null) continue;
    if (ref == null) { ref = e; continue; }
    if (e - ref >= 3) { gain += e - ref; ref = e; } // 3m未満の上下はノイズとして無視
    else if (ref - e >= 3) { loss += ref - e; ref = e; }
  }
  const t0 = points[0]?.[2], t1 = points[points.length - 1]?.[2];
  return { dist, gain, loss, ms: t0 ? t1 - t0 : 0 };
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* 許可されない環境もある */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.active && !S.active.paused) keepAwake(true);
});

let lastSave = 0;
function addTrackPoint(p) {
  if (p.acc > 50) return; // 精度の悪い点は捨てる
  const pts = S.active.points;
  const last = pts[pts.length - 1];
  if (last && distance(last, [p.lat, p.lng]) < 5) return;
  const pt = [+p.lat.toFixed(6), +p.lng.toFixed(6), Date.now(), null];
  pts.push(pt);
  activeLine.addLatLng([pt[0], pt[1]]);
  elevationAt(pt[0], pt[1]).then(e => { if (e != null) pt[3] = Math.round(e * 10) / 10; });
  if (Date.now() - lastSave > 10e3) { lastSave = Date.now(); saveActive(); }
}
function startTrack() {
  if (!startGPS()) return;
  S.active = { id: uid(), start: Date.now(), paused: false, points: [] };
  activeLine.setLatLngs([]);
  saveActive(); keepAwake(true); setFollow(true);
  toast('軌跡の記録を始めました。画面は消さずにお使いください');
  renderPanel();
}
function pauseTrack() {
  S.active.paused = !S.active.paused; saveActive();
  keepAwake(!S.active.paused); renderPanel();
}
function stopTrack() {
  const a = S.active;
  if (a.points.length >= 2) {
    const d = new Date(a.start);
    S.tracks.unshift({ id: a.id, name: `${d.getMonth() + 1}/${d.getDate()} の山行`, start: a.start, end: Date.now(), points: a.points, visible: true });
    saveTracks();
    toast('山行を保存しました');
  } else toast('記録した点が少ないため保存しませんでした');
  S.active = null; saveActive(); activeLine.setLatLngs([]); keepAwake(false);
  drawTracks(); renderPanel();
}
function drawTracks() {
  trackLayer.clearLayers();
  for (const t of S.tracks) if (t.visible) {
    L.polyline(t.points.map(p => [p[0], p[1]]), { color: '#8a5a2b', weight: 4, opacity: 0.75, dashArray: '8 6' })
      .bindTooltip(t.name).addTo(trackLayer);
  }
}
if (S.active) { activeLine.setLatLngs(S.active.points.map(p => [p[0], p[1]])); startGPS(); }
drawTracks();

function gpx(track) {
  const pts = track.points.map(p =>
    `<trkpt lat="${p[0]}" lon="${p[1]}">${p[3] != null ? `<ele>${p[3]}</ele>` : ''}<time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="猟野ノート" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(track.name)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* =========================================================
   地点の記録(罠・痕跡・捕獲)
   ========================================================= */
function drawRecords() {
  recordLayer.clearLayers();
  for (const r of S.records) {
    const t = TYPES[r.type]; if (!t) continue;
    const late = t.trap && Date.now() - r.checked > 24 * HOUR;
    const icon = L.divIcon({
      className: 'pin' + (late ? ' late' : ''),
      html: `<span style="background:${t.color}"><em>${t.short}</em></span>`,
      iconSize: [30, 30], iconAnchor: [15, 34],
    });
    L.marker([r.lat, r.lng], { icon, title: `${t.name} ${r.animal}` }).on('click', () => openPin(r)).addTo(recordLayer);
  }
  $('#trapBadge').textContent = S.records.filter(r => TYPES[r.type]?.trap && Date.now() - r.checked > 24 * HOUR).length || '';
}

/* 編集ダイアログの「種類」ボタン(iPhoneでも確実に反応するよう、ラジオではなくボタン) */
const typeBox = $('#pinTypes');
let dlgType = 'kukuri';
for (const [k, t] of Object.entries(TYPES)) {
  typeBox.insertAdjacentHTML('beforeend',
    `<button type="button" role="radio" aria-checked="false" data-type="${k}"><i style="background:${t.color}"></i>${t.name}</button>`);
}
function setDlgType(k) {
  dlgType = k;
  typeBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.type === k)));
}
typeBox.addEventListener('click', e => { const b = e.target.closest('button[data-type]'); if (b) setDlgType(b.dataset.type); });

let lastType = store.get('lastType', 'kukuri');
let lastAnimal = store.get('lastAnimal', 'イノシシ');
function newRecord(type, latlng) {
  const r = { id: uid(), type, lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6), animal: lastAnimal, note: '', at: Date.now() };
  if (TYPES[type].trap) { r.set = Date.now(); r.checked = Date.now(); }
  return r;
}
function openPin(rec, latlng) {
  const isNew = !rec;
  S.editing = rec || { ...newRecord(lastType, latlng), _new: true };
  const r = S.editing;
  $('#pinTitle').textContent = isNew ? '地点を記録' : TYPES[r.type].name;
  setDlgType(r.type);
  $('#pinAnimal').value = r.animal;
  $('#pinNote').value = r.note || '';
  $('#pinDelete').hidden = isNew;
  const meta = $('#pinMeta');
  meta.textContent = `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}${r.ele != null ? ` ・標高 ${r.ele}m` : ''}`;
  if (r.ele == null) elevationAt(r.lat, r.lng).then(e => { if (e != null && S.editing === r) { r.ele = Math.round(e); meta.textContent += ` ・標高 ${r.ele}m`; } });
  $('#pinDialog').showModal();
}
$('#pinForm').addEventListener('submit', e => {
  e.preventDefault();
  const r = S.editing; if (!r) return;
  r.type = dlgType;
  r.animal = $('#pinAnimal').value;
  r.note = $('#pinNote').value.trim();
  if (TYPES[r.type].trap) { r.set ??= Date.now(); r.checked ??= Date.now(); }
  if (r._new) { delete r._new; S.records.push(r); lastType = r.type; store.set('lastType', lastType); }
  lastAnimal = r.animal; store.set('lastAnimal', lastAnimal);
  saveRecords(); drawRecords(); $('#pinDialog').close(); renderPanel();
  if (!warnRecord(r)) toast(`${TYPES[r.type].name}を保存しました`);
});
$('#pinCancel').onclick = () => $('#pinDialog').close();
$('#pinDelete').onclick = () => {
  const btn = $('#pinDelete');
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'もう一度押すと削除'; return; }
  S.records = S.records.filter(x => x !== S.editing);
  saveRecords(); drawRecords(); $('#pinDialog').close(); renderPanel();
};
$('#pinDialog').addEventListener('close', () => { const b = $('#pinDelete'); b.dataset.armed = ''; b.textContent = '削除'; S.editing = null; });

/* スタンプ: 上の列から選び、地図をタップするとその場に置く(もう一度押すと解除) */
const stampBar = $('#stampBar');
for (const [k, t] of Object.entries(TYPES)) {
  stampBar.insertAdjacentHTML('beforeend',
    `<button class="stamp" data-stamp="${k}" aria-pressed="false"><i style="background:${t.color}"></i>${t.name}</button>`);
}
function setStamp(k) {
  S.stamp = k;
  stampBar.querySelectorAll('.stamp').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stamp === k)));
  $('.stage').classList.toggle('stamping', !!k);
  $('#addBar').hidden = !k;
  if (k) {
    $('#addTitle').textContent = `地図をタップすると「${TYPES[k].name}」を置きます`;
    $('#addHere').disabled = !S.pos;
    $('#layerMenu').hidden = true;
    startGPS();
  }
}
stampBar.addEventListener('click', e => {
  const b = e.target.closest('.stamp'); if (!b) return;
  setStamp(S.stamp === b.dataset.stamp ? null : b.dataset.stamp);
});
// 同じ場所での連打や、地図を動かした直後の誤タップを防ぐ
let lastStampAt = 0;
function placeStamp(latlng) {
  if (Date.now() - lastStampAt < 600) return;
  lastStampAt = Date.now();
  const r = newRecord(S.stamp, latlng);
  S.records.push(r);
  elevationAt(r.lat, r.lng).then(e => { if (e != null) { r.ele = Math.round(e); saveRecords(); } });
  saveRecords(); drawRecords(); renderPanel();
  navigator.vibrate?.(30);
  if (!warnRecord(r)) toast(`${TYPES[r.type].name}を置きました。ピンを押すとメモを書けます`);
}
map.on('click', e => {
  if (S.draw) addDrawPoint(e.latlng);
  else if (S.stamp) placeStamp(e.latlng);
});
$('#addCancel').onclick = () => setStamp(null);
$('#addHere').onclick = () => { if (S.stamp && S.pos) placeStamp({ lat: S.pos.lat, lng: S.pos.lng }); };

/* ＋ボタン: 現在地(なければ地図の中心)にメモつきで記録 / 地図の長押しでも同じ */
$('#btnAdd').onclick = () => {
  startGPS();
  openPin(null, S.pos ? { lat: S.pos.lat, lng: S.pos.lng } : map.getCenter());
};
map.on('contextmenu', e => openPin(null, e.latlng));
drawRecords();

/* =========================================================
   パネル
   ========================================================= */
const sheet = $('#sheet');
$('#grip').onclick = () => (sheet.dataset.open = sheet.dataset.open === 'true' ? 'false' : 'true');
document.querySelector('.tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  if (S.view === t.dataset.v) sheet.dataset.open = sheet.dataset.open === 'true' ? 'false' : 'true';
  else sheet.dataset.open = 'true';
  S.view = t.dataset.v; renderPanel();
  setTimeout(() => map.invalidateSize(), 50);
});
new ResizeObserver(() => map.invalidateSize()).observe($('.stage'));

const view = $('#view');
function renderPanel() {
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v === S.view)));
  ({ track: V_track, traps: V_traps, records: V_records, zones: V_zones, offline: V_offline })[S.view]();
}

function fromHere(r) {
  if (!S.pos) return '';
  const a = [S.pos.lat, S.pos.lng], b = [r.lat, r.lng];
  return ` ・${dirName(bearing(a, b))}へ${fmtDist(distance(a, b))}`;
}

/* --- 山行 --- */
function V_track() {
  const a = S.active;
  const s = a ? trackStats(a.points) : null;
  const curEle = a?.points.length ? a.points[a.points.length - 1][3] : null;
  view.innerHTML = `
    ${a ? `
      <div><h2>${a.paused ? '一時停止中' : '<span class="rec-dot"></span>記録中'}</h2>
      <p class="note">${new Date(a.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 開始 ・ ${a.points.length} 点</p></div>
      <div class="stats">
        <div><small>距離</small><b>${fmtDist(s.dist)}</b></div>
        <div><small>経過</small><b>${span(Date.now() - a.start)}</b></div>
        <div><small>登り</small><b>+${Math.round(s.gain)} m</b></div>
        <div><small>現在の標高</small><b>${curEle != null ? Math.round(curEle) + ' m' : '—'}</b></div>
      </div>
      <div class="btnrow">
        <button class="btn big" data-act="pause">${a.paused ? '再開' : '一時停止'}</button>
        <button class="btn big primary" data-act="stop">終了して保存</button>
      </div>
      <p class="note">ブラウザ版は画面を消すと記録が止まる端末があります(特にiPhone)。記録中は画面を点けたままにしてください。</p>`
    : `
      <div class="btnrow"><button class="btn big primary" data-act="start">軌跡の記録を始める</button></div>
      <p class="note">GPSの点を5mごとに記録し、標高は国土地理院の10mメッシュから求めます。保存済みの範囲なら圏外でも標高が出ます。</p>`}
    <div><div class="label">過去の山行</div>
      <div class="list">${S.tracks.map(t => {
        const st = trackStats(t.points);
        return `<div class="row"><div class="ic" style="background:#8a5a2b">行</div>
          <div class="body" data-fit="${t.id}"><div class="t">${esc(t.name)}</div>
          <div class="m">${fmtDist(st.dist)} ・ +${Math.round(st.gain)}m ・ ${span(st.ms)}</div></div>
          <div class="side"><button class="btn ghost" data-vis="${t.id}">${t.visible ? '隠す' : '表示'}</button>
          <button class="btn ghost" data-gpx="${t.id}">GPX</button></div></div>`;
      }).join('') || '<div class="empty">まだありません。</div>'}</div></div>`;
}

/* --- 罠の見回り --- */
function trapState(r) {
  const h = (Date.now() - r.checked) / HOUR;
  if (h < 12) return '<span class="st ok">見回り済</span>';
  if (h < 24) return '<span class="st warn">今日中に見回り</span>';
  return `<span class="st bad">${Math.floor(h)}時間 未確認</span>`;
}
function V_traps() {
  const traps = S.records.filter(r => TYPES[r.type]?.trap).sort((a, b) => a.checked - b.checked);
  view.innerHTML = `
    <div><h2>見回りリスト</h2><p class="note">確認が古い順。${S.pos ? '現在地からの方角と距離つき。' : '現在地ボタンを押すと方角と距離が出ます。'}</p></div>
    <div class="list">${traps.map(r => {
      const t = TYPES[r.type];
      return `<div class="row"><div class="ic" style="background:${t.color}">${t.short}</div>
        <div class="body" data-go="${r.id}"><div class="t">${t.name} ・ ${esc(r.animal)}</div>
        <div class="m">設置 ${ago(r.set)} ・ 確認 ${ago(r.checked)}${fromHere(r)}</div>${zoneBadge(r)}
        ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</div>
        <div class="side">${trapState(r)}<button class="btn" data-check="${r.id}">見回り済</button></div></div>`;
    }).join('') || '<div class="empty">罠はまだありません。＋ボタンで「くくり罠」か「箱罠」を記録してください。地図の長押しでも記録できます。</div>'}</div>
    <p class="note">罠には住所・氏名・登録番号などを書いた標識が必要です。</p>`;
}

/* --- 記録一覧 --- */
function V_records() {
  const list = [...S.records].sort((a, b) => b.at - a.at);
  view.innerHTML = `
    <div class="btnrow" style="justify-content:space-between;align-items:center"><h2>記録 ${list.length}件</h2>
      <button class="btn" data-act="export">GeoJSONで書き出す</button></div>
    <div class="list">${list.map(r => {
      const t = TYPES[r.type];
      return `<div class="row"><div class="ic" style="background:${t.color}">${t.short}</div>
        <div class="body" data-go="${r.id}"><div class="t">${t.name} ・ ${esc(r.animal)}</div>
        <div class="m">${ago(r.at)}${r.ele != null ? ` ・ 標高${r.ele}m` : ''}${fromHere(r)}</div>${zoneBadge(r)}
        ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</div></div>`;
    }).join('') || '<div class="empty">足跡・糞・ヌタ場・捕獲などを記録すると、ここに並びます。</div>'}</div>
    <p class="note">書き出したファイルは、次の段階で作る「ハンターマップとの照合」や他の地図アプリで使えます。</p>`;
}

/* --- オフライン地図 --- */
const dlOpts = store.get('dlOpts', { maxZoom: 16, std: true, photo: false, hillshade: true });
function currentPlan() {
  const b = map.getBounds();
  const bounds = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
  const keys = ['dem'];
  if (dlOpts.std) keys.push(S.settings.base === 'pale' ? 'pale' : 'std');
  if (dlOpts.photo) keys.push('photo');
  if (dlOpts.hillshade) keys.push('hillshade');
  return { bounds, keys, ...off.planArea(bounds, keys, dlOpts.maxZoom) };
}
function V_offline() {
  const busy = !!S.dl;
  view.innerHTML = `
    <div><h2>圏外用に地図を保存</h2><p class="note">いま画面に映っている範囲を保存します。山に入る前に、電波のある場所で済ませてください。</p></div>
    <div class="form">
      <label for="dlZoom">どこまで細かく
        <select id="dlZoom" ${busy ? 'disabled' : ''}>
          ${[[14, '14 ・ 尾根と沢がわかる'], [15, '15 ・ 登山道レベル(おすすめ)'], [16, '16 ・ 等高線がくっきり'], [17, '17 ・ とても細かい(容量大)']]
            .map(([z, l]) => `<option value="${z}" ${dlOpts.maxZoom === z ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <div class="inline">
        <label><input type="checkbox" id="dlStd" ${dlOpts.std ? 'checked' : ''} ${busy ? 'disabled' : ''}> 地図</label>
        <label><input type="checkbox" id="dlHill" ${dlOpts.hillshade ? 'checked' : ''} ${busy ? 'disabled' : ''}> 陰影起伏</label>
        <label><input type="checkbox" id="dlPhoto" ${dlOpts.photo ? 'checked' : ''} ${busy ? 'disabled' : ''}> 航空写真</label>
      </div>
      <p class="note mono" id="dlPlan"></p>
      <label for="dlName">名前<input type="text" id="dlName" value="エリア ${S.areas.length + 1}" ${busy ? 'disabled' : ''}></label>
      ${busy ? `<div class="progress"><i id="dlBar"></i></div><p class="note mono" id="dlProg"></p>
                <div class="btnrow"><button class="btn big" data-act="dlcancel">中止</button></div>`
             : `<div class="btnrow"><button class="btn big primary" data-act="dl" id="dlBtn">この範囲を保存</button></div>`}
    </div>
    <div><div class="label">保存済み</div><div class="list">${S.areas.map(a => `
      <div class="row"><div class="ic" style="background:#2b6cb0">図</div>
        <div class="body" data-area="${a.id}"><div class="t">${esc(a.name)}</div>
        <div class="m">${new Date(a.at).toLocaleDateString('ja-JP')} ・ ${a.count}枚 ・ 約${Math.round(a.mb)}MB ・ ズーム${a.maxZoom}まで</div></div>
        <div class="side"><button class="btn ghost danger" data-delarea="${a.id}">削除</button></div></div>`).join('') || '<div class="empty">まだありません。</div>'}
    </div></div>
    <p class="note mono" id="storage"></p>
    <p class="note">地図データ: 国土地理院「地理院タイル」。一度に大量の取得をしないよう、1回の保存は${off.MAX_TILES_PER_AREA}枚までにしています。</p>`;
  renderOfflinePlan();
  off.storageInfo().then(i => { const el = $('#storage'); if (i && el) el.textContent = `端末の使用量 ${i.usageMB.toFixed(0)}MB / 上限の目安 ${(i.quotaMB / 1024).toFixed(1)}GB`; });
}
function renderOfflinePlan() {
  const el = $('#dlPlan'); if (!el || S.dl) return;
  const p = currentPlan();
  const over = p.urls.length > off.MAX_TILES_PER_AREA;
  el.textContent = `${p.urls.length.toLocaleString()}枚 ・ 約${p.mb.toFixed(0)}MB` + (over ? ' ・ 多すぎます。地図を拡大して範囲を狭めるか、細かさを下げてください' : '');
  el.style.color = over ? 'var(--bad)' : '';
  const b = $('#dlBtn'); if (b) b.disabled = over || !navigator.onLine;
}
view.addEventListener('change', e => {
  if (e.target.id === 'dlZoom') dlOpts.maxZoom = +e.target.value;
  if (e.target.id === 'dlStd') dlOpts.std = e.target.checked;
  if (e.target.id === 'dlHill') dlOpts.hillshade = e.target.checked;
  if (e.target.id === 'dlPhoto') dlOpts.photo = e.target.checked;
  store.set('dlOpts', dlOpts); renderOfflinePlan();
});

async function startDownload() {
  const p = currentPlan();
  const name = $('#dlName').value.trim() || `エリア ${S.areas.length + 1}`;
  const ctrl = new AbortController();
  S.dl = ctrl;
  off.askPersist();
  renderPanel();
  const res = await off.downloadUrls(p.urls, {
    signal: ctrl.signal,
    onProgress(done, total, failed) {
      const bar = $('#dlBar'), txt = $('#dlProg');
      if (bar) bar.style.width = `${(done / total) * 100}%`;
      if (txt) txt.textContent = `${done.toLocaleString()} / ${total.toLocaleString()}枚${failed ? ` ・ 失敗 ${failed}` : ''}`;
    },
  });
  S.dl = null;
  if (!res.aborted) {
    S.areas.unshift({ id: uid(), name, at: Date.now(), bounds: p.bounds, keys: p.keys, maxZoom: dlOpts.maxZoom, count: p.urls.length, mb: p.mb });
    saveAreas(); drawAreas();
    toast(res.failed ? `保存しました(${res.failed}枚は取得できませんでした。もう一度押すと続きを取ります)` : `「${name}」を保存しました。圏外でも表示できます`, 5000);
  } else toast('保存を中止しました');
  renderPanel();
}
function drawAreas() {
  areaLayer.clearLayers();
  for (const a of S.areas) L.rectangle([[a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]], { color: '#2b6cb0', weight: 2, fill: false, dashArray: '4 4' }).bindTooltip(a.name).addTo(areaLayer);
}
drawAreas();

/* --- パネル内の操作をまとめて受ける --- */
view.addEventListener('click', async e => {
  const el = e.target.closest('[data-act],[data-check],[data-go],[data-vis],[data-gpx],[data-fit],[data-area],[data-delarea]');
  if (!el) return;
  const d = el.dataset;
  if (d.act === 'start') startTrack();
  else if (d.act === 'pause') pauseTrack();
  else if (d.act === 'stop') {
    if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'もう一度押して終了'; return; }
    stopTrack();
  }
  else if (d.act === 'export') {
    const fc = {
      type: 'FeatureCollection',
      features: [
        ...S.records.map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
          properties: { kind: r.type, name: TYPES[r.type].name, animal: r.animal, note: r.note, at: new Date(r.at).toISOString(), elevation: r.ele ?? null } })),
        ...S.tracks.map(t => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.points.map(p => [p[1], p[0], p[3] ?? 0]) },
          properties: { kind: 'track', name: t.name, start: new Date(t.start).toISOString() } })),
      ],
    };
    download(`ryouya-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(fc), 'application/geo+json');
  }
  else if (d.act === 'dl') startDownload();
  else if (d.act === 'dlcancel') S.dl?.abort();
  else if (d.check) {
    const r = S.records.find(x => x.id === d.check); r.checked = Date.now();
    saveRecords(); drawRecords(); renderPanel(); toast('見回り済にしました');
  }
  else if (d.go) {
    const r = S.records.find(x => x.id === d.go);
    setFollow(false); map.setView([r.lat, r.lng], Math.max(map.getZoom(), 16));
    if (innerWidth < 860) sheet.dataset.open = 'false';
  }
  else if (d.vis) { const t = S.tracks.find(x => x.id === d.vis); t.visible = !t.visible; saveTracks(); drawTracks(); renderPanel(); }
  else if (d.gpx) { const t = S.tracks.find(x => x.id === d.gpx); download(`${t.name.replace(/[\\/:*?"<>|]/g, '-')}.gpx`, gpx(t), 'application/gpx+xml'); }
  else if (d.fit) {
    const t = S.tracks.find(x => x.id === d.fit); t.visible = true; saveTracks(); drawTracks();
    setFollow(false); map.fitBounds(t.points.map(p => [p[0], p[1]]), { padding: [30, 30] });
  }
  else if (d.area) {
    const a = S.areas.find(x => x.id === d.area);
    S.settings.showAreas = true; saveSettings(); applyLayers();
    setFollow(false); map.fitBounds([[a.bounds.s, a.bounds.w], [a.bounds.n, a.bounds.e]]);
  }
  else if (d.delarea) {
    if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = '本当に削除'; return; }
    const a = S.areas.find(x => x.id === d.delarea);
    const { urls } = off.planArea(a.bounds, a.keys, a.maxZoom);
    // 他の保存範囲と重なるタイルは残す
    const keep = new Set(S.areas.filter(x => x !== a).flatMap(x => off.planArea(x.bounds, x.keys, x.maxZoom).urls));
    await off.deleteUrls(urls.filter(u => !keep.has(u)));
    S.areas = S.areas.filter(x => x !== a); saveAreas(); drawAreas(); renderPanel();
    toast('削除しました');
  }
});


/* =========================================================
   B版: ハンターマップの重ね表示
   ========================================================= */
const sheetLayers = new Map(); // id -> { layer, url }
async function sheetUrl(sh) {
  if (sheetLayers.get(sh.id)?.url) return sheetLayers.get(sh.id).url;
  const blob = await getImage(sh.id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  sheetLayers.set(sh.id, { ...(sheetLayers.get(sh.id) || {}), url });
  return url;
}
async function drawSheets() {
  for (const sh of S.sheets) {
    const entry = sheetLayers.get(sh.id);
    const want = S.settings.showHmap && sh.visible && sh.M;
    if (entry?.layer && (!want || entry.M !== sh.M)) { map.removeLayer(entry.layer); entry.layer = null; }
    if (want && !sheetLayers.get(sh.id)?.layer) {
      const url = await sheetUrl(sh);
      if (!url) continue;
      const layer = geoImageLayer(url, sh.w, sh.h, sh.M, sh.opacity).addTo(map);
      sheetLayers.set(sh.id, { url, layer, M: sh.M });
    }
  }
  // 削除された画像の後始末
  for (const [id, e] of sheetLayers) if (!S.sheets.find(s => s.id === id)) {
    if (e.layer) map.removeLayer(e.layer);
    if (e.url) URL.revokeObjectURL(e.url);
    sheetLayers.delete(id);
  }
}
const saveSheets = () => store.set('sheets', S.sheets);

$('#hmapFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  toast('画像を取り込んでいます…', 8000);
  try {
    const { blob, w, h } = await shrinkImage(file);
    const sh = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), w, h, M: null, pairs: [], opacity: 0.6, visible: true, at: Date.now() };
    await putImage(sh.id, blob);
    S.sheets.push(sh); saveSheets();
    renderPanel();
    calibrate(sh);
  } catch (err) {
    console.error(err);
    toast('画像を取り込めませんでした。JPGかPNGの画像を選んでください(PDFは不可)', 6000);
  }
});
async function calibrate(sh) {
  const url = await sheetUrl(sh);
  if (!url) { toast('画像が見つかりません。取り込み直してください'); return; }
  const c = map.getCenter();
  const pc = sh.pairs.length ? [sh.pairs[0].lat, sh.pairs[0].lng] : [c.lat, c.lng];
  openCalibrator({
    url, w: sh.w, h: sh.h, pairs: sh.pairs, center: pc, title: sh.name,
    onDone({ pairs, M, rms }) {
      sh.pairs = pairs; sh.M = M; sh.rms = pairs.length > 3 ? rms : null; sh.visible = true;
      S.settings.showHmap = true; saveSettings();
      saveSheets(); drawSheets(); renderPanel();
      // 画像の中心あたりへ移動
      const cu = sh.w / 2, cv = sh.h / 2;
      const pt = L.point(M[0] * cu + M[2] * cv + M[4], M[1] * cu + M[3] * cv + M[5]);
      map.setView(L.CRS.EPSG3857.pointToLatLng(pt, 18), Math.min(map.getZoom(), 12));
      toast('ハンターマップを地図に重ねました。透明度は「区域」タブで変えられます', 5000);
    },
  });
}

/* =========================================================
   B版: 区域の登録・表示・判定
   ========================================================= */
const zoneLayer = L.layerGroup();
const saveZones = () => store.set('zones', S.zones);
function drawZones() {
  zoneLayer.clearLayers();
  for (const z of S.zones) {
    const t = ZONE_TYPES[z.type] || ZONE_TYPES.chui;
    // スタンプ中・なぞり中は、区域の上をタップしても地図をタップしたのと同じに扱う
    L.polygon(z.coords, { color: t.color, weight: 2.5, fillColor: t.color, fillOpacity: 0.16, dashArray: t.ban.gun && !t.ban.trap ? '8 5' : null, bubblingMouseEvents: false })
      .on('click', e => {
        if (S.draw) addDrawPoint(e.latlng);
        else if (S.stamp) placeStamp(e.latlng);
        else L.popup().setLatLng(e.latlng).setContent(`<b>${esc(z.name || t.name)}</b><br>${t.name} ・ ${t.rule}`).openOn(map);
      })
      .addTo(zoneLayer);
  }
}
function refreshOverlays() {
  S.settings.showZones ? zoneLayer.addTo(map) : map.removeLayer(zoneLayer);
  drawSheets();
}

/** 記録した地点が区域内なら警告して true を返す */
function warnRecord(r) {
  const inside = S.zones.filter(z => z.coords.length >= 3 && inPolygon([r.lat, r.lng], z.coords));
  if (!inside.length) return false;
  const isTrap = TYPES[r.type]?.trap;
  const bad = inside.filter(z => isTrap ? ZONE_TYPES[z.type]?.ban.trap : ZONE_TYPES[z.type]?.ban.gun || ZONE_TYPES[z.type]?.ban.trap);
  const z = bad[0] || inside[0];
  const t = ZONE_TYPES[z.type];
  if (isTrap && t.ban.trap) {
    navigator.vibrate?.([200, 100, 200]);
    toast(`⚠ この場所は${t.name}「${z.name || ''}」の中です。わなは設置できません(許可がある場合を除く)`, 7000);
  } else toast(`この場所は${t.name}「${z.name || ''}」の中です ・ ${t.rule}`, 5000);
  return true;
}
function zoneBadge(r) {
  const z = S.zones.find(z => z.coords.length >= 3 && inPolygon([r.lat, r.lng], z.coords));
  if (!z) return '';
  const t = ZONE_TYPES[z.type];
  return `<div><span class="st zone" style="background:${t.color}">${t.name}の中</span></div>`;
}

/** 現在地の区域チェック。入った瞬間に振動で知らせる */
function checkZones() {
  const banner = $('#zoneBanner');
  if (!S.pos || !S.zones.length) { banner.hidden = true; S.zoneState = ''; return; }
  const { inside, near } = zonesAt([S.pos.lat, S.pos.lng], S.zones, 150);
  const key = inside.map(z => z.id).sort().join(',');
  if (inside.length) {
    const z = inside.sort((a, b) => banRank(b) - banRank(a))[0], t = ZONE_TYPES[z.type];
    banner.className = 'zonebanner in';
    banner.innerHTML = `<span class="z-ic">⚠</span><div>${esc(t.name)}「${esc(z.name || '名前なし')}」の中にいます<small>${esc(t.rule)}${inside.length > 1 ? ` ・ ほか${inside.length - 1}区域` : ''}</small></div>`;
    banner.hidden = false;
    if (key !== S.zoneState) navigator.vibrate?.([300, 120, 300]);
  } else if (near.length) {
    const { zone: z, d } = near[0], t = ZONE_TYPES[z.type];
    banner.className = 'zonebanner near';
    banner.innerHTML = `<span class="z-ic">!</span><div>${esc(t.name)}「${esc(z.name || '名前なし')}」まで 約${Math.round(d)}m<small>${esc(t.rule)}</small></div>`;
    banner.hidden = false;
  } else banner.hidden = true;
  S.zoneState = key;
}
const banRank = z => { const b = ZONE_TYPES[z.type]?.ban || {}; return (b.gun ? 1 : 0) + (b.trap ? 1 : 0); };

/* 区域をなぞって登録 */
const drawLine = L.polygon([], { color: '#e8590c', weight: 3, dashArray: '6 6', fillOpacity: 0.1 });
const drawVerts = L.layerGroup();
const drawType = $('#drawType');
drawType.innerHTML = Object.entries(ZONE_TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');
function startDraw() {
  setStamp(null);
  S.draw = { pts: [] };
  drawType.value = 'jukinshi';
  $('#drawName').value = '';
  $('#drawBar').hidden = false;
  document.body.classList.add('drawing');
  drawLine.setLatLngs([]).addTo(map); drawVerts.clearLayers().addTo(map);
  if (innerWidth < 860) sheet.dataset.open = 'false';
  updateDraw();
  toast('境界の角を順にタップしてください。ハンターマップを重ねておくと、なぞりやすくなります', 5000);
}
function addDrawPoint(ll) {
  S.draw.pts.push([+ll.lat.toFixed(6), +ll.lng.toFixed(6)]);
  navigator.vibrate?.(15);
  updateDraw();
}
function updateDraw() {
  const pts = S.draw.pts;
  drawLine.setLatLngs(pts);
  drawLine.setStyle({ color: ZONE_TYPES[drawType.value].color });
  drawVerts.clearLayers();
  pts.forEach(p => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: ZONE_TYPES[drawType.value].color, fillOpacity: 1, interactive: false }).addTo(drawVerts));
  $('#drawCount').textContent = `${pts.length}点`;
  $('#drawDone').disabled = pts.length < 3;
  $('#drawUndo').disabled = !pts.length;
}
function endDraw() {
  S.draw = null;
  $('#drawBar').hidden = true;
  document.body.classList.remove('drawing');
  map.removeLayer(drawLine); map.removeLayer(drawVerts);
}
drawType.addEventListener('change', () => S.draw && updateDraw());
$('#drawUndo').onclick = () => { S.draw.pts.pop(); updateDraw(); };
$('#drawCancel').onclick = endDraw;
$('#drawDone').onclick = () => {
  const z = { id: uid(), type: drawType.value, name: $('#drawName').value.trim(), coords: S.draw.pts, at: Date.now() };
  S.zones.push(z); saveZones();
  endDraw();
  S.settings.showZones = true; saveSettings(); applyLayers();
  drawZones(); checkZones(); drawRecords();
  S.view = 'zones'; renderPanel();
  toast(`${ZONE_TYPES[z.type].name}を登録しました`);
};

/* GeoJSON の読み込み(仲間と区域を共有する用) */
$('#zoneFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const gj = JSON.parse(await file.text());
    const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
    let n = 0;
    for (const f of feats) {
      const g = f.geometry; if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        const ring = poly[0].map(([lng, lat]) => [lat, lng]);
        if (ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
        const p = f.properties || {};
        const type = ZONE_TYPES[p.zoneType] ? p.zoneType : (Object.entries(ZONE_TYPES).find(([, t]) => t.name === p.type)?.[0] || 'chui');
        S.zones.push({ id: uid(), type, name: p.name || '', coords: ring, at: Date.now() }); n++;
      }
    }
    saveZones(); drawZones(); checkZones(); drawRecords(); renderPanel();
    toast(n ? `${n}件の区域を読み込みました` : '区域(多角形)が見つかりませんでした');
  } catch { toast('ファイルを読み込めませんでした。GeoJSON形式か確認してください'); }
});
function exportZones() {
  const fc = { type: 'FeatureCollection', features: S.zones.map(z => ({
    type: 'Feature',
    properties: { name: z.name, zoneType: z.type, type: ZONE_TYPES[z.type].name, rule: ZONE_TYPES[z.type].rule },
    geometry: { type: 'Polygon', coordinates: [[...z.coords, z.coords[0]].map(([la, ln]) => [ln, la])] },
  })) };
  download(`区域-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(fc), 'application/geo+json');
}

/* --- 区域タブ --- */
function V_zones() {
  const P = PREFS[PREF];
  const se = seasonStatus(new Date(), PREF);
  view.innerHTML = `
    <div><h2>ハンターマップ</h2>
      <p class="note">${P.name}の鳥獣保護区等位置図(JPG)を取り込み、地図に重ねます。<a class="link" href="${P.hunterMap}" target="_blank" rel="noopener">県のページを開く</a>でJPGを保存してから取り込んでください。PDFはスクリーンショットにすると取り込めます。</p></div>
    <div class="list">${S.sheets.map(sh => `
      <div class="sheetrow">
        <img class="thumb" data-thumb="${sh.id}" alt="">
        <div style="min-width:0">
          <div class="t">${esc(sh.name)}</div>
          <div class="m">${sh.M ? `位置合わせ済み ・ ${sh.pairs.length}点${sh.rms != null ? ` ・ 誤差 約${Math.round(sh.rms)}m` : ''}` : '<span style="color:var(--bad)">位置合わせがまだです</span>'}</div>
          ${sh.M ? `<label class="slider" for="op-${sh.id}">透明度<input type="range" id="op-${sh.id}" min="0.1" max="1" step="0.05" value="${sh.opacity}" data-op="${sh.id}"></label>` : ''}
          <div class="acts">
            <button class="btn ${sh.M ? '' : 'primary'}" data-z="cal" data-id="${sh.id}">${sh.M ? '合わせ直す' : '位置合わせ'}</button>
            ${sh.M ? `<button class="btn ghost" data-z="vis" data-id="${sh.id}">${sh.visible ? '隠す' : '表示'}</button>` : ''}
            <button class="btn ghost danger" data-z="delsheet" data-id="${sh.id}">削除</button>
          </div>
        </div>
      </div>`).join('') || '<div class="empty">まだありません。</div>'}</div>
    <div class="btnrow"><button class="btn primary big" data-z="import">ハンターマップの画像を取り込む</button></div>

    <div><h2>区域</h2><p class="note">保護区や銃猟禁止区域を登録すると、中に入ったときと150m以内に近づいたときに知らせます。わなを置こうとした場所が禁止区域なら警告します。</p></div>
    <div class="legend-z">${Object.values(ZONE_TYPES).map(t => `<span><i class="zsw" style="color:${t.color};background:${t.color}33"></i>${t.name}</span>`).join('')}</div>
    <div class="list">${S.zones.map(z => {
      const t = ZONE_TYPES[z.type] || ZONE_TYPES.chui;
      const inside = S.pos && inPolygon([S.pos.lat, S.pos.lng], z.coords);
      return `<div class="row"><div class="ic" style="background:${t.color}">区</div>
        <div class="body" data-z="fit" data-id="${z.id}"><div class="t">${esc(z.name || '名前なし')}</div>
        <div class="m">${t.name} ・ ${t.rule}</div>${inside ? '<div><span class="st bad">いま中にいます</span></div>' : ''}</div>
        <div class="side"><button class="btn ghost danger" data-z="delzone" data-id="${z.id}">削除</button></div></div>`;
    }).join('') || '<div class="empty">まだありません。</div>'}</div>
    <div class="btnrow">
      <button class="btn primary big" data-z="draw">区域をなぞって登録</button>
    </div>
    <div class="btnrow">
      <button class="btn" data-z="importzone">GeoJSONを読み込む</button>
      <button class="btn" data-z="exportzone" ${S.zones.length ? '' : 'disabled'}>書き出して仲間と共有</button>
    </div>

    <div><h2>${P.name}の猟期</h2>
      <p class="note">一般 ${se.general.start.getMonth() + 1}/${se.general.start.getDate()}〜${se.general.end.getMonth() + 1}/${se.general.end.getDate()}
      ${se.extended.map(e => ` ・ ${e.label} ${e.start.getMonth() + 1}/${e.start.getDate()}〜${e.end.getMonth() + 1}/${e.end.getDate()}`).join('')}
      ・ 今日: イノシシ ${animalOpen(new Date(), 'イノシシ', PREF) ? '<b style="color:var(--ok)">可</b>' : '不可'}、その他 ${animalOpen(new Date(), 'その他', PREF) ? '<b style="color:var(--ok)">可</b>' : '不可'}</p>
      <p class="note">区域の登録とこの表示は補助です。元の地図が10万分の1のため、境界には数十mのずれが出ます。境界付近では現地の標識と公式マップで確認してください。<a class="link" href="${P.source}" target="_blank" rel="noopener">猟期の出典</a></p></div>`;
  // サムネイル
  view.querySelectorAll('[data-thumb]').forEach(async img => {
    const sh = S.sheets.find(s => s.id === img.dataset.thumb);
    const url = sh && await sheetUrl(sh);
    if (url) img.src = url;
  });
}
view.addEventListener('input', e => {
  const id = e.target.dataset.op; if (!id) return;
  const sh = S.sheets.find(s => s.id === id); sh.opacity = +e.target.value;
  sheetLayers.get(id)?.layer?.setOpacity(sh.opacity);
  saveSheets();
});
view.addEventListener('click', async e => {
  const b = e.target.closest('[data-z]'); if (!b) return;
  const id = b.dataset.id, act = b.dataset.z;
  if (act === 'import') $('#hmapFile').click();
  else if (act === 'importzone') $('#zoneFile').click();
  else if (act === 'exportzone') exportZones();
  else if (act === 'draw') startDraw();
  else if (act === 'cal') calibrate(S.sheets.find(s => s.id === id));
  else if (act === 'vis') {
    const sh = S.sheets.find(s => s.id === id); sh.visible = !sh.visible;
    if (sh.visible) { S.settings.showHmap = true; saveSettings(); applyLayers(); }
    saveSheets(); drawSheets(); renderPanel();
  }
  else if (act === 'delsheet' || act === 'delzone') {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '本当に削除'; return; }
    if (act === 'delsheet') { S.sheets = S.sheets.filter(s => s.id !== id); saveSheets(); await delImage(id).catch(() => {}); drawSheets(); }
    else { S.zones = S.zones.filter(z => z.id !== id); saveZones(); drawZones(); checkZones(); drawRecords(); }
    renderPanel(); toast('削除しました');
  }
  else if (act === 'fit') {
    const z = S.zones.find(z => z.id === id);
    setFollow(false); map.fitBounds(z.coords, { padding: [40, 40] });
    if (innerWidth < 860) sheet.dataset.open = 'false';
  }
});
drawZones();
overlaysReady = true;
refreshOverlays();

/* =========================================================
   起動
   ========================================================= */
renderTop();
renderPanel();
if (migratedCount) toast(`A版の記録${migratedCount}件を引き継ぎました`, 5000);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => reg.update()).catch(err => console.warn('SW登録に失敗', err));
  // 新しい版が入ったら一度だけ読み直して最新にする
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true; location.reload();
  });
}
if (location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  toast('GPSとオフライン保存には https での公開が必要です', 8000);
}
