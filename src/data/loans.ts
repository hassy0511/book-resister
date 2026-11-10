/**
 * 貸出記録（groups/{gid}/loans）。貸出中は returnedOn == null。
 * 複合インデックスを使わないよう、クエリは単一フィールドの条件だけにして並べ替えはクライアントで行う。
 */
import { useMemo } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useRequiredGroup } from '../group/GroupProvider';
import { normalizeIsbn } from '../lib/isbn';
import type { DateString, Loan, LoanBookSnapshot, ReadStatus, WithId } from '../types';
import {
  BATCH_LIMIT,
  EMPTY_LIST,
  TEXT_LIMITS,
  chunk,
  cleanCoverUrl,
  cleanStringList,
  clipAuthors,
  clipText,
  compareJa,
  docSubscriber,
  docWithId,
  isDateString,
  isValidDocId,
  noopSubscriber,
  querySubscriber,
  settleWrite,
  stripUndefined,
  trimOrNull,
  uniqueSorted,
  useSubscription,
  type QueryResult,
  type Subscriber,
} from './common';

export interface NewLoanInput {
  bookId: string;
  book: LoanBookSnapshot;
  locationId: string;
  borrowerUid: string;
  borrowedOn: DateString;
  dueOn: DateString;
}

export interface ReturnInput {
  loanId: string;
  returnedOn: DateString;
  readStatus: ReadStatus;
  rating: number | null;
  review: string | null;
}

export type LoanPatch = Partial<
  Pick<Loan, 'dueOn' | 'locationId' | 'borrowerUid' | 'borrowedOn' | 'rating' | 'review' | 'readStatus' | 'returnedOn'>
>;

/** Firestore の in クエリに渡せる値の最大数 */
const IN_QUERY_LIMIT = 30;

const READ_STATUSES: readonly ReadStatus[] = ['read', 'partial', 'unread'];

function loansCol(gid: string) {
  return collection(db, 'groups', gid, 'loans');
}

// ---------------------------------------------------------------------------
// 純粋関数
// ---------------------------------------------------------------------------

type SortableLoan = Pick<Loan, 'dueOn' | 'borrowedOn' | 'book'>;

/** 返却日が近い順（同じなら借りた日、タイトル順） */
export function sortLoansByDue<T extends SortableLoan>(loans: readonly T[]): T[] {
  return [...loans].sort(
    (a, b) =>
      a.dueOn.localeCompare(b.dueOn) ||
      a.borrowedOn.localeCompare(b.borrowedOn) ||
      compareJa(a.book.title, b.book.title),
  );
}

/** 借りた日の新しい順（同じなら作成日時の新しい順、タイトル順） */
export function sortLoansByBorrowedDesc<T extends SortableLoan & Partial<Pick<Loan, 'createdAt'>>>(
  loans: readonly T[],
): T[] {
  return [...loans].sort((a, b) => {
    const byDate = b.borrowedOn.localeCompare(a.borrowedOn);
    if (byDate !== 0) return byDate;
    const at = a.createdAt?.toMillis?.() ?? 0;
    const bt = b.createdAt?.toMillis?.() ?? 0;
    if (at !== bt) return bt - at;
    return compareJa(a.book.title, b.book.title);
  });
}

function requireDate(value: unknown, label: string): DateString {
  if (!isDateString(value)) throw new Error(`${label}が正しくありません`);
  return value;
}

/** 評価は 1〜5 の整数か null */
export function cleanRating(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('評価は 1〜5 で選んでください');
  return value;
}

/** 感想は前後の空白を除き、空なら null */
export function cleanReview(value: string | null | undefined): string | null {
  const review = trimOrNull(value);
  if (review !== null && review.length > TEXT_LIMITS.review) {
    throw new Error(`感想は ${TEXT_LIMITS.review} 文字以内にしてください`);
  }
  return review;
}

