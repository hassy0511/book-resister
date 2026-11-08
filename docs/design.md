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
| `groups/{gid}` | `Group` | メンバーのみ読める |
| `groups/{gid}/members/{uid}` | `Member` | 作成は本人のみ。グループ作成者 or 有効な招待コードを持つ人 |
| `invites/{code}` | `Invite` | ログイン済みなら code 指定で `get` 可（`list` 不可）。有効期限 7 日 |
| `groups/{gid}/locations/{id}` | `Location` | |
| `groups/{gid}/books/{id}` | `Book` | ISBN がある本の ID は `isbn-<ISBN13>` |
| `groups/{gid}/series/{id}` | `Series` | |
| `groups/{gid}/loans/{id}` | `Loan` | 貸出中は `returnedOn == null` |
| `groups/{gid}/pushSubscriptions/{id}` | `PushSubscriptionDoc` | ID は endpoint の SHA-256（16 進）。本人のもののみ読み書き |

- 日付（借りた日など）は `'YYYY-MM-DD'`（端末のローカル日付）。作成・更新日時は `serverTimestamp()`。
- **複合インデックスは使わない。** クエリは単一フィールドの条件か並び替えのみとし、残りはクライアントで絞り込む・並べ替える（家族規模なので件数は少ない）。
- `Loan.book` は本情報のコピー。`updateBook` で本を編集したら、その本の貸出記録の `book` も一括更新する。

## 4. モジュールの公開 API

### 4.1 `src/lib/date.ts`

```ts
todayString(): DateString                         // 端末のローカル日付
addDays(date: DateString, days: number): DateString
diffDays(from: DateString, to: DateString): number // to - from（日数）
formatDate(date: DateString, opts?: { withYear?: boolean }): string // 例 "11月8日(土)"。今年でなければ年を付ける
dueStatus(dueOn: DateString, today?: DateString): 'overdue' | 'soon' | 'ok' // soon = 今日〜3日後
dueLabel(dueOn: DateString, today?: DateString): string // 例 "2日超過" "今日まで" "明日まで" "あと5日"
```

### 4.2 `src/lib/isbn.ts`

```ts
normalizeIsbn(input: string): string | null  // ISBN-10/13（ハイフン可）→ ISBN-13。不正なら null
isBookEan(code: string): boolean             // 978/979 で始まりチェックディジットが正しい 13 桁
bookIdForIsbn(isbn13: string): string        // `isbn-${isbn13}`
formatIsbn(isbn13: string): string           // 表示用（ハイフン区切り不要なら素の 13 桁でよい）
```

### 4.3 `src/lib/series.ts`

```ts
guessSeries(title: string): { seriesName: string | null; volume: number | null }
  // 「おしりたんてい (3)」「マジック・ツリーハウス 12」「〇〇 第3巻」「〇〇 ③」「〇〇 vol.2」などから推定
normalizeSeriesName(name: string): string   // 比較用（NFKC、空白・記号除去、小文字化）
findMatchingSeries<T extends { name: string }>(name: string, list: T[]): T | null
```

### 4.4 `src/lib/bookLookup/index.ts`

```ts
lookupByIsbn(isbn13: string, opts?: { signal?: AbortSignal }): Promise<BookCandidate | null>
  // openBD → NDL → Google Books。最初に見つかった結果を基に、欠けている項目（表紙など）を後続で補う
  // シリーズ名・巻数は API の値を優先し、無ければ guessSeries(title) で推定
searchByTitle(query: string, opts?: { signal?: AbortSignal }): Promise<BookCandidate[]>
  // NDL ＋ Google Books。ISBN で重複除去、最大 20 件
```

- 各 API 呼び出しは try/catch し、失敗（CORS・タイムアウト・上限）しても例外を外に出さない。タイムアウト 8 秒。
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
  signInWithGoogle(): Promise<void>;            // popup → 失敗（popup-blocked 等）時は redirect にフォールバック
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}
```

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
  joinGroup(code: string, displayName: string): Promise<void>;           // member + users を 1 バッチで
  updateDisplayName(displayName: string): Promise<void>;                 // users と members の両方
  updateGroupName(name: string): Promise<void>;
}
useRequiredGroup(): { groupId: string; uid: string; ... }  // グループ参加済みの画面用（未参加なら例外）
```

