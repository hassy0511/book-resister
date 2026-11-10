/*
 * シリーズ画面のロジック（純粋関数）: 巻ごとの状態、抜け番、一覧の集計。
 * 巻の状態は、その巻の本（別 ISBN の版が複数あってもよい）の貸出記録をまとめて bookReadState で決める。
 */
import type { Book, DateString, Loan } from '../../types';
import { bookReadState, type BookReadState } from '../../data/readStatus';

type LoanFields = Pick<Loan, 'bookId' | 'borrowedOn' | 'returnedOn' | 'readStatus'>;
type BookFields = Pick<Book, 'volume' | 'title'> & { id: string };

/** 1 冊の本の状況 */
export interface SeriesBookInfo<B> {
  book: B;
  state: BookReadState;
  loanCount: number;
  /** 最後に借りた日（借りていなければ null） */
  lastBorrowedOn: DateString | null;
  /** 一度でも「読んだ」で返却したか */
  everRead: boolean;
}

/** 1 つの巻（同じ巻の本が複数あることもある） */
export interface VolumeSlot<B> {
  volume: number;
  books: SeriesBookInfo<B>[];
  state: BookReadState;
  everRead: boolean;
}

export interface SeriesOverview<B> {
  /** 1〜lastVolume の巻（巻数 0 の本があれば 0 巻も先頭に入る） */
  slots: VolumeSlot<B>[];
  /** 巻数が未設定の本 */
  noVolume: SeriesBookInfo<B>[];
  /** 最後の巻（全巻数、無ければ本の巻数の最大値。巻が無ければ 0） */
  lastVolume: number;
  /** 全巻数が設定されているか */
  totalKnown: boolean;
  /** まだ借りていない巻（1〜lastVolume） */
  missing: number[];
  /** 巻の状態ごとの数 */
  stateCounts: Record<BookReadState, number>;
  /** 借りたことのある巻の数 */
  borrowedVolumes: number;
  /** 一度でも「読んだ」巻の数 */
  readVolumes: number;
  /** 巻数なしの本のうち借りたことのある冊数 */
  borrowedNoVolume: number;
  /** シリーズの本を最後に借りた日 */
  lastBorrowedOn: DateString | null;
}

/** 本ごとの貸出記録 */
export function groupLoansByBook<L extends Pick<Loan, 'bookId'>>(loans: readonly L[]): Map<string, L[]> {
  const out = new Map<string, L[]>();
  for (const loan of loans) {
    const list = out.get(loan.bookId);
    if (list) list.push(loan);
    else out.set(loan.bookId, [loan]);
  }
  return out;
}

function maxDate(a: DateString | null, b: DateString | null): DateString | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function bookInfo<B extends BookFields>(book: B, loans: readonly LoanFields[]): SeriesBookInfo<B> {
  let lastBorrowedOn: DateString | null = null;
  let everRead = false;
  for (const l of loans) {
    lastBorrowedOn = maxDate(lastBorrowedOn, l.borrowedOn || null);
    if (l.returnedOn !== null && l.readStatus === 'read') everRead = true;
  }
  return { book, state: bookReadState(loans), loanCount: loans.length, lastBorrowedOn, everRead };
}

