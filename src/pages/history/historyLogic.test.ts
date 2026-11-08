import { describe, expect, it } from 'vitest';
import type { Loan } from '../../types';
import {
  EMPTY_FILTER,
  activeFilterCount,
  applyFilterToParams,
  countBy,
  filterFromParams,
  filterHistory,
  groupByMonth,
  historyStateOf,
  monthLabel,
  periodRange,
  type HistoryFilter,
} from './historyLogic';
import { buildSearchText, matchesTerms, normalizeForSearch, parseSearchQuery } from './searchText';

type TestLoan = Pick<Loan, 'locationId' | 'borrowerUid' | 'borrowedOn' | 'returnedOn' | 'readStatus'> & {
  id: string;
  title: string;
  authors: string[];
};

function loan(id: string, patch: Partial<TestLoan> = {}): TestLoan {
  return {
    id,
    title: `本${id}`,
    authors: [],
    locationId: 'L1',
    borrowerUid: 'u1',
    borrowedOn: '2026-11-01',
    returnedOn: '2026-11-10',
    readStatus: 'read',
    ...patch,
  };
}

const TODAY = '2026-11-08';

describe('normalizeForSearch', () => {
  it('ひらがな・カタカナ、全角・半角、大文字・小文字の揺れを吸収する', () => {
    expect(normalizeForSearch('ゾロリ')).toBe(normalizeForSearch('ぞろり'));
    expect(normalizeForSearch('ｿﾞﾛﾘ')).toBe(normalizeForSearch('ぞろり'));
    expect(normalizeForSearch('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeForSearch('Harry')).toBe('harry');
  });

  it('空白や記号を無視する', () => {
    expect(normalizeForSearch('マジック・ツリーハウス')).toBe(normalizeForSearch('マジックツリーハウス'));
    expect(normalizeForSearch('おしりたんてい (3)')).toBe(normalizeForSearch('おしりたんてい3'));
    expect(normalizeForSearch('ヨシタケ　シンスケ')).toBe(normalizeForSearch('ヨシタケシンスケ'));
  });

  it('長音記号は残す', () => {
    expect(normalizeForSearch('ハウス')).not.toBe(normalizeForSearch('ハーウス'));
  });
});

describe('検索語', () => {
  const text = buildSearchText(['かいけつゾロリのきょうふのやかた', '原ゆたか']);

  it('部分一致で探す', () => {
    expect(matchesTerms(text, parseSearchQuery('ぞろり'))).toBe(true);
    expect(matchesTerms(text, parseSearchQuery('ﾔｶﾀ'))).toBe(true);
    expect(matchesTerms(text, parseSearchQuery('ノンタン'))).toBe(false);
  });

  it('空白区切りは AND 検索（タイトルと著者をまたいでもよい）', () => {
    expect(matchesTerms(text, parseSearchQuery('ゾロリ 原'))).toBe(true);
    expect(matchesTerms(text, parseSearchQuery('ゾロリ　ノンタン'))).toBe(false);
  });

  it('タイトルと著者の境目をまたいだ一致はしない', () => {
    expect(matchesTerms(text, parseSearchQuery('やかた原'))).toBe(false);
  });

  it('空の検索語は条件なし', () => {
    expect(parseSearchQuery('  　')).toEqual([]);
    expect(parseSearchQuery('・・')).toEqual([]);
    expect(matchesTerms(text, [])).toBe(true);
  });
});

describe('URL との変換', () => {
  it('URL から読み、不正な値は無視する', () => {
    const f = filterFromParams(
      new URLSearchParams('location=L1&borrower=u2&period=range&from=2026-04-01&to=bad&state=partial'),
    );
    expect(f).toEqual({
      locationId: 'L1',
      borrowerUid: 'u2',
      period: 'range',
      from: '2026-04-01',
      to: '',
      state: 'partial',
    });
    expect(filterFromParams(new URLSearchParams('period=xxx&state=yyy'))).toEqual(EMPTY_FILTER);
  });

  it('範囲指定でなければ from / to は使わない', () => {
    const f = filterFromParams(new URLSearchParams('period=this-year&from=2026-04-01'));
    expect(f.period).toBe('thisYear');
    expect(f.from).toBe('');
  });

  it('書き戻すと他のパラメータは残し、既定値は消す', () => {
    const prev = new URLSearchParams('q=ぞろり&location=L1&from=2026-01-01');
    const filter: HistoryFilter = { ...EMPTY_FILTER, period: 'lastYear', state: 'active' };
    const next = applyFilterToParams(prev, filter);
    expect(next.get('q')).toBe('ぞろり');
    expect(next.get('location')).toBeNull();
    expect(next.get('from')).toBeNull();
    expect(next.get('period')).toBe('last-year');
    expect(next.get('state')).toBe('active');
    expect(filterFromParams(next)).toEqual(filter);
  });

  it('設定されている絞り込みの数', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, locationId: 'L1', period: 'range', state: 'read' })).toBe(3);
  });
});

