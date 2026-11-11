import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));

import { needsCover, pickBackfillTargets, type CoverTarget } from './coverBackfill';

const t = (bookId: string, isbn: string | null, coverUrl: string | null): CoverTarget => ({ bookId, isbn, coverUrl });

describe('needsCover', () => {
  it('空と、提供が終わった NDL の書影 URL は「表紙なし」', () => {
    expect(needsCover(null)).toBe(true);
    expect(needsCover('  ')).toBe(true);
    expect(needsCover('https://ndlsearch.ndl.go.jp/thumbnail/9784834000825.jpg')).toBe(true);
    expect(needsCover('https://books.google.com/books/content?id=x')).toBe(false);
  });
});

describe('pickBackfillTargets', () => {
  const none = () => null;

  it('ISBN があって表紙が無い本だけを、重複なしで選ぶ', () => {
    const items = [
      t('a', '9784834000825', null),
      t('a', '9784834000825', null),
      t('b', null, null),
      t('c', '9784591025093', 'https://example.com/c.jpg'),
      t('d', '9784591025093', 'https://ndlsearch.ndl.go.jp/thumbnail/9784591025093.jpg'),
    ];
    expect(pickBackfillTargets(items, none, '2026-11-11').map((x) => x.bookId)).toEqual(['a', 'd']);
  });

  it('今日すでに試した本は除き、最大件数で打ち切る', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => t(id, '9784834000825', null));
    const tried = (id: string) => (id === 'a' ? '2026-11-11' : id === 'b' ? '2026-11-10' : null);
    expect(pickBackfillTargets(items, tried, '2026-11-11', 2).map((x) => x.bookId)).toEqual(['b', 'c']);
  });
});