### 4.9 `src/data/*`

共通: フックは `QueryResult<T> = { data: T; loading: boolean; error: Error | null }` を返す（`src/data/common.ts`）。
フックは `useRequiredGroup()` から groupId を取る。書き込み関数は第 1 引数に `groupId` を取る。

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
findOrCreateSeries(gid, name: string): Promise<string>   // normalizeSeriesName で既存と照合

// books.ts
useBook(bookId: string | undefined): QueryResult<WithId<Book> | null>
useBooks(): QueryResult<WithId<Book>[]>                     // 全件（シリーズ一覧・検索用）
useBooksInSeries(seriesId: string | undefined): QueryResult<WithId<Book>[]>
getBook(gid, bookId): Promise<WithId<Book> | null>
findBookForCandidate(gid, c: BookCandidate): Promise<WithId<Book> | null> // ISBN なら ID で、無ければタイトル完全一致
upsertBookFromCandidate(gid, c: BookCandidate, series: { seriesId: string | null; volume: number | null }): Promise<string>
  // 既存があればその ID を返す（既存の空欄だけ補完し、シリーズ未設定なら設定）。無ければ作成
updateBook(gid, bookId, patch: Partial<Pick<Book, 'title' | 'authors' | 'publisher' | 'coverUrl' | 'seriesId' | 'volume'>>): Promise<void>
  // 該当本の全 Loan の book スナップショットも更新（バッチ）

// loans.ts
useActiveLoans(): QueryResult<WithId<Loan>[]>               // returnedOn == null、dueOn 昇順
useAllLoans(): QueryResult<WithId<Loan>[]>                  // 全件、borrowedOn 降順
useLoansForBook(bookId: string | undefined): QueryResult<WithId<Loan>[]>  // borrowedOn 降順
useLoansForBooks(bookIds: string[]): QueryResult<WithId<Loan>[]>          // シリーズ画面用（30 件ずつ in クエリ）
useLoan(loanId: string | undefined): QueryResult<WithId<Loan> | null>
type NewLoanInput = { bookId: string; book: LoanBookSnapshot; locationId: string; borrowerUid: string; borrowedOn: DateString; dueOn: DateString }
createLoans(gid, uid, inputs: NewLoanInput[]): Promise<string[]>   // 1 バッチ
updateLoan(gid, loanId, patch: Partial<Pick<Loan, 'dueOn' | 'locationId' | 'borrowerUid' | 'borrowedOn' | 'rating' | 'review' | 'readStatus' | 'returnedOn'>>): Promise<void>
type ReturnInput = { loanId: string; returnedOn: DateString; readStatus: ReadStatus; rating: number | null; review: string | null }
returnLoans(gid, items: ReturnInput[]): Promise<void>               // 1 バッチ
undoReturn(gid, loanId): Promise<void>                              // returnedOn と readStatus を null に戻す
deleteLoan(gid, loanId): Promise<void>                              // 誤登録の削除

// invites.ts
createInvite(gid, groupName: string, uid: string): Promise<{ code: string; url: string }>  // url = `${location.origin}/join/${code}`
getInvite(code: string): Promise<WithId<Invite> | null>              // 期限切れは null

// readStatus.ts（純粋関数）
bookReadState(loans: Loan[]): 'reading' | 'read' | 'partial' | 'unread' | 'none'
  // 貸出中があれば 'reading'、それ以外は返却済みの中で最良（read > partial > unread）、貸出なしは 'none'
