// 端末内保存。いまは localStorage。データが増えたら IndexedDB に移す想定で窓口を一つにしている
const PREFIX = 'ryouyaB:';
const A_PREFIX = 'ryouya:';

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

/** 初回だけ、A版の記録と山行をB版にコピーする(Aのデータは変えない) */
export function migrateFromA() {
  try {
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
