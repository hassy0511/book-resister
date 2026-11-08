import { describe, expect, it } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import type { Book, BookCandidate, WithId } from '../types';
import {
  applyExisting,
  applyLookup,
  applyPatch,
  cartIsbn,
  findDuplicate,
  fillCandidateBlanks,
  isItemResolved,
  itemFromBook,
  itemFromCandidate,
  newIsbnItem,
  parseStoredCart,
  serializeCart,
  type CartItem,
} from './borrowCartLogic';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const ISBN = '9784834000825';

function cand(patch: Partial<BookCandidate> = {}): BookCandidate {
  return {
    isbn: ISBN,
    title: 'ぐりとぐら',
    authors: ['なかがわりえこ'],
    publisher: '福音館書店',
    coverUrl: 'https://example.com/a.jpg',
    seriesName: null,
    volume: null,
    source: 'openbd',
    ...patch,
  };
}

function book(patch: Partial<Book> = {}, id = `isbn-${ISBN}`): WithId<Book> {
  return {
    id,
    isbn: ISBN,
    title: 'ぐりとぐら（既存）',
    authors: [],
    publisher: null,
    coverUrl: null,
    seriesId: null,
    volume: null,
    source: 'manual',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
}

describe('cartIsbn', () => {
  it('ISBN-10 やハイフン付きを 13 桁にする', () => {
    expect(cartIsbn('4-8340-0082-6')).toBe(ISBN);
    expect(cartIsbn(' 978-4-8340-0082-5 ')).toBe(ISBN);
  });
  it('空は null', () => {
    expect(cartIsbn('  ')).toBeNull();
    expect(cartIsbn(null)).toBeNull();
  });
});

describe('findDuplicate', () => {
  const items: CartItem[] = [
    newIsbnItem(ISBN),
    { ...itemFromCandidate(cand({ isbn: null, title: 'げつようびは なにたべる？' }), 'manual-1') },
    { ...itemFromBook(book({ isbn: null }, 'b-1'), null, 'b-1') },
  ];
  it('同じ ISBN', () => {
    expect(findDuplicate(items, { isbn: '4834000826' })?.key).toBe(ISBN);
  });
  it('同じ既存の本', () => {
    expect(findDuplicate(items, { bookId: 'b-1' })?.key).toBe('b-1');
  });
  it('ISBN なしで同じタイトル（空白・全角半角の違いは無視）', () => {
    expect(findDuplicate(items, { titleWithoutIsbn: 'げつようびはなにたべる?' })?.key).toBe('manual-1');
  });
  it('違う本は重複ではない', () => {
    expect(findDuplicate(items, { isbn: '9784591005262' })).toBeNull();
    expect(findDuplicate(items, { titleWithoutIsbn: 'ちがう本' })).toBeNull();
  });
});

describe('既存の本・書誌の反映', () => {
  it('取得中 → 書誌が見つかれば ready、シリーズは推定値', () => {
    const looked = cand({ seriesName: 'おしりたんてい', volume: 3 });
    const out = applyLookup(newIsbnItem(ISBN), looked);
    expect(out.status).toBe('ready');
    expect(out.candidate?.title).toBe('ぐりとぐら');
    expect(out.seriesName).toBe('おしりたんてい');
    expect(out.volume).toBe(3);
  });

  it('取得中 → 見つからなければ not-found', () => {
    const out = applyLookup(newIsbnItem(ISBN), null);
    expect(out.status).toBe('not-found');
    expect(out.candidate).toBeNull();
    expect(isItemResolved(out)).toBe(false);
  });

  it('既存の本があれば、本の情報とシリーズを優先し、空欄は書誌で補う', () => {
    const ex = { book: book({ seriesId: 's1', volume: 2 }), seriesName: 'ぐりとぐらシリーズ' };
    const step1 = applyExisting(newIsbnItem(ISBN), ex);
    expect(step1.status).toBe('ready');
    expect(step1.existingBookId).toBe(`isbn-${ISBN}`);
    expect(step1.candidate?.title).toBe('ぐりとぐら（既存）');
    expect(step1.seriesName).toBe('ぐりとぐらシリーズ');
    expect(step1.volume).toBe(2);

    const looked = cand({ seriesName: '別のシリーズ', volume: 9 });
    const step2 = applyLookup(step1, looked);
    expect(step2.candidate?.title).toBe('ぐりとぐら（既存）');
    expect(step2.candidate?.authors).toEqual(['なかがわりえこ']);
    expect(step2.candidate?.coverUrl).toBe('https://example.com/a.jpg');
    expect(step2.seriesName).toBe('ぐりとぐらシリーズ');
    expect(step2.volume).toBe(2);
  });

  it('既存の本にシリーズが無ければ、候補のシリーズを使う', () => {
    const fromSearch = itemFromCandidate(cand({ seriesName: 'おしりたんてい', volume: 1 }), ISBN);
    const out = applyExisting(fromSearch, { book: book(), seriesName: null });
    expect(out.seriesName).toBe('おしりたんてい');
    expect(out.volume).toBe(1);
    expect(out.existingBookId).toBe(`isbn-${ISBN}`);
  });

  it('既存の本のシリーズ名が不明（一覧に無い）なら候補の値を残す', () => {
    const fromSearch = itemFromCandidate(cand({ seriesName: 'おしりたんてい', volume: 1 }), ISBN);
    const out = applyExisting(fromSearch, { book: book({ seriesId: 'gone', volume: 5 }), seriesName: null });
    expect(out.seriesName).toBe('おしりたんてい');
    expect(out.volume).toBe(1);
  });

  it('既存の本の後で書誌が見つからなくても ready のまま', () => {
    const step1 = applyExisting(newIsbnItem(ISBN), { book: book(), seriesName: null });
    expect(applyLookup(step1, null).status).toBe('ready');
  });

  it('返却日の個別指定は書誌の反映で消えない', () => {
    const item = { ...newIsbnItem(ISBN), dueOnOverride: '2026-12-01' };
    expect(applyLookup(item, cand()).dueOnOverride).toBe('2026-12-01');
  });

  it('fillCandidateBlanks は空欄だけ補う', () => {
    const out = fillCandidateBlanks(cand({ publisher: null, coverUrl: '' }), cand({ publisher: 'A社', coverUrl: 'x' }));
    expect(out.publisher).toBe('A社');
    expect(out.coverUrl).toBe('x');
    expect(out.title).toBe('ぐりとぐら');
  });
});

describe('applyPatch', () => {
  it('空のシリーズ名は null、手入力のタイトルで解決済みになる', () => {
    const nf = applyLookup(newIsbnItem(ISBN), null);
    const out = applyPatch(nf, {
      seriesName: '  ',
      candidate: { ...cand({ title: '手入力の本', source: 'manual' }) },
    });
    expect(out.seriesName).toBeNull();
    expect(out.status).toBe('not-found');
    expect(isItemResolved(out)).toBe(true);
  });
});

describe('保存形式', () => {
  it('保存して読み戻せる', () => {
    const items = [newIsbnItem(ISBN), itemFromCandidate(cand({ isbn: null }), 'manual-a')];
    const restored = parseStoredCart(serializeCart('g1', items));
    expect(restored.groupId).toBe('g1');
    expect(restored.items).toEqual(items);
  });

  it('壊れた内容・古い形式は捨てる', () => {
    expect(parseStoredCart('{').items).toEqual([]);
    expect(parseStoredCart(JSON.stringify({ version: 2, items: [] })).items).toEqual([]);
    expect(parseStoredCart(null).items).toEqual([]);
  });

  it('おかしな項目は直すか捨てる', () => {
    const raw = JSON.stringify({
      version: 1,
      groupId: 'g1',
      items: [
        { key: ISBN, status: 'ready', candidate: null, isbn: ISBN },
        { key: ISBN, status: 'loading', isbn: ISBN },
        { key: '', status: 'ready' },
        { key: 'x', status: 'loading', isbn: null, candidate: null, dueOnOverride: 'あした' },
        'ゴミ',
      ],
    });
    const { items } = parseStoredCart(raw);
    expect(items).toHaveLength(2);
    expect(items[0].status).toBe('loading');
    expect(items[1]).toMatchObject({ key: 'x', status: 'not-found', dueOnOverride: null });
  });
});
