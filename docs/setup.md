# 利用開始までの手順書

このアプリ（かりた本ノート）を自分の家族用に動かすまでの手順です。上から順番に進めてください。
**費用は一切かかりません。** クレジットカードの登録も不要です（Firebase は無料の Spark プランのまま使います）。

所要時間の目安: 1 時間くらい（初めての場合）

> 用意するもの
>
> - Google アカウント（Gmail のアカウント。Firebase を作る人のもの）
> - GitHub アカウントと、このアプリのリポジトリ（**非公開（Private）にしておく**。理由は手順 13 を参照）
> - ブラウザ（**パソコンがあるとずっと楽です**。手順 1〜7 は iPhone の Safari でもできますが、画面が狭く操作しにくい）
> - 家族の iPhone（iOS 16.4 以上）
>
> **パソコンにプログラムを入れる必要はありません。** すべてブラウザの中で行います。

以下、`<project>` と書いてあるところは、自分の Firebase プロジェクト ID（例: `karita-hon-1a2b3`）に読み替えてください。

---

## 全体の流れ

| 手順 | どこで | やること |
|---|---|---|
| 1〜4 | Firebase のサイト | プロジェクト・ログイン方法・データベースを作り、アプリの設定値をコピーする |
| 5 | Google Cloud の Cloud Shell（ブラウザの中の黒い画面） | 用意したコマンドを貼り付けて、鍵を作る |
| 6 | GitHub のサイト | 手順 5 でできた秘密の値を 3 つ登録する |
| 7 | GitHub のサイト | 公開（デプロイ）する |
| 8〜10 | iPhone | ホーム画面に追加し、家族を招待して、通知を確かめる |

設定値は、リポジトリの **`app.config.json`** というファイルに書き込みます（公開されても困らない値だけ）。
Claude（このアプリを作った AI）とやり取りしている場合は、値を Claude に送れば書き込んでもらえます。自分で書き込む方法も各手順に書いてあります。

---

## 目次

