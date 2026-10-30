#!/usr/bin/env bash
# 猟野ノートの iPhone アプリを Mac で組み立てる準備をする。何度実行しても大丈夫。
#   bash scripts/ios-setup.sh         準備して Xcode を開く
#   bash scripts/ios-setup.sh --ci    Xcode を開かない(GitHub Actions 用)
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✕ %s\033[0m\n' "$1"; exit 1; }

step "必要なものを確認"
command -v node >/dev/null || fail "Node.js が入っていません。https://nodejs.org/ja から LTS 版(22以上)を入れてください。"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js が古いです(いま $(node -v))。22 以上を入れてください。"
command -v xcodebuild >/dev/null || fail "Xcode が入っていません。App Store から Xcode を入れてください。"
XCODE_MAJOR=$(xcodebuild -version | head -1 | sed -E 's/Xcode ([0-9]+).*/\1/')
[ "$XCODE_MAJOR" -ge 26 ] || fail "Xcode が古いです(いま $(xcodebuild -version | head -1))。26 以上に更新してください。"
echo "Node $(node -v) / $(xcodebuild -version | head -1)"

step "部品をインストール"
npm install --no-audit --no-fund

step "アプリ用のファイルを組み立て"
npm run build

if [ ! -d ios ]; then
  step "iOS のプロジェクトを作成"
  npx cap add ios
fi

step "アイコンを作成"
npx --yes @capacitor/assets generate --ios --iconBackgroundColor '#1f2a1f' --splashBackgroundColor '#1f2a1f' || echo "(アイコン作成はスキップしました。動作には影響しません)"

step "アプリに最新のファイルを反映"
npx cap sync ios

step "位置情報と、画面を消している間の記録を許可する設定"
PLIST=ios/App/App/Info.plist
PB=/usr/libexec/PlistBuddy
setstr() { $PB -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true; $PB -c "Add :$1 string $2" "$PLIST"; }
setstr NSLocationWhenInUseUsageDescription "現在地の表示、軌跡の記録、保護区などへの接近の警告に使います。"
setstr NSLocationAlwaysAndWhenInUseUsageDescription "画面を消している間も軌跡を記録し、保護区などに入ったときに知らせるために使います。"
$PB -c "Delete :UIBackgroundModes" "$PLIST" >/dev/null 2>&1 || true
$PB -c "Add :UIBackgroundModes array" "$PLIST"
$PB -c "Add :UIBackgroundModes:0 string location" "$PLIST"
setstr CFBundleDisplayName "猟野ノート"
echo "設定しました: $PLIST"

if [ "${1:-}" != "--ci" ]; then
  step "Xcode を開きます"
  npx cap open ios
  cat <<'MSG'

次は Xcode で:
  1. 左の一覧で「App」を選び、「Signing & Capabilities」→ Team で自分の Apple ID を選ぶ
  2. iPhone をケーブルでつなぎ、上の端末選択で自分の iPhone を選ぶ
  3. ▶(Run)を押す
詳しくは docs/iphone.md を見てください。
MSG
fi
