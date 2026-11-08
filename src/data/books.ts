/**
 * 本（groups/{gid}/books）。ISBN がある本の ID は `isbn-<ISBN13>`、無い本は自動 ID。
 */
import { useMemo } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type UpdateData,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useRequiredGroup } from '../group/GroupProvider';
import { bookIdForIsbn, normalizeIsbn } from '../lib/isbn';
import type { Book, BookCandidate, LoanBookSnapshot, WithId } from '../types';
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
  isValidDocId,
  noopSubscriber,
  querySubscriber,
  settleWrite,
  stripUndefined,
  toDataError,
  trimOrNull,
  useSubscription,
  type QueryResult,
} from './common';

/** updateBook で変更できる項目 */
export type BookPatch = Partial<Pick<Book, 'title' | 'authors' | 'publisher' | 'coverUrl' | 'seriesId' | 'volume'>>;

function booksCol(gid: string) {
  return collection(db, 'groups', gid, 'books');
}

function loansCol(gid: string) {
  return collection(db, 'groups', gid, 'loans');
}

// ---------------------------------------------------------------------------
// 純粋関数
// ---------------------------------------------------------------------------

/** 貸出記録に複製する本の情報 */
export function toLoanBookSnapshot(book: Pick<Book, 'title' | 'authors' | 'coverUrl' | 'isbn'>): LoanBookSnapshot {
  return {
    title: book.title,
    authors: [...book.authors],
    coverUrl: book.coverUrl ?? null,
    isbn: book.isbn ?? null,
  };
}

/** 巻数は 0 以上の整数。それ以外は null */
export function cleanVolume(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) && value >= 0 && value <= 99999 ? value : null;
}

/**
 * 候補の値を整える（前後空白・空配列・ISBN の正規化）。タイトルが空なら例外。
 * 書誌 API の値が長すぎる場合は firestore.rules の上限に切り詰め、使えない表紙 URL は捨てる。
 */
export function cleanCandidate(c: BookCandidate): BookCandidate {
  const title = clipText(c.title.trim(), TEXT_LIMITS.bookTitle);
  if (!title) throw new Error('タイトルを入力してください');
  const publisher = trimOrNull(c.publisher);
  return {
    isbn: c.isbn ? normalizeIsbn(c.isbn) : null,
    title,
    authors: clipAuthors(cleanStringList(c.authors)),
    publisher: publisher === null ? null : clipText(publisher, TEXT_LIMITS.publisher),
    coverUrl: cleanCoverUrl(c.coverUrl),
    seriesName: trimOrNull(c.seriesName),
    volume: cleanVolume(c.volume),
    source: c.source,
  };
}

/**
 * 既存の本の空欄だけを候補で補う差分を返す（変更が無ければ空オブジェクト）。
 * シリーズ未設定の本には引数のシリーズを設定する（巻数は既存の値を優先）。
 */
export function bookFillPatch(
  existing: Pick<Book, 'title' | 'authors' | 'publisher' | 'coverUrl' | 'seriesId' | 'volume'>,
  c: Pick<BookCandidate, 'title' | 'authors' | 'publisher' | 'coverUrl'>,
  series: { seriesId: string | null; volume: number | null },
): BookPatch {
  const patch: BookPatch = {};
  const title = c.title.trim();
  if (!existing.title.trim() && title) patch.title = title;
  const authors = cleanStringList(c.authors);
  if ((existing.authors ?? []).length === 0 && authors.length > 0) patch.authors = authors;
  const publisher = trimOrNull(c.publisher);
  if (!trimOrNull(existing.publisher) && publisher) patch.publisher = publisher;
  const coverUrl = cleanCoverUrl(c.coverUrl);
  if (!trimOrNull(existing.coverUrl) && coverUrl) patch.coverUrl = coverUrl;
  if (existing.seriesId == null && series.seriesId) {
    patch.seriesId = series.seriesId;
    const volume = existing.volume ?? cleanVolume(series.volume);
    if (volume !== existing.volume) patch.volume = volume;
  }
  return patch;
}