describe('periodRange', () => {
  it('今年・去年', () => {
    expect(periodRange({ period: 'thisYear', from: '', to: '' }, TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange({ period: 'lastYear', from: '', to: '' }, TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('範囲指定は片側だけでもよく、逆順なら入れ替える', () => {
    expect(periodRange({ period: 'range', from: '2026-04-01', to: '' }, TODAY)).toEqual({ from: '2026-04-01', to: null });
    expect(periodRange({ period: 'range', from: '2026-06-30', to: '2026-04-01' }, TODAY)).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
  });

  it('すべて', () => {
    expect(periodRange({ period: 'all', from: '2026-01-01', to: '' }, TODAY)).toEqual({ from: null, to: null });
  });
});

describe('historyStateOf', () => {
  it('貸出中・読書状況（未設定は読んでいない）', () => {
    expect(historyStateOf({ returnedOn: null, readStatus: null })).toBe('active');
    expect(historyStateOf({ returnedOn: '2026-11-01', readStatus: 'partial' })).toBe('partial');
    expect(historyStateOf({ returnedOn: '2026-11-01', readStatus: null })).toBe('unread');
  });
});

describe('filterHistory', () => {
  const loans = [
    loan('a', { borrowedOn: '2026-11-01', returnedOn: null, readStatus: null, title: 'かいけつゾロリ' }),
    loan('b', { borrowedOn: '2026-03-01', locationId: 'L2', readStatus: 'partial', title: 'ぐりとぐら' }),
    loan('c', { borrowedOn: '2025-12-31', borrowerUid: 'u2', title: 'ノンタン', authors: ['キヨノサチコ'] }),
    loan('d', { borrowedOn: '2025-01-01', readStatus: 'unread', title: 'おしりたんてい' }),
  ];
  const ids = (list: TestLoan[]) => list.map((l) => l.id);
  const search = (q: string) => ({ terms: parseSearchQuery(q), textOf: (l: TestLoan) => buildSearchText([l.title, ...l.authors]) });

  it('条件なしなら全件（順序を保つ）', () => {
    expect(ids(filterHistory(loans, EMPTY_FILTER, TODAY))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('場所・借りた人', () => {
    expect(ids(filterHistory(loans, { ...EMPTY_FILTER, locationId: 'L2' }, TODAY))).toEqual(['b']);
    expect(ids(filterHistory(loans, { ...EMPTY_FILTER, borrowerUid: 'u2' }, TODAY))).toEqual(['c']);
  });

  it('期間（境界の日を含む）', () => {
    expect(ids(filterHistory(loans, { ...EMPTY_FILTER, period: 'thisYear' }, TODAY))).toEqual(['a', 'b']);
    expect(ids(filterHistory(loans, { ...EMPTY_FILTER, period: 'lastYear' }, TODAY))).toEqual(['c', 'd']);
    expect(
      ids(filterHistory(loans, { ...EMPTY_FILTER, period: 'range', from: '2025-12-31', to: '2026-03-01' }, TODAY)),
    ).toEqual(['b', 'c']);
  });

  it('状態', () => {
    expect(ids(filterHistory(loans, { ...EMPTY_FILTER, state: 'active' }, TODAY))).toEqual(['a']);
    expect(ids(filterHistory(loans, { ...EMPTY_FILTER, state: 'read' }, TODAY))).toEqual(['c']);
    expect(ids(filterHistory(loans, { ...EMPTY_FILTER, state: 'unread' }, TODAY))).toEqual(['d']);
  });

  it('検索（タイトル・著者）', () => {
    expect(ids(filterHistory(loans, EMPTY_FILTER, TODAY, search('ぞろり')))).toEqual(['a']);
    expect(ids(filterHistory(loans, EMPTY_FILTER, TODAY, search('きよの')))).toEqual(['c']);
    expect(ids(filterHistory(loans, EMPTY_FILTER, TODAY, search('')))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignore で指定した条件は無視する', () => {
    const filter = { ...EMPTY_FILTER, locationId: 'L2', state: 'read' as const };
    expect(ids(filterHistory(loans, filter, TODAY))).toEqual([]);
    expect(ids(filterHistory(loans, filter, TODAY, undefined, 'location'))).toEqual(['c']);
    expect(ids(filterHistory(loans, filter, TODAY, undefined, 'state'))).toEqual(['b']);
  });
});

describe('groupByMonth', () => {
  it('借りた日の月ごとにまとめる（入力の順のまま）', () => {
    const groups = groupByMonth([
      loan('a', { borrowedOn: '2026-11-08' }),
      loan('b', { borrowedOn: '2026-11-01' }),
      loan('c', { borrowedOn: '2025-12-31' }),
    ]);
    expect(groups.map((g) => [g.key, g.label, g.loans.map((l) => l.id)])).toEqual([
      ['2026-11', '2026年11月', ['a', 'b']],
      ['2025-12', '2025年12月', ['c']],
    ]);
  });

  it('不正な日付は「日付なし」', () => {
    expect(monthLabel('')).toBe('日付なし');
    expect(groupByMonth([loan('a', { borrowedOn: '' })])[0].label).toBe('日付なし');
  });
});

describe('countBy', () => {
  it('値ごとに数える', () => {
    expect(countBy(['a', 'b', 'a'], (s) => s)).toEqual(
      new Map([
        ['a', 2],
        ['b', 1],
      ]),
    );
  });
});
