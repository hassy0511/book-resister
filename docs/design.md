# 設計書（実装用）

要件は [requirements.md](./requirements.md) を参照。ここでは実装の取り決め（構成・データ・モジュール間の約束）をまとめる。
**モジュールの公開 API（関数名・引数・戻り値）はこの文書が正。** 変更が必要になったらこの文書も更新する。

## 1. 構成

| 項目 | 採用 |
|---|---|
| 言語 / ビルド | TypeScript（strict）、Vite 8、React 19 |
| ルーティング | react-router-dom v7（`BrowserRouter`。Firebase Hosting で SPA の rewrite を設定） |
| スタイル | CSS Modules（`*.module.css`）＋ `src/styles/global.css` の CSS 変数。UI ライブラリは使わない |
| 認証 / DB | Firebase Authentication（Google・メール＋パスワード）、Cloud Firestore（オフラインキャッシュ有効） |
| PWA | vite-plugin-pwa（`injectManifest`、Service Worker は `src/sw.ts`） |
| バーコード | `@zxing/browser` |
| 書誌情報 | openBD → 国立国会図書館サーチ → Google Books の順で試す（ブラウザから直接呼ぶ。失敗しても次へ） |
| 定期通知 | GitHub Actions（毎朝）で `scripts/notify` を実行し、Web Push を送信 |
| テスト | Vitest（ロジック）、`@firebase/rules-unit-testing` ＋ Firestore エミュレータ（セキュリティルール） |

無料（Firebase Spark プラン）で動かすため、**Cloud Functions と Cloud Storage は使わない**。

## 2. ディレクトリと担当範囲

```
src/
  main.tsx                 エントリ。SW 登録（virtual:pwa-register）
  swUpdate.ts              新しい版の SW が有効になったときの再読み込みの時機（5.1「新しい版への切り替え」）
  App.tsx                  ルーティング、Provider の組み立て、ログイン/グループ参加のガード
  types.ts                 共有データ型（Firestore と 1 対 1）
  firebase.ts              Firebase 初期化（app / auth / db）
  sw.ts                    Service Worker（プリキャッシュ、SPA フォールバック、push / notificationclick）
  auth/AuthProvider.tsx    useAuth()
  group/GroupProvider.tsx  useGroup()
  data/                    Firestore 読み書き（フック＋関数）。ページは Firestore を直接触らずここを使う
  lib/                     UI に依存しない純粋ロジック（日付、ISBN、シリーズ推定、書誌検索、プッシュ購読）
  state/borrowCart.tsx     借りる予定の本（カート）。localStorage に保存
  components/ui/           汎用 UI 部品
  components/              ドメイン部品（LoanRow など）
  components/scanner/      バーコードスキャナ
  pages/<領域>/            画面
  styles/global.css        CSS 変数・リセット
scripts/notify/            毎朝の通知送信スクリプト（Node, tsx で実行）
tests/rules/               Firestore セキュリティルールのテスト
```

## 3. データ（Firestore）

型は `src/types.ts` が正。パスと要点：

| パス | 内容 | 補足 |
|---|---|---|
| `users/{uid}` | `UserProfile` | 本人のみ読み書き。`groupId` は自分がメンバーのグループのみ設定可 |
| `groups/{gid}` | `Group` | メンバーのみ読める。メンバーは `name` と `invitesValidAfter`（招待の一括無効化。値は今の時刻＝`request.time` だけ、削除不可）を変更できる |
| `groups/{gid}/members/{uid}` | `Member` | 作成は本人のみ。グループ作成者 or 有効な招待コードを持つ人。削除は本人（抜ける）か、メンバー（他の人を外す。F-07）。他の人を外すときは同じ書き込みで `groups/{gid}.invitesValidAfter` を今の時刻にする（ルールで必須） |
| `invites/{code}` | `Invite` | ログイン済みなら code 指定で `get` 可（`list` 不可）。有効期限 7 日。期限内なら何人でも使える。有効＝期限内かつ `createdAt` がグループの `invitesValidAfter`（無ければ 1970 年）より後 |
| `groups/{gid}/locations/{id}` | `Location` | |
| `groups/{gid}/books/{id}` | `Book` | ISBN がある本の ID は `isbn-<ISBN13>` |
| `groups/{gid}/series/{id}` | `Series` | |
| `groups/{gid}/loans/{id}` | `Loan` | 貸出中は `returnedOn == null` |
| `groups/{gid}/pushSubscriptions/{id}` | `PushSubscriptionDoc` | ID は endpoint の SHA-256（16 進）。本人のもののみ読み書き。endpoint は主要なブラウザのプッシュサービスのみ、鍵は p256dh 65 バイト・auth 16 バイトの base64url（6 章） |

- 日付（借りた日など）は `'YYYY-MM-DD'`（端末のローカル日付）。作成・更新日時は `serverTimestamp()`（ルールで `request.time` と一致を確認する）。
- `firestore.rules` はフィールドの集合（過不足なし）・型・範囲を確認する。文字数の上限は次のとおり（`src/data/common.ts` の `TEXT_LIMITS` と一致させる）。書誌 API から来た値は data 層で切り詰め、利用者の入力は日本語のエラーにする。

| 項目 | 上限 |
|---|---|
| 表示名・グループ名・招待の groupName | 1〜50 文字 |
| 場所の名前 / メモ | 100 / 1000 文字（画面では名前を 40 文字に制限） |
| シリーズ名 / 全巻数 | 200 文字 / 1〜9999 |
| 本のタイトル / 出版社 | 300 / 200 文字 |
| 著者 | 10 人まで、1 人 200 文字、合計 2000 文字（ルールにループが無く、要素の型は添字で 1 つずつ確かめるため。確かめる数を増やすと式の評価数の上限 1000 に当たる。書誌 API の 11 人目以降は `clipAuthors` で落とす） |
| 表紙 URL | `http(s)://` で始まる 2048 文字以内 |
| 巻数 | 0〜99999 の整数 |
| 感想 / 評価 | 2000 文字 / 1〜5 の整数 |
| 招待コード / 有効期限 | `^[A-Za-z0-9_-]{16,64}$` / 作成時刻 + 8 日以内（端末の時計のずれを見込む） |
- **招待の取り消しとメンバーを外す（F-07）。** 招待は一覧できない（`list` 不可）ので 1 本ずつは消さず、`groups/{gid}.invitesValidAfter` を今の時刻にしてそれより前の招待をまとめて無効にする（招待で参加する members の作成・上書きのルールで `invite.createdAt > invitesValidAfter` を確かめる）。他のメンバーを外すときも同じバッチで無効にするので、外した人は手元の招待リンクや自分で作った招待で戻れない。グループの作成者は外されても招待なしで戻れる（`joinsAsCreator`。作成者は運用者で、部外者に外されたときの戻り道）。外された人の端末は `GroupProvider` の permission-denied で未参加の扱いになり、通知はメンバーの購読にだけ送るので届かなくなる（購読のドキュメントは消さない）。
- **複合インデックスは使わない。** クエリは単一フィールドの条件か並び替えのみとし、残りはクライアントで絞り込む・並べ替える。
- **読み取りの回数（Spark の無料枠は 5 万回／日）。** 購読は画面ごとに付け外しされ、前回から 30 分以上空けて購読し直すと結果の全件分が読み取りとして数えられる（`persistentLocalCache` の差分の読み取りは 30 分以内だけ）。貸出記録は削除しないので年 1,000 件ずつ増え続ける。そのため、コレクション全件の購読は全件が本当に必要な画面だけにする。
  - 既読チェック: ISBN から決まる ID の 1 冊（`useBook`）・同じシリーズの本（`useBooksInSeries`）・ISBN なしの本（`useBooksWithoutIsbn`）だけ。借りる確認: カートの本（`useBooksByIds`）と ISBN なしの本だけ。
  - 履歴: 最初は借りた日の新しい順に 1 ページ分（101 件）、期間で絞り込めばその期間だけ、全期間の検索・絞り込み・「もっと見る」・絞り込みシートで全件（`useHistoryLoans`）。F-60〜62 のとおり、全期間の検索・絞り込みは全件を対象にする。
  - 全件を読むのは、シリーズ一覧（シリーズに入っている本 `useSeriesBooks` ＋ 貸出記録の全件。集計に要るため）、履歴の全期間の検索など、本の追加（タイトルの部分一致に本の全件）。
  - 目安: 30 分以上空けて開くたびに「シリーズ一覧＝シリーズ数＋シリーズの本の冊数＋貸出記録数」「履歴の全期間の検索＝貸出記録数」「本の追加＝本の冊数」。貸出記録が数千件になり使用量が上限に近づいたら（手順書 13 章）、シリーズ文書に集計値を持たせる非正規化などを検討する（Cloud Functions が無いので、貸出の登録・返却・取り消し・編集・削除のすべてでクライアントから整合させる必要がある）。
