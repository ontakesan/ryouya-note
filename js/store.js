// 端末内保存。いまは localStorage。データが増えたら IndexedDB に移す想定で窓口を一つにしている
// 保存キーの頭は、B版として作ったときの 'ryouyaB:' のまま(変えるとデータが見えなくなるため)
const PREFIX = 'ryouyaB:';
const A_PREFIX = 'ryouya:'; // 以前のA版

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
};

/** 初回だけ、以前のA版の記録・山行・保存した地図の一覧をコピーする(Aのデータは変えない) */
export function migrateFromA() {
  try {
    // A版で保存した地図の一覧(地図の画像そのものは端末にそのまま残っていて使える)
    if (!localStorage.getItem(PREFIX + 'areasMigrated')) {
      localStorage.setItem(PREFIX + 'areasMigrated', '1');
      const a = JSON.parse(localStorage.getItem(A_PREFIX + 'areas') || '[]');
      if (a.length) {
        const mine = JSON.parse(localStorage.getItem(PREFIX + 'areas') || '[]');
        const ids = new Set(mine.map(x => x.id));
        localStorage.setItem(PREFIX + 'areas', JSON.stringify([...mine, ...a.filter(x => !ids.has(x.id))]));
      }
    }
    if (localStorage.getItem(PREFIX + 'migrated')) return 0;
    localStorage.setItem(PREFIX + 'migrated', '1');
    let n = 0;
    for (const key of ['records', 'tracks', 'settings', 'lastType']) {
      const v = localStorage.getItem(A_PREFIX + key);
      if (v != null && localStorage.getItem(PREFIX + key) == null) {
        localStorage.setItem(PREFIX + key, v);
        if (key === 'records' || key === 'tracks') n += JSON.parse(v).length;
      }
    }
    return n;
  } catch { return 0; }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
