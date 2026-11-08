import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW_MODE,
  VIEW_MODE_STORAGE_KEY,
  bulkReturnPath,
  countBy,
  filterLoans,
  groupByLocation,
  isFilterActive,
  loadViewMode,
  saveViewMode,
  sortByDue,
  summarizeLoans,
} from './homeLogic';

type TestLoan = {
  id: string;
  locationId: string;
  borrowerUid: string;
  borrowedOn: string;
  dueOn: string;
  book: { title: string };
};

function loan(id: string, locationId: string, dueOn: string, extra: Partial<TestLoan> = {}): TestLoan {
  return { id, locationId, borrowerUid: 'u1', borrowedOn: '2026-11-01', dueOn, book: { title: id }, ...extra };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    data,
  };
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

describe('表示形式の保存', () => {
  it('既定は場所ごと', () => {
    expect(DEFAULT_VIEW_MODE).toBe('byLocation');
    expect(loadViewMode(memoryStorage())).toBe('byLocation');
    expect(loadViewMode(null)).toBe('byLocation');
  });

  it('保存した値を読み戻せる', () => {
    const s = memoryStorage();
    saveViewMode('byDue', s);
    expect(s.data.get(VIEW_MODE_STORAGE_KEY)).toBe('byDue');
    expect(loadViewMode(s)).toBe('byDue');
  });

  it('壊れた値は既定に戻す', () => {
    expect(loadViewMode(memoryStorage({ [VIEW_MODE_STORAGE_KEY]: 'grid' }))).toBe('byLocation');
  });

  it('ストレージが例外を出しても落ちない', () => {
    expect(loadViewMode(throwingStorage)).toBe('byLocation');
    expect(() => saveViewMode('byDue', throwingStorage)).not.toThrow();
  });
});

describe('summarizeLoans', () => {
  it('延滞・3日以内（今日〜3日後）・合計を数える', () => {
    const today = '2026-11-08';
    const loans = [
      loan('a', 'L1', '2026-11-01'), // 延滞
      loan('b', 'L1', '2026-11-07'), // 延滞（昨日）
      loan('c', 'L1', '2026-11-08'), // 今日まで
      loan('d', 'L1', '2026-11-11'), // 3日後
      loan('e', 'L1', '2026-11-12'), // 4日後
    ];
    expect(summarizeLoans(loans, today)).toEqual({ overdue: 2, soon: 2, total: 5 });
  });

  it('空なら全部 0', () => {
    expect(summarizeLoans([], '2026-11-08')).toEqual({ overdue: 0, soon: 0, total: 0 });
  });
});

describe('filterLoans', () => {
  const loans = [
    loan('a', 'L1', '2026-11-10', { borrowerUid: 'u1' }),
    loan('b', 'L2', '2026-11-10', { borrowerUid: 'u2' }),
    loan('c', 'L1', '2026-11-10', { borrowerUid: 'u2' }),
  ];

  it('場所と借りた人で絞り込む（null は条件なし）', () => {
    expect(filterLoans(loans, { locationId: null, borrowerUid: null }).map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(filterLoans(loans, { locationId: 'L1', borrowerUid: null }).map((l) => l.id)).toEqual(['a', 'c']);
    expect(filterLoans(loans, { locationId: null, borrowerUid: 'u2' }).map((l) => l.id)).toEqual(['b', 'c']);
    expect(filterLoans(loans, { locationId: 'L1', borrowerUid: 'u2' }).map((l) => l.id)).toEqual(['c']);
  });

  it('isFilterActive', () => {
    expect(isFilterActive({ locationId: null, borrowerUid: null })).toBe(false);
    expect(isFilterActive({ locationId: 'L1', borrowerUid: null })).toBe(true);
    expect(isFilterActive({ locationId: null, borrowerUid: 'u1' })).toBe(true);
  });
});

describe('sortByDue', () => {
  it('返却日 → 借りた日 → タイトルの順', () => {
    const loans = [
      loan('z', 'L1', '2026-11-20'),
      loan('b', 'L1', '2026-11-10', { borrowedOn: '2026-11-02' }),
      loan('a', 'L1', '2026-11-10', { borrowedOn: '2026-11-02' }),
      loan('c', 'L1', '2026-11-10', { borrowedOn: '2026-11-01' }),
    ];
    expect(sortByDue(loans).map((l) => l.id)).toEqual(['c', 'a', 'b', 'z']);
  });

  it('タイトルの数字は数値として比べる', () => {
    const loans = [
      loan('x', 'L1', '2026-11-10', { book: { title: 'おしりたんてい 10' } }),
      loan('y', 'L1', '2026-11-10', { book: { title: 'おしりたんてい 2' } }),
    ];
    expect(sortByDue(loans).map((l) => l.id)).toEqual(['y', 'x']);
  });
});

describe('groupByLocation', () => {
  const names: Record<string, string> = { L1: 'あおば図書館', L2: 'いずみ図書室', L3: 'うみ保育園' };
  const nameOf = (id: string) => names[id] ?? '（不明な場所）';

  it('セクションは最も近い返却日の順、セクション内は返却日順', () => {
    const loans = [
      loan('a', 'L1', '2026-11-20'),
      loan('b', 'L2', '2026-11-12'),
      loan('c', 'L1', '2026-11-10'),
      loan('d', 'L3', '2026-11-30'),
      loan('e', 'L2', '2026-11-25'),
    ];
    const sections = groupByLocation(loans, nameOf);
    expect(sections.map((s) => s.locationId)).toEqual(['L1', 'L2', 'L3']);
    expect(sections[0].loans.map((l) => l.id)).toEqual(['c', 'a']);
    expect(sections[0].earliestDue).toBe('2026-11-10');
    expect(sections[1].loans.map((l) => l.id)).toEqual(['b', 'e']);
    expect(sections[2].loans.map((l) => l.id)).toEqual(['d']);
  });

  it('最も近い返却日が同じなら場所名の順', () => {
    const loans = [loan('a', 'L3', '2026-11-10'), loan('b', 'L1', '2026-11-10')];
    expect(groupByLocation(loans, nameOf).map((s) => s.locationId)).toEqual(['L1', 'L3']);
  });

  it('空なら空', () => {
    expect(groupByLocation([], nameOf)).toEqual([]);
  });
});

describe('countBy', () => {
  it('キーごとの件数', () => {
    const counts = countBy([loan('a', 'L1', '2026-11-10'), loan('b', 'L1', '2026-11-10'), loan('c', 'L2', '2026-11-10')], (l) => l.locationId);
    expect(counts.get('L1')).toBe(2);
    expect(counts.get('L2')).toBe(1);
    expect(counts.get('L3')).toBeUndefined();
  });
});

describe('bulkReturnPath', () => {
  it('借りた人で絞り込んでいなければ場所単位', () => {
    expect(bulkReturnPath('L1', [{ id: 'a' }], false)).toBe('/return?location=L1');
  });

  it('借りた人で絞り込んでいれば見えている本だけ', () => {
    expect(bulkReturnPath('L1', [{ id: 'a' }, { id: 'b' }], true)).toBe('/return?loans=a,b');
  });

  it('ID はエンコードする', () => {
    expect(bulkReturnPath('a b', [], false)).toBe('/return?location=a%20b');
  });
});