- `Loan.book` は本情報のコピー。`updateBook` で本を編集したら、その本の貸出記録の `book` も一括更新する。

## 4. モジュールの公開 API

### 4.1 `src/lib/date.ts`

```ts
todayString(now?: Date): DateString              // 端末のローカル日付（now はテスト用）
addDays(date: DateString, days: number): DateString
diffDays(from: DateString, to: DateString): number // to - from（日数）
formatDate(date: DateString, opts?: { withYear?: boolean; today?: DateString }): string // 例 "11月8日(日)"。今年でなければ年を付ける
dueStatus(dueOn: DateString, today?: DateString): 'overdue' | 'soon' | 'ok' // soon = 今日〜3日後
dueLabel(dueOn: DateString, today?: DateString): string // 例 "2日超過" "今日まで" "明日まで" "あと5日"
```

- 不正な入力でも例外は出さない（描画中に落とさないため）。addDays は入力をそのまま、diffDays は NaN、formatDate は入力をそのまま、dueStatus は 'ok'、dueLabel は '' を返す。

### 4.2 `src/lib/isbn.ts`

```ts
normalizeIsbn(input: string): string | null  // ISBN-10/13（ハイフン可）→ ISBN-13。不正なら null
  // 「ISBN」「ISBN-13:」などの接頭辞・各種ハイフン・全角も可。「ISBN 1338878921」のように接頭辞の後ろの
  // 10／13 が ISBN-10 の先頭の数字のこともあるので、取り除いた形と残した形の両方を試す
isBookEan(code: string): boolean             // 978/979 で始まりチェックディジットが正しい 13 桁
bookIdForIsbn(isbn13: string): string        // `isbn-${isbn13}`
formatIsbn(isbn13: string): string           // 表示用（ハイフン区切り不要なら素の 13 桁でよい）
```

### 4.3 `src/lib/series.ts`

```ts
guessSeries(title: string): { seriesName: string | null; volume: number | null }
  // 「おしりたんてい (3)」「マジック・ツリーハウス 12」「〇〇 第3巻」「〇〇 ③」「〇〇 vol.2」などから推定
guessSeriesDetail(title: string): { seriesName; volume; position: '上' | '中' | '下' | '前' | '後' | null }
parseVolume(text): number | null              // API の巻次（「3」「第3巻」「下」など）
parseVolumePosition(text) / titleVolumePosition(title): 上・中・下／前・後 の位置（無ければ null）
resolvePositionVolume(book: { title; volume; position? }, siblings): number | null
  // 「下」（巻数 2）と同じシリーズに「中」があれば 3、それ以外は book.volume のまま
normalizeSeriesName(name: string): string   // 比較用（NFKC、空白・記号除去、小文字化、末尾の「シリーズ」除去）
findMatchingSeries<T extends { name: string }>(name: string, list: T[]): T | null
```

- 上・中・下は 上=1・中=2・**下=2**、前編=1・後編=2。日本の本は上下 2 冊組が 3 冊組よりはるかに多く、下=3 にすると存在しない 2 巻が「抜けている巻」（F-74）・「まだの巻」（F-82）に出るため。タイトルからの推定と API の巻次（`parseVolume`）は同じ表を使う。
- 3 冊組の「下」は推定の段階では分からないので、保存の直前（借りる確認の登録、`borrowLogic.volumeForSave`）に同じカートの同じシリーズに「中」の本があれば 3 巻にする。登録済みの他の本の巻数は書き換えない（利用者が手で直した巻数を上書きしないため。巻数が自動の推定かどうかは記録していない）。「下」を 2 巻で登録した後に「中」を登録すると 2 巻が 2 冊になる（抜けは出ない。手で直せる、F-71）。下=3 で登録済みの本は移行しない（手で直す）。
- 「第456号」のような号数は巻数にしない（月刊絵本の号数を巻数にすると 1〜455 号が「抜け」になるため）。

### 4.4 `src/lib/bookLookup/index.ts`

```ts
lookupByIsbn(isbn13: string, opts?: { signal?: AbortSignal }): Promise<BookCandidate | null>
  // openBD → NDL → Google Books。最初に見つかった結果を基に、欠けている項目（表紙など）を後続で補う
  // シリーズ名・巻数が定まらない場合（API にもタイトルにも無い）は NDL も呼ぶ（Google Books は呼ばない）
  // シリーズ名・巻数は API の値を優先し、無ければ guessSeries(title) で推定
searchByTitle(query: string, opts?: { signal?: AbortSignal }): Promise<BookCandidate[]>
  // NDL ＋ Google Books。ISBN で重複除去、最大 20 件
lookupByIsbnDetailed(isbn13, opts?): Promise<{ candidate: BookCandidate | null; failed: boolean }>
searchByTitleDetailed(query, opts?): Promise<{ candidates: BookCandidate[]; failed: boolean }>
  // failed: 見つからず（0 件で）、しかも 1 つ以上の API が通信に失敗した（該当なしと確かめられていない）
```

