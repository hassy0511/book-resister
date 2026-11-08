import { describe, expect, it } from 'vitest';
import { formatVolumeRanges, parseScanMode, summarizeSeries } from './scanLogic';

describe('parseScanMode', () => {
  it('check 以外は借りるモード', () => {
    expect(parseScanMode('check')).toBe('check');
    expect(parseScanMode('borrow')).toBe('borrow');
    expect(parseScanMode(null)).toBe('borrow');
    expect(parseScanMode('xxx')).toBe('borrow');
  });
});

describe('formatVolumeRanges', () => {
  it('連続する巻をまとめる', () => {
    expect(formatVolumeRanges([1, 2, 3, 5, 7, 8, 9, 12])).toBe('1〜3、5、7〜9、12');
  });
  it('2 巻だけの連続は「、」で並べる', () => {
    expect(formatVolumeRanges([4, 5])).toBe('4、5');
  });
  it('重複・順不同・空', () => {
    expect(formatVolumeRanges([3, 1, 2, 2])).toBe('1〜3');
    expect(formatVolumeRanges([])).toBe('');
  });
});

describe('summarizeSeries', () => {
  const books = [
    { id: 'b1', volume: 1 },
    { id: 'b2', volume: 2 },
    { id: 'b4', volume: 4 },
    { id: 'b5', volume: 5 },
    { id: 'bx', volume: null },
  ];
  const loans = [
    { bookId: 'b1', returnedOn: '2026-01-10', readStatus: 'read' as const },
    { bookId: 'b2', returnedOn: '2026-01-10', readStatus: 'partial' as const },
    { bookId: 'b4', returnedOn: null, readStatus: null },
    { bookId: 'bx', returnedOn: '2026-02-01', readStatus: 'read' as const },
  ];

  it('全巻数が無ければ、借りた最大の巻までの抜けを出す', () => {
    const s = summarizeSeries({ books, loans, totalVolumes: null });
    expect(s.borrowedVolumes).toEqual([1, 2, 4]);
    expect(s.readVolumes).toEqual([1]);
    expect(s.notFinishedVolumes).toEqual([2]);
    expect(s.readingVolumes).toEqual([4]);
    expect(s.notBorrowedVolumes).toEqual([3]);
    expect(s.total).toBeNull();
    expect(s.borrowedBookCount).toBe(4);
  });

  it('全巻数があれば、1〜全巻数のうち借りていない巻', () => {
    const s = summarizeSeries({ books, loans, totalVolumes: 7 });
    expect(s.notBorrowedVolumes).toEqual([3, 5, 6, 7]);
    expect(s.total).toBe(7);
  });

  it('前に「読んだ」で返して、いま読み返すために借りている巻は「読んだ巻」と「貸出中」の両方に入る', () => {
    const s = summarizeSeries({
      books: [
        { id: 'v1', volume: 1 },
        { id: 'v2', volume: 2 },
        { id: 'v3', volume: 3 },
      ],
      loans: [
        { bookId: 'v1', returnedOn: '2026-01-10', readStatus: 'read' },
        { bookId: 'v1', returnedOn: null, readStatus: null },
        { bookId: 'v2', returnedOn: '2026-02-10', readStatus: 'read' },
      ],
      totalVolumes: 3,
    });
    expect(s.readVolumes).toEqual([1, 2]);
    expect(s.readingVolumes).toEqual([1]);
    expect(s.notBorrowedVolumes).toEqual([3]);
  });

  it('同じ巻の別の版を読んでいれば、もう一方が途中までのままでも「途中・未読」には入れない', () => {
    const s = summarizeSeries({
      books: [
        { id: 'a', volume: 1 },
        { id: 'b', volume: 1 },
        { id: 'c', volume: 2 },
      ],
      loans: [
        { bookId: 'a', returnedOn: '2026-01-10', readStatus: 'read' },
        { bookId: 'b', returnedOn: '2026-03-10', readStatus: 'partial' },
        { bookId: 'c', returnedOn: '2026-03-10', readStatus: 'partial' },
        { bookId: 'c', returnedOn: '2026-04-10', readStatus: 'unread' },
      ],
      totalVolumes: null,
    });
    expect(s.readVolumes).toEqual([1]);
    expect(s.notFinishedVolumes).toEqual([2]);
  });

  it('貸出が無ければ空', () => {
    const s = summarizeSeries({ books, loans: [], totalVolumes: null });
    expect(s.borrowedVolumes).toEqual([]);
    expect(s.notBorrowedVolumes).toEqual([]);
    expect(s.borrowedBookCount).toBe(0);
  });
});
