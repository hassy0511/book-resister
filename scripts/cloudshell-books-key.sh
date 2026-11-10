# Google Cloud Shell に貼り付けて実行する、Google Books の API キーを作るコマンド（docs/setup.md の手順 12）。
# 全部をまとめて貼り付けて Enter を押し、「プロジェクト ID」を聞かれたら入力して Enter を押す。
#
# キーなしの Google Books は世界中の利用者と 1 日の上限を分け合っていて、日本の朝にはもう使い切られていることが多い
# （エラー 429）。自分のキーを作ると、このプロジェクト専用の上限（1 日 1,000 回）になる。無料・請求先の登録も不要。
# キーは、このアプリの URL（<project>.web.app / <project>.firebaseapp.com）からの Books API の呼び出しにだけ使えるよう
# 制限する。アプリの中に入って誰でも見られる値なので、app.config.json に書いてよい。
# 何度実行しても構わない（作り済みならそのキーを表示する）。

karita_books_key() {
  local PROJECT_ID=""
  read -r -p "Firebase のプロジェクト ID を入力して Enter: " PROJECT_ID
  PROJECT_ID="$(printf '%s' "$PROJECT_ID" | tr -d '[:space:]')"
  if [ -z "$PROJECT_ID" ]; then
    echo "!! プロジェクト ID が空です。もう一度「karita_books_key」と入力して Enter を押してください。"
    return 1
  fi
  gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
  if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    echo "!! プロジェクト「$PROJECT_ID」が見つかりません。プロジェクト ID を確かめてください。"
    return 1
  fi

  echo "== 1/3 Books API を有効にしています（1 分ほどかかることがあります）"
  gcloud services enable books.googleapis.com apikeys.googleapis.com ||
    { echo "!! Books API を有効にできませんでした。"; return 1; }

  echo "== 2/3 キーを作っています"
  local name
  name="$(gcloud services api-keys list --filter='displayName=karita-books' --format='value(name)' 2>/dev/null | head -n 1)"
  if [ -z "$name" ]; then
    gcloud services api-keys create --display-name=karita-books \
      --api-target=service=books.googleapis.com \
      --allowed-referrers="https://${PROJECT_ID}.web.app/*,https://${PROJECT_ID}.firebaseapp.com/*" >/dev/null 2>&1 ||
      { echo "!! キーを作れませんでした。少し待ってから「karita_books_key」と入力してやり直してください。"; return 1; }
    name="$(gcloud services api-keys list --filter='displayName=karita-books' --format='value(name)' 2>/dev/null | head -n 1)"
  fi
  if [ -z "$name" ]; then
    echo "!! 作ったキーが見つかりません。少し待ってから「karita_books_key」と入力してやり直してください。"
    return 1
  fi

  echo "== 3/3 キーを取り出しています"
  local key
  key="$(gcloud services api-keys get-key-string "$name" --format='value(keyString)' 2>/dev/null)"
  if [ -z "$key" ]; then
    echo "!! キーを取り出せませんでした。少し待ってから「karita_books_key」と入力してやり直してください。"
    return 1
  fi
  echo
  echo "========================================================================"
  echo " できました。次の 1 行（AIza で始まる）を Claude に送ってください。"
  echo " （このアプリの URL からしか使えないよう制限してあるので、送って大丈夫です）"
  echo
  echo " $key"
  echo "========================================================================"
}

karita_books_key
