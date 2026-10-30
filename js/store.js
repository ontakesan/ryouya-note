// 端末内保存。いまは localStorage。データが増えたら IndexedDB に移す想定で窓口を一つにしている
const PREFIX = 'ryouya:';

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

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