function emptyCounts(): Record<BookReadState, number> {
  return { reading: 0, read: 0, partial: 0, unread: 0, none: 0 };
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

/**
 * シリーズの巻ごとの状況をまとめる。
 * loansByBook は本 ID ごとの貸出記録（groupLoansByBook の結果）。
 */
export function buildSeriesOverview<B extends BookFields>(
  books: readonly B[],
  loansByBook: ReadonlyMap<string, readonly LoanFields[]>,
  totalVolumes: number | null,
): SeriesOverview<B> {
  const byVolume = new Map<number, { infos: SeriesBookInfo<B>[]; loans: LoanFields[] }>();
  const noVolume: SeriesBookInfo<B>[] = [];
  let maxVolume = 0;
  let hasZero = false;
  let lastBorrowedOn: DateString | null = null;

  for (const book of books) {
    const loans = loansByBook.get(book.id) ?? [];
    const info = bookInfo(book, loans);
    lastBorrowedOn = maxDate(lastBorrowedOn, info.lastBorrowedOn);
    const v = book.volume;
    if (v === null || !Number.isInteger(v) || v < 0) {
      noVolume.push(info);
      continue;
    }
    if (v === 0) hasZero = true;
    maxVolume = Math.max(maxVolume, v);
    const entry = byVolume.get(v);
    if (entry) {
      entry.infos.push(info);
      entry.loans.push(...loans);
    } else {
      byVolume.set(v, { infos: [info], loans: [...loans] });
    }
  }

  const totalKnown = totalVolumes !== null && Number.isInteger(totalVolumes) && totalVolumes > 0;
  // 全巻数より大きい巻の本があっても表示から漏らさない
  const lastVolume = totalKnown ? Math.max(totalVolumes, maxVolume) : maxVolume;

  const slots: VolumeSlot<B>[] = [];
  const missing: number[] = [];
  const stateCounts = emptyCounts();
  let borrowedVolumes = 0;
  let readVolumes = 0;

  for (let v = hasZero ? 0 : 1; v <= lastVolume; v += 1) {
    const entry = byVolume.get(v);
    const infos = entry
      ? [...entry.infos].sort(
          (a, b) =>
            (b.lastBorrowedOn ?? '').localeCompare(a.lastBorrowedOn ?? '') || collator.compare(a.book.title, b.book.title),
        )
      : [];
    const state = bookReadState(entry?.loans ?? []);
    const everRead = infos.some((i) => i.everRead);
    slots.push({ volume: v, books: infos, state, everRead });
    stateCounts[state] += 1;
    if (state === 'none') {
      if (v >= 1) missing.push(v);
    } else {
      borrowedVolumes += 1;
    }
    if (everRead) readVolumes += 1;
  }

  noVolume.sort((a, b) => collator.compare(a.book.title, b.book.title));

  return {
    slots,
    noVolume,
    lastVolume,
    totalKnown,
    missing,
    stateCounts,
    borrowedVolumes,
    readVolumes,
    borrowedNoVolume: noVolume.filter((i) => i.loanCount > 0).length,
    lastBorrowedOn,
  };
}

/** 昇順の巻番号を連続する範囲にまとめる。[2,5,7,8,9] → [[2,2],[5,5],[7,9]] */
export function compressRanges(nums: readonly number[]): [number, number][] {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/** 巻番号の一覧の表示。[2,5,7,8,9] → "2, 5, 7〜9" */
export function formatVolumeRanges(nums: readonly number[]): string {
  return compressRanges(nums)
    .map(([a, b]) => (a === b ? String(a) : `${a}〜${b}`))
    .join(', ');
}

// ---------------------------------------------------------------------------
// シリーズ一覧
// ---------------------------------------------------------------------------

export interface SeriesSummary<S, B> {
  series: S;
  overview: SeriesOverview<B>;
  bookCount: number;
  /** 一覧に出す表紙（最後に借りた本、無ければ最初の巻） */
  coverBook: B | null;
}

/** シリーズ一覧の行を作る。最後に借りた日の新しい順（借りていないシリーズは後ろで名前順） */
export function summarizeSeriesList<
  S extends { id: string; name: string; totalVolumes: number | null },
  B extends BookFields & { seriesId: string | null },
>(seriesList: readonly S[], books: readonly B[], loans: readonly LoanFields[]): SeriesSummary<S, B>[] {
  const booksBySeries = new Map<string, B[]>();
  for (const book of books) {
    if (!book.seriesId) continue;
    const list = booksBySeries.get(book.seriesId);
    if (list) list.push(book);
    else booksBySeries.set(book.seriesId, [book]);
  }
  const loansByBook = groupLoansByBook(loans);

  const rows = seriesList.map((series) => {
    const seriesBooks = booksBySeries.get(series.id) ?? [];
    const overview = buildSeriesOverview(seriesBooks, loansByBook, series.totalVolumes);
    return { series, overview, bookCount: seriesBooks.length, coverBook: pickCoverBook(overview) };
  });

  return rows.sort((a, b) => {
    const da = a.overview.lastBorrowedOn ?? '';
    const db = b.overview.lastBorrowedOn ?? '';
    if (da !== db) return db.localeCompare(da);
    return collator.compare(a.series.name, b.series.name);
  });
}

function pickCoverBook<B extends BookFields>(overview: SeriesOverview<B>): B | null {
  const infos = [...overview.slots.flatMap((s) => s.books), ...overview.noVolume];
  let best: SeriesBookInfo<B> | null = null;
  for (const info of infos) {
    if (!info.lastBorrowedOn) continue;
    if (!best || (best.lastBorrowedOn ?? '') < info.lastBorrowedOn) best = info;
  }
  return (best ?? infos[0] ?? null)?.book ?? null;
}
