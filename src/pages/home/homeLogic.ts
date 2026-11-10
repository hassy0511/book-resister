/*
 * ホーム画面の純粋ロジック（要約・絞り込み・場所ごとのまとめ・表示形式の保存）。
 * Firebase に依存しないのでテストしやすい。
 */
import type { DateString, Loan } from '../../types';
import { dueStatus } from '../../lib/date';

// ---------------------------------------------------------------------------
// 表示形式（場所ごと / 返却日順）。localStorage に保存する
// ---------------------------------------------------------------------------

export type HomeViewMode = 'byLocation' | 'byDue';

export const VIEW_MODE_STORAGE_KEY = 'home.viewMode';
export const DEFAULT_VIEW_MODE: HomeViewMode = 'byLocation';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** 使える localStorage（プライベートブラウズなどでアクセス自体が例外になる場合は null） */
function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function isHomeViewMode(value: unknown): value is HomeViewMode {
  return value === 'byLocation' || value === 'byDue';
}

/** 保存した表示形式を読む。無い・壊れている・読めない場合は既定（場所ごと） */
export function loadViewMode(storage: StorageLike | null = browserStorage()): HomeViewMode {
  try {
    const value = storage?.getItem(VIEW_MODE_STORAGE_KEY);
    return isHomeViewMode(value) ? value : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

/** 表示形式を保存する（保存できなくても何もしない） */
export function saveViewMode(mode: HomeViewMode, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // 容量超過・プライベートブラウズなど。表示はそのまま続ける
  }
}

// ---------------------------------------------------------------------------
// 要約
// ---------------------------------------------------------------------------

export type LoanSummary = {
  /** 返却日を過ぎた冊数 */
  overdue: number;
  /** 今日〜3 日後が返却日の冊数 */
  soon: number;
  /** 貸出中の冊数 */
  total: number;
};

export function summarizeLoans(loans: readonly Pick<Loan, 'dueOn'>[], today: DateString): LoanSummary {
  let overdue = 0;
  let soon = 0;
  for (const loan of loans) {
    const status = dueStatus(loan.dueOn, today);
    if (status === 'overdue') overdue += 1;
    else if (status === 'soon') soon += 1;
  }
  return { overdue, soon, total: loans.length };
}

// ---------------------------------------------------------------------------
// 絞り込み・並べ替え
// ---------------------------------------------------------------------------

export type HomeFilter = {
  locationId: string | null;
  borrowerUid: string | null;
};

export function isFilterActive(filter: HomeFilter): boolean {
  return filter.locationId !== null || filter.borrowerUid !== null;
}

export function filterLoans<T extends Pick<Loan, 'locationId' | 'borrowerUid'>>(
  loans: readonly T[],
  filter: HomeFilter,
): T[] {
  return loans.filter(
    (l) =>
      (filter.locationId === null || l.locationId === filter.locationId) &&
      (filter.borrowerUid === null || l.borrowerUid === filter.borrowerUid),
  );
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

type DueSortable = Pick<Loan, 'dueOn' | 'borrowedOn'> & { book: Pick<Loan['book'], 'title'> };

/** 返却日が近い順（同じなら借りた日の古い順、タイトル順） */
export function compareByDue(a: DueSortable, b: DueSortable): number {
  return (
    a.dueOn.localeCompare(b.dueOn) ||
    a.borrowedOn.localeCompare(b.borrowedOn) ||
    collator.compare(a.book.title, b.book.title)
  );
}

export function sortByDue<T extends DueSortable>(loans: readonly T[]): T[] {
  return [...loans].sort(compareByDue);
}

/** key ごとの件数 */
export function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 場所ごとのまとめ
// ---------------------------------------------------------------------------

export type LocationSection<T> = {
  locationId: string;
  /** 返却日が近い順 */
  loans: T[];
  /** この場所でいちばん近い返却日 */
  earliestDue: DateString;
};

/**
 * 場所ごとにまとめる。セクションは「いちばん近い返却日」が早い順（同じなら場所名順）、
 * セクション内は返却日が近い順。
 */
export function groupByLocation<T extends DueSortable & Pick<Loan, 'locationId'>>(
  loans: readonly T[],
  locationName: (locationId: string) => string,
): LocationSection<T>[] {
  const byLocation = new Map<string, T[]>();
  for (const loan of loans) {
    const list = byLocation.get(loan.locationId);
    if (list) list.push(loan);
    else byLocation.set(loan.locationId, [loan]);
  }
  const sections: LocationSection<T>[] = [];
  for (const [locationId, list] of byLocation) {
    const sorted = sortByDue(list);
    sections.push({ locationId, loans: sorted, earliestDue: sorted[0].dueOn });
  }
  return sections.sort(
    (a, b) =>
      a.earliestDue.localeCompare(b.earliestDue) ||
      collator.compare(locationName(a.locationId), locationName(b.locationId)) ||
      a.locationId.localeCompare(b.locationId),
  );
}

/**
 * 「まとめて返却」のリンク先。
 * 借りた人で絞り込んでいるときは、見えている本だけを返却対象にする（?loans=）。
 * それ以外はその場所の貸出中すべて（?location=）。
 */
export function bulkReturnPath(
  locationId: string,
  visibleLoans: readonly { id: string }[],
  borrowerFiltered: boolean,
): string {
  if (borrowerFiltered) {
    const ids = visibleLoans.map((l) => encodeURIComponent(l.id)).join(',');
    return `/return?loans=${ids}`;
  }
  return `/return?location=${encodeURIComponent(locationId)}`;
}
