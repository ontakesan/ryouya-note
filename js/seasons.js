// 都道府県ごとの猟期。いまは熊本県のみ。
// 出典: 熊本県 狩猟者登録・猟期のページ(令和8年度) https://www.pref.kumamoto.jp/soshiki/52/277773.html
export const PREFS = {
  kumamoto: {
    name: '熊本県',
    general: { from: [11, 15], to: [2, 15] },
    extended: [{ label: 'イノシシ・シカ', animals: ['イノシシ', 'ニホンジカ'], from: [11, 1], to: [3, 15] }],
    source: 'https://www.pref.kumamoto.jp/soshiki/52/277773.html',
    hunterMap: 'https://www.pref.kumamoto.jp/soshiki/52/249903.html',
    center: [32.79, 130.74],
  },
};

// 猟期は年をまたぐ(11月〜翌3月)。5月を境に「今季」を決める
function range(now, from, to) {
  const y = now.getMonth() < 4 ? now.getFullYear() - 1 : now.getFullYear();
  return { start: new Date(y, from[0] - 1, from[1]), end: new Date(y + 1, to[0] - 1, to[1], 23, 59, 59) };
}
const days = ms => Math.ceil(ms / 864e5);

/** 上の帯に出す一行と、今どの猟期が開いているか */
export function seasonStatus(now, prefKey = 'kumamoto') {
  const P = PREFS[prefKey];
  const g = range(now, P.general.from, P.general.to);
  const ex = P.extended.map(e => ({ ...e, ...range(now, e.from, e.to) }));
  const gOpen = now >= g.start && now <= g.end;
  const exOpen = ex.filter(e => now >= e.start && now <= e.end);
  let text, open = gOpen || exOpen.length > 0;
  if (gOpen) {
    const longer = exOpen.filter(e => e.end > g.end);
    text = `猟期 残り${days(g.end - now)}日` + (longer.length ? `(${longer.map(e => e.label).join('・')}は${e2s(longer[0].end)}まで)` : '');
  } else if (exOpen.length) {
    const e = exOpen[0];
    text = now < g.start ? `${e.label}猟期中 ・ 一般解禁まで${days(g.start - now)}日` : `${e.label}のみ ・ 残り${days(e.end - now)}日`;
  } else {
    const shift = r => ({ ...r, start: new Date(r.start.getFullYear() + 1, r.start.getMonth(), r.start.getDate()) });
    let cands = [g, ...ex].filter(r => r.start > now);
    if (!cands.length) cands = [g, ...ex].map(shift); // 今季が終わった後(3月下旬〜4月)は来季で数える
    const next = cands.sort((a, b) => a.start - b.start)[0];
    const label = next.label ? `${next.label}解禁` : '解禁';
    text = `${label}まで${days(next.start - now)}日`;
  }
  return { text, open, general: g, extended: ex, pref: P };
}
const e2s = d => `${d.getMonth() + 1}/${d.getDate()}`;

/** 対象獣ごとに、今日狩猟できる期間内か */
export function animalOpen(now, animal, prefKey = 'kumamoto') {
  const s = seasonStatus(now, prefKey);
  if (now >= s.general.start && now <= s.general.end) return true;
  return s.extended.some(e => e.animals.includes(animal) && now >= e.start && now <= e.end);
}