- 各 API 呼び出しは try/catch し、失敗（CORS・タイムアウト・上限）しても例外を外に出さない。タイムアウト 8 秒。
- 通信の失敗（通信エラー・タイムアウト・HTTP エラー（429・5xx）・壊れた応答）と「該当なし」を区別する（`http.ts` の `fetchJsonResult`/`fetchTextResult` が失敗の理由を返す）。呼び出し側の signal による中断は失敗に数えない。すべてではなく 1 つでも失敗すれば failed にする（openBD が該当なしでも NDL・Google が失敗していれば、無いとは確かめられていない）。キー無しの Google Books は 429 になりやすいので「つながりませんでした」が増えるが、画面の再取得・手入力で対応する。
- 画面は failed のとき「検索サービスにつながりませんでした（電波のよい場所で再取得するか、手入力してください）」と案内し、再取得できるようにする（借りる確認・スキャンの通知・本の追加・既読チェック。4.10、5.1）。
- 後続の API を呼ぶかは `missingFields`（`merge.ts`）で決める。'series' はシリーズ名か巻数が定まらないこと（`finalizeCandidate` によるタイトルからの推定も含めて判断するので「おしりたんてい (3)」「ONE PIECE 104」では呼ばない）。NDL の dcndl:seriesTitle（「かいけつゾロリシリーズ ; 36」）を使うため。副作用として、シリーズの無い単発の本では NDL を 1 回多く呼ぶ（借りる・既読チェックの待ち時間が少し増える）。シリーズのためだけに呼んだ NDL のシリーズに巻数が無ければ使わない（`isLabelLikeSeriesName` で除けない叢書名をシリーズにしないため）。`fillMissing` の「先の API の値が優先」は変えない。
- openBD: v1 は 2023-07 に提供終了が告知され（JPRO からのデータ配信は 2023-06 に停止）、2023-08 以降の `api.openbd.jp/v1/get` は国立国会図書館の書誌（CC-BY）を元にした代替データを同じ仕様で返している（少なくとも 60 か月の提供。**2028 年ごろに見直す**。終わったら `ISBN_SOURCES` から外すか見直す）。新刊・書影の収録は以前より狭いが、未登録は `[null]` がすぐ返る（往復 1 回分）ので先頭のままにしている。今は主に書影と ONIX 由来のシリーズ情報（Collection・PartNumber）の取得元として働く。要件の「取得できる情報と優先順位は実装時に検証する」の結果として、openBD（書影・ONIX のシリーズ）→ NDL（書誌・シリーズの巻次）→ Google Books（書影の補い。キー無しでは上限に当たりやすい）の順にしている。
- NDL のタイトル検索は資料種別を絞らずに 50 件取り（`cnt=50`）、記事・論文・雑誌などは受け取った後で除く。除く分と同じ ISBN の重複レコード（国立国会図書館・公共図書館）も枠を使うため、表示の最大 20 件より多めに取る。資料種別の絞り込み（mediatype）は受け付ける値を本番の API で確かめられないので使わない。
- 出版社のレーベル名らしいシリーズ名（末尾が 文庫・新書・コミックス・絵本 など）はシリーズとして使わず、タイトルから推定する。
- `searchByTitle` に ISBN として読める文字列（`normalizeIsbn` が読める。「ISBN978-4-…」・U+2010 のハイフン・全角Ｘも可）を渡すと `lookupByIsbn` の結果（0 件か 1 件）を返す。
- Google Books は `VITE_GOOGLE_BOOKS_API_KEY` があれば `key=` を付ける。
- 表紙が無い場合は NDL のサムネイル URL `https://ndlsearch.ndl.go.jp/thumbnail/{isbn13}.jpg` を候補にしてよい（`<img>` 表示のみ。読み込み失敗時は `BookCover` がプレースホルダに切り替える）。

### 4.5 `src/lib/push.ts`

```ts
type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'
isStandalone(): boolean
getPushState(): Promise<PushState>   // iOS で standalone でなければ 'needs-install'
enablePush(groupId: string, uid: string): Promise<void>  // 許可を求め、購読し、Firestore に保存（ユーザー操作の中で呼ぶ）
disablePush(groupId: string): Promise<void>
showTestNotification(): Promise<void> // SW の showNotification でローカル表示
```

- 端末の購読が現在の `VITE_VAPID_PUBLIC_KEY` と違う鍵で作られていれば 'off' を返す（enablePush で作り直す）。
- 保存する購読情報は `{ uid, endpoint, keys: { p256dh, auth }, userAgent, createdAt }` のみ（ルールが余計なフィールドを拒否する）。
- ログアウト時は設定画面が先に `disablePush(groupId)` を呼ぶ（失敗は無視、最大 3 秒）。

### 4.6 `src/firebase.ts`

```ts
export const app: FirebaseApp
export const auth: Auth
export const db: Firestore   // initializeFirestore + persistentLocalCache({ tabManager: persistentMultipleTabManager() })
export const isFirebaseConfigured: boolean // VITE_FIREBASE_* が揃っているか（未設定ならセットアップ案内を表示）
```

`VITE_USE_EMULATORS=true` のときは Auth（9099）と Firestore（8080）のエミュレータに接続する。

### 4.7 `src/auth/AuthProvider.tsx`

```ts
<AuthProvider>
useAuth(): {
  user: User | null; loading: boolean;
  signInWithGoogle(): Promise<void>;            // popup → 失敗（popup-blocked 等）時は redirect にフォールバック。iOS のホーム画面のアプリ（standalone）は最初から redirect
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  redirectError: string | null;                 // redirect でのログイン失敗（日本語）。ログイン画面に表示する
}
```

- 失敗時は日本語メッセージの Error を投げる（元の `code` と `cause` を保持）。利用者が Google のポップアップを自分で閉じた場合はエラーにしない。
- iOS のホーム画面のアプリ（`isIos() && isStandalone()`）では、Firebase がポップアップの代わりにアプリ内ブラウザのシートを開き、ブロックも「閉じた」ことも検知できない（結果も戻らないことがある）ため、最初から `signInWithRedirect` を使う（authDomain をアプリと同じドメインにしているので同じ保存領域に戻る）。新しい呼び出しで取り消された前の呼び出し（`cancelled-popup-request`）はリダイレクトに切り替えず、何もせず終える。
- ログイン画面は、Google の待ち中でもメールアドレスの欄とボタンを使えるようにし、「キャンセル」で待つのをやめられる（ほかの環境でポップアップの結果が戻らない場合に備える。一定時間での打ち切りはしない。Google のパスワードを入力中の人を待たせないため）。
- ログイン画面はログイン成功後に navigate しない（App の `/login` ルートが戻り先へ移す）。

### 4.8 `src/group/GroupProvider.tsx`

```ts
<GroupProvider>   // AuthProvider の内側
useGroup(): {
  loading: boolean;
  profile: UserProfile | null;
  groupId: string | null;
  group: WithId<Group> | null;
  members: WithId<Member>[];
  memberName(uid: string): string;              // 不明なら '（不明）'
  createGroup(groupName: string, displayName: string): Promise<string>;  // group + member + users を 1 バッチで
  joinGroup(code: string, displayName: string): Promise<void>;           // member + users（+ 前のグループの member 削除）を 1 バッチで
  updateDisplayName(displayName: string): Promise<void>;                 // users と members の両方
  updateGroupName(name: string): Promise<void>;
  error: Error | null;                          // 読み込みエラー（日本語）
}
useRequiredGroup(): { groupId: string; uid: string; ... }  // グループ参加済みの画面用（未参加なら例外）
```

- `groups/{gid}` の読み取りが（再試行後も）permission-denied なら、メンバーでなくなったとみなして `groupId` を null にする。
- `joinGroup` は同じグループに参加済みなら何もしない。別のグループに参加中なら、前のグループの `members/{uid}` を同じバッチで削除する（1 人 1 グループ。前のグループのデータと通知から外れる）。画面（JoinPage）は別グループ参加中の人の参加を止めて案内する。
- 文字数は表示名・グループ名とも 50 文字まで。

### 4.9 `src/data/*`