function requireReadStatus(value: unknown): ReadStatus {
  if (typeof value === 'string' && (READ_STATUSES as readonly string[]).includes(value)) return value as ReadStatus;
  throw new Error('読書状況を選んでください');
}

function requireId(value: string, label: string): string {
  if (!value || !value.trim()) throw new Error(`${label}を選んでください`);
  return value;
}

/** スナップショットの ISBN。13 桁（978/979）ならそのまま、それ以外は正規化を試み、だめなら null */
function snapshotIsbn(value: string | null | undefined): string | null {
  const raw = trimOrNull(value);
  if (raw === null) return null;
  return /^97[89]\d{10}$/.test(raw) ? raw : normalizeIsbn(raw);
}

/** 新しい貸出記録のフィールド（createdAt / updatedAt 以外） */
export function buildNewLoan(input: NewLoanInput, uid: string): Omit<Loan, 'createdAt' | 'updatedAt'> {
  const borrowedOn = requireDate(input.borrowedOn, '借りた日');
  const dueOn = requireDate(input.dueOn, '返却日');
  if (dueOn < borrowedOn) throw new Error('返却日は借りた日以降にしてください');
  const title = clipText(input.book.title.trim(), TEXT_LIMITS.bookTitle);
  if (!title) throw new Error('タイトルがありません');
  return {
    bookId: requireId(input.bookId, '本'),
    book: {
      title,
      authors: clipAuthors(cleanStringList(input.book.authors)),
      coverUrl: cleanCoverUrl(input.book.coverUrl),
      isbn: snapshotIsbn(input.book.isbn),
    },
    locationId: requireId(input.locationId, '場所'),
    borrowerUid: requireId(input.borrowerUid, '借りた人'),
    borrowedOn,
    dueOn,
    returnedOn: null,
    readStatus: null,
    rating: null,
    review: null,
    createdBy: uid,
  };
}

/** updateLoan の引数を整える（undefined は除く） */
export function cleanLoanPatch(patch: LoanPatch): LoanPatch {
  return stripUndefined({
    dueOn: patch.dueOn === undefined ? undefined : requireDate(patch.dueOn, '返却日'),
    borrowedOn: patch.borrowedOn === undefined ? undefined : requireDate(patch.borrowedOn, '借りた日'),
    locationId: patch.locationId === undefined ? undefined : requireId(patch.locationId, '場所'),
    borrowerUid: patch.borrowerUid === undefined ? undefined : requireId(patch.borrowerUid, '借りた人'),
    rating: patch.rating === undefined ? undefined : cleanRating(patch.rating),
    review: patch.review === undefined ? undefined : cleanReview(patch.review),
    readStatus:
      patch.readStatus === undefined ? undefined : patch.readStatus === null ? null : requireReadStatus(patch.readStatus),
    returnedOn:
      patch.returnedOn === undefined ? undefined : patch.returnedOn === null ? null : requireDate(patch.returnedOn, '返却した日'),
  });
}

// ---------------------------------------------------------------------------
// フック
// ---------------------------------------------------------------------------

/** 貸出中（返却日が近い順） */
export function useActiveLoans(): QueryResult<WithId<Loan>[]> {
  const { groupId } = useRequiredGroup();
  const result = useSubscription(
    `activeLoans/${groupId}`,
    querySubscriber<Loan>(query(loansCol(groupId), where('returnedOn', '==', null))),
    EMPTY_LIST,
  );
  return useMemo(() => ({ ...result, data: sortLoansByDue(result.data) }), [result]);
}

/**
 * 全件（借りた日の新しい順）。件数に比例して読み取りが増えるため（30 分以上空けて開き直すたびに全件分）、
 * 全件が本当に必要な場所（シリーズ一覧の集計、履歴の全期間の検索・絞り込み）だけで使う。
 */
