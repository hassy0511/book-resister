/*
 * 履歴画面のロジック（純粋関数）: 絞り込み条件と URL の相互変換、絞り込み、月ごとのまとめ。
 */
import type { DateString, Loan } from '../../types';
import { matchesTerms } from './searchText';

/** 期間の絞り込み */
export type PeriodKind = 'thisYear' | 'lastYear' | 'all' | 'range';

/** 状態の絞り込み（貸出中 / 返却時の読書状況） */
export type HistoryState = 'active' | 'read' | 'partial' | 'unread';

export interface HistoryFilter {
  locationId: string | null;
  borrowerUid: string | null;
  period: PeriodKind;
  /** period が 'range' のときだけ使う（'' は指定なし） */
  from: DateString;
  to: DateString;
  state: HistoryState | null;
}

export const EMPTY_FILTER: HistoryFilter = {
  locationId: null,
  borrowerUid: null,
  period: 'all',
  from: '',
  to: '',
  state: null,
};

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  thisYear: '今年',
  lastYear: '去年',
  all: 'すべて',
  range: '期間指定',
};

export const HISTORY_STATE_LABELS: Record<HistoryState, string> = {
  active: '貸出中',
  read: '読んだ',
  partial: '途中まで',
  unread: '読んでいない',
};

export const HISTORY_STATES: readonly HistoryState[] = ['active', 'read', 'partial', 'unread'];

/** 一度に表示する件数（「もっと見る」で増やす） */
export const PAGE_SIZE = 100;

type HistoryLoan = Pick<Loan, 'locationId' | 'borrowerUid' | 'borrowedOn' | 'returnedOn' | 'readStatus'>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): DateString {
  return value && DATE_RE.test(value) ? value : '';
}

// ---------------------------------------------------------------------------
// URL のクエリ文字列 ⇔ 絞り込み条件
// ---------------------------------------------------------------------------

const PERIOD_PARAM: Record<Exclude<PeriodKind, 'all'>, string> = {
  thisYear: 'this-year',
  lastYear: 'last-year',
  range: 'range',
};

function parsePeriod(value: string | null): PeriodKind {
  for (const [kind, param] of Object.entries(PERIOD_PARAM)) {
    if (param === value) return kind as PeriodKind;
  }
  return 'all';
}

function parseState(value: string | null): HistoryState | null {
  return value && (HISTORY_STATES as readonly string[]).includes(value) ? (value as HistoryState) : null;
}

/** URL のクエリ文字列から絞り込み条件を読む（不正な値は無視する） */
export function filterFromParams(params: URLSearchParams): HistoryFilter {
  const period = parsePeriod(params.get('period'));
  return {
    locationId: params.get('location') || null,
    borrowerUid: params.get('borrower') || null,
    period,
    from: period === 'range' ? validDate(params.get('from')) : '',
    to: period === 'range' ? validDate(params.get('to')) : '',
    state: parseState(params.get('state')),
  };
}

/** 絞り込み条件を URL のクエリ文字列に書く（検索語 q など他のパラメータは残す） */
export function applyFilterToParams(prev: URLSearchParams, filter: HistoryFilter): URLSearchParams {
  const next = new URLSearchParams(prev);
  const set = (key: string, value: string | null) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  set('location', filter.locationId);
  set('borrower', filter.borrowerUid);
  set('period', filter.period === 'all' ? null : PERIOD_PARAM[filter.period]);
  set('from', filter.period === 'range' ? filter.from || null : null);
  set('to', filter.period === 'range' ? filter.to || null : null);
  set('state', filter.state);
  return next;
}

/** 絞り込み（検索語以外）がいくつ設定されているか */
export function activeFilterCount(filter: HistoryFilter): number {
  let n = 0;
  if (filter.locationId) n += 1;
  if (filter.borrowerUid) n += 1;
  if (filter.period !== 'all') n += 1;
  if (filter.state) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// 絞り込み
// ---------------------------------------------------------------------------

/** 期間の絞り込みを借りた日の範囲にする（null は制限なし）。範囲指定の前後が逆なら入れ替える */
export function periodRange(
  filter: Pick<HistoryFilter, 'period' | 'from' | 'to'>,
  today: DateString,
): { from: DateString | null; to: DateString | null } {
  const year = Number(today.slice(0, 4));
  switch (filter.period) {
    case 'thisYear':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'lastYear':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case 'range': {
      const from = filter.from || null;
      const to = filter.to || null;
      if (from && to && from > to) return { from: to, to: from };
      return { from, to };
    }
    case 'all':
      return { from: null, to: null };
  }
}

/** 貸出記録の状態。返却済みで読書状況が無いものは「読んでいない」とみなす（bookReadState と同じ） */
export function historyStateOf(loan: Pick<Loan, 'returnedOn' | 'readStatus'>): HistoryState {
  if (loan.returnedOn === null) return 'active';
  return loan.readStatus ?? 'unread';
}

export type FilterDimension = 'location' | 'borrower' | 'state';

/**
 * 絞り込み条件に合う記録だけを返す（順序は保つ）。
 * ignore に指定した条件は無視する（チップの件数を数えるときに使う）。
 */
export function filterHistory<T extends HistoryLoan>(
  loans: readonly T[],
  filter: HistoryFilter,
  today: DateString,
  search?: { terms: readonly string[]; textOf: (loan: T) => string },
  ignore?: FilterDimension,
): T[] {
  const { from, to } = periodRange(filter, today);
  const locationId = ignore === 'location' ? null : filter.locationId;
  const borrowerUid = ignore === 'borrower' ? null : filter.borrowerUid;
  const state = ignore === 'state' ? null : filter.state;
  const terms = search && search.terms.length > 0 ? search.terms : null;
  return loans.filter((loan) => {
    if (locationId && loan.locationId !== locationId) return false;
    if (borrowerUid && loan.borrowerUid !== borrowerUid) return false;
    if (from && loan.borrowedOn < from) return false;
    if (to && loan.borrowedOn > to) return false;
    if (state && historyStateOf(loan) !== state) return false;
    if (terms && search && !matchesTerms(search.textOf(loan), terms)) return false;
    return true;
  });
}

/** 値ごとの件数 */
export function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 月ごとのまとめ
// ---------------------------------------------------------------------------

export interface MonthGroup<T> {
  /** 'YYYY-MM'（不正な日付は '' ） */
  key: string;
  label: string;
  loans: T[];
}

/** 'YYYY-MM' → 「2026年11月」 */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return '日付なし';
  return `${Number(m[1])}年${Number(m[2])}月`;
}

export function monthKeyOf(date: DateString): string {
  return DATE_RE.test(date) ? date.slice(0, 7) : '';
}

/** 借りた日の月ごとにまとめる（並びは入力の順のまま。降順に並んだ入力を想定） */
export function groupByMonth<T extends Pick<Loan, 'borrowedOn'>>(loans: readonly T[]): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  const index = new Map<string, MonthGroup<T>>();
  for (const loan of loans) {
    const key = monthKeyOf(loan.borrowedOn);
    let group = index.get(key);
    if (!group) {
      group = { key, label: monthLabel(key), loans: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.loans.push(loan);
  }
  return groups;
}