共通: フックは `QueryResult<T> = { data: T; loading: boolean; error: Error | null }` を返す（`src/data/common.ts`）。
フックは `useRequiredGroup()` から groupId を取る。書き込み関数は第 1 引数に `groupId` を取る。

- 書き込み関数はサーバーの応答を最大 4 秒待ち、それを過ぎたら（またはオフラインなら）端末に保存済みとして完了する（後で自動送信）。待ち時間内に返ったエラー（権限など）は日本語の Error で投げる。`createGroup` / `joinGroup` は常にサーバーの保存を待ち、`createInvite` は最大 15 秒待つ。
  - 共通の `settleWrite(write, { ignoreError? }): Promise<'confirmed' | 'local'>`（`common.ts`）。一度 4 秒を過ぎたら 30 秒は長くは待たない（電波の弱い所で何度も待たせない）が、その間とオフラインのときも 50 ミリ秒だけ待ち、すぐ返る拒否は投げる。書き込みが成功しても拒否されても（＝サーバーに届いている）30 秒の待たない期間を終える。
  - 完了扱いにした後でサーバーに拒否された書き込みは、Firestore が端末からも取り消すため、`onLateWriteFailure` の登録先に知らせる。`GroupProvider` がトースト（「保存できなかった変更があります（理由）。内容を確かめて、もう一度入力してください。」）を出す。
- 購読関数 `docSubscriber(ref, { missingAfterMs? })`: キャッシュに無いだけの「存在しない」はサーバーの応答を待つが、`missingAfterMs` を指定するとその時間で（オフラインならすぐに）「存在しない」とみなす（未登録の本を確認する既読チェックが読み込み中のままにならないように）。
- 書き込み前に入力を確認し、不正なら日本語の Error を投げる（貸出期間 1〜365 の整数、評価 1〜5、日付は実在する YYYY-MM-DD、返却日は借りた日以降、名前・タイトルは必須、3 章の文字数の上限）。
- 購読フックは permission-denied を数回（0.5〜6 秒）再試行する（グループ作成・参加の直後の反映待ち）。
- `useBook` / `useLoan` / `useSeries` はキャッシュに無いだけの「存在しない」ではサーバーの応答を待つ。ID が不正なら `{ data: null, loading: false }`。

```ts
// locations.ts
useLocations(opts?: { includeArchived?: boolean }): QueryResult<WithId<Location>[]>  // 名前順
addLocation(gid, input: { name: string; defaultLoanDays: number; memo: string }): Promise<string>
updateLocation(gid, id, patch: Partial<Pick<Location, 'name' | 'defaultLoanDays' | 'memo' | 'archived'>>): Promise<void>

// series.ts
useSeriesList(): QueryResult<WithId<Series>[]>
useSeries(seriesId: string | undefined): QueryResult<WithId<Series> | null>
createSeries(gid, name: string, totalVolumes?: number | null): Promise<string>
updateSeries(gid, id, patch: Partial<Pick<Series, 'name' | 'totalVolumes'>>): Promise<void>
findOrCreateSeries(gid, name: string): Promise<string>   // normalizeSeriesName で既存と照合。無ければ seriesIdForName の ID で作る
seriesIdForName(name: string): string | null              // 's-' + 正規化した名前のハッシュ（32 桁の 16 進）。2 台で同時に作っても 1 つにまとまる
  // 別の端末が先に同じ ID で作っていると、この作成は更新として扱われルールで拒否される（createdAt が違う）。ID は同じなので成功とみなす
  // その ID のシリーズが別の名前に変えられていればランダムな ID で作る。トランザクションはオフラインで使えないので使わない
mergeSeries(gid, fromId: string, intoId: string): Promise<void>   // from の本を into に移して from を削除（writeBatch。全巻数は into、無ければ from の値）
deleteSeries(gid, id: string, opts?: { detachBooks?: boolean }): Promise<void>  // 本があれば detachBooks のときだけ本の seriesId を null にして削除

// books.ts
useBook(bookId: string | undefined, opts?: { missingAfterMs?: number }): QueryResult<WithId<Book> | null>
useBooks(): QueryResult<WithId<Book>[]>                     // 全件（本の追加のタイトル検索用。3 章の読み取りの回数を参照）
useSeriesBooks(): QueryResult<WithId<Book>[]>               // seriesId != null の本だけ（シリーズ一覧）
useBooksWithoutIsbn(enabled?: boolean): QueryResult<WithId<Book>[]>  // isbn == null の本だけ（同じタイトルの手がかり）
useBooksByIds(bookIds: readonly string[]): QueryResult<WithId<Book>[]>  // ドキュメント ID の in クエリを 30 件ずつ（借りる確認）
useBooksInSeries(seriesId: string | undefined): QueryResult<WithId<Book>[]>
getBook(gid, bookId): Promise<WithId<Book> | null>
findBookForCandidate(gid, c: BookCandidate): Promise<WithId<Book> | null> // ISBN なら ID で、無ければタイトル完全一致（pickTitleMatch）
  // pickTitleMatch: 両方に著者があり 1 人も重ならない本・両方に巻数があり値が違う本は除き、著者が重なる本 → ISBN なしの本 → 先の本の順に選ぶ
  // （著者の一致は必須にしない。シールでバーコードが隠れた本の手入力はタイトルだけのことが多いため）
upsertBookFromCandidate(gid, c: BookCandidate, series: { seriesId: string | null; volume: number | null }, opts?: UpsertBookOptions): Promise<string>
saveBookFromCandidate(gid, c, series, opts?: UpsertBookOptions): Promise<{ id: string; existing: WithId<Book> | null }>
  // 既存があればその ID を返す（既存の空欄だけ補完し、シリーズ未設定なら設定）。無ければ作成
  // opts.bookId: 結び付けた既存の本の ID（あればタイトルで探し直さない。見つからなければ通常の照合）
  // opts.forceNew: タイトルでの照合をせず別の本として作る（ISBN の本は ID が決まるので無関係）
updateBook(gid, bookId, patch: Partial<Pick<Book, 'title' | 'authors' | 'publisher' | 'coverUrl' | 'seriesId' | 'volume'>>): Promise<void>
  // 該当本の全 Loan の book スナップショットも更新（バッチ）

// loans.ts
useActiveLoans(): QueryResult<WithId<Loan>[]>               // returnedOn == null、dueOn 昇順
useAllLoans(): QueryResult<WithId<Loan>[]>                  // 全件、borrowedOn 降順（シリーズ一覧の集計用）
useHistoryLoans(scope: HistoryScope): QueryResult<WithId<Loan>[]>  // 履歴用。borrowedOn 降順
  // HistoryScope = { kind: 'recent'; count } (orderBy borrowedOn desc + limit) | { kind: 'range'; from; to } (borrowedOn の範囲) | { kind: 'all' }
useLoansForBook(bookId: string | undefined): QueryResult<WithId<Loan>[]>  // borrowedOn 降順
useLoansForBooks(bookIds: string[]): QueryResult<WithId<Loan>[]>          // シリーズ画面用（30 件ずつ in クエリ）
useLoan(loanId: string | undefined): QueryResult<WithId<Loan> | null>
type NewLoanInput = { bookId: string; book: LoanBookSnapshot; locationId: string; borrowerUid: string; borrowedOn: DateString; dueOn: DateString }
createLoans(gid, uid, inputs: NewLoanInput[]): Promise<string[]>   // 1 バッチ
updateLoan(gid, loanId, patch: Partial<Pick<Loan, 'dueOn' | 'locationId' | 'borrowerUid' | 'borrowedOn' | 'rating' | 'review' | 'readStatus' | 'returnedOn'>>): Promise<void>
type ReturnInput = { loanId: string; returnedOn: DateString; readStatus: ReadStatus; rating: number | null; review: string | null }
returnLoans(gid, items: ReturnInput[]): Promise<void>               // 1 バッチ
undoReturn(gid, loanId): Promise<void>                              // returnedOn と readStatus を null に戻す（評価・感想は残す）
deleteLoan(gid, loanId): Promise<void>                              // 誤登録の削除

// invites.ts
createInvite(gid, groupName: string, uid: string): Promise<{ code: string; url: string }>  // url = `${location.origin}/join/${code}`
  // 家族に送るときは画面側（MembersPage の shareableInviteUrl）で ?openExternalBrowser=1 を付ける（5.1 参照）
getInvite(code: string): Promise<WithId<Invite> | null>              // 期限切れは null（一括無効化された招待は読めるが、参加で拒否される）

// members.ts（F-07。どちらもサーバーの応答を 15 秒まで待ち、届かなければ「まだ反映されていません」のエラー）
revokeInvites(gid): Promise<void>                                     // groups/{gid}.invitesValidAfter = serverTimestamp()
removeMember(gid, memberUid, selfUid): Promise<void>                  // invitesValidAfter の更新 + members/{memberUid} の削除を 1 バッチ。自分は不可

// readStatus.ts（純粋関数）
bookReadState(loans: Pick<Loan, 'returnedOn' | 'readStatus'>[]): BookReadState  // 'reading' | 'read' | 'partial' | 'unread' | 'none'
  // 貸出中があれば 'reading'、それ以外は返却済みの中で最良（read > partial > unread）、貸出なしは 'none'
  // 返却済みで readStatus が null の記録は 'unread'。表示名は BOOK_READ_STATE_LABELS（reading = 「貸出中」）
  // 「読んだ巻」の数え方は別（everRead）: 一度でも「読んだ」で返却した巻は、いま読み返すために借りていても
  // 「読んだ巻」に数える（シリーズ一覧・シリーズ詳細の要約・既読チェックの summarizeSeries で共通。5.1 参照）
```

