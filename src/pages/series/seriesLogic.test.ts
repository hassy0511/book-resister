import { describe, expect, it } from 'vitest';
import type { Loan, ReadStatus } from '../../types';
import {
  buildSeriesOverview,
  compressRanges,
  formatVolumeRanges,
  groupLoansByBook,
  summarizeSeriesList,
} from './seriesLogic';

type TestBook = { id: string; title: string; volume: number | null; seriesId: string | null };
type TestLoan = Pick<Loan, 'bookId' | 'borrowedOn' | 'returnedOn' | 'readStatus'>;

function book(id: string, volume: number | null, seriesId: string | null = 's1'): TestBook {
  return { id, title: `本${id}`, volume, seriesId };
}

function returned(bookId: string, readStatus: ReadStatus | null, borrowedOn = '2026-10-01'): TestLoan {
  return { bookId, borrowedOn, returnedOn: '2026-10-15', readStatus };
}

function active(bookId: string, borrowedOn = '2026-11-01'): TestLoan {
  return { bookId, borrowedOn, returnedOn: null, readStatus: null };
}

describe('compressRanges / formatVolumeRanges', () => {
  it('連続する巻は範囲にまとめる', () => {
    expect(compressRanges([2, 5, 7, 8, 9])).toEqual([
      [2, 2],
      [5, 5],
      [7, 9],
    ]);
    expect(formatVolumeRanges([2, 5, 7, 8, 9])).toBe('2, 5, 7〜9');
    expect(formatVolumeRanges([3, 4])).toBe('3〜4');
  });

  it('順不同・重複にも対応し、空なら空文字', () => {
    expect(formatVolumeRanges([9, 1, 2, 2, 3])).toBe('1〜3, 9');
    expect(formatVolumeRanges([])).toBe('');
  });
});

describe('buildSeriesOverview', () => {
  it('全巻数があれば 1〜全巻数の各巻の状態と、まだ借りていない巻を出す', () => {
    const books = [book('b1', 1), book('b3', 3), book('b4', 4), book('b6', 6)];
    const loans = groupLoansByBook([
      returned('b1', 'read'),
      returned('b3', 'partial'),
      active('b4'),
      returned('b6', 'unread'),
    ]);
    const o = buildSeriesOverview(books, loans, 8);
    expect(o.lastVolume).toBe(8);
    expect(o.totalKnown).toBe(true);
    expect(o.slots.map((s) => [s.volume, s.state])).toEqual([
      [1, 'read'],
      [2, 'none'],
      [3, 'partial'],
      [4, 'reading'],
      [5, 'none'],
      [6, 'unread'],
      [7, 'none'],
      [8, 'none'],
    ]);
    expect(o.missing).toEqual([2, 5, 7, 8]);
    expect(o.borrowedVolumes).toBe(4);
    expect(o.readVolumes).toBe(1);
    expect(o.stateCounts).toEqual({ read: 1, partial: 1, reading: 1, unread: 1, none: 4 });
  });

  it('全巻数が無ければ借りた巻の最大値までで抜け番を出す（F-74）', () => {
    const books = [book('b2', 2), book('b5', 5)];
    const o = buildSeriesOverview(books, groupLoansByBook([returned('b2', 'read'), returned('b5', 'read')]), null);
    expect(o.totalKnown).toBe(false);
    expect(o.lastVolume).toBe(5);
    expect(o.missing).toEqual([1, 3, 4]);
  });

  it('同じ巻に別の本（別 ISBN）があっても 1 つの巻にまとめ、状態は全貸出から決める', () => {
    const books = [book('b3a', 3), book('b3b', 3)];
    const loans = groupLoansByBook([
      returned('b3a', 'unread', '2026-01-01'),
      returned('b3b', 'read', '2026-05-01'),
    ]);
    const o = buildSeriesOverview(books, loans, null);
    const slot = o.slots[2];
    expect(slot.volume).toBe(3);
    expect(slot.books.map((b) => b.book.id)).toEqual(['b3b', 'b3a']); // 最後に借りた順
    expect(slot.state).toBe('read');
    expect(o.borrowedVolumes).toBe(1);
  });

  it('貸出中の巻でも、以前に読んでいれば「読んだ巻」に数える', () => {
    const o = buildSeriesOverview([book('b1', 1)], groupLoansByBook([returned('b1', 'read'), active('b1')]), null);
    expect(o.slots[0].state).toBe('reading');
    expect(o.readVolumes).toBe(1);
  });

  it('巻数なしの本は別にする。貸出の無い本の巻は「まだ借りていない」', () => {
    const books = [book('x', null), book('y', null), book('b2', 2)];
    const o = buildSeriesOverview(books, groupLoansByBook([returned('x', 'read')]), null);
    expect(o.noVolume.map((i) => [i.book.id, i.state])).toEqual([
      ['x', 'read'],
      ['y', 'none'],
    ]);
    expect(o.borrowedNoVolume).toBe(1);
    expect(o.slots.map((s) => s.state)).toEqual(['none', 'none']);
    expect(o.slots[1].books).toHaveLength(1);
    expect(o.missing).toEqual([1, 2]);
  });

  it('全巻数より大きい巻の本も表示から漏らさない。0 巻は先頭に置くが抜け番には数えない', () => {
    const o = buildSeriesOverview([book('b0', 0), book('b5', 5)], groupLoansByBook([returned('b5', 'read')]), 3);
    expect(o.lastVolume).toBe(5);
    expect(o.slots.map((s) => s.volume)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(o.missing).toEqual([1, 2, 3, 4]);
  });

  it('本が無ければ巻も無い', () => {
    const o = buildSeriesOverview([], new Map(), null);
    expect(o.slots).toEqual([]);
    expect(o.lastVolume).toBe(0);
    expect(o.lastBorrowedOn).toBeNull();
  });

  it('最後に借りた日', () => {
    const o = buildSeriesOverview(
      [book('b1', 1), book('b2', 2)],
      groupLoansByBook([returned('b1', 'read', '2026-02-01'), active('b2', '2026-10-05')]),
      null,
    );
    expect(o.lastBorrowedOn).toBe('2026-10-05');
  });
});

describe('summarizeSeriesList', () => {
  it('最後に借りた日の新しい順。借りていないシリーズは後ろで名前順', () => {
    const series = [
      { id: 's1', name: 'おしりたんてい', totalVolumes: null },
      { id: 's2', name: 'かいけつゾロリ', totalVolumes: 70 },
      { id: 's3', name: 'あたらしいシリーズ', totalVolumes: null },
      { id: 's4', name: 'いもうと', totalVolumes: null },
    ];
    const books = [book('a1', 1, 's1'), book('z1', 1, 's2'), book('z2', 2, 's2'), book('n1', 1, 's3'), book('free', 1, null)];
    const loans = [returned('a1', 'read', '2026-05-01'), returned('z1', 'read', '2026-09-01'), active('z2', '2026-08-01')];
    const rows = summarizeSeriesList(series, books, loans);
    expect(rows.map((r) => r.series.id)).toEqual(['s2', 's1', 's3', 's4']);
    expect(rows[0].overview.borrowedVolumes).toBe(2);
    expect(rows[0].overview.readVolumes).toBe(1);
    expect(rows[0].overview.lastVolume).toBe(70);
    expect(rows[0].coverBook?.id).toBe('z1');
    expect(rows[2].bookCount).toBe(1);
    expect(rows[2].coverBook?.id).toBe('n1');
    expect(rows[3].bookCount).toBe(0);
    expect(rows[3].coverBook).toBeNull();
  });
});
