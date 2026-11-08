// @vitest-environment jsdom
/* BorrowCartProvider の動作（書誌取得・既存の本・保存）。データ層と書誌検索はモック */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Timestamp } from 'firebase/firestore';
import type { Book, BookCandidate, Series, WithId } from '../types';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const state = vi.hoisted(() => ({
  group: { groupId: 'g1' as string | null, loading: false },
  series: { data: [] as unknown[], loading: false, error: null as Error | null },
}));

const api = vi.hoisted(() => ({
  lookupByIsbn: vi.fn(),
  getBook: vi.fn(),
  findBookForCandidate: vi.fn(),
}));

vi.mock('../group/GroupProvider', () => ({
  useGroup: () => state.group,
}));
vi.mock('../data/series', () => ({
  useSeriesList: () => state.series,
}));
vi.mock('../data/books', () => ({
  getBook: api.getBook,
  findBookForCandidate: api.findBookForCandidate,
}));
vi.mock('../lib/bookLookup', () => ({
  lookupByIsbn: api.lookupByIsbn,
}));

import { BorrowCartProvider, useBorrowCart, type BorrowCart } from './borrowCart';
import { CART_STORAGE_KEY, serializeCart, newIsbnItem } from './borrowCartLogic';

const ISBN = '9784834000825';
const ISBN2 = '9784591005262';

function candidate(patch: Partial<BookCandidate> = {}): BookCandidate {
  return {
    isbn: ISBN,
    title: 'ぐりとぐら',
    authors: ['なかがわりえこ'],
    publisher: '福音館書店',
    coverUrl: 'https://example.com/g.jpg',
    seriesName: null,
    volume: null,
    source: 'openbd',
    ...patch,
  };
}