### 4.10 `src/state/borrowCart.tsx`

```ts
<BorrowCartProvider>
useBorrowCart(): {
  items: CartItem[];
  addIsbn(isbn13: string): 'added' | 'duplicate';   // 書誌の取得はカート内で非同期に行う
  addCandidate(c: BookCandidate): 'added' | 'duplicate';
  addExistingBook(book: WithId<Book>): 'added' | 'duplicate';
  update(key: string, patch: Partial<Pick<CartItem, 'seriesName' | 'volume' | 'dueOnOverride' | 'candidate' | 'forceNew'>> & { existingBookId?: null }): void;
  retry(key: string): void;         // 'error'（と 'not-found'）の ISBN の本を 'loading' に戻して取り直す
  remove(key: string): void;
  clear(): void;
}
type CartItem = {                   // 型は src/state/borrowCartLogic.ts に置き、borrowCart.tsx から再 export
  key: string;                      // ISBN があれば isbn13、無ければランダム
  status: 'loading' | 'ready' | 'not-found' | 'error';  // error: 通信の失敗で書誌を確かめられなかった
  candidate: BookCandidate | null;  // not-found・error の場合は null（タイトル手入力を促す）
  isbn: string | null;
  existingBookId: string | null;
  matchedBy: 'isbn' | 'title' | 'chosen' | null;  // 結び付けたきっかけ（ISBN の ID・タイトルの一致・利用者が選んだ本）
  forceNew: boolean;                // 「別の本として登録」（タイトルで照合しない）
  beforeMatch: { candidate; isbn; seriesName; volume } | null;  // タイトルで結び付ける前の内容（外すと戻す）
  seriesName: string | null;
  volume: number | null;
  dueOnOverride: DateString | null;
}
```

- BorrowCartProvider は `/login` を含む全ルートの外側にあるため、`useRequiredGroup()` ではなく `useGroup()` を使う（未参加ならグループの照合をしない）。
- 別のグループのユーザーがログインしたらカートを空にする。読み込み中のまま再起動した項目は取得し直す。
- 書誌が見つからない項目（'not-found'）・通信の失敗で確かめられなかった項目（'error'、`lookupByIsbnDetailed` の failed）は、利用者がタイトルを入力しても status はそのまま（タイトルの入力欄を出し続ける）。登録できるのは「読み込み中でなく、タイトルのある candidate を持つ」項目（`isItemResolved`）なので、'error' でも手入力すれば登録できる。
- 'error' の項目は取り直せる: 借りる確認の「本の情報を再取得」（`retry`）、同じバーコードをもう一度読み取る（`addIsbn` は 'duplicate' を返し、その項目を取り直す）、保存した内容の復元（'loading' に戻す）。取り直しで書誌が見つかっても、利用者が入力したタイトル・著者は上書きせず空欄だけ補う。iOS では弱い電波のとき `navigator.onLine`・`online` イベントが当てにならないので、自動の再試行はせずボタンで取り直す。
- タイトルの一致で既存の本に結び付けた項目（`matchedBy: 'title'`）は、借りる確認で「同じタイトルの登録済みの本」と示し、「別の本として登録」（`update(key, { forceNew: true })`）で外せる（結び付ける前の内容に戻す）。登録時は `existingBookId` があればその本を使い（`saveBookFromCandidate` の `bookId`）、`forceNew` ならタイトルで照合しない。
- 重複の判定（`findDuplicate`）: 同じ ISBN・同じ既存の本・ISBN なしで同じタイトル。ただし ISBN なしで同じタイトルでも、巻数が両方あって違う場合（月刊絵本の号など）と、カートの側が `forceNew` の場合は別の本とみなす（登録時の照合とそろえ、1 冊に貸出が 2 件付かないようにする）。

### 4.11 UI 部品（`src/components/ui/`、`src/components/`）

`Button`（variant: primary / secondary / danger / ghost、size、block）、`IconButton`、`Card`、`ListRow`、`PageHeader`（title, back, right）、`Page`（PageHeader＋スクロール領域、セーフエリア対応）、`BottomTabBar`、`Sheet`（下から出るモーダル）、`ConfirmDialog`、`TextField`、`NumberField`、`DateField`（`<input type="date">`）、`Select`、`SegmentedControl`、`Chips`（絞り込み用）、`StarRating`、`EmptyState`、`Spinner`、`ToastProvider` / `useToast()`（`{ show(message, { action?: { label, onClick }, tone?: 'default' | 'success' | 'error', duration? }), dismiss }`）、`icons.tsx`（インライン SVG アイコン）。
追加: `LinkButton` / `IconLinkButton`、`ListGroup`、`TextArea`、`ErrorState` / `errorMessage`、`Field`、`layout/SplashScreen`、`layout/ErrorBoundary`、`layout/tabBarVisibility`（`useHideTabBar()`）、`ui/index.ts`（まとめて import 用）。

