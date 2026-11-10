# Google Cloud Shell に貼り付けて実行する準備用のコマンド（docs/setup.md の手順 5 と同じ内容）。
# 全部をまとめて貼り付けて Enter を押し、「プロジェクト ID」を聞かれたら入力して Enter を押す。
#
# 行うこと:
#   - デプロイと通知に使う Google Cloud の機能（API）を有効にする
#   - ロボット用アカウント（サービスアカウント）を 2 つ作り、必要な権限だけを付ける
#       github-actions … アプリの公開（デプロイ）用
#       notify-bot     … 毎朝の通知用（データの読み書きだけ）
#   - それぞれの鍵（JSON）と、通知用の鍵のペア（VAPID 鍵）を作る
#   - GitHub に登録する 3 つの値を ~/karita-setup/ にファイルで保存し、エディタで開く
# 何度実行しても構わない（作り済みのものはそのまま使う。鍵は実行するたびに新しく作られる）。

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
