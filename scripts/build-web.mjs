// アプリ用に www/ を組み立てる。
// GitHub Pages のブラウザ版はリポジトリ直下をそのまま配信し、Leaflet は CDN から読む。
// アプリ版は圏外でも起動できるよう、Leaflet を www/vendor/ に同梱して CDN を使わない。
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const leaflet = join(root, 'node_modules', 'leaflet', 'dist');
if (!existsSync(leaflet)) {
  console.error('Leaflet が見つかりません。先に npm install を実行してください。');
  process.exit(1);
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
  .replace(/ crossorigin=""/g, '');
if (html === before || html.includes('unpkg.com')) { console.error('index.html の Leaflet の読み込みを置き換えられませんでした'); process.exit(1); }
writeFileSync(htmlPath, html);
console.log('www/ を作りました(Leaflet 同梱、Service Worker なし)');
