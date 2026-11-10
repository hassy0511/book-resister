/*
 * 借りる画面（確認・本の追加）とスキャンの確認結果で使う純粋ロジック。
 * Firebase・React に依存しない。
 */
import { addDays, diffDays, isDateString, parseDateString } from '../../lib/date';
import { bookIdForIsbn, normalizeIsbn } from '../../lib/isbn';
import { normalizeSeriesName, resolvePositionVolume } from '../../lib/series';
import type { CartItem } from '../../state/borrowCartLogic';
import type { Book, BookCandidate, DateString, Loan, LoanBookSnapshot, ReadStatus } from '../../types';

// ---------------------------------------------------------------------------
// 前回選んだ場所（localStorage）
// ---------------------------------------------------------------------------

export const LAST_LOCATION_STORAGE_KEY = 'borrow.lastLocationId';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadLastLocationId(storage: StorageLike | null = browserStorage()): string | null {
  try {
    const v = storage?.getItem(LAST_LOCATION_STORAGE_KEY);
    return v ? v : null;
  } catch {
    return null;
  }
}

export function saveLastLocationId(id: string, storage: StorageLike | null = browserStorage()): void {
  try {
    if (id) storage?.setItem(LAST_LOCATION_STORAGE_KEY, id);
  } catch {
    // 保存できなくても続行する
  }
}

/** 場所の初期値。前回の場所が選べればそれ、場所が 1 つだけならそれ、それ以外は未選択（''） */
export function pickDefaultLocationId(locations: readonly { id: string }[], lastId: string | null): string {
  if (lastId && locations.some((l) => l.id === lastId)) return lastId;
  if (locations.length === 1) return locations[0].id;
  return '';
}

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

/** 借りた日＋場所の既定貸出期間。計算できなければ null */
export function autoDueOn(borrowedOn: DateString, loanDays: number | null | undefined): DateString | null {
  if (!isDateString(borrowedOn) || loanDays == null || !Number.isFinite(loanDays)) return null;
  return addDays(borrowedOn, loanDays);
}

/** 「2025年3月2日」（年を必ず付け、曜日は付けない） */
export function formatFullDate(date: DateString): string {
  const ymd = parseDateString(date);
  return ymd ? `${ymd.y}年${ymd.m}月${ymd.d}日` : date;
}

/** 本ごとの返却日（個別の指定があればそれ、無ければ一括の返却日） */
export function effectiveDueOn(item: Pick<CartItem, 'dueOnOverride'>, bulkDueOn: DateString): DateString {
  return item.dueOnOverride ?? bulkDueOn;
}

/** 返却日が借りた日以降の正しい日付か */
export function isValidDue(dueOn: DateString, borrowedOn: DateString): boolean {
  if (!isDateString(dueOn) || !isDateString(borrowedOn)) return false;
  return diffDays(borrowedOn, dueOn) >= 0;
}

// ---------------------------------------------------------------------------
// 本・貸出の表示
// ---------------------------------------------------------------------------

export const READ_STATUS_SHORT: Record<ReadStatus, string> = {
  read: '読んだ',
  partial: '途中まで',
  unread: '読んでいない',
};

/** カートの本に対応する本ドキュメントの ID（既存の本、または ISBN から決まる ID）。不明なら null */
export function bookIdForCartItem(item: Pick<CartItem, 'existingBookId' | 'isbn'>): string | null {
  if (item.existingBookId) return item.existingBookId;
  return item.isbn ? bookIdForIsbn(item.isbn) : null;
}

/** 貸出 1 件の説明。例「2025年3月2日 ○○図書館 ママ（読んだ）」 */
export function describeLoan(
  loan: Pick<Loan, 'borrowedOn' | 'returnedOn' | 'readStatus'>,
  locationName: string,
  borrowerName: string,
): string {
  const status = loan.returnedOn == null ? '貸出中' : loan.readStatus ? READ_STATUS_SHORT[loan.readStatus] : '返却済み';
  return [formatFullDate(loan.borrowedOn), locationName, borrowerName].filter(Boolean).join(' ') + `（${status}）`;
}

/** 返却済みの貸出のうち、いちばん新しいもの（借りた日の新しい順） */
export function latestReturnedLoan<T extends Pick<Loan, 'borrowedOn' | 'returnedOn'>>(loans: readonly T[]): T | null {
  let best: T | null = null;
  for (const l of loans) {
    if (l.returnedOn == null) continue;
    if (!best || l.borrowedOn > best.borrowedOn) best = l;
  }
  return best;
}