/** updateBook の引数を整える（undefined は除く） */
export function cleanBookPatch(patch: BookPatch): BookPatch {
  const out: BookPatch = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error('タイトルを入力してください');
    if (title.length > TEXT_LIMITS.bookTitle) throw new Error(`タイトルは ${TEXT_LIMITS.bookTitle} 文字以内にしてください`);
    out.title = title;
  }
  if (patch.authors !== undefined) {
    const authors = cleanStringList(patch.authors);
    if (authors.some((a) => a.length > TEXT_LIMITS.author)) {
      throw new Error(`著者名は 1 人あたり ${TEXT_LIMITS.author} 文字以内にしてください`);
    }
    out.authors = clipAuthors(authors);
  }
  if (patch.publisher !== undefined) {
    const publisher = trimOrNull(patch.publisher);
    if (publisher !== null && publisher.length > TEXT_LIMITS.publisher) {
      throw new Error(`出版社は ${TEXT_LIMITS.publisher} 文字以内にしてください`);
    }
    out.publisher = publisher;
  }
  if (patch.coverUrl !== undefined) {
    const raw = trimOrNull(patch.coverUrl);
    const coverUrl = cleanCoverUrl(raw);
    if (raw !== null && coverUrl === null) {
      throw new Error('表紙画像の URL は https:// で始まる形で入力してください');
    }
    out.coverUrl = coverUrl;
  }
  if (patch.seriesId !== undefined) out.seriesId = trimOrNull(patch.seriesId);
  if (patch.volume !== undefined) {
    const volume = cleanVolume(patch.volume);
    if (patch.volume !== null && volume === null) throw new Error('巻数は 0 以上の整数で入力してください');
    out.volume = volume;
  }
  return out;
}

/** 貸出記録の book に反映する差分（ドット区切りのフィールドパス） */
export function loanSnapshotPatch(patch: BookPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.title !== undefined) out['book.title'] = patch.title;
  if (patch.authors !== undefined) out['book.authors'] = patch.authors;
  if (patch.coverUrl !== undefined) out['book.coverUrl'] = patch.coverUrl;
  return out;
}

/** 巻数順（巻数なしは後ろ）、同じならタイトル順 */
export function sortBooksByVolume<T extends Pick<Book, 'volume' | 'title'>>(books: readonly T[]): T[] {
  return [...books].sort((a, b) => {
    if (a.volume !== b.volume) {
      if (a.volume === null) return 1;
      if (b.volume === null) return -1;
      return a.volume - b.volume;
    }
    return compareJa(a.title, b.title);
  });
}

/** タイトル完全一致の候補から使う本を選ぶ（ISBN なしの本を優先） */
export function pickTitleMatch<T extends Pick<Book, 'isbn'>>(matches: readonly T[]): T | null {
  return matches.find((b) => b.isbn === null) ?? matches[0] ?? null;
}

// ---------------------------------------------------------------------------
// フック
// ---------------------------------------------------------------------------

export function useBook(bookId: string | undefined): QueryResult<WithId<Book> | null> {
  const { groupId } = useRequiredGroup();
  const valid = isValidDocId(bookId);
  return useSubscription(
    valid ? `book/${groupId}/${bookId}` : null,
    valid ? docSubscriber<Book>(doc(booksCol(groupId), bookId)) : noopSubscriber,
    null,
  );
}

/** 全件（タイトル順） */
export function useBooks(): QueryResult<WithId<Book>[]> {
  const { groupId } = useRequiredGroup();
  const result = useSubscription(`books/${groupId}`, querySubscriber<Book>(booksCol(groupId)), EMPTY_LIST);
  return useMemo(
    () => ({ ...result, data: [...result.data].sort((a, b) => compareJa(a.title, b.title)) }),
    [result],
  );
}

/** シリーズの本（巻数順） */
export function useBooksInSeries(seriesId: string | undefined): QueryResult<WithId<Book>[]> {
  const { groupId } = useRequiredGroup();
  const result = useSubscription(
    seriesId ? `booksInSeries/${groupId}/${seriesId}` : null,
    seriesId ? querySubscriber<Book>(query(booksCol(groupId), where('seriesId', '==', seriesId))) : noopSubscriber,
    EMPTY_LIST,
  );
  return useMemo(() => ({ ...result, data: sortBooksByVolume(result.data) }), [result]);
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

/** サーバー優先で読む。オフラインでキャッシュにも無ければ「存在しない」扱い */
async function readDoc(ref: DocumentReference): Promise<DocumentSnapshot | null> {
  try {
    return await getDoc(ref);
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'unavailable') return null;
    throw toDataError(e);
  }
}