export function useAllLoans(): QueryResult<WithId<Loan>[]> {
  const { groupId } = useRequiredGroup();
  const result = useSubscription(`allLoans/${groupId}`, querySubscriber<Loan>(loansCol(groupId)), EMPTY_LIST);
  return useMemo(() => ({ ...result, data: sortLoansByBorrowedDesc(result.data) }), [result]);
}

/**
 * 履歴画面で読む範囲。
 *   - recent: 借りた日の新しい順に count 件だけ（最初に開いたとき。条件が無ければ一覧の 1 ページ分で足りる）
 *   - range:  借りた日が from〜to の記録（期間で絞り込んだとき。null は制限なし）
 *   - all:    全件（全期間の検索・絞り込み、「もっと見る」）
 * どれも単一フィールド（borrowedOn）の条件・並べ替えだけなので、複合インデックスは要らない。
 */
export type HistoryScope =
  | { kind: 'recent'; count: number }
  | { kind: 'range'; from: DateString | null; to: DateString | null }
  | { kind: 'all' };

/** 範囲の比較用のキー（同じ範囲なら同じ文字列） */
export function historyScopeKey(scope: HistoryScope): string {
  switch (scope.kind) {
    case 'recent':
      return `recent:${scope.count}`;
    case 'range':
      return `range:${scope.from ?? ''}:${scope.to ?? ''}`;
    case 'all':
      return 'all';
  }
}

/** 履歴の範囲を読むとき、キャッシュの結果より先にサーバーの結果を待つ時間 */
const HISTORY_SERVER_WAIT_MS = 3000;

function historyConstraints(scope: HistoryScope): QueryConstraint[] {
  switch (scope.kind) {
    case 'recent':
      return [orderBy('borrowedOn', 'desc'), limit(scope.count)];
    case 'range': {
      const out: QueryConstraint[] = [];
      if (scope.from) out.push(where('borrowedOn', '>=', scope.from));
      if (scope.to) out.push(where('borrowedOn', '<=', scope.to));
      return out;
    }
    case 'all':
      return [];
  }
}

/** 履歴画面用。scope の範囲の貸出記録（借りた日の新しい順） */
export function useHistoryLoans(scope: HistoryScope): QueryResult<WithId<Loan>[]> {
  const { groupId } = useRequiredGroup();
  const scopeKey = historyScopeKey(scope);
  const result = useSubscription(
    `historyLoans/${groupId}/${scopeKey}`,
    // 範囲を切り替えた直後のキャッシュには別の範囲で読んだ一部の記録しか無いことがあるので、サーバーの結果を少し待つ
    querySubscriber<Loan>(query(loansCol(groupId), ...historyConstraints(scope)), {
      preferServerMs: HISTORY_SERVER_WAIT_MS,
    }),
    EMPTY_LIST,
  );
  return useMemo(() => ({ ...result, data: sortLoansByBorrowedDesc(result.data) }), [result]);
}

/** 1 冊の本の貸出記録（借りた日の新しい順） */
export function useLoansForBook(bookId: string | undefined): QueryResult<WithId<Loan>[]> {
  const { groupId } = useRequiredGroup();
  const result = useSubscription(
    bookId ? `loansForBook/${groupId}/${bookId}` : null,
    bookId ? querySubscriber<Loan>(query(loansCol(groupId), where('bookId', '==', bookId))) : noopSubscriber,
    EMPTY_LIST,
  );
  return useMemo(() => ({ ...result, data: sortLoansByBorrowedDesc(result.data) }), [result]);
}

