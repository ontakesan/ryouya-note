# 猟野ノートを iPhone アプリとして入れる

ブラウザ版(ホーム画面に追加する版)との違い:

| | ブラウザ版 | iPhone アプリ |
|---|---|---|
| 画面を消したときの軌跡記録 | 止まる | **続く** |
| 区域に入ったときの知らせ | 画面の帯のみ(振動なし) | **振動+通知**(画面を消していても) |
| 圏外の地図 | 保存した範囲 | 保存した範囲(端末のデータベースに保存) |
| ファイルの書き出し | ダウンロード | 共有シート(AirDrop・ファイル・LINE など) |
| 更新 | 開くだけで最新 | Mac で入れ直す |

> **データはブラウザ版から自動では移りません。** 区域は「区域」タブの「書き出して仲間と共有」でファイルにし、アプリ側で「GeoJSONを読み込む」で移せます。ハンターマップはアプリ側で取り込み直してください(自動で位置が合います)。

---

## 1. 自分の iPhone に入れる(無料)

### 用意するもの
- Mac(macOS は Xcode 26 が動くもの)
- **Xcode 26 以上**(App Store から無料)
- **Node.js 22 以上**(https://nodejs.org/ja の LTS 版)
- iPhone(iOS 15 以上)と、Mac につなぐケーブル
- Apple ID(いつも使っているもので可)

### 手順
1. ターミナルでリポジトリを取ってきて、準備スクリプトを実行します。
   ```bash
   git clone https://github.com/ontakesan/ryouya-note.git
   cd ryouya-note
   bash scripts/ios-setup.sh
   ```
   部品のインストールから iOS プロジェクトの作成、位置情報の設定までを自動で行い、最後に Xcode が開きます。

2. **Xcode で署名を設定**(初回のみ)
   - 左の一覧の一番上「App」→ 中央の「Signing & Capabilities」タブ
   - 「Team」で「Add an Account…」から Apple ID でサインインし、自分の名前(Personal Team)を選ぶ
   - 「Bundle Identifier」が使えないと言われたら、末尾を変えます(例: `io.github.ontakesan.ryouyanote.yt`)

3. **iPhone をつないで実行**
   - iPhone をケーブルでつなぎ、iPhone で「このコンピュータを信頼」
   - iPhone の「設定」→「プライバシーとセキュリティ」→「デベロッパモード」をオン(再起動あり)
   - Xcode 上部の端末選択で自分の iPhone を選び、▶ を押す

4. **iPhone で開発元を信頼**(初回のみ)
   - 「設定」→「一般」→「VPNとデバイス管理」→ 自分の Apple ID →「信頼」

5. アプリを開き、位置情報は**「常に許可」**(または「Appの使用中は許可」)、通知は**「許可」**を選びます。
   画面を消している間も記録・警告するには、「設定」→「猟野ノート」→「位置情報」を「常に」にしておくのが確実です。

### 無料の場合の注意
- **7日ごとに入れ直しが必要**です(Mac につないで Xcode の ▶ を押すだけ。データは消えません)
- 無料で入れられるのは、Mac につないだ自分の iPhone だけです

### アプリを最新にする
```bash
cd ryouya-note
git pull
bash scripts/ios-setup.sh
```
Xcode が開いたら ▶ を押します。

---

## 2. 猟仲間の iPhone に配る(Apple Developer Program が必要)

仲間の iPhone に入れるには、**Apple Developer Program(年 99 ドル、日本では 12,980 円)** への登録が必要です。登録すると TestFlight で配れます。

- 仲間は App Store から「TestFlight」アプリを入れ、送られてきたリンクを開くだけで入れられます(Mac もケーブルも不要)
- 1回入れたビルドは 90 日使えます。それまでに新しいビルドを配れば続けて使えます
- 7日ごとの入れ直しは不要になります

### 手順の概要
1. https://developer.apple.com/programs/ で登録(個人で可。審査に数日かかることがあります)
2. Xcode の Team を、登録したアカウント(個人名の Team)に変更
3. App Store Connect(https://appstoreconnect.apple.com)で「マイApp」→「＋」→ 新規 App(バンドルIDは Xcode と同じもの)
4. Xcode のメニュー「Product」→「Archive」→ 終わったら「Distribute App」→「TestFlight & App Store」→ アップロード
5. App Store Connect の「TestFlight」タブで、外部テスターのグループを作り、公開リンクを有効にする
   (外部テスターへの初回配布は Apple の簡単な審査があります。通常 1 日程度)
6. 公開リンクを LINE などで仲間に送る

---

## 困ったとき

| 症状 | 対処 |
|---|---|
| `ios-setup.sh` が Node.js / Xcode が古いと言う | 表示どおり更新してから、もう一度実行 |
| Xcode で「Signing for "App" requires a development team」 | 手順2の Team を選ぶ |
| 「Untrusted Developer」と出て開けない | 手順4の「信頼」 |
| 画面を消すと記録が止まる | 位置情報を「常に」に。低電力モードはオフに |
| 区域に入っても通知が来ない | 「設定」→「通知」→「猟野ノート」で通知を許可 |
| 7日たって開けなくなった | 無料の場合の仕様。Mac につないで ▶ で入れ直す(データは残る) |

ビルドが通るかは、GitHub の「Actions」→「iOS build check」で毎回自動で確かめています。