/** カートの中で同じ本が 2 回以上入っている本の ID */
export function duplicatedBookIds(items: readonly Pick<CartItem, 'existingBookId' | 'isbn'>[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const item of items) {
    const id = bookIdForCartItem(item);
    if (!id) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return dup;
}

/** 著者の入力（「、」「,」「/」区切り）を配列にする */
export function splitAuthors(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[、，,／/;；\n]+/)) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 登録できるかの判定
// ---------------------------------------------------------------------------

export type SubmitCheckInput = {
  items: readonly Pick<CartItem, 'status' | 'candidate' | 'dueOnOverride'>[];
  locationId: string;
  borrowerUid: string;
  borrowedOn: DateString;
  bulkDueOn: DateString;
  /** 今日（端末の日付）。借りた日が今日より後なら登録させない */
  today: DateString;
};

/**
 * 借りた日の入力のエラー（問題なければ null）。
 * 未来の日付で登録すると返却画面で「返却した日」を選べなくなるため、今日より後は不可
 * （貸出の詳細の validateBorrowedOn と同じ文言）。
 */
export function borrowedOnError(borrowedOn: DateString, today: DateString): string | null {
  if (!isDateString(borrowedOn)) return null;
  return isDateString(today) && borrowedOn > today ? '今日より後の日付は選べません' : null;
}

/** 登録ボタンを押せない理由（押せるなら null） */
export function submitBlockReason(input: SubmitCheckInput): string | null {
  const { items, locationId, borrowerUid, borrowedOn, bulkDueOn, today } = input;
  if (items.length === 0) return '借りる本がありません';
  const loading = items.filter((i) => i.status === 'loading').length;
  if (loading > 0) return `本の情報を取得しています（${loading}冊）。少しお待ちください`;
  const untitled = items.filter((i) => !i.candidate || !i.candidate.title.trim()).length;
  if (untitled > 0) return `タイトルが入っていない本があります（${untitled}冊）`;
  if (!locationId) return '借りた場所を選んでください';
  if (!borrowerUid) return '借りた人を選んでください';
  if (!isDateString(borrowedOn)) return '借りた日を入力してください';
  if (borrowedOnError(borrowedOn, today)) return '借りた日は今日以前にしてください';
  const badDue = items.some((i) => !isValidDue(effectiveDueOn(i, bulkDueOn), borrowedOn));
  if (badDue) {
    if (!isDateString(bulkDueOn) && items.some((i) => !i.dueOnOverride)) return '返却日を入力してください';
    return '返却日は借りた日以降にしてください';
  }
  return null;
}

// ---------------------------------------------------------------------------
// タイトル検索（本の追加画面）
// ---------------------------------------------------------------------------

/** 検索の比較用（全角半角・大小文字・空白・中黒などの違いを無視） */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　・･、。,.!！?？「」『』()（）［］\[\]〔〕【】\-‐－〜~]/g, '');
}

/** 著者の一覧が検索語（著者名の一部）を含むか */
export function matchesAuthor(authors: readonly string[], author: string): boolean {
  const key = normalizeForSearch(author);
  if (!key) return true;
  return authors.some((a) => normalizeForSearch(a).includes(key));
}

/** 著者名が一致するものを先に並べる（著者の指定が無ければそのまま） */
export function rankByAuthor<T extends { authors: string[] }>(list: readonly T[], author: string): T[] {
  if (!normalizeForSearch(author)) return [...list];
  const hit: T[] = [];
  const rest: T[] = [];
  for (const item of list) (matchesAuthor(item.authors, author) ? hit : rest).push(item);
  return [...hit, ...rest];
}

/**
 * 検索欄の入力が ISBN として読めれば ISBN-13、読めなければ null。
 * 判定は searchByTitle と同じ normalizeIsbn（「ISBN978-4-…」「978‐4‐…」「…Ｘ」なども ISBN として扱う）。
 */
export function isbnFromSearchQuery(query: string): string | null {
  const q = query.trim();
  return q ? normalizeIsbn(q) : null;
}

/**
 * 書誌の取得が通信の失敗（タイムアウト・通信エラー・429 など）で確かめられなかったときの案内
 * （借りる確認・本の追加・既読チェック・スキャンの通知）。
 */
export const LOOKUP_FAILED_MESSAGE = '検索サービスにつながりませんでした（電波のよい場所で再取得するか、手入力してください）';

