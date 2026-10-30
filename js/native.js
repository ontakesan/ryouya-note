// アプリ版(iPhone)とブラウザ版の違いを吸収する窓口。
// アプリ版では Capacitor のプラグインを使い、ブラウザ版では今までどおり Web の機能を使う。
const C = window.Capacitor;
export const isNative = !!C?.isNativePlatform?.();

function plugin(name) {
  if (!isNative) return null;
  return C.Plugins?.[name] || C.registerPlugin?.(name) || null;
}

/* ---------- 振動 ----------
   iPhone のブラウザは振動に対応していないので、アプリ版では本体の振動(Haptics)を使う */
export async function haptic(kind = 'light') {
  if (isNative) {
    try {
      const H = plugin('Haptics');
      if (kind === 'warn') await H.notification({ type: 'WARNING' });
      else await H.impact({ style: kind === 'heavy' ? 'HEAVY' : 'LIGHT' });
    } catch { /* 振動できなくても動作は続ける */ }
    return;
  }
  navigator.vibrate?.(kind === 'warn' ? [300, 120, 300] : kind === 'heavy' ? 60 : 20);
}

/* ---------- 通知(アプリ版のみ) ----------
   画面を消しているときに保護区などへ入ったら知らせる */
let notifyReady = null;
async function ensureNotifyPermission() {
  const N = plugin('LocalNotifications');
  if (!N) return false;
  let p = await N.checkPermissions();
  if (p.display !== 'granted') p = await N.requestPermissions();
  return p.display === 'granted';
}
export function prepareNotifications() {
  if (!isNative) return Promise.resolve(false);
  notifyReady ??= ensureNotifyPermission().catch(() => false);
  return notifyReady;
}
let notifyId = 1;
export async function notify(title, body) {
  if (!isNative || !(await prepareNotifications())) return;
  try {
    await plugin('LocalNotifications').schedule({ notifications: [{ id: (Date.now() % 2147483) * 1000 + (notifyId++ % 1000), title, body }] });
  } catch { /* 通知できなくても動作は続ける */ }
}

/* ---------- 位置情報 ----------
   アプリ版は背景位置情報プラグインを使い、画面を消しても位置を受け取り続ける。
   どちらも Web の Geolocation と同じ形({coords, timestamp})で渡す */
export function watchPosition(onPos, onErr) {
  if (isNative) {
    const BG = plugin('BackgroundGeolocation');
    let id = null, stopped = false;
    BG.addWatcher({
      backgroundTitle: '猟野ノート',
      backgroundMessage: '位置情報を記録しています',
      requestPermissions: true,
      stale: false,
      distanceFilter: 3,
    }, (loc, err) => {
      if (err) { onErr({ code: err.code === 'NOT_AUTHORIZED' ? 1 : 2, message: err.message }); return; }
      if (!loc) return;
      onPos({
        coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, heading: loc.bearing ?? null, altitude: loc.altitude ?? null },
        timestamp: loc.time || Date.now(),
      });
    }).then(watcherId => { id = watcherId; if (stopped) BG.removeWatcher({ id }); })
      .catch(e => onErr({ code: 2, message: String(e) }));
    return () => { stopped = true; if (id) BG.removeWatcher({ id }); };
  }
  const wid = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  return () => navigator.geolocation.clearWatch(wid);
}
export const hasGeolocation = () => isNative || 'geolocation' in navigator;

/** 位置情報の設定画面を開く(アプリ版で許可されていないとき) */
export async function openLocationSettings() {
  try { await plugin('BackgroundGeolocation')?.openSettings(); } catch {}
}

/* ---------- ファイルの書き出し ----------
   アプリ版はダウンロードができないので、共有シート(AirDrop・ファイルに保存・LINEなど)で渡す */
export async function saveFile(name, text, mime) {
  if (isNative) {
    const FS = plugin('Filesystem'), Share = plugin('Share');
    const { uri } = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title: name, files: [uri] });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