- 入力部品（TextField / TextArea / NumberField / DateField / Select / SegmentedControl / Chips / StarRating）の `onChange` はイベントではなく値を受け取る（NumberField は `number | null`、Chips は `T | null`）。
- 画面は default export。ルート要素は親の高さいっぱい（`Page` を使えば自動）。body はスクロールせず `Page` の中の main がスクロールする。下部に固定するボタンは `Page` の `footer` に置く。`Page` のスクロール領域の直下の要素は縦に縮まない（`contentClassName` で flex の縦並びにしても Card が潰れない）。

ドメイン部品: `BookCover`（画像＋読み込み失敗時のプレースホルダ）、`DueBadge`（`dueStatus` で色分け）、`LoanRow`（表紙・タイトル・場所名・借りた人・返却日バッジ。props で名前を受け取る）、`ReadStatusPicker`（読んだ / 途中まで / 読んでいない。既定 read）、`ReviewEditor`（★と感想。`value: { rating, review: string }`、保存時は `reviewToPatch()` で空文字を null に）、`SeriesPicker`（既存シリーズ選択 or 新規名入力＋巻数。シリーズは作らない。保存時に `findOrCreateSeries`）、`ReadStateBadge`（`{ state }` に `bookReadState(loans)` の結果を渡す）。

スキャナ: `<BarcodeScanner onDetect={(isbn13) => void} active={boolean} />`（任意で `guideText`、`manualSubmitLabel`、`className`）。`isBookEan` を通ったコードだけを渡し、同じコードは見えなくなってから 2.5 秒は再通知しない（手入力は抑止しない）。カメラが使えない場合は案内と ISBN の手入力欄を出す。重複の扱いは画面側（`cart.addIsbn` の 'duplicate'）。

日付の補助: `src/pages/home/useToday.ts`（`useToday()`。アプリに戻ったときと 1 分ごとに今日の日付を更新）。ホーム・返却・貸出詳細・借りる確認・履歴・シリーズの各画面で使う。

## 5. 画面とルート

| ルート | ファイル | 内容 |
|---|---|---|
| `/login` | `pages/auth/LoginPage.tsx` | Google / メール＋パスワード（ログイン・新規登録・パスワード再設定） |
| `/welcome` | `pages/auth/WelcomePage.tsx` | グループ作成（表示名・グループ名）→ 最初の場所の登録へ。招待リンクの案内 |
| `/join/:code` | `pages/auth/JoinPage.tsx` | 招待の確認と参加（未ログインならログイン後にここへ戻る） |
| `/` | `pages/home/HomePage.tsx` | 貸出中一覧（F-30〜33）。場所ごとに「まとめて返却」 |
| `/scan` | `pages/scan/ScanPage.tsx` | `?mode=borrow`（連続スキャン）/ `?mode=check`（既読チェック） |
| `/borrow/confirm` | `pages/borrow/BorrowConfirmPage.tsx` | カートの一括設定と登録（F-21, 24〜28） |
| `/borrow/add` | `pages/borrow/AddBookPage.tsx` | タイトル検索・手入力（F-23） |
| `/return` | `pages/loans/ReturnPage.tsx` | `?location=ID` または `?loans=id,id`。一括返却（F-50〜53, F-91） |
| `/loans/:loanId` | `pages/loans/LoanDetailPage.tsx` | 返却日変更（延長）、返却、取り消し、感想、削除 |
| `/history` | `pages/history/HistoryPage.tsx` | 全貸出記録、検索・絞り込み（F-60〜62） |
| `/books/:bookId` | `pages/books/BookDetailPage.tsx` | 書誌・貸出履歴・家族の感想・シリーズ・編集（F-63, F-92） |
| `/series` | `pages/series/SeriesListPage.tsx` | シリーズ一覧 |
| `/series/:seriesId` | `pages/series/SeriesDetailPage.tsx` | 巻ごとの状況、全巻数、抜け番（F-72〜74） |
| `/settings` | `pages/settings/SettingsPage.tsx` | 各設定へのリンク、ログアウト |
| `/settings/profile` | `pages/settings/ProfilePage.tsx` | 表示名、グループ名 |
| `/settings/locations` | `pages/settings/LocationsPage.tsx` | 場所一覧（非表示含む） |
| `/settings/locations/new`, `/settings/locations/:id` | `pages/settings/LocationEditPage.tsx` | 場所の登録・編集・非表示 |
| `/settings/members` | `pages/settings/MembersPage.tsx` | メンバー一覧、招待リンクの発行・共有、他のメンバーを外す・これまでの招待リンクをすべて無効にする（F-07。どちらも確認ダイアログ） |
| `/settings/notifications` | `pages/settings/NotificationsPage.tsx` | 通知の状態、オン/オフ、ホーム画面追加の手順、テスト通知 |

下部タブ: ホーム（`/`）・スキャン（`/scan?mode=borrow`）・履歴（`/history`）・シリーズ（`/series`）・設定（`/settings`）。タブはログイン済みかつグループ参加済みの画面でのみ表示。

ガード: 未ログイン → `/login`（`/join/:code` から来た場合はログイン後に戻す。戻り先は `sessionStorage` に保存し、`/login?next=/join/...` として URL にも載せる。アプリ内ブラウザから Safari に移ると `sessionStorage` は引き継がれないため。`next` は `/join/` で始まるアプリ内のパスのみ）。LINE などのアプリ内ブラウザで未ログインのまま `/join/:code` を開いた場合は、`/login` へ移る前に「Safari で開いて」の案内を出す（アドレス欄に招待リンクを残すため。「このままメールアドレスでログインする」で `/login` へ進める）。ログイン済みでグループ未参加 → `/welcome`（`/join/:code` は除く）。グループ情報の読み込みが権限以外のエラーなら `/welcome` へ送らずエラーと再読み込みボタンを出す（グループの二重作成を防ぐ）。

- `/welcome` はグループ参加済みでも表示できる（作成直後に「最初の場所の登録」へ進むため）。`/join/:code` も同様で、参加済み・別グループ参加中の案内は画面側で行う。
- `/return` は `?loans` と `?location` の両方があれば `?loans` を優先する。ホームの「まとめて返却」は借りた人で絞り込み中なら `?loans=`（表示中の分だけ）にする。
- ホームの絞り込みは URL（`?location=` / `?borrower=`）に、表示の切り替え（場所ごと／返却日順）は localStorage に保存する。履歴の検索語・絞り込みも URL に保存する。
- `/scan`・`/borrow/confirm`・`/borrow/add`・`/return` は下部タブを隠す（戻るボタンで戻る）。

### 5.1 画面ごとの補足