1. [Firebase プロジェクトを作る](#1-firebase-プロジェクトを作る)
2. [ログイン方法を設定する](#2-ログイン方法を設定する)
3. [データベース（Firestore）を作る](#3-データベースfirestoreを作る)
4. [ウェブアプリを登録して、設定値をコピーする](#4-ウェブアプリを登録して設定値をコピーする)
5. [Cloud Shell で鍵を作る](#5-cloud-shell-で鍵を作る)
6. [GitHub に秘密の値を 3 つ登録する](#6-github-に秘密の値を-3-つ登録する)
7. [公開（デプロイ）する](#7-公開デプロイする)
8. [iPhone のホーム画面に追加して通知をオンにする](#8-iphone-のホーム画面に追加して通知をオンにする)
9. [家族を招待して、通知を送るグループを登録する](#9-家族を招待して通知を送るグループを登録する)
10. [通知の動作を確認する](#10-通知の動作を確認する)
11. [（任意）Google アカウントでもログインできるようにする](#11-任意google-アカウントでもログインできるようにする)
12. [（任意）Google Books API キーを作る](#12-任意google-books-api-キーを作る)
13. [無料枠の目安とトラブルシュート](#13-無料枠の目安とトラブルシュート)
14. [（開発者向け）ローカルでの開発](#14-開発者向けローカルでの開発)

---

## 1. Firebase プロジェクトを作る

1. ブラウザで <https://console.firebase.google.com/> を開き、Google アカウントでログインします。
2. 「**プロジェクトを作成**」（または「Firebase プロジェクトを使ってみる」）を押します。
3. プロジェクト名を入力します（例: `karita-hon`）。名前の下に小さく表示される **プロジェクト ID**（例: `karita-hon-1a2b3`）をメモしておきます。これが `<project>` です。
   - アプリの URL は `https://<project>.web.app` になります。
4. 途中で聞かれる「Gemini」や「Google アナリティクス」は**オフ**で構いません（使いません）。
5. 「プロジェクトを作成」を押し、完了するまで待ちます。

> **料金プランは「Spark（無料）」のままにしてください。** 「Blaze にアップグレード」と表示されても押さないでください。

## 2. ログイン方法を設定する

最初は**メールアドレスとパスワードでのログインだけ**を使います（Google アカウントでのログインは設定が多いので、必要になったら手順 11 で追加します）。

1. 左のメニューの「**構築**」（または「Build」）→「**Authentication**」を開き、「**始める**」を押します。
2. 「**Sign-in method**（ログイン方法）」タブで「**メール / パスワード**」を選びます。
3. 1 つ目のスイッチ（メール / パスワード）だけを**オン**にして「**保存**」を押します（2 つ目の「メールリンク」はオフのまま）。

## 3. データベース（Firestore）を作る

1. 左のメニューの「**構築**」→「**Firestore Database**」を開き、「**データベースを作成**」を押します。
2. エディションを聞かれたら「**Standard**」を選びます。
3. ロケーション（データを置く場所）は **`asia-northeast1`（Tokyo）** を選びます。
   - **ロケーションは後から変更できません。** 間違えた場合はプロジェクトを作り直すことになります。
4. セキュリティルールは「**本番環境モード**」を選んで「作成」を押します。
   - 最初はすべてのアクセスが拒否されますが、それで正しい状態です。アプリ用のルールは手順 7 の公開で自動的に入ります。

## 4. ウェブアプリを登録して、設定値をコピーする

ここでは「このプロジェクトをウェブのアプリから使います」と Firebase に登録し、アプリが Firebase につながるための値（設定値）を受け取ります。**設定値は秘密ではありません**（アプリの中に入っていて、誰でも見られるもの）。

1. Firebase の画面の左上にある**歯車のアイコン** →「**プロジェクトの設定**」を押します。
2. 「**全般**」タブを一番下までスクロールします。「**マイアプリ**」の欄に「アプリがありません」と出ていて、その下に丸いアイコンがいくつか並んでいます。
3. その中の **`</>`** のアイコン（ウェブ）を押します。
4. 「アプリのニックネーム」に `かりた本ノート` と入力します。
5. 「**このアプリの Firebase Hosting も設定します**」に**チェックを入れます**（アプリを公開する場所が用意されます）。
6. 「**アプリを登録**」を押します。
7. 次の画面に、次のような文字のかたまりが表示されます。**`const firebaseConfig = {` から `};` までをまるごとコピー**します。

   ```js
   const firebaseConfig = {
     apiKey: "AIza....",
     authDomain: "<project>.firebaseapp.com",
     projectId: "<project>",
     storageBucket: "<project>.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcd..."
   };
   ```

8. コピーしたものを **Claude に送ります**（メモ帳などに貼っておいても構いません）。
9. 画面の「次へ」を何回か押し（「Firebase CLI のインストール」などの説明は**読み飛ばして構いません**。何もインストールしません）、最後に「**コンソールに進む**」を押します。

> **見失ったときは:** 歯車 →「プロジェクトの設定」→「全般」の一番下、「マイアプリ」の「かりた本ノート」を選び、「SDK の設定と構成」で「**構成**（Config）」を選ぶと、同じものがいつでも表示されます。

> **自分で書き込む場合:** GitHub のリポジトリで `app.config.json` を開き、鉛筆のアイコン（Edit this file）を押して、`"firebase"` の中の `apiKey`・`projectId`・`appId`・`messagingSenderId` の `""` の間に値を入れて「Commit changes」を押します。`authDomain` は空のままにします（自動で `<project>.web.app` になります）。

## 5. Cloud Shell で鍵を作る

アプリの公開と毎朝の通知に使う「鍵」を作ります。ふつうは何十回もクリックが必要な作業ですが、**用意したコマンドを 1 回貼り付けるだけ**で済むようにしてあります。

使うのは **Cloud Shell**（Google が無料で用意している、ブラウザの中で動く黒い画面）です。

1. ブラウザで <https://console.cloud.google.com/> を開きます（Firebase と同じ Google アカウント）。
2. 画面の一番上の「プロジェクトを選択」の欄で、手順 1 で作ったプロジェクト（`karita-hon` など）を選びます。
3. 画面の右上にある **`>_` の形のアイコン**（「Cloud Shell をアクティブにする」）を押します。
   - 画面の下半分に黒い画面が開きます。初めてのときは「続行」を押します。準備に 1 分ほどかかります。
4. 黒い画面に `あなたの名前@cloudshell:~` のような文字が出たら、下のコマンドを**全部コピーして黒い画面に貼り付け**、**Enter** を押します。
   - 貼り付けは、黒い画面を右クリック →「貼り付け」、または `Ctrl`＋`V`（Mac は `⌘`＋`V`）です。
   - 「複数行を貼り付けますか」と聞かれたら「貼り付け」を押します。

   ```bash
   karita_setup() {
     local PROJECT_ID=""
     read -r -p "Firebase のプロジェクト ID を入力して Enter: " PROJECT_ID
     PROJECT_ID="$(printf '%s' "$PROJECT_ID" | tr -d '[:space:]')"
     local out="$HOME/karita-setup"
     local deploy_sa="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"
     local notify_sa="notify-bot@${PROJECT_ID}.iam.gserviceaccount.com"
   
     if [ -z "$PROJECT_ID" ]; then
       echo "!! プロジェクト ID が空です。もう一度「karita_setup」と入力して Enter を押してください。"
       return 1
     fi
     echo "== 1/5 プロジェクトを選んでいます: $PROJECT_ID"
     gcloud config set project "$PROJECT_ID" >/dev/null 2>&1 || {
       echo "!! プロジェクト「$PROJECT_ID」を選べませんでした。プロジェクト ID（表示名ではありません）を確かめてください。"
       return 1
     }
     if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
       echo "!! プロジェクト「$PROJECT_ID」が見つかりません。プロジェクト ID（表示名ではありません）を確かめて、"
       echo "   もう一度「karita_setup」と入力して Enter を押してください。"
       return 1
     fi
   
     echo "== 2/5 必要な機能を有効にしています（1〜2 分かかることがあります）"
     gcloud services enable firebasehosting.googleapis.com firebaserules.googleapis.com \
       firestore.googleapis.com iam.googleapis.com || { echo "!! 機能を有効にできませんでした。"; return 1; }
   
     echo "== 3/5 ロボット用アカウントを作っています"
     gcloud iam service-accounts describe "$deploy_sa" >/dev/null 2>&1 ||
       gcloud iam service-accounts create github-actions --display-name="アプリの公開用" >/dev/null ||
       { echo "!! github-actions を作れませんでした。"; return 1; }
     gcloud iam service-accounts describe "$notify_sa" >/dev/null 2>&1 ||
       gcloud iam service-accounts create notify-bot --display-name="返却日の通知用" >/dev/null ||
       { echo "!! notify-bot を作れませんでした。"; return 1; }
     sleep 15 # 作った直後は権限を付けられないことがあるので少し待つ
   
     echo "== 4/5 権限を付けています"
     local role
     for role in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin \
       roles/datastore.user roles/serviceusage.serviceUsageConsumer; do
       gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$deploy_sa" \
         --role="$role" --condition=None --quiet >/dev/null || { echo "!! 権限 $role を付けられませんでした。"; return 1; }
     done
     gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$notify_sa" \
       --role=roles/datastore.user --condition=None --quiet >/dev/null ||
       { echo "!! 通知用の権限を付けられませんでした。"; return 1; }
   
     echo "== 5/5 鍵を作っています"
     mkdir -p "$out" && chmod 700 "$out"
     rm -f "$out"/*
     gcloud iam service-accounts keys create "$out/1_FIREBASE_SERVICE_ACCOUNT.json" --iam-account="$deploy_sa" >/dev/null 2>&1 ||
       { echo "!! デプロイ用の鍵を作れませんでした。"; return 1; }
     gcloud iam service-accounts keys create "$out/2_NOTIFY_SERVICE_ACCOUNT.json" --iam-account="$notify_sa" >/dev/null 2>&1 ||
       { echo "!! 通知用の鍵を作れませんでした。"; return 1; }
     npx -y web-push@3 generate-vapid-keys --json >"$out/vapid.json" 2>/dev/null ||
       { echo "!! 通知用の鍵のペア（VAPID）を作れませんでした。"; return 1; }
     node -e '
       const fs = require("fs");
       const dir = process.argv[1];
       const v = JSON.parse(fs.readFileSync(dir + "/vapid.json", "utf8"));
       fs.writeFileSync(dir + "/3_VAPID_PRIVATE_KEY.txt", v.privateKey);
       fs.writeFileSync(dir + "/claude_ni_okuru_koukaikagi.txt", v.publicKey);
       fs.unlinkSync(dir + "/vapid.json");
     ' "$out" || { echo "!! VAPID 鍵を保存できませんでした。"; return 1; }
     chmod 600 "$out"/*
   
     echo
     echo "========================================================================"
     echo " できました。上のエディタに 4 つのファイルが開いています（~/karita-setup/）。"
     echo "   1_FIREBASE_SERVICE_ACCOUNT.json  → GitHub の Secrets「FIREBASE_SERVICE_ACCOUNT」"
     echo "   2_NOTIFY_SERVICE_ACCOUNT.json    → GitHub の Secrets「NOTIFY_SERVICE_ACCOUNT」"
     echo "   3_VAPID_PRIVATE_KEY.txt          → GitHub の Secrets「VAPID_PRIVATE_KEY」"
     echo "   claude_ni_okuru_koukaikagi.txt   → 中身を Claude に送る（公開してよい値）"
     echo " 1〜3 は秘密の値です。GitHub 以外には貼らないでください。"
     echo " 登録が終わったら、次のコマンドで消してください:  rm -rf ~/karita-setup"
     echo "========================================================================"
     echo
     echo "Claude に送る公開鍵:"
     cat "$out/claude_ni_okuru_koukaikagi.txt"
     echo
     if command -v cloudshell >/dev/null 2>&1; then
       cloudshell edit "$out/claude_ni_okuru_koukaikagi.txt"
       cloudshell edit "$out/3_VAPID_PRIVATE_KEY.txt"
       cloudshell edit "$out/2_NOTIFY_SERVICE_ACCOUNT.json"
       cloudshell edit "$out/1_FIREBASE_SERVICE_ACCOUNT.json"
     fi
   }
   
   karita_setup
   ```

5. `Firebase のプロジェクト ID を入力して Enter:` と出たら、手順 1 でメモしたプロジェクト ID（例: `karita-hon-1a2b3`）を入力して **Enter** を押します。
   - 「Cloud Shell の承認」という確認が出たら「**承認**」を押します。
6. `== 1/5` から `== 5/5` まで順に進み（2〜3 分）、最後に「**できました**」と表示されれば成功です。
   画面の上半分にエディタが開き、次の 4 つのファイルがタブで並んでいます（`karita-setup` というフォルダの中）。

   | ファイル | 中身 | どうするか |
   |---|---|---|
   | `1_FIREBASE_SERVICE_ACCOUNT.json` | 公開用の鍵 | 手順 6 で GitHub に登録する（**秘密**） |
   | `2_NOTIFY_SERVICE_ACCOUNT.json` | 通知用の鍵 | 手順 6 で GitHub に登録する（**秘密**） |
   | `3_VAPID_PRIVATE_KEY.txt` | 通知の秘密鍵 | 手順 6 で GitHub に登録する（**秘密**） |
   | `claude_ni_okuru_koukaikagi.txt` | 通知の公開鍵 | **Claude に送る**（秘密ではない。黒い画面の最後にも表示されています） |

   > **自分で書き込む場合:** 公開鍵は `app.config.json` の `"vapidPublicKey": ""` の `""` の間に入れます。

7. **Cloud Shell のタブは、手順 6 が終わるまで閉じないでください**（閉じてしまっても、Cloud Shell を開き直して左のファイル一覧の `karita-setup` から開けます）。

> **うまくいかないとき:** `!!` で始まる行に理由が出ます。
> - 「プロジェクト … が見つかりません」→ 表示名（`karita-hon`）ではなく、ID（`karita-hon-1a2b3` のように後ろに英数字が付いたもの）を入力します。黒い画面に `karita_setup` と入力して Enter を押すと、もう一度聞かれます。
> - 「権限 … を付けられませんでした」→ 数分待ってから、黒い画面に `karita_setup` と入力して Enter を押します（何度やり直しても構いません）。
> - それでもだめなときは、黒い画面に出た文字をそのまま Claude に送ってください（**鍵の中身は送らない**でください）。

## 6. GitHub に秘密の値を 3 つ登録する

手順 5 でできた 3 つのファイルの中身を、GitHub に「秘密の値（Secrets）」として登録します。登録した値は、GitHub の自動処理（公開と毎朝の通知）だけが使い、あとから誰も（自分も）見ることはできません。

1. 別のタブで GitHub のこのリポジトリのページを開きます。
2. 上のメニューの「**Settings**」（歯車）→ 左のメニューの「**Secrets and variables**」→「**Actions**」を押します。
3. 「**Secrets**」タブが選ばれていることを確かめ、緑の「**New repository secret**」を押します。
4. 次の表のとおり、1 つずつ登録します（3 回繰り返します）。
   - 「**Name**」に名前を**そのまま**入力します（全部大文字・`_` の位置も同じ）。
   - Cloud Shell のエディタでそのファイルのタブを開き、中身をすべて選んで（`Ctrl`＋`A`、Mac は `⌘`＋`A`）コピーし、「**Secret**」の欄に貼り付けます。
   - 「**Add secret**」を押します。

   | Name | Secret に貼り付けるもの |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | `1_FIREBASE_SERVICE_ACCOUNT.json` の中身すべて（`{` から `}` まで） |
   | `NOTIFY_SERVICE_ACCOUNT` | `2_NOTIFY_SERVICE_ACCOUNT.json` の中身すべて（`{` から `}` まで） |
   | `VAPID_PRIVATE_KEY` | `3_VAPID_PRIVATE_KEY.txt` の中身（1 行） |

5. 3 つが一覧に並んだら完了です。Cloud Shell の黒い画面に次を入力して Enter を押し、鍵のファイルを消しておきます。

   ```bash
   rm -rf ~/karita-setup
   ```

> **鍵はパスワードと同じです。** GitHub の Secrets 以外（チャット・メール・Claude など）には貼らないでください。もし漏らしてしまったら、Cloud Shell で `karita_setup` をもう一度実行して新しい鍵を作り、GitHub に登録し直してから、Google Cloud の「IAM と管理」→「サービス アカウント」→ 各アカウントの「鍵」タブで古い鍵を削除します（そのときは通知の公開鍵も変わるので、新しい公開鍵を Claude に送り、全員が通知をオンにし直します）。

> Variables（Secrets の隣のタブ）には何も登録しなくて構いません（設定は `app.config.json` に書きます）。

## 7. 公開（デプロイ）する

1. 手順 4 と手順 5 の値（設定値と公開鍵）が `app.config.json` に入ったことを確かめます（Claude に送った場合は、Claude が書き込んで知らせてくれます）。
2. その変更を **`main` ブランチに取り込みます。** Claude がプルリクエスト（変更の取り込みのお願い）を作った場合は、GitHub でそのプルリクエストを開き、下の方の緑の「**Merge pull request**」→「**Confirm merge**」を押します。
3. 上のメニューの「**Actions**」を押すと、「**デプロイ**」が動いているのが見えます（黄色い丸）。5 分前後で**緑のチェック**になれば完了です。
   - デプロイの前にテストを行い、1 つでも失敗したら公開しません（公開中のアプリは前のまま）。
   - 赤い × になったときは、その行を押して開き、赤くなっている手順を開いて、表示された文字を Claude に送ってください（よくある原因は手順 13 のトラブルシュート）。
   - 設定を直した後に、変更なしでやり直すときは「Actions」→ 左の「デプロイ」→「**Run workflow**」→ 緑の「Run workflow」を押します。
4. ブラウザで `https://<project>.web.app` を開き、ログイン画面が出れば成功です。

## 8. iPhone のホーム画面に追加して通知をオンにする

通知（返却日のお知らせ）を受け取るには、**ホーム画面に追加したアプリ**から通知を許可する必要があります（iPhone の仕様です。iOS 16.4 以上が必要）。家族それぞれの iPhone で行ってください。

1. iPhone の **Safari** で `https://<project>.web.app` を開きます（Chrome など他のブラウザではなく Safari で）。
2. 画面下の **共有ボタン**（四角から上向き矢印が出ているアイコン）を押します。
3. 一覧を下にスクロールして「**ホーム画面に追加**」を押し、右上の「追加」を押します。
4. **ホーム画面に追加された「かりた本」アイコンから**アプリを開きます（以降は毎回ここから開きます）。
5. 「新規登録」を選び、メールアドレスとパスワード（6 文字以上）を入れて登録します。
6. 最初の 1 人目は、グループの作成画面で表示名（例: ママ）とグループ名（例: 山田家）を入力します。続けて、よく使う場所（図書館など）と貸出期間を登録します。
7. 画面下の「**設定**」タブ →「**返却日の通知**」を開き、「**通知をオンにする**」を押します。iPhone の確認画面が出たら「**許可**」を押します。
8. 同じ画面の「**テスト通知を送る**」を押し、通知が表示されることを確認します。

> 通知を一度「許可しない」にしてしまった場合は、iPhone の「設定」→「通知」→「かりた本」から通知をオンにしてください。

## 9. 家族を招待して、通知を送るグループを登録する

### 家族を招待する

1. 画面下の「**設定**」タブ →「**家族メンバーと招待**」で「**招待リンクを作る**」を押し、LINE やメッセージで家族に送ります（共有シートが出ないときは「共有する」か「コピーする」を押します）。
   - 招待リンクの有効期限は **7 日間** です。期限が切れたら新しいリンクを作ってください。
2. 受け取った家族は、iPhone の **Safari** でリンクを開き、メールアドレスで新規登録して、画面の案内に従ってグループに参加します。
   - 招待リンクには LINE で開いたときに Safari で開く設定（`?openExternalBrowser=1`）が付いています。LINE などのアプリの中の画面で開いてしまった場合（「〇〇 の中のブラウザで開いています」と表示されます）は、画面のメニュー（「…」など）から「**Safari で開く**」を選んでください。アプリの中の画面ではホーム画面に追加できず、通知も受け取れません。
3. 参加したら、手順 8 の 2〜4 と 7〜8（ホーム画面に追加して通知をオン）を行ってもらいます。

> 招待リンクは、有効期限内なら**何人でも**使えます（家族の LINE グループに 1 本送れば全員が参加できるように）。家族以外には送らないでください。

### 誤って家族以外に招待リンクを送ったとき

「**設定**」タブ →「**家族メンバーと招待**」で、次の順に行います（メンバーなら誰でもできます）。

1. 「**これまでの招待リンクをすべて無効にする**」を押します。これまでに作った招待リンク（他の家族が作ったものも）では、誰も参加できなくなります。すでに参加している人はそのままです。
2. 家族以外の人が参加してしまっていたら、メンバー一覧のその人の「**外す**」を押します。外した人はグループの本や貸出記録を見られなくなり、通知も届かなくなります。外すときも招待リンクはすべて無効になるので、外した人が同じリンクで戻ってくることはできません。
3. まだ参加していない家族がいる場合は、新しい招待リンクを作って送り直します。

> アプリを開けない場合の最後の手段: Firebase コンソールの「Firestore Database」→「データ」で、`invites` のうち `groupId` が自分のグループの ID のものをすべて削除し、**その後で** `groups` →（自分のグループ）→ `members` からその人のドキュメントを削除します（順番が逆だと、残っている招待リンクで戻られてしまいます）。

### 通知を送るグループを登録する

このアプリは誰でもアカウントを作ってグループを作れます。家族以外の人が作ったグループに毎朝の通知の処理をさせないよう、**家族のグループだけ**を登録します（登録しないと、すべてのグループを処理し、実行結果に黄色い警告が出ます。通知は届きます）。

1. アプリの「**設定**」タブ →「**家族メンバーと招待**」の一番下に「**グループ ID**」（20 文字くらいの英数字）があります。「**グループ ID をコピーする**」を押します。
2. コピーした ID を **Claude に送ります**。Claude が `app.config.json` に書き込みます。
   > **自分で書き込む場合:** `app.config.json` の `"notifyGroupIds": ""` の `""` の間に ID を入れて「Commit changes」を押します。
3. その変更が `main` に入れば完了です（手順 7 の 2 と同じ）。

## 10. 通知の動作を確認する

通知は GitHub の「**返却日の通知**」という自動処理が毎朝 8 時ごろ（日本時間 7:45 に起動）に送ります。次の本があるときだけ、グループ全員に 1 通届きます。

- 返却日を過ぎている本（返却するまで毎朝）
- 明日が返却日の本
- 3 日後が返却日の本

### 送らずに内容だけ確認する（dry run）

1. GitHub の「**Actions**」→ 左の一覧から「**返却日の通知**」を選びます。
2. 「**Run workflow**」を押し、「**送信せずに内容だけ表示する**」に**チェックを入れて**、緑の「Run workflow」を押します。
3. 実行が終わったら開いて、「通知を送信」のログに、送る予定の内容と件数が表示されていることを確認します。
   - 「通知するグループ: 1 件（NOTIFY_GROUP_IDS）」と自分のグループだけが出ていれば、手順 9 の登録もできています。

### 実際に送ってみる

1. アプリで、返却日を「明日」にして本を 1 冊借りた登録をします（テスト用。後で削除します）。
2. 上と同じ手順で、今度は**チェックを入れずに**「Run workflow」を押します。
3. 通知をオンにした iPhone に「明日返却：…」という通知が届けば成功です。
4. テスト用の貸出は、ホームの一覧でその本をタップして貸出の詳細を開き、一番下の「**この登録を削除**」→「**削除する**」で消してください（本の詳細画面には削除はありません）。消し忘れると、翌々日から返却するまで毎朝「延滞中」の通知が家族全員に届きます。

> GitHub の定期実行は混雑していると数分〜数十分遅れることがあります。8 時ちょうどに届かなくても異常ではありません。

## 11. （任意）Google アカウントでもログインできるようにする

メールアドレスでのログインに加えて、「Google でログイン」のボタンを出したいときだけ行います。

1. Firebase の「**Authentication**」→「**Sign-in method**」で「**新しいプロバイダを追加**」→「**Google**」を選び、「有効にする」をオンにします。「プロジェクトのサポートメール」に自分のメールアドレスを選んで「保存」を押します。
2. <https://console.cloud.google.com/apis/credentials> を開き、画面上部で自分のプロジェクトを選びます。
3. 「OAuth 2.0 クライアント ID」の一覧にある「**Web client (auto created by Google Service)**」を押します。
4. 「**承認済みのリダイレクト URI**」の「**URI を追加**」を押し、次を入力して「**保存**」を押します（`<project>` は自分のプロジェクト ID）。

   ```text
   https://<project>.web.app/__/auth/handler
   ```

   （`https://<project>.firebaseapp.com/__/auth/handler` は最初から入っています。消さずに残します）

5. Firebase の「Authentication」→「**設定**」→「**承認済みドメイン**」に `<project>.web.app` があることを確かめます（無ければ「ドメインの追加」で追加）。
6. Claude に「Google ログインを有効にして」と伝えます（`app.config.json` の `"googleSignIn": false` を `true` にします）。`main` に入ると、ログイン画面に「Google でログイン」が出ます。反映まで数分〜数十分かかることがあります。

> **なぜアプリと同じドメイン（`<project>.web.app`）でログインするのか:** iPhone の Safari は、別のドメインのサイトがデータを保存することを制限しています（トラッキング防止）。ログインの処理を行うドメインがアプリの URL と違うと、ホーム画面のアプリで Google ログインの後に画面が戻ってこないことがあります。このアプリは自動でアプリと同じドメインを使うようにしてあり、手順 4 はそのための設定です。

## 12. （任意）Google Books API キーを作る

本の情報（タイトル・表紙など）は、まず openBD と国立国会図書館サーチから探し、見つからないときに Google Books を使います。Google Books は API キーが無くても使えますが、利用者全体で共有の上限に当たりやすいため、キーを作っておくと安定します。**無料**です（請求先アカウントの登録も不要です）。

1. <https://console.cloud.google.com/apis/library/books.googleapis.com> を開き、上部で自分のプロジェクトを選んで「**有効にする**」を押します。
2. <https://console.cloud.google.com/apis/credentials> で「**＋ 認証情報を作成**」→「**API キー**」を押します。作成されたキーを控えます。
3. 作成したキーを開き（「キーを編集」）、次のように**制限**をかけて保存します（他の人に勝手に使われないようにするため）。
   - **アプリケーションの制限**: 「**ウェブサイト**（HTTP リファラー）」を選び、次を追加します。
     - `https://<project>.web.app/*`
     - `https://<project>.firebaseapp.com/*`
     - （ローカル開発もする場合）`http://localhost:5173/*`
   - **API の制限**: 「キーを制限」を選び、「**Books API**」だけにチェック。
4. キーを Claude に送るか、`app.config.json` の `"googleBooksApiKey": ""` に入れて、`main` に取り込みます（制限をかけたキーは、アプリの中に入る公開の値として扱って構いません）。


## 13. 無料枠の目安とトラブルシュート

### 無料枠の目安

家族 6 人程度・年間 1,000 件程度の貸出なら、どれも無料枠に収まります。ただし Firestore の読み取りは、貸出の記録が増えるにつれて増えます（下の「Firestore の読み取りの目安」）。

| サービス | 無料枠（主なもの） | このアプリでの使い方の目安 |
|---|---|---|
| Cloud Firestore（Spark） | 保存 1 GiB、読み取り 5 万回／日、書き込み 2 万回／日、削除 2 万回／日 | 1 日数百〜数千回の読み取り（記録が増えると増える。下の目安を参照） |
| Firebase Hosting（Spark） | 保存 10 GB、転送 360 MB／日 | アプリ本体は数 MB。2 回目以降はキャッシュから読むのでほとんど使わない |
| Firebase Authentication | Google・メールのログインは無料 | 家族の人数分 |
| GitHub Actions（非公開リポジトリ） | 月 2,000 分 | 通知は 1 日 1 回・1 分程度（月 30 分ほど）。デプロイと CI は 1 回数分 |

- 上限を超えても**勝手に課金されることはありません**。ただし Spark プランでは、無料枠がリセットされるまで（太平洋時間の 0 時＝日本時間の 17 時。米国の夏時間の間は 16 時）、**アプリの読み書きと翌朝の通知が止まります**（データは消えません）。
- Firebase コンソールの「**使用量と請求額**」で使用量を確認できます。

### Firestore の読み取りの目安

アプリの画面は、開いている間だけデータを読み込みます。前に開いてから **30 分以上空けて** 開き直すと、その画面が読む記録の件数分が「読み取り」として数えられます（30 分以内なら変わった分だけ）。iPhone のホーム画面のアプリは、閉じている間は接続が切れるので、時間をおいて開くたびに数えられます。

| 画面 | 30 分以上空けて開いたときの読み取り（おおよそ） |
|---|---|
| ホーム | いま借りている記録の件数 |
| 履歴（最初に開いたとき） | 101 件（新しい順に 1 ページ分） |
| 履歴（全期間で検索・絞り込み、「もっと見る」） | 貸出の記録の全件数 |
| 履歴（期間で絞り込み） | その期間の記録の件数 |
| シリーズ一覧 | シリーズの数 ＋ シリーズに入っている本の冊数 ＋ 貸出の記録の全件数 |
| スキャンで確認・借りる本の確認 | 数件〜数十件（その本・同じシリーズの本・ISBN なしで登録した本） |
| バーコードがない本を追加 | 本の全冊数 |

例として、貸出の記録が 3,000 件・本が 2,000 冊・シリーズが 150 件（年 1,000 件のペースで 3 年目）のとき、シリーズ一覧を 1 回開くと約 4,000〜5,000 回、履歴で全期間を検索すると約 3,000 回です。家族 6 人がそれぞれ 1 日 1 回ずつシリーズ一覧と履歴の検索を時間をおいて使うと 1 日 4〜5 万回になり、上限（5 万回）に近づきます。

- 毎朝 7:45 の通知も同じ無料枠を使います（通知の実行は太平洋時間では前日の午後なので、**前の日の夕方以降に使い切ると、翌朝の通知も届きません**）。
- ときどき（月に 1 回くらい）Firebase コンソールの「**使用量と請求額**」（または「Firestore Database」→「使用状況」）で、読み取りの数を確認してください。1 日の読み取りが 3 万回を超える日が出てきたら、シリーズ一覧や履歴の全期間の検索を開く回数を控えるか、Blaze プラン（従量課金。無料枠を超えた分だけ少額の料金がかかります）を検討してください。
- 上限に達すると、アプリに「**利用量の上限（無料枠）に達しました**」と表示されます。日本時間の 17 時（米国の夏時間の間は 16 時）を過ぎると元に戻ります。

### リポジトリは非公開にしておく

公開（Public）リポジトリでは、**60 日間リポジトリに変更が無いと定期実行（毎朝の通知）が自動で止まります。** 非公開（Private）にしておけば止まりません。リポジトリの「Settings」→「General」の一番下（Danger Zone）の「Change repository visibility」で変更できます。

止まってしまった場合は、「Actions」→「返却日の通知」を開き、表示される「Enable workflow」を押すと再開します。

### よくあるトラブル

**デプロイ（Actions の「デプロイ」）が失敗する**

- 「app.config.json の設定が足りません」→ 手順 4・5 の値が `app.config.json` に入っているか確認します（入れた変更が `main` に取り込まれているかも）。
- 「FIREBASE_SERVICE_ACCOUNT が未設定です」→ 手順 6 の Secrets を確認します（名前のつづり間違いに注意）。
- `HTTP Error: 403` / `Permission denied` / `PERMISSION_DENIED` → `github-actions` の権限が足りません。手順 5 の Cloud Shell で `karita_setup` をもう一度実行し、手順 6 の `FIREBASE_SERVICE_ACCOUNT` を新しい鍵で登録し直します（権限の反映まで数分かかることがあります）。
- `Failed to get Firebase project` / `Invalid project id` → `app.config.json` の `projectId` がプロジェクト ID（表示名ではなく ID）になっているか確認します。
- `Cloud Firestore API has not been used` / データベースが無い → 手順 3 で Firestore を作成したか確認します。
- 「型チェック」「単体テスト」「セキュリティルールのテスト」の手順が赤い → テストが失敗したので、デプロイは行われていません（公開中のアプリは前のまま）。ログの `FAIL` や `✗`・`×` の行に、失敗したテストの名前が出ます。直前の変更が原因なので、その変更を直す（または元に戻す）と次の push でデプロイされます。「セキュリティルールのテスト」だけが `Java` や `emulator` のエラーで失敗したときは、GitHub 側の一時的な問題のことがあるので、「Re-run jobs」でやり直します。

**ログインできない**

- ホーム画面のアプリで Google ログイン後に画面が戻ってこない → 手順 11 の 4（リダイレクト URI の追加）を行ったか確認します。`app.config.json` の `authDomain` は空のまま（自動で `<project>.web.app`）にします。ログイン画面が「Google でログイン」の処理中のままになったときは、下の「キャンセル」を押すか、そのままメールアドレスでログインできます。
- `auth/unauthorized-domain` → 手順 11 の 5（承認済みドメイン）を確認します。
- `redirect_uri_mismatch`（Google の画面のエラー）→ 手順 11 の 4 を確認します。追加した直後は反映まで時間がかかることがあります。
- メールアドレスで登録したパスワードを忘れた → ログイン画面のパスワード再設定から、再設定用のメールを送れます。メールが届かないときは迷惑メールフォルダを確認してください。

**「権限がありません」と表示される**

- Firebase コンソールの「Firestore Database」→「ルール」タブに、このリポジトリの `firestore.rules` と同じ内容が入っているか確認します（入っていなければデプロイが失敗しています）。
- 招待リンクで参加した直後なら、アプリを一度閉じて開き直します。

**通知が届かない**

- iPhone が iOS 16.4 以上か確認します（「設定」→「一般」→「情報」）。
- **ホーム画面のアイコンから開いたアプリ**で通知をオンにしたか確認します（Safari のタブで開いた画面からは通知を受け取れません）。
- iPhone の「設定」→「通知」→「かりた本」で通知が許可されているか、集中モード（おやすみモードなど）になっていないか確認します。
- 「Actions」→「返却日の通知」が毎朝動いているか確認します。dry run で対象の本が表示されるかも確認します。
- `app.config.json` の `vapidPublicKey` と、Secrets の `VAPID_PRIVATE_KEY` が、同じとき（手順 5 の同じ実行）に作ったペアか確認します。鍵を作り直した場合は、全員がアプリの「設定」タブ →「返却日の通知」で一度オフにしてからオンにし直します。
- 通知の送り主の連絡先（VAPID の subject）は、空ならアプリの URL（`https://<project>.web.app`）を使います。iPhone にだけ届かず、ログに `BadJwtToken` と出るときは、`app.config.json` の `vapidSubject` に `mailto:自分のメールアドレス` を入れて試します。
- ログに「グループが見つかりません」と出る → `app.config.json` の `notifyGroupIds` の ID が正しいか確認します（手順 9）。グループを作り直した場合は、新しい ID に変えます。
- ログに「NOTIFY_GROUP_IDS が設定されていないため…」の警告が出る → 手順 9 の「通知を送るグループを登録する」を行います。
- ログに「送れない購読…を読み飛ばしました」と出る → このアプリが対応していないブラウザ（またはおかしな値）で登録された通知先です。家族の端末なら、その端末のアプリで通知を一度オフにしてからオンにし直します。失敗には数えません。
- 「NOTIFY_SERVICE_ACCOUNT が未登録です」のエラーで止まる → 手順 6 の Secrets に `NOTIFY_SERVICE_ACCOUNT` を登録します。
- 「Firebase の初期化に失敗しました」・`PERMISSION_DENIED` → `NOTIFY_SERVICE_ACCOUNT` に `notify-bot` の JSON の中身がすべて貼り付けてあるか、`notify-bot` に Cloud Datastore ユーザーのロールが付いているか確認します。
- アプリを削除してホーム画面に追加し直した場合は、通知もオンにし直します。

**バーコードが読み取れない・カメラが起動しない**

- 初回にカメラの使用を聞かれたら「許可」を押します。拒否してしまった場合は、iPhone の「設定」→「アプリ」→「Safari」→「カメラ」を「確認」か「許可」にします。
- 明るい場所で、バーコードを画面の枠いっぱいに映します。読み取れないときは ISBN を手で入力するか、タイトルで検索してください。

**図書館のシールでバーコードが隠れている本**

- 奥付（本の最後のページ）に ISBN が書いてあれば、スキャン画面の「ISBN を手入力」か、「バーコードがない本を追加」の検索欄に ISBN を入れて登録してください。ISBN を付けて登録しておくと、あとで別の本屋さんなどでバーコードを読んだときに「借りたことがあります」と正しく分かります。
- タイトルだけで手入力した本を後でバーコードで読むと、別の本として扱われます。タイトルが同じなら「ISBN なしで登録した同じタイトルの本があります」と表示されるので、借りるときは「同じ本として借りる」を選ぶと、前の本の貸出の記録にまとまります（タイトルの書き方が違うと見つかりません）。

**本の情報（タイトル・表紙）が出ない**

- 書誌情報のサービスが一時的に使えないことがあります。時間をおくか、タイトル検索・手入力で登録してください。
- Google Books の上限に当たっている可能性があります。手順 12 の API キーを設定すると改善します。

**アプリの更新が反映されない**

- 新しい版は、アプリを開いたとき（または 10 分以上たってアプリに戻ったとき）に裏で読み込まれます。開いた直後ならその場で再読み込みされます。使っている途中なら、入力中の内容が消えないよう、**次に別の画面へ移るとき**に新しい版で開き直します（その画面のまま待っていても切り替わりません）。
- すぐに反映させたいときは、アプリを完全に閉じて（ホーム画面でスワイプして終了）、開き直します。

**朝から急にアプリがデータを読めない（「利用量の上限（無料枠）に達しました」）**

- Firebase コンソールの「**使用量と請求額**」（または「Firestore Database」→「使用状況」）で読み取り・書き込みの数を確認します。家族の使い方（上の「Firestore の読み取りの目安」）に比べて極端に多いときは、家族以外の人がこのアプリでアカウントやグループを大量に作っている可能性があります（アプリの設定値は公開されているため、作ること自体は防げません）。
- 「Firestore Database」→「データ」→ `groups` に、見覚えのないグループが大量にあれば、コンソールで削除します。
- 毎朝の通知は、`notifyGroupIds`（手順 9）を登録していれば家族のグループだけを読むので、ほかのグループが増えても通知の読み取りは増えません。登録していなければ登録してください。
- 上限に達しても課金はされず、日本時間の 17 時（米国の夏時間の間は 16 時）を過ぎると元に戻ります。

---

## 14. （開発者向け）ローカルでの開発

必要なもの: Node.js 22、Java 21 以上（Firebase エミュレータ用）。

```sh
npm ci
cp .env.example .env.local   # VITE_USE_EMULATORS=true にする（実プロジェクトの値は空のままでよい）
npm run emulators            # 別のターミナルで。Auth: 9099 / Firestore: 8080（データは終了時に消える）
npm run dev                  # http://localhost:5173
```

- 実際の Firebase プロジェクトにつなぐ場合は、`.env.local` に `VITE_FIREBASE_*` を設定し、`VITE_USE_EMULATORS=false` にします（実データが変更されるので注意）。
- iPhone 実機で試す場合、カメラと Service Worker は HTTPS（または localhost）でしか動かないため、デプロイした環境で確認するのが簡単です。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run typecheck` | 型チェック |
| `npm test` | 単体テスト（Vitest） |
| `npm run test:rules` | Firestore セキュリティルールのテスト（エミュレータを自動で起動） |
| `npm run build` | 本番用ビルド（`dist/`） |
| `npm run emulators` | Firebase エミュレータ（Auth・Firestore・Hosting） |
| `npm run gen:vapid` | 通知用の VAPID 鍵を作る |
| `npx tsx scripts/notify/index.ts --dry-run` | 通知の内容を確認（`FIREBASE_SERVICE_ACCOUNT` などの環境変数が必要） |
| `node scripts/generate-icons.mjs` | アイコン（`public/icons/`）を作り直す（Playwright が必要） |
