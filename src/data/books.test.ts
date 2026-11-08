import { describe, expect, it, vi } from 'vitest';
import type { Book, BookCandidate } from '../types';

// Firebase とグループ・ISBN モジュールはテストでは使わない
vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));
vi.mock('../group/GroupProvider', () => ({ useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1' }) }));
vi.mock('../lib/isbn', () => ({
  normalizeIsbn: (input: string) => {
    const digits = input.replace(/[-\s]/g, '');
    return /^97[89]\d{10}$/.test(digits) ? digits : null;
  },
  bookIdForIsbn: (isbn13: string) => `isbn-${isbn13}`,
}));

const {
  bookFillPatch,
  cleanBookPatch,
  cleanCandidate,
  cleanVolume,
  loanSnapshotPatch,
  pickTitleMatch,
  sortBooksByVolume,
  toLoanBookSnapshot,
} = await import('./books');

type BookFields = Pick<Book, 'title' | 'authors' | 'publisher' | 'coverUrl' | 'seriesId' | 'volume'>;

const baseBook: BookFields = {
  title: 'おしりたんてい',
  authors: ['トロル'],
  publisher: 'ポプラ社',
  coverUrl: 'https://example.com/a.jpg',
  seriesId: null,
  volume: null,
};

const candidate = (patch: Partial<BookCandidate> = {}): BookCandidate => ({
  isbn: '9784591000000',
  title: 'おしりたんてい',
  authors: ['トロル'],
  publisher: 'ポプラ社',
  coverUrl: 'https://example.com/b.jpg',
  seriesName: null,
  volume: null,
  source: 'openbd',
  ...patch,
});

describe('bookFillPatch', () => {
  it('既存の値は上書きしない', () => {
    expect(bookFillPatch(baseBook, candidate({ title: '別のタイトル', publisher: '別の出版社' }), { seriesId: null, volume: null })).toEqual({});
  });

  it('空欄だけを補う', () => {
    const existing: BookFields = { ...baseBook, authors: [], publisher: null, coverUrl: null };
    expect(bookFillPatch(existing, candidate(), { seriesId: null, volume: null })).toEqual({
      authors: ['トロル'],
      publisher: 'ポプラ社',
      coverUrl: 'https://example.com/b.jpg',
    });
  });

  it('空白だけの値も空欄とみなし、候補が空なら補わない', () => {
    const existing: BookFields = { ...baseBook, publisher: '  ', coverUrl: '' };
    expect(bookFillPatch(existing, candidate({ publisher: null, coverUrl: ' ' }), { seriesId: null, volume: null })).toEqual({});
  });

  it('シリーズ未設定なら引数のシリーズと巻数を設定する', () => {
    expect(bookFillPatch(baseBook, candidate(), { seriesId: 's1', volume: 3 })).toEqual({ seriesId: 's1', volume: 3 });
  });

  it('既存の巻数は残す', () => {
    expect(bookFillPatch({ ...baseBook, volume: 5 }, candidate(), { seriesId: 's1', volume: 3 })).toEqual({ seriesId: 's1' });
  });

  it('シリーズ設定済みなら変更しない', () => {
    expect(bookFillPatch({ ...baseBook, seriesId: 's0', volume: 1 }, candidate(), { seriesId: 's1', volume: 3 })).toEqual({});
  });
});

describe('cleanCandidate', () => {
  it('前後空白・著者の重複・ISBN を整える', () => {
    const c = cleanCandidate(
      candidate({ isbn: '978-4-591-00000-0', title: '  タイトル ', authors: [' A ', 'A', ''], publisher: ' ', coverUrl: null, volume: 2.5 }),
    );
    expect(c).toMatchObject({ isbn: '9784591000000', title: 'タイトル', authors: ['A'], publisher: null, coverUrl: null, volume: null });
  });

  it('不正な ISBN は null にする', () => {
    expect(cleanCandidate(candidate({ isbn: '123' })).isbn).toBeNull();
  });

  it('タイトルが空なら例外', () => {
    expect(() => cleanCandidate(candidate({ title: '   ' }))).toThrow('タイトル');
  });
});

describe('cleanBookPatch', () => {
  it('指定された項目だけを整える', () => {
    expect(cleanBookPatch({ title: ' 新しい ', publisher: '', coverUrl: undefined })).toEqual({ title: '新しい', publisher: null });
    expect(cleanBookPatch({ seriesId: null, volume: null })).toEqual({ seriesId: null, volume: null });
  });

  it('タイトルを空にはできない', () => {
    expect(() => cleanBookPatch({ title: ' ' })).toThrow('タイトル');
  });

  it('巻数は 0 以上の整数', () => {
    expect(cleanBookPatch({ volume: 0 })).toEqual({ volume: 0 });
    expect(() => cleanBookPatch({ volume: -1 })).toThrow('巻数');
    expect(() => cleanBookPatch({ volume: 1.5 })).toThrow('巻数');
  });
});

describe('cleanVolume', () => {
  it('0 以上の整数だけを残す', () => {
    expect(cleanVolume(3)).toBe(3);
    expect(cleanVolume(0)).toBe(0);
    expect(cleanVolume(-1)).toBeNull();
    expect(cleanVolume(Number.NaN)).toBeNull();
    expect(cleanVolume(undefined)).toBeNull();
  });
});

describe('loanSnapshotPatch', () => {
  it('貸出記録の book に関係する項目だけをドット区切りで返す', () => {
    expect(loanSnapshotPatch({ title: 'T', authors: ['A'], coverUrl: null, publisher: 'P', seriesId: 's', volume: 1 })).toEqual({
      'book.title': 'T',
      'book.authors': ['A'],
      'book.coverUrl': null,
    });
    expect(loanSnapshotPatch({ seriesId: 's' })).toEqual({});
  });
});

describe('toLoanBookSnapshot', () => {
  it('貸出記録用の 4 項目だけを複製する', () => {
    const book = { ...baseBook, isbn: '9784591000000', source: 'openbd' as const };
    const snap = toLoanBookSnapshot(book);
    expect(snap).toEqual({ title: 'おしりたんてい', authors: ['トロル'], coverUrl: 'https://example.com/a.jpg', isbn: '9784591000000' });
    expect(snap.authors).not.toBe(book.authors);
  });
});

describe('sortBooksByVolume', () => {
  it('巻数順、巻数なしは後ろ、同じならタイトル順', () => {
    const books = [
      { title: 'C', volume: null },
      { title: 'B', volume: 10 },
      { title: 'A', volume: 2 },
      { title: 'A2', volume: null },
      { title: 'Z', volume: 1 },
    ];
    expect(sortBooksByVolume(books).map((b) => b.title)).toEqual(['Z', 'A', 'B', 'A2', 'C']);
  });
});

describe('pickTitleMatch', () => {
  it('ISBN なしの本を優先する', () => {
    expect(pickTitleMatch([{ id: 'a', isbn: '9784591000000' }, { id: 'b', isbn: null }])?.id).toBe('b');
    expect(pickTitleMatch([{ id: 'a', isbn: '9784591000000' }])?.id).toBe('a');
    expect(pickTitleMatch([])).toBeNull();
  });
});

describe('ルールの上限への対応', () => {
  it('cleanCandidate は API の長すぎる値を切り詰め、使えない表紙 URL を捨てる', () => {
    const c = cleanCandidate(
      candidate({ title: 'あ'.repeat(400), publisher: 'い'.repeat(300), coverUrl: 'ftp://example.com/a.jpg' }),
    );
    expect(c.title).toHaveLength(300);
    expect(c.publisher).toHaveLength(200);
    expect(c.coverUrl).toBeNull();
  });

  it('cleanBookPatch は利用者の入力が長すぎる・URL が不正ならエラーにする', () => {
    expect(() => cleanBookPatch({ title: 'あ'.repeat(301) })).toThrow('300 文字以内');
    expect(() => cleanBookPatch({ publisher: 'い'.repeat(201) })).toThrow('200 文字以内');
    expect(() => cleanBookPatch({ coverUrl: 'example.com/a.jpg' })).toThrow('https://');
    expect(cleanBookPatch({ coverUrl: '' })).toEqual({ coverUrl: null });
  });
});