- **既読チェック（F-80、`pages/scan/CheckResult.tsx`）**: 「借りたことがあるか」はグループの本と貸出記録だけで決まるので、グループに無い本でも本（ISBN から決まる ID の 1 冊）の読み込みが終わった時点で「まだ借りたことがありません」をすぐ出し、書誌（`lookupByIsbn`）はあとから表示する（取得中はタイトル欄に小さなスピナー。「見つかりませんでした」と手入力の案内は取得が終わってから）。書誌の取得はこの画面でだけ 10 秒で打ち切る（`lookupByIsbn` 自体の直列の呼び出し方は変えない）。書誌が無いとき、通信の失敗（`lookupByIsbnDetailed` の failed）または 10 秒の打ち切りなら「見つかりませんでした」ではなく「検索サービスにつながりませんでした」と「本の情報を再取得」ボタンを出す（打ち切りでは後続の API を確かめていないため）。
- **ISBN なしで登録した本の手がかり（F-80・F-27・F-28）**: 本の ID は ISBN から決まる（`isbn-<ISBN13>`）ため、バーコードが隠れて手入力（ISBN なし・自動 ID）で登録した本を、後でバーコードで読むと別の本になる（ルールで ID と ISBN が結び付いており、ISBN を後から付けたり ID を変えたりはしない）。そこで、ISBN の本が見つからず、書誌のタイトルが ISBN なしの本のタイトルと一致する（`normalizeForSearch` で空白・全角半角・記号の違いを無視して完全一致）場合だけ、次のように手がかりを出す。手入力のタイトルは書き方が違うことが多く、同じタイトルの別の本もあるので、自動ではつなげない。
  - 既読チェック: 判定は「まだ借りたことがありません」のまま、「ISBN なしで登録した同じタイトルの本」としてその本の貸出の履歴と詳細へのリンクを出す。
  - 借りる確認: 本ごとのカードで「同じ本ですか？」と聞き、「同じ本として借りる」を選んだらカートの本を既存の本（`addExistingBook`）に置き換える。貸出は既存の本に記録し、その本の ISBN は null のまま。この本だけの返却日と、既存の本にシリーズが無ければ書誌のシリーズ・巻数を引き継ぐ。「別の本」を選べばそのまま ISBN の本として新しく登録する。
  - タイトルの書き方が違えば見つからない。バーコードが隠れた本は、奥付の ISBN を「ISBN を手入力」（スキャン画面）か本の追加画面の検索欄に入れて登録すると、後でバーコードを読んだときに同じ本として見つかる。
- **本の追加（F-23、`pages/borrow/AddBookPage.tsx`）**: 検索欄の入力が ISBN として読める（`isbnFromSearchQuery`。`searchByTitle` と同じ判定）のに見つからなかった場合は、手入力ではなく「ISBN で追加する（タイトルは確認画面で入力）」（`cart.addIsbn`、バーコードを読んだときと同じ扱い）を出して ISBN を残す。手入力を開いても ISBN の数字はタイトルに写さない。「以前に登録した本」にはその ISBN の登録済みの本も出す。検索が 0 件で通信に失敗していた（`searchByTitleDetailed` の failed、またはオフライン）ときは「見つかりませんでした」や「ひらがな・カタカナを変えたり…」ではなく「検索サービスにつながりませんでした」と、電波のよい場所での検索し直し・手入力を案内する。
- **借りた日（`pages/borrow/BorrowConfirmPage.tsx`）**: 今日より後の日付は登録させない（`submitBlockReason` と入力欄のエラー。文言は貸出の詳細の `validateBorrowedOn` と同じ）。未来の借りた日で登録すると、返却画面で「返却した日」（借りた日以降かつ今日以前）を選べなくなるため。`<input type="date" max>` はキーボード入力を止めないので、画面のロジックで確かめる。
- **シリーズの「読んだ巻」**: 巻の状態（色）は `bookReadState`（貸出中が優先）のままにし、「読んだ巻」は一度でも「読んだ」で返却したか（everRead）で数える。読み返すために借りている巻は、シリーズ詳細のマス目・一覧で貸出中の色に読んだ印（チェック）を添え、表示名を「貸出中（前に読んだ）」にする。既読チェックのシリーズの要約でも「読んだ巻」と「貸出中」の両方に出る（「途中・未読」は返却済みで一度も読んでいない巻だけ）。
- **招待リンクとアプリ内ブラウザ（F-01〜03）**: LINE のアプリ内ブラウザ（WKWebView）では Google のログインが「403 disallowed_useragent」で拒否され、Safari・ホーム画面のアプリと保存場所が別で、ホーム画面にも追加できない。
  - 家族に送る招待リンクには LINE の URL パラメータ `?openExternalBrowser=1` を付ける（LINE からは Safari などで直接開く）。共有の文面にも「iPhone では Safari で開いてください」と書く。
  - それでもアプリ内ブラウザで開いた場合（Facebook・Instagram など）に備え、UA の目印（`Line/`・`FBAN`/`FBAV`・`Instagram`）だけで狭く判定し（`components/inAppBrowser.ts`）、招待リンクを未ログインで開いたとき（`/login` へ移る前）・ログイン画面・参加画面・通知の設定（ホーム画面に追加の手順）で「Safari で開く」を案内する。ログイン画面では Google のボタンを薄くして理由を添える（判定が外れても使えるよう、隠さない）。メールアドレスでのログインはそのまま使える。UA を偽装したり別の OAuth の方法で Google の方針を避けたりはしない。
- **シリーズの編集（`pages/series/SeriesEditSheet.tsx`）**: 同じ名前のシリーズがほかにもあれば（2 台で同時に作った・名前を変えて重なった・前からの重複）、このシリーズを X にまとめる操作（`mergeSeries`）を出す（ボタンは「「X」にまとめる」）。「シリーズを削除」（`deleteSeries`。本があれば本をシリーズから外して削除。本と貸出の記録は残る）で、自動の推定で誤って作られたシリーズも消せる。まとめた後はまとめ先の画面、削除した後はシリーズ一覧へ移る。
- **メンバーを外す・招待の無効化（F-07、`pages/settings/MembersPage.tsx`）**: 自分以外の行に「外す」。確認ダイアログで「見られなくなる・通知が届かなくなる・これまでの招待リンクもすべて無効になる」と伝える。招待の欄の下に「これまでの招待リンクをすべて無効にする」（確認ダイアログ）。どちらも成功したら、画面に出していた招待リンクを消す。参加画面で無効化済みの招待を使うと、参加の書き込みが permission-denied になるので「この招待リンクは無効になっています」と出す（`GroupProvider.joinGroup`）。
- **新しい版への切り替え（`src/swUpdate.ts`、`main.tsx`）**: `registerType: 'autoUpdate'` と `sw.ts` の `skipWaiting`・`clientsClaim` で、新しい SW は見つかるとすぐ有効になる（更新の確認は起動時、1 時間ごと、10 分以上空けてアプリに戻ったとき）。`registerSW` の `onNeedReload` で、読み込みから 10 秒以内ならすぐ再読み込みし、それ以外は「再読み込み待ち」にして、次に別の画面へ移るとき（`history.pushState`／`replaceState` で pathname が変わる、または戻る操作）に移動先の URL を読み込み直す。入力中（感想・貸出の編集など）の内容を消さないため。古い画面のまま lazy() の画面を開くと、新しい SW がキャッシュから消した古いチャンクを読めない（ErrorBoundary の「画面を読み込めませんでした」）ので、画面を移る時点で読み込み直す。アプリを裏に回しただけでは再読み込みしない。
- **ログイン画面（F-01、`pages/auth/LoginPage.tsx`）**: Google の待ち中もメールアドレスでのログインはでき、「キャンセル（Google の画面から戻ってこないとき）」で待つのをやめられる（4.7 参照）。
- **通知の手順のアプリ名（F-105、`pages/settings/NotificationsPage.tsx`）**: ホーム画面と「設定」>「通知」の一覧に出る名前は `apple-mobile-web-app-title`・manifest の `short_name` の「かりた本」（正式名の「かりた本ノート」ではない）。手順の図と文面はこの名前で案内する。通知がブロックされているときの「一覧に見つからないとき」は、(1) ホーム画面のアイコンの下の名前で探す、(2) ホーム画面のアイコンから開いているか確かめる、(3) 最後の手段としてだけ、アイコンを削除して追加し直す（ログインと通知の設定が消え、送られていないオフラインの変更が消えることがあるので、先にオンラインで開く）の順に案内する。