export async function getBook(gid: string, bookId: string): Promise<WithId<Book> | null> {
  if (!isValidDocId(bookId)) return null;
  const snap = await readDoc(doc(booksCol(gid), bookId));
  return snap && snap.exists() ? docWithId<Book>(snap) : null;
}

/** 候補に対応する既存の本。ISBN があれば ID で、無ければタイトル完全一致で探す */
export async function findBookForCandidate(gid: string, c: BookCandidate): Promise<WithId<Book> | null> {
  const isbn = c.isbn ? normalizeIsbn(c.isbn) : null;
  if (isbn) return getBook(gid, bookIdForIsbn(isbn));
  const title = c.title.trim();
  if (!title) return null;
  try {
    const snap = await getDocs(query(booksCol(gid), where('title', '==', title)));
    return pickTitleMatch(snap.docs.map((d) => docWithId<Book>(d)));
  } catch (e) {
    throw toDataError(e);
  }
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

/** 本を更新し、貸出記録の book スナップショットにも反映する */
async function writeBookPatch(gid: string, bookId: string, patch: BookPatch): Promise<void> {
  const bookUpdate = { ...stripUndefined(patch), updatedAt: serverTimestamp() };
  const loanPatch = loanSnapshotPatch(patch);
  const updates: { ref: DocumentReference; data: UpdateData<DocumentData> }[] = [
    { ref: doc(booksCol(gid), bookId), data: bookUpdate },
  ];
  if (Object.keys(loanPatch).length > 0) {
    let loanRefs: DocumentReference[];
    try {
      // オフラインのときはキャッシュにある貸出記録だけが対象になる
      const snap = await getDocs(query(loansCol(gid), where('bookId', '==', bookId)));
      loanRefs = snap.docs.map((d) => d.ref);
    } catch (e) {
      throw toDataError(e);
    }
    for (const ref of loanRefs) updates.push({ ref, data: { ...loanPatch, updatedAt: serverTimestamp() } });
  }
  const commits = chunk(updates, BATCH_LIMIT).map((group) => {
    const batch = writeBatch(db);
    for (const u of group) batch.update(u.ref, u.data);
    return batch.commit();
  });
  await settleWrite(Promise.all(commits));
}

/**
 * 候補から本を登録する。既存があればその ID を返す（既存の空欄だけ補完し、シリーズ未設定なら設定）。
 * 無ければ作成する。
 */
export async function upsertBookFromCandidate(
  gid: string,
  c: BookCandidate,
  series: { seriesId: string | null; volume: number | null },
): Promise<string> {
  const cand = cleanCandidate(c);
  const existing = await findBookForCandidate(gid, cand);
  if (existing) {
    const patch = bookFillPatch(existing, cand, series);
    if (Object.keys(patch).length > 0) await writeBookPatch(gid, existing.id, patch);
    return existing.id;
  }
  const ref = cand.isbn ? doc(booksCol(gid), bookIdForIsbn(cand.isbn)) : doc(booksCol(gid));
  await settleWrite(
    setDoc(ref, {
      isbn: cand.isbn,
      title: cand.title,
      authors: cand.authors,
      publisher: cand.publisher,
      coverUrl: cand.coverUrl,
      seriesId: series.seriesId ?? null,
      volume: cleanVolume(series.volume),
      source: cand.source,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  return ref.id;
}

/** 本を更新する。title / authors / coverUrl が変わる場合は、その本の全貸出記録の book も更新する */
export async function updateBook(gid: string, bookId: string, patch: BookPatch): Promise<void> {
  const clean = cleanBookPatch(patch);
  if (Object.keys(clean).length === 0) return;
  await writeBookPatch(gid, bookId, clean);
}
