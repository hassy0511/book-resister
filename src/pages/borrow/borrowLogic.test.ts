import { describe, expect, it } from 'vitest';
import type { BookCandidate } from '../../types';
import {
  autoDueOn,
  bookIdForCartItem,
  describeLoan,
  duplicatedBookIds,
  effectiveDueOn,
  existingSeriesPatch,
  formatFullDate,
  latestReturnedLoan,
  loadLastLocationId,
  loanSnapshotFor,
  matchExistingBooks,
  normalizeForSearch,
  rankByAuthor,
  pickDefaultLocationId,
  saveLastLocationId,
  splitAuthors,
  submitBlockReason,
} from './borrowLogic';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const cand: BookCandidate = {
  isbn: null,
  title: 'ぐりとぐら',
  authors: [],
  publisher: null,
  coverUrl: null,
  seriesName: null,
  volume: null,
  source: 'manual',
};

describe('前回の場所', () => {
  it('保存して読める。読めないストレージでも落ちない', () => {
    const s = memoryStorage();
    expect(loadLastLocationId(s)).toBeNull();
    saveLastLocationId('L2', s);
    expect(loadLastLocationId(s)).toBe('L2');
    const broken = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(loadLastLocationId(broken)).toBeNull();
    expect(() => saveLastLocationId('L1', broken)).not.toThrow();
  });

  it('初期値: 前回 → 1 つだけならそれ → 未選択', () => {
    const list = [{ id: 'L1' }, { id: 'L2' }];
    expect(pickDefaultLocationId(list, 'L2')).toBe('L2');
    expect(pickDefaultLocationId(list, 'gone')).toBe('');
    expect(pickDefaultLocationId([{ id: 'L1' }], null)).toBe('L1');
    expect(pickDefaultLocationId([], 'L1')).toBe('');
  });
});

describe('日付', () => {
  it('借りた日＋貸出期間', () => {
    expect(autoDueOn('2026-11-08', 14)).toBe('2026-11-22');
    expect(autoDueOn('2026-12-25', 14)).toBe('2027-01-08');
    expect(autoDueOn('', 14)).toBeNull();
    expect(autoDueOn('2026-11-08', null)).toBeNull();
  });

  it('formatFullDate', () => {
    expect(formatFullDate('2025-03-02')).toBe('2025年3月2日');
    expect(formatFullDate('bad')).toBe('bad');
  });

  it('個別の返却日が優先', () => {
    expect(effectiveDueOn({ dueOnOverride: null }, '2026-11-22')).toBe('2026-11-22');
    expect(effectiveDueOn({ dueOnOverride: '2026-12-01' }, '2026-11-22')).toBe('2026-12-01');
  });
});

describe('本・貸出の表示', () => {
  it('bookIdForCartItem', () => {
    expect(bookIdForCartItem({ existingBookId: 'b1', isbn: '9784834000825' })).toBe('b1');
    expect(bookIdForCartItem({ existingBookId: null, isbn: '9784834000825' })).toBe('isbn-9784834000825');
    expect(bookIdForCartItem({ existingBookId: null, isbn: null })).toBeNull();
  });

  it('describeLoan', () => {
    expect(describeLoan({ borrowedOn: '2025-03-02', returnedOn: '2025-03-16', readStatus: 'read' }, '中央図書館', 'ママ')).toBe(
      '2025年3月2日 中央図書館 ママ（読んだ）',
    );
    expect(describeLoan({ borrowedOn: '2026-11-01', returnedOn: null, readStatus: null }, '図書室', 'はなこ')).toBe(
      '2026年11月1日 図書室 はなこ（貸出中）',
    );
  });

  it('latestReturnedLoan は返却済みの中で最新', () => {
    const loans = [
      { id: 'a', borrowedOn: '2025-01-01', returnedOn: '2025-01-10' },
      { id: 'b', borrowedOn: '2026-11-01', returnedOn: null },
      { id: 'c', borrowedOn: '2025-06-01', returnedOn: '2025-06-10' },
    ];
    expect(latestReturnedLoan(loans)?.id).toBe('c');
    expect(latestReturnedLoan([])).toBeNull();
  });

  it('duplicatedBookIds', () => {
    const dup = duplicatedBookIds([
      { existingBookId: 'b1', isbn: null },
      { existingBookId: null, isbn: '9784834000825' },
      { existingBookId: 'b1', isbn: null },
      { existingBookId: null, isbn: null },
    ]);
    expect(Array.from(dup)).toEqual(['b1']);
  });

  it('splitAuthors', () => {
    expect(splitAuthors(' なかがわりえこ、 おおむらゆりこ ,なかがわりえこ')).toEqual(['なかがわりえこ', 'おおむらゆりこ']);
    expect(splitAuthors('')).toEqual([]);
  });
});

