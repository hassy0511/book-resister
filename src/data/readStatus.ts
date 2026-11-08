/**
 * 読書状況の判定（純粋関数）。
 */
import type { Loan, ReadStatus } from '../types';

/** 本ごとの読書状況。reading = 貸出中、none = まだ借りていない */
export type BookReadState = 'reading' | 'read' | 'partial' | 'unread' | 'none';

type LoanReadFields = Pick<Loan, 'returnedOn' | 'readStatus'>;

/** 返却済みの読書状況の優先順位（大きいほど良い） */
const RANK: Record<ReadStatus, number> = { unread: 1, partial: 2, read: 3 };

/**
 * 1 冊の本の貸出記録から読書状況を決める。
 * 貸出中があれば 'reading'、それ以外は返却済みの中で最良（read > partial > unread）、貸出なしは 'none'。
 * 返却済みで readStatus が未設定の記録は 'unread' とみなす。
 */
export function bookReadState(loans: readonly LoanReadFields[]): BookReadState {
  if (loans.length === 0) return 'none';
  if (loans.some((l) => l.returnedOn === null)) return 'reading';
  let best: ReadStatus = 'unread';
  for (const l of loans) {
    const status = l.readStatus ?? 'unread';
    if (RANK[status] > RANK[best]) best = status;
  }
  return best;
}

/** 貸出記録を本ごとにまとめて読書状況を求める（シリーズ画面用）。貸出の無い本は含まれない */
export function readStatesByBook(
  loans: readonly (LoanReadFields & Pick<Loan, 'bookId'>)[],
): Map<string, BookReadState> {
  const byBook = new Map<string, LoanReadFields[]>();
  for (const l of loans) {
    const list = byBook.get(l.bookId);
    if (list) list.push(l);
    else byBook.set(l.bookId, [l]);
  }
  const out = new Map<string, BookReadState>();
  for (const [bookId, list] of byBook) out.set(bookId, bookReadState(list));
  return out;
}

/** 返却時の読書状況の表示名 */
export const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  read: '読んだ',
  partial: '途中まで',
  unread: '読んでいない',
};

/** 本ごとの読書状況の表示名 */
export const BOOK_READ_STATE_LABELS: Record<BookReadState, string> = {
  reading: '貸出中',
  read: '読んだ',
  partial: '途中まで',
  unread: '読んでいない',
  none: 'まだ借りていない',
};
