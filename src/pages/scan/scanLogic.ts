/*
 * スキャン画面の純粋ロジック（モードの判定、シリーズの既読状況の要約）。
 */
import { bookReadState, type BookReadState } from '../../data/readStatus';
import type { CartItem } from '../../state/borrowCartLogic';
import type { Book, Loan } from '../../types';

export type ScanMode = 'borrow' | 'check';

/** URL の ?mode= からモードを決める（既定は借りる） */
export function parseScanMode(value: string | null): ScanMode {
  return value === 'check' ? 'check' : 'borrow';
}

/** 巻数の一覧を「1〜3、5、7〜9」の形にする（重複・並び順は問わない） */
export function formatVolumeRanges(volumes: readonly number[]): string {
  const sorted = Array.from(new Set(volumes.filter((v) => Number.isInteger(v)))).sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    if (j === i) parts.push(String(sorted[i]));
    else if (j === i + 1) parts.push(`${sorted[i]}、${sorted[j]}`);
    else parts.push(`${sorted[i]}〜${sorted[j]}`);
    i = j + 1;
  }
  return parts.join('、');
}

export type SeriesSummary = {
  /** 借りたことがある巻（巻数のある本のみ） */
  borrowedVolumes: number[];
  /** 読んだ巻 */
  readVolumes: number[];
  /** 途中まで／読んでいない巻 */
  notFinishedVolumes: number[];
  /** いま借りている巻 */
  readingVolumes: number[];
  /**
   * まだ借りていない巻。全巻数があれば 1〜全巻数のうち借りていない巻、
   * 無ければ 1〜借りた最大の巻のうち抜けている巻。
   */
  notBorrowedVolumes: number[];
  total: number | null;
  /** 借りたことがある本の冊数（巻数の無い本も含む） */
  borrowedBookCount: number;
};

/** 本ごとの貸出からシリーズの既読状況をまとめる */
export function summarizeSeries(input: {
  books: readonly (Pick<Book, 'volume'> & { id: string })[];
  loans: readonly Pick<Loan, 'bookId' | 'returnedOn' | 'readStatus'>[];
  totalVolumes: number | null;
}): SeriesSummary {
  const loansByBook = new Map<string, Pick<Loan, 'bookId' | 'returnedOn' | 'readStatus'>[]>();
  for (const l of input.loans) {
    const list = loansByBook.get(l.bookId);
    if (list) list.push(l);
    else loansByBook.set(l.bookId, [l]);
  }

  // 巻ごとの状態（同じ巻の本が複数あれば良いほうを採る）
  const RANK: Record<BookReadState, number> = { none: 0, unread: 1, partial: 2, read: 3, reading: 4 };
  const byVolume = new Map<number, BookReadState>();
  let borrowedBookCount = 0;
  for (const b of input.books) {
    const state = bookReadState(loansByBook.get(b.id) ?? []);
    if (state !== 'none') borrowedBookCount += 1;
    if (b.volume == null) continue;
    const prev = byVolume.get(b.volume);
    if (prev === undefined || RANK[state] > RANK[prev]) byVolume.set(b.volume, state);
  }

  const pick = (pred: (s: BookReadState) => boolean) =>
    Array.from(byVolume.entries())
      .filter(([, s]) => pred(s))
      .map(([v]) => v)
      .sort((a, b) => a - b);

  const borrowedVolumes = pick((s) => s !== 'none');
  const total = input.totalVolumes != null && input.totalVolumes > 0 ? input.totalVolumes : null;
  const upper = total ?? (borrowedVolumes.length > 0 ? Math.max(...borrowedVolumes) : 0);
  const borrowedSet = new Set(borrowedVolumes);
  const notBorrowedVolumes: number[] = [];
  for (let v = 1; v <= upper; v += 1) if (!borrowedSet.has(v)) notBorrowedVolumes.push(v);

  return {
    borrowedVolumes,
    readVolumes: pick((s) => s === 'read'),
    notFinishedVolumes: pick((s) => s === 'partial' || s === 'unread'),
    readingVolumes: pick((s) => s === 'reading'),
    notBorrowedVolumes,
    total,
    borrowedBookCount,
  };
}

// ---------------------------------------------------------------------------
// 連続スキャンの小さな通知
// ---------------------------------------------------------------------------

export type ScanNoticeKind = 'added' | 'duplicate';

export type ScanNotice = {
  message: string;
  tone: 'success' | 'info' | 'warning';
  /** 書誌の取得中（通知を長めに出す） */
  loading: boolean;
};

/** 読み取った直後の通知の文言（カートの本の状態から作る） */
export function scanNoticeText(
  kind: ScanNoticeKind,
  item: Pick<CartItem, 'status' | 'candidate'> | null,
): ScanNotice {
  const title = item?.candidate?.title?.trim() || null;
  if (kind === 'duplicate') {
    return { message: title ? `すでに追加済み：${title}` : 'すでに追加済みです', tone: 'info', loading: false };
  }
  if (!item) return { message: '追加しました', tone: 'success', loading: false };
  if (item.status === 'loading') {
    return { message: title ? `追加：${title}（取得中…）` : '追加：タイトルを取得中…', tone: 'success', loading: true };
  }
  if (!title) {
    return {
      message: '追加：本の情報が見つかりません（次の画面でタイトルを入力できます）',
      tone: 'warning',
      loading: false,
    };
  }
  return { message: `追加：${title}`, tone: 'success', loading: false };
}