/**
 * 登録する巻数。上・中・下の「下」は既定で 2 巻（上下 2 冊組が多いため）。同じカートの同じシリーズに
 * 「中」の本があれば 3 冊組とみなして 3 巻にする（resolvePositionVolume）。
 * 結び付けた既存の本の巻数は変えない（利用者が手で直した巻数のことがあるため）。
 */
export function volumeForSave(item: CartItem, items: readonly CartItem[]): number | null {
  const seriesName = item.seriesName?.trim();
  if (item.existingBookId || !seriesName || !item.candidate) return item.volume;
  const key = normalizeSeriesName(seriesName);
  const siblings = items.flatMap((i) =>
    i !== item && i.candidate && i.seriesName && normalizeSeriesName(i.seriesName) === key
      ? [{ title: i.candidate.title, volume: i.volume }]
      : [],
  );
  return resolvePositionVolume({ title: item.candidate.title, volume: item.volume }, siblings);
}

/**
 * グループ内の本からタイトルの部分一致（＋著者）で探す。
 * 入力が ISBN として読める場合は、その ISBN の本も（先頭に）出す。
 */
export function matchExistingBooks<T extends { title: string; authors: string[]; isbn?: string | null }>(
  books: readonly T[],
  title: string,
  author: string,
  limit = 8,
): T[] {
  const key = normalizeForSearch(title);
  if (!key) return [];
  const isbn = isbnFromSearchQuery(title);
  const byIsbn = isbn ? books.filter((b) => b.isbn === isbn) : [];
  const byTitle = books.filter(
    (b) => !byIsbn.includes(b) && normalizeForSearch(b.title).includes(key) && matchesAuthor(b.authors, author),
  );
  return [...byIsbn, ...byTitle].slice(0, limit);
}

/**
 * ISBN なしで登録した本のうち、タイトルが同じ（normalizeForSearch で比べて一致）もの。
 * バーコードが隠れて手入力した本を、後でバーコードで読んだときの「同じ本かも」の手がかりに使う。
 * タイトルの書き方が違えば見つからないし、同じタイトルの別の本もありうるので、自動ではつなげず利用者に確かめる。
 */
export function sameTitleBooksWithoutIsbn<T extends { id: string; title: string; isbn: string | null }>(
  books: readonly T[],
  title: string | null | undefined,
): T[] {
  const key = title ? normalizeForSearch(title) : '';
  if (!key) return [];
  return books.filter((b) => b.isbn === null && normalizeForSearch(b.title) === key);
}

// ---------------------------------------------------------------------------
// 登録
// ---------------------------------------------------------------------------

/**
 * 貸出記録に複製する本の情報。既存の本があればその内容を優先し、空欄は候補で補う
 * （upsertBookFromCandidate が既存の本の空欄を候補で埋めるのと同じ考え方）。
 */
export function loanSnapshotFor(
  existing: Pick<Book, 'title' | 'authors' | 'coverUrl' | 'isbn'> | null,
  c: Pick<BookCandidate, 'title' | 'authors' | 'coverUrl' | 'isbn'>,
): LoanBookSnapshot {
  if (!existing) {
    return { title: c.title.trim(), authors: [...c.authors], coverUrl: c.coverUrl ?? null, isbn: c.isbn ?? null };
  }
  return {
    title: existing.title.trim() || c.title.trim(),
    authors: existing.authors.length > 0 ? [...existing.authors] : [...c.authors],
    coverUrl: existing.coverUrl || c.coverUrl || null,
    isbn: existing.isbn ?? c.isbn ?? null,
  };
}

/**
 * 既存の本（シリーズ設定済み）のシリーズ・巻数を、確認画面で選んだ値に合わせるための差分。
 * シリーズ未設定の本は upsertBookFromCandidate が設定するので対象外。シリーズを外すことはしない。
 */
export function existingSeriesPatch(
  existing: Pick<Book, 'seriesId' | 'volume'> | null,
  chosen: { seriesId: string | null; volume: number | null },
): { seriesId?: string; volume?: number } {
  if (!existing?.seriesId || !chosen.seriesId) return {};
  const patch: { seriesId?: string; volume?: number } = {};
  if (chosen.seriesId !== existing.seriesId) patch.seriesId = chosen.seriesId;
  if (chosen.volume != null && chosen.volume !== existing.volume) patch.volume = chosen.volume;
  return patch;
}