```

### 4.10 `src/state/borrowCart.tsx`

```ts
<BorrowCartProvider>
useBorrowCart(): {
  items: CartItem[];
  addIsbn(isbn13: string): 'added' | 'duplicate';   // 書誌の取得はカート内で非同期に行う
  addCandidate(c: BookCandidate): 'added' | 'duplicate';
  addExistingBook(book: WithId<Book>): 'added' | 'duplicate';
  update(key: string, patch: Partial<Pick<CartItem, 'seriesName' | 'volume' | 'dueOnOverride' | 'candidate'>>): void;
  remove(key: string): void;
  clear(): void;
}
type CartItem = {
  key: string;                      // ISBN があれば isbn13、無ければランダム
  status: 'loading' | 'ready' | 'not-found';
  candidate: BookCandidate | null;  // not-found の場合は null（タイトル手入力を促す）
  isbn: string | null;
  existingBookId: string | null;
  seriesName: string | null;
  volume: number | null;
  dueOnOverride: DateString | null;
}
```

### 4.11 UI 部品（`src/components/ui/`、`src/components/`）

`Button`（variant: primary / secondary / danger / ghost、size、block）、`IconButton`、`Card`、`ListRow`、`PageHeader`（title, back, right）、`Page`（PageHeader＋スクロール領域、セーフエリア対応）、`BottomTabBar`、`Sheet`（下から出るモーダル）、`ConfirmDialog`、`TextField`、`NumberField`、`DateField`（`<input type="date">`）、`Select`、`SegmentedControl`、`Chips`（絞り込み用）、`StarRating`、`EmptyState`、`Spinner`、`ToastProvider` / `useToast()`（`show(message, { action?: { label, onClick } })`）、`icons.tsx`（インライン SVG アイコン）。

ドメイン部品: `BookCover`（画像＋読み込み失敗時のプレースホルダ）、`DueBadge`（`dueStatus` で色分け）、`LoanRow`（表紙・タイトル・場所名・借りた人・返却日バッジ。props で名前を受け取る）、`ReadStatusPicker`（読んだ / 途中まで / 読んでいない。既定 read）、`ReviewEditor`（★と感想）、`SeriesPicker`（既存シリーズ選択 or 新規名入力＋巻数）、`ReadStateBadge`（`bookReadState` の表示）。

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
| `/settings/members` | `pages/settings/MembersPage.tsx` | メンバー一覧、招待リンクの発行・共有 |
| `/settings/notifications` | `pages/settings/NotificationsPage.tsx` | 通知の状態、オン/オフ、ホーム画面追加の手順、テスト通知 |

下部タブ: ホーム（`/`）・スキャン（`/scan?mode=borrow`）・履歴（`/history`）・シリーズ（`/series`）・設定（`/settings`）。タブはログイン済みかつグループ参加済みの画面でのみ表示。

ガード: 未ログイン → `/login`（`/join/:code` から来た場合はログイン後に戻す。戻り先は `sessionStorage` に保存）。ログイン済みでグループ未参加 → `/welcome`（`/join/:code` は除く）。

## 6. 通知（`scripts/notify`）

- GitHub Actions で毎日 UTC 22:45（日本時間 7:45）に起動。キューの遅延を見込んで「8 時ごろ」に届く想定。手動実行（workflow_dispatch）も可能。
- 日本時間の今日を基準に、各グループの貸出中（`returnedOn == null`）の本を次の区分で集計する：
  - 延滞中（`dueOn < 今日`）… 毎日
  - 明日返却（`dueOn == 今日+1`）
  - 3 日後に返却（`dueOn == 今日+3`）
- 対象があるグループのメンバー全員の購読先に 1 通送る。本文は区分ごとに場所別の冊数（例：「明日返却：○○図書館 3冊」）。タップでアプリのホームを開く。
- 送信結果が 404/410 の購読は削除する。
- 環境変数: `FIREBASE_SERVICE_ACCOUNT`（JSON）、`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`（`mailto:` か URL）、`APP_URL`。
- `--dry-run` で送信せずに内容を表示。

## 7. 画面デザインの方針

- iPhone の片手操作が前提。タップ領域は 44px 以上、主要ボタンは画面下部寄り。`env(safe-area-inset-*)` を考慮。
- 文字は日本語、システムフォント。本文 16px 以上（iOS の入力時ズーム防止のため input も 16px）。
- 色は CSS 変数で定義し、`prefers-color-scheme: dark` にも対応。メインカラーは落ち着いた緑（`#2f6f5e`）。
- 返却日の色: 延滞＝赤、3 日以内＝オレンジ、それ以外＝通常。
- 読み込み中・空の状態・エラーを必ず表示する。書き込みの成功／失敗はトーストで知らせる。