describe('submitBlockReason', () => {
  const base = {
    items: [{ status: 'ready' as const, candidate: cand, dueOnOverride: null }],
    locationId: 'L1',
    borrowerUid: 'u1',
    borrowedOn: '2026-11-08',
    bulkDueOn: '2026-11-22',
  };

  it('そろっていれば null', () => {
    expect(submitBlockReason(base)).toBeNull();
  });

  it('本が無い・取得中・タイトルなし', () => {
    expect(submitBlockReason({ ...base, items: [] })).toBe('借りる本がありません');
    expect(submitBlockReason({ ...base, items: [{ status: 'loading', candidate: null, dueOnOverride: null }] })).toContain(
      '取得しています（1冊）',
    );
    expect(submitBlockReason({ ...base, items: [{ status: 'not-found', candidate: null, dueOnOverride: null }] })).toContain(
      'タイトルが入っていない本があります（1冊）',
    );
    expect(
      submitBlockReason({
        ...base,
        items: [{ status: 'not-found', candidate: { ...cand, title: '手入力' }, dueOnOverride: null }],
      }),
    ).toBeNull();
  });

  it('場所・借りた人・日付', () => {
    expect(submitBlockReason({ ...base, locationId: '' })).toBe('借りた場所を選んでください');
    expect(submitBlockReason({ ...base, borrowerUid: '' })).toBe('借りた人を選んでください');
    expect(submitBlockReason({ ...base, borrowedOn: '' })).toBe('借りた日を入力してください');
    expect(submitBlockReason({ ...base, bulkDueOn: '' })).toBe('返却日を入力してください');
    expect(submitBlockReason({ ...base, bulkDueOn: '2026-11-01' })).toBe('返却日は借りた日以降にしてください');
    expect(
      submitBlockReason({
        ...base,
        items: [{ status: 'ready', candidate: cand, dueOnOverride: '2026-11-01' }],
      }),
    ).toBe('返却日は借りた日以降にしてください');
  });
});

describe('タイトル検索の補助', () => {
  const books = [
    { title: 'ぐりとぐら', authors: ['なかがわ りえこ'] },
    { title: 'ぐりとぐらのえんそく', authors: ['なかがわりえこ'] },
    { title: 'ノンタン ぶらんこのせて', authors: ['キヨノサチコ'] },
  ];

  it('normalizeForSearch は空白・全角半角・記号の違いを無視する', () => {
    expect(normalizeForSearch('ノンタン　ぶらんこ・のせて')).toBe(normalizeForSearch('ﾉﾝﾀﾝぶらんこのせて'));
  });

  it('matchExistingBooks はタイトルの部分一致＋著者', () => {
    expect(matchExistingBooks(books, 'ぐり と ぐら', '').map((b) => b.title)).toEqual(['ぐりとぐら', 'ぐりとぐらのえんそく']);
    expect(matchExistingBooks(books, 'ぐりとぐら', 'りえこ')).toHaveLength(2);
    expect(matchExistingBooks(books, 'ぐりとぐら', 'キヨノ')).toHaveLength(0);
    expect(matchExistingBooks(books, '  ', '')).toHaveLength(0);
    expect(matchExistingBooks(books, 'ぐり', '', 1)).toHaveLength(1);
  });

  it('rankByAuthor は著者が一致するものを先に', () => {
    const list = [
      { id: 1, authors: ['ほかのひと'] },
      { id: 2, authors: ['なかがわりえこ', 'おおむらゆりこ'] },
      { id: 3, authors: [] },
    ];
    expect(rankByAuthor(list, 'おおむら').map((x) => x.id)).toEqual([2, 1, 3]);
    expect(rankByAuthor(list, '').map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe('登録の補助', () => {
  it('loanSnapshotFor は既存の本を優先し、空欄を候補で補う', () => {
    const c = { title: '候補', authors: ['A'], coverUrl: 'https://c', isbn: '9784834000825' };
    expect(loanSnapshotFor(null, c)).toEqual({ title: '候補', authors: ['A'], coverUrl: 'https://c', isbn: '9784834000825' });
    expect(loanSnapshotFor({ title: '既存', authors: [], coverUrl: null, isbn: null }, c)).toEqual({
      title: '既存',
      authors: ['A'],
      coverUrl: 'https://c',
      isbn: '9784834000825',
    });
  });

  it('existingSeriesPatch は既存のシリーズ設定済みの本だけ', () => {
    expect(existingSeriesPatch(null, { seriesId: 's1', volume: 1 })).toEqual({});
    expect(existingSeriesPatch({ seriesId: null, volume: null }, { seriesId: 's1', volume: 1 })).toEqual({});
    expect(existingSeriesPatch({ seriesId: 's1', volume: 2 }, { seriesId: null, volume: 3 })).toEqual({});
    expect(existingSeriesPatch({ seriesId: 's1', volume: 2 }, { seriesId: 's1', volume: 2 })).toEqual({});
    expect(existingSeriesPatch({ seriesId: 's1', volume: 2 }, { seriesId: 's2', volume: 5 })).toEqual({ seriesId: 's2', volume: 5 });
    expect(existingSeriesPatch({ seriesId: 's1', volume: 2 }, { seriesId: 's1', volume: null })).toEqual({});
  });
});
