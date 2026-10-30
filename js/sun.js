// 日の出・日没(日本時間)と猟期の目安
export function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const start = new Date(date.getFullYear(), 0, 0);
  const N = Math.floor((date - start) / 864e5);
  const g = (2 * Math.PI / 365) * (N - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const ha = Math.acos(Math.min(1, Math.max(-1, cosHa))) / rad;
  const noonJst = 720 - 4 * lon - eqt + 9 * 60; // 分(JST)
  // 端末のタイムゾーンに関係なく JST の時刻として作る
  const jstMidnightUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - 9 * 3600e3;
  const mk = m => new Date(jstMidnightUtc + m * 60e3);
  return { rise: mk(noonJst - 4 * ha), set: mk(noonJst + 4 * ha) };
}

/** 一般的な猟期 11/15〜翌2/15。都道府県の延長猟期は設定で上書きする想定 */
export function season(now, endMonthDay = [2, 15]) {
  const y = now.getMonth() < 4 ? now.getFullYear() - 1 : now.getFullYear();
  const s = new Date(y, 10, 15);
  const e = new Date(y + 1, endMonthDay[0] - 1, endMonthDay[1], 23, 59);
  return { start: s, end: e, open: now >= s && now <= e };
}

export const hhmm = d => d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
export const span = ms => {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h ? `${h}時間${m}分` : `${m}分`;
};