function book(patch: Partial<WithId<Book>> = {}): WithId<Book> {
  return {
    id: `isbn-${ISBN}`,
    isbn: ISBN,
    title: 'ぐりとぐら',
    authors: ['なかがわりえこ'],
    publisher: null,
    coverUrl: null,
    seriesId: 's1',
    volume: 1,
    source: 'openbd',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
}

function series(id: string, name: string): WithId<Series> {
  return { id, name, totalVolumes: null, createdAt: ts, updatedAt: ts };
}

let cart: BorrowCart;
function Probe() {
  cart = useBorrowCart();
  return null;
}

function renderCart() {
  return render(
    <BorrowCartProvider>
      <Probe />
    </BorrowCartProvider>,
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
  state.group = { groupId: 'g1', loading: false };
  state.series = { data: [series('s1', 'ぐりとぐらシリーズ')], loading: false, error: null };
  api.lookupByIsbn.mockReset().mockResolvedValue(null);
  api.getBook.mockReset().mockResolvedValue(null);
  api.findBookForCandidate.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe('BorrowCartProvider', () => {
  it('addIsbn はすぐ取得中で追加し、書誌が届いたら ready にする', async () => {
    api.lookupByIsbn.mockResolvedValue(candidate({ seriesName: 'ぐりとぐら', volume: 2 }));
    renderCart();
    let result = '';
    act(() => {
      result = cart.addIsbn(ISBN);
    });
    expect(result).toBe('added');
    expect(cart.items[0].status).toBe('loading');
    await flush();
    expect(api.getBook).toHaveBeenCalledWith('g1', `isbn-${ISBN}`);
    expect(cart.items[0]).toMatchObject({ status: 'ready', seriesName: 'ぐりとぐら', volume: 2, existingBookId: null });
    expect(cart.items[0].candidate?.title).toBe('ぐりとぐら');
  });

  it('同じ ISBN は duplicate（同じタップ内の連続呼び出しでも）', () => {
    renderCart();
    const results: string[] = [];
    act(() => {
      results.push(cart.addIsbn(ISBN));
      results.push(cart.addIsbn('4834000826'));
    });
    expect(results).toEqual(['added', 'duplicate']);
    expect(cart.items).toHaveLength(1);
  });

  it('既存の本があれば、その情報とシリーズを優先する', async () => {
    api.getBook.mockResolvedValue(book({ title: '既存のぐりとぐら', volume: 1 }));
    api.lookupByIsbn.mockResolvedValue(candidate({ seriesName: '別名', volume: 7 }));
    renderCart();
    act(() => {
      cart.addIsbn(ISBN);
    });
    await flush();
    expect(cart.items[0]).toMatchObject({
      status: 'ready',
      existingBookId: `isbn-${ISBN}`,
      seriesName: 'ぐりとぐらシリーズ',
      volume: 1,
    });
    expect(cart.items[0].candidate?.title).toBe('既存のぐりとぐら');
    // 空欄（表紙・出版社）は書誌で補う
    expect(cart.items[0].candidate?.coverUrl).toBe('https://example.com/g.jpg');
    expect(cart.items[0].candidate?.publisher).toBe('福音館書店');
  });

  it('見つからなければ not-found', async () => {
    renderCart();
    act(() => {
      cart.addIsbn(ISBN2);
    });
    await flush();
    expect(cart.items[0].status).toBe('not-found');
  });

  it('グループ未参加でも落ちない（既存の本は確認しない）', async () => {
    state.group = { groupId: null, loading: false };
    api.lookupByIsbn.mockResolvedValue(candidate());
    renderCart();
    act(() => {
      cart.addIsbn(ISBN);
    });
    await flush();
    expect(api.getBook).not.toHaveBeenCalled();
    expect(cart.items[0].status).toBe('ready');
  });

  it('addCandidate は既存の本を確認して existingBookId を入れる', async () => {
    api.findBookForCandidate.mockResolvedValue(book({ id: 'b-manual', title: 'てがき', isbn: null, seriesId: null, volume: null }));
    renderCart();
    act(() => {
      cart.addCandidate(candidate({ isbn: null, title: 'てがき', source: 'manual', seriesName: 'てがきシリーズ', volume: 3 }));
    });
    await flush();
    expect(cart.items[0]).toMatchObject({ existingBookId: 'b-manual', seriesName: 'てがきシリーズ', volume: 3 });
    // ISBN なしで同じタイトルは duplicate
    let dup = '';
    act(() => {
      dup = cart.addCandidate(candidate({ isbn: null, title: 'てがき', source: 'manual' }));
    });
    expect(dup).toBe('duplicate');
  });

  it('addExistingBook はシリーズ名を一覧から引く', () => {
    renderCart();
    let r = '';
    act(() => {
      r = cart.addExistingBook(book());
    });
    expect(r).toBe('added');
    expect(cart.items[0]).toMatchObject({ status: 'ready', existingBookId: `isbn-${ISBN}`, seriesName: 'ぐりとぐらシリーズ', volume: 1 });
    act(() => {
      r = cart.addIsbn(ISBN);
    });
    expect(r).toBe('duplicate');
  });

  it('localStorage に保存し、復元時に取得中の本を取り直す', async () => {
    localStorage.setItem(CART_STORAGE_KEY, serializeCart('g1', [newIsbnItem(ISBN)]));
    api.lookupByIsbn.mockResolvedValue(candidate());
    renderCart();
    expect(cart.items).toHaveLength(1);
    await flush();
    expect(api.lookupByIsbn).toHaveBeenCalledTimes(1);
    expect(cart.items[0].status).toBe('ready');
    const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '{}') as { items: { status: string }[] };
    expect(saved.items[0].status).toBe('ready');

    act(() => {
      cart.clear();
    });
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('グループの読み込み中は取得を始めない', async () => {
    state.group = { groupId: null, loading: true };
    localStorage.setItem(CART_STORAGE_KEY, serializeCart('g1', [newIsbnItem(ISBN)]));
    const view = renderCart();
    await flush();
    expect(api.lookupByIsbn).not.toHaveBeenCalled();
    state.group = { groupId: 'g1', loading: false };
    view.rerender(
      <BorrowCartProvider>
        <Probe />
      </BorrowCartProvider>,
    );
    await flush();
    expect(api.lookupByIsbn).toHaveBeenCalledTimes(1);
    expect(api.getBook).toHaveBeenCalledTimes(1);
  });

  it('別のグループの保存内容は捨てる', async () => {
    localStorage.setItem(CART_STORAGE_KEY, serializeCart('other', [newIsbnItem(ISBN)]));
    renderCart();
    await flush();
    expect(cart.items).toHaveLength(0);
  });

  it('update と remove', () => {
    renderCart();
    act(() => {
      cart.addCandidate(candidate());
    });
    act(() => {
      cart.update(ISBN, { seriesName: 'ぐりとぐら', volume: 4, dueOnOverride: '2026-12-01' });
    });
    expect(cart.items[0]).toMatchObject({ seriesName: 'ぐりとぐら', volume: 4, dueOnOverride: '2026-12-01' });
    act(() => {
      cart.remove(ISBN);
    });
    expect(cart.items).toHaveLength(0);
  });
});
