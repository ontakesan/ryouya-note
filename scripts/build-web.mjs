// アプリ用に www/ を組み立てる。
// GitHub Pages のブラウザ版はリポジトリ直下をそのまま配信し、Leaflet は CDN から読む。
// アプリ版は圏外でも起動できるよう、Leaflet を www/vendor/ に同梱して CDN を使わない。
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const leaflet = join(root, 'node_modules', 'leaflet', 'dist');
if (!existsSync(leaflet)) {
  console.error('Leaflet が見つかりません。先に npm install を実行してください。');
  process.exit(1);
}

// npm から入った Leaflet が、公式(leafletjs.com)の公開ハッシュと同じ中身か確かめる。違えば止める
const OFFICIAL = {
  'leaflet.js': 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  'leaflet.css': 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
for (const [f, want] of Object.entries(OFFICIAL)) {
  const got = 'sha256-' + createHash('sha256').update(readFileSync(join(leaflet, f))).digest('base64');
  if (got !== want) { console.error(`${f} の中身が公式と違います。改ざんの恐れがあるため中止します。`); process.exit(1); }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const p of ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons']) cpSync(join(root, p), join(out, p), { recursive: true });
mkdirSync(join(out, 'vendor', 'leaflet'), { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css', 'images']) cpSync(join(leaflet, f), join(out, 'vendor', 'leaflet', f), { recursive: true });

const htmlPath = join(out, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const before = html;
html = html
  .replace(/https:\/\/unpkg\.com\/leaflet@[\d.]+\/dist\/leaflet\.css/g, 'vendor/leaflet/leaflet.css')
  .replace(/https:\/\/unpkg\.com\/leaflet@[\d.]+\/dist\/leaflet\.js/g, 'vendor/leaflet/leaflet.js')
  .replace(/ integrity="sha256-[^"]+"/g, '') // 同梱版は上で照合済み
  .replace(/ crossorigin=""/g, '');
if (html === before || html.includes('unpkg.com')) { console.error('index.html の Leaflet の読み込みを置き換えられませんでした'); process.exit(1); }
writeFileSync(htmlPath, html);
console.log('www/ を作りました(Leaflet 同梱、Service Worker なし)');