/** 複数の本の貸出記録をまとめて購読する（bookId の in クエリを 30 件ずつに分割） */
function loansForBooksSubscriber(gid: string, bookIds: string[]): Subscriber<WithId<Loan>[]> {
  return (next, fail) => {
    const groups = chunk(bookIds, IN_QUERY_LIMIT);
    const results: (WithId<Loan>[] | undefined)[] = groups.map(() => undefined);
    const unsubscribes: Unsubscribe[] = groups.map((ids, i) =>
      onSnapshot(
        query(loansCol(gid), where('bookId', 'in', ids)),
        (snap) => {
          results[i] = snap.docs.map((d) => docWithId<Loan>(d));
          // すべての分割クエリが 1 回以上届いてから返す
          if (results.every((r) => r !== undefined)) {
            next(results.flatMap((r) => r ?? []));
          }
        },
        fail,
      ),
    );
    return () => unsubscribes.forEach((u) => u());
  };
}

/** シリーズ画面用。複数の本の貸出記録（借りた日の新しい順） */
export function useLoansForBooks(bookIds: string[]): QueryResult<WithId<Loan>[]> {
  const { groupId } = useRequiredGroup();
  const idsKey = uniqueSorted(bookIds.filter((id) => id)).join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);
  const result = useSubscription(
    ids.length > 0 ? `loansForBooks/${groupId}/${idsKey}` : null,
    ids.length > 0 ? loansForBooksSubscriber(groupId, ids) : noopSubscriber,
    EMPTY_LIST,
  );
  return useMemo(() => ({ ...result, data: sortLoansByBorrowedDesc(result.data) }), [result]);
}

export function useLoan(loanId: string | undefined): QueryResult<WithId<Loan> | null> {
  const { groupId } = useRequiredGroup();
  const valid = isValidDocId(loanId);
  return useSubscription(
    valid ? `loan/${groupId}/${loanId}` : null,
    valid ? docSubscriber<Loan>(doc(loansCol(groupId), loanId)) : noopSubscriber,
    null,
  );
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

/** 貸出記録をまとめて作成する（1 バッチ）。作成した ID を入力と同じ順で返す */
export async function createLoans(gid: string, uid: string, inputs: NewLoanInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];
  const docs = inputs.map((input) => ({ ref: doc(loansCol(gid)), data: buildNewLoan(input, uid) }));
  const commits = chunk(docs, BATCH_LIMIT).map((group) => {
    const batch = writeBatch(db);
    for (const d of group) {
      batch.set(d.ref, { ...d.data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    return batch.commit();
  });
  await settleWrite(Promise.all(commits));
  return docs.map((d) => d.ref.id);
}

export async function updateLoan(gid: string, loanId: string, patch: LoanPatch): Promise<void> {
  const clean = cleanLoanPatch(patch);
  if (Object.keys(clean).length === 0) return;
  await settleWrite(updateDoc(doc(loansCol(gid), loanId), { ...clean, updatedAt: serverTimestamp() }));
}

/** まとめて返却する（1 バッチ） */
export async function returnLoans(gid: string, items: ReturnInput[]): Promise<void> {
  if (items.length === 0) return;
  const updates = items.map((item) => ({
    ref: doc(loansCol(gid), requireId(item.loanId, '貸出記録')),
    data: {
      returnedOn: requireDate(item.returnedOn, '返却した日'),
      readStatus: requireReadStatus(item.readStatus),
      rating: cleanRating(item.rating),
      review: cleanReview(item.review),
    },
  }));
  const commits = chunk(updates, BATCH_LIMIT).map((group) => {
    const batch = writeBatch(db);
    for (const u of group) batch.update(u.ref, { ...u.data, updatedAt: serverTimestamp() });
    return batch.commit();
  });
  await settleWrite(Promise.all(commits));
}

/** 返却を取り消す（returnedOn と readStatus を null に戻す。評価・感想は残す） */
export async function undoReturn(gid: string, loanId: string): Promise<void> {
  await settleWrite(
    updateDoc(doc(loansCol(gid), loanId), { returnedOn: null, readStatus: null, updatedAt: serverTimestamp() }),
  );
}

/** 誤登録の削除 */
export async function deleteLoan(gid: string, loanId: string): Promise<void> {
  await settleWrite(deleteDoc(doc(loansCol(gid), loanId)));
}