## 6. 通知（`scripts/notify`）

- GitHub Actions で毎日 UTC 22:45（日本時間 7:45）に起動。キューの遅延を見込んで「8 時ごろ」に届く想定。手動実行（workflow_dispatch）も可能。
- 日本時間の今日を基準に、各グループの貸出中（`returnedOn == null`）の本を次の区分で集計する：
  - 延滞中（`dueOn < 今日`）… 毎日
  - 明日返却（`dueOn == 今日+1`）
  - 3 日後に返却（`dueOn == 今日+3`）
- 対象があるグループのメンバー全員の購読先に 1 通送る。本文は区分ごとに場所別の冊数（例：「明日返却：○○図書館 3冊」）。タップでアプリのホームを開く。
- 本文の長さ（Apple の Web Push は暗号化後 4KB まで。超えると 413 で毎日失敗する）: 1 つの区分に並べる場所は冊数の多い順に 3 か所までで、残りは「ほか 2 か所 5冊」にまとめる。場所の名前は 40 文字（画面の上限）で切り、改行は空白にする。本文全体は 500 文字（`src/sw.ts` が表示時に切る長さと同じ `MAX_BODY_LENGTH`）までで、行の単位で切る。
- 送信結果が 404/410 の購読は削除する。
- 対象のグループ: `NOTIFY_GROUP_IDS`（`app.config.json` の `notifyGroupIds`。カンマ区切り）に書いた家族のグループだけ。誰でもアカウントとグループを作れるため、部外者のグループ・購読を毎朝のジョブに処理させない。未設定なら互換のため全グループを処理し、警告（GitHub Actions では `::warning::`）を出す。グループ ID はログの `[ID] グループ「名前」` の行で確かめる（docs/setup.md 手順 12）。指定した ID のグループが無ければ失敗に数える。
- 送らない購読（`scripts/notify/subscription.ts`。`firestore.rules` の pushSubscriptions と `src/lib/push.ts` も同じ条件）:
  - endpoint が主要なブラウザのプッシュサービス（`web.push.apple.com`・`fcm.googleapis.com`・`updates.push.services.mozilla.com`・`*.notify.windows.com`。ホストの直後は `/`）でないもの。第三者のサーバーへ送ると VAPID の JWT（`VAPID_SUBJECT` の連絡先を含む）が渡るため。
  - p256dh が P-256 の公開鍵（65 バイトの base64url、曲線上の点）でない、auth が 16 バイトの base64url でないもの（暗号化の段階で必ず失敗するため）。
  - 読み飛ばした数は警告として出すだけで、失敗には数えない（終了コードに影響しない）。削除もしない（条件の誤りで家族の購読を消さないため）。
- 送信の上限: 1 件の送信は 20 秒で打ち切る（web-push の `timeout` は無通信の時間しか見ないので、少しずつ応答する相手に備えて送信ごとの `https.Agent` を壊して接続を切る）。1 グループで送る購読はメンバーのものを新しい順に 20 件まで、同時に 5 件まで。グループは 4 つずつ並行に処理し、1 グループが遅れても他のグループを待たせない。終わった後に接続が残っていても 5 秒で終了する。
- 終了コード: 送信の失敗・グループの処理の失敗が 1 件でもあれば 1。
- 環境変数: `FIREBASE_SERVICE_ACCOUNT`（JSON）、`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`（`mailto:` か URL。空なら `APP_URL`）、`APP_URL`、`NOTIFY_GROUP_IDS`。
  秘密の値（`FIREBASE_SERVICE_ACCOUNT` ← Secrets の `NOTIFY_SERVICE_ACCOUNT`、`VAPID_PRIVATE_KEY`）以外は、ワークフローの中で `scripts/appConfig.ts` が `app.config.json` から作る。

### 6.1 設定の置き場所（app.config.json）

- 秘密ではない設定（Firebase のウェブ設定、VAPID 公開鍵、通知するグループ ID、Google ログインの有無、Google Books のキー）はリポジトリの `app.config.json` に置く。GitHub の Variables は不要（同じ名前の Variables があればそちらを優先）。
- `scripts/appConfig.ts` が `VITE_*`・`VAPID_PUBLIC_KEY`・`VAPID_SUBJECT`・`APP_URL`・`NOTIFY_GROUP_IDS` に変換して `$GITHUB_ENV` に書く（deploy.yml・notify.yml）。`authDomain` が空なら `<projectId>.web.app`、`APP_URL` は `https://<projectId>.web.app`。
- `googleSignIn` が false のとき `VITE_GOOGLE_SIGN_IN=false` になり、ログイン画面に Google のボタンを出さない（`firebase.ts` の `isGoogleSignInEnabled`）。リダイレクト URI の設定（setup.md 手順 11）を済ませてから true にする。
- 秘密の値（サービスアカウントの鍵 2 つと VAPID 秘密鍵）は GitHub の Secrets だけに置く。作成は Cloud Shell に貼る `scripts/cloudshell-setup.sh` で行う。
- 鍵: 通知のワークフローには、`roles/datastore.user` だけを持つ通知専用のサービスアカウント（`notify-bot`）の鍵（Secrets `NOTIFY_SERVICE_ACCOUNT`）を環境変数 `FIREBASE_SERVICE_ACCOUNT` として渡す。デプロイ用の鍵（Hosting・ルールの管理権限を持つ `FIREBASE_SERVICE_ACCOUNT`）は渡さない。`NOTIFY_SERVICE_ACCOUNT` が未登録のときはデプロイ用の鍵に切り替えず、エラーで止める。
- `--dry-run` で送信せずに内容を表示。

## 7. 画面デザインの方針

- iPhone の片手操作が前提。タップ領域は 44px 以上、主要ボタンは画面下部寄り。`env(safe-area-inset-*)` を考慮。
- 文字は日本語、システムフォント。本文 16px 以上（iOS の入力時ズーム防止のため input も 16px）。
- 色は CSS 変数で定義し、`prefers-color-scheme: dark` にも対応。メインカラーは落ち着いた緑（`#2f6f5e`）。
- 返却日の色: 延滞＝赤、3 日以内＝オレンジ、それ以外＝通常。
- 読み込み中・空の状態・エラーを必ず表示する。書き込みの成功／失敗はトーストで知らせる。

## 8. デプロイと CI（`.github/workflows`）

- `deploy.yml`: main への push と手動実行（workflow_dispatch）で、Hosting と Firestore のルール・インデックスをデプロイする。デプロイの前に**同じジョブの中で**型チェック・単体テスト・セキュリティルールのテスト（`npm run test:rules`、Java とエミュレータを使う）を行い、失敗したらデプロイしない。CI の結果は待たない（`workflow_run` は PR の CI 成功でも動く・既定ブランチの最新をチェックアウトするなどの落とし穴があり、非公開リポジトリの無料プランではブランチ保護で CI を必須にできないため）。`concurrency: deploy`、途中で取り消さない。
- `ci.yml`: main への push・プルリクエスト・手動実行で、型チェック・単体テスト・ビルド・ルールのテストを行う（同じブランチの新しい push で古い実行は取り消す）。デプロイのジョブを ci.yml に入れないのは、この取り消しでデプロイが途中で止まらないようにするため。
