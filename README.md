# かりた本ノート

家族で使う「借りた本」の管理アプリです。図書館・マンションの図書室・学校・保育園など、いろいろな場所で借りた本と返却日をまとめて管理し、返却日が近づくと家族全員の iPhone に通知します。シリーズものの「どの巻を読んだか」も履歴から分かります。

iPhone のホーム画面に追加して使う Web アプリ（PWA）で、**完全無料**（Firebase の無料プラン＋GitHub Actions）で動きます。

## 主な機能

- **バーコードで借りる**: カメラで本のバーコード（ISBN）を続けて読み取り、場所・借りた人・返却日をまとめて登録。タイトル・著者・表紙は自動で取得（ISBN が無い本はタイトル検索や手入力）
- **貸出中の一覧**: 返却日が近い順に表示。期限切れ・3 日以内を色分けし、場所や借りた人で絞り込み
- **返却**: 1 冊ずつ、または場所ごとにまとめて返却。読書状況（読んだ／途中まで／読んでいない）と感想・評価を記録。誤操作は取り消し可能
- **延長**: 返却日の変更
- **履歴**: すべての貸出記録をタイトル・著者で検索、場所・人・期間で絞り込み
- **シリーズ管理**: 巻ごとの既読状況、まだ借りていない巻・抜けている巻の表示
- **スキャンで確認**: 書店や図書館の棚でバーコードを読むだけで「前に借りたことがあるか」を確認
- **返却日の通知**: 返却日の 3 日前・前日、延滞中は毎朝、グループ全員にプッシュ通知（毎朝 8 時ごろ）
- **家族で共有**: 招待リンクで家族をグループに招待。データは数秒で全員の端末に反映。誤って家族以外に送ったリンクは無効にでき、参加してしまった人は外せる

## 技術構成

| 領域 | 採用 |
|---|---|
| フロントエンド | React 19 + TypeScript + Vite、react-router-dom、CSS Modules |
| PWA | vite-plugin-pwa（Service Worker でオフライン表示・プッシュ通知の受信） |
| ログイン | Firebase Authentication（Google、メール＋パスワード） |
| データベース | Cloud Firestore（リアルタイム同期・オフラインキャッシュ、セキュリティルールでグループ外からのアクセスを拒否） |
| ホスティング | Firebase Hosting |
| バーコード | @zxing/browser |
| 書誌情報 | openBD → 国立国会図書館サーチ → Google Books |
| 定期通知 | GitHub Actions（毎朝）＋ Web Push（web-push） |
| テスト | Vitest、@firebase/rules-unit-testing ＋ Firestore エミュレータ |
| CI / デプロイ | GitHub Actions（`.github/workflows/`） |

Firebase は無料の Spark プランで動かすため、Cloud Functions と Cloud Storage は使っていません。

## ドキュメント

- [利用開始までの手順書](docs/setup.md) — Firebase の準備から iPhone での通知設定まで
- [要件定義書](docs/requirements.md)
- [設計書](docs/design.md) — 構成・データ構造・モジュールの公開 API・画面とルート

## 開発

必要なもの: Node.js 22、Java 21 以上（Firebase エミュレータ用）

```sh
npm ci
cp .env.example .env.local   # VITE_USE_EMULATORS=true にする
npm run emulators            # 別のターミナルで（Auth: 9099 / Firestore: 8080）
npm run dev                  # http://localhost:5173
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run typecheck` | 型チェック |
| `npm test` | 単体テスト（Vitest） |
| `npm run test:rules` | Firestore セキュリティルールのテスト（エミュレータを自動で起動） |
| `npm run build` | 本番用ビルド（`dist/`） |
| `npm run emulators` | Firebase エミュレータ |
| `npm run gen:vapid` | 通知用の VAPID 鍵を作る |
| `node scripts/generate-icons.mjs` | アイコンを作り直す（Playwright が必要） |

### ディレクトリ

```
src/               アプリ本体（構成は docs/design.md の 2 章）
scripts/notify/    毎朝の通知送信スクリプト（GitHub Actions から実行）
tests/rules/       Firestore セキュリティルールのテスト
firestore.rules    Firestore セキュリティルール
firebase.json      Hosting・Firestore・エミュレータの設定
.github/workflows/ CI（ci.yml）、デプロイ（deploy.yml）、返却日の通知（notify.yml）
```

`main` ブランチへの push で、テスト（セキュリティルールのテストを含む）を通ったときだけ自動的にデプロイされます（[手順書](docs/setup.md#8-main-にマージしてデプロイする)）。
