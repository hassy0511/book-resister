import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { LoanBookSnapshot } from '../types';

vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));
vi.mock('../group/GroupProvider', () => ({ useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1' }) }));

const { buildNewLoan, cleanLoanPatch, cleanRating, cleanReview, sortLoansByBorrowedDesc, sortLoansByDue } = await import(
  './loans'
);

const book = (title: string): LoanBookSnapshot => ({ title, authors: [], coverUrl: null, isbn: null });

describe('sortLoansByDue', () => {
  it('返却日が近い順、同じなら借りた日・タイトル順', () => {
    const loans = [
      { id: '1', dueOn: '2026-11-20', borrowedOn: '2026-11-06', book: book('B') },
      { id: '2', dueOn: '2026-11-10', borrowedOn: '2026-10-27', book: book('A') },
      { id: '3', dueOn: '2026-11-20', borrowedOn: '2026-11-06', book: book('A') },
      { id: '4', dueOn: '2026-11-20', borrowedOn: '2026-11-01', book: book('C') },
    ];
    expect(sortLoansByDue(loans).map((l) => l.id)).toEqual(['2', '4', '3', '1']);
  });

  it('元の配列は変更しない', () => {
    const loans = [
      { dueOn: '2026-11-20', borrowedOn: '2026-11-06', book: book('B') },
      { dueOn: '2026-11-10', borrowedOn: '2026-11-06', book: book('A') },
    ];
    const copy = [...loans];
    sortLoansByDue(loans);
    expect(loans).toEqual(copy);
  });
});

describe('sortLoansByBorrowedDesc', () => {
  it('借りた日の新しい順、同じなら作成日時の新しい順', () => {
    const loans = [
      { id: '1', dueOn: '', borrowedOn: '2026-10-01', book: book('A'), createdAt: Timestamp.fromMillis(1) },
      { id: '2', dueOn: '', borrowedOn: '2026-11-01', book: book('A'), createdAt: Timestamp.fromMillis(1) },
      { id: '3', dueOn: '', borrowedOn: '2026-11-01', book: book('B'), createdAt: Timestamp.fromMillis(5) },
    ];
    expect(sortLoansByBorrowedDesc(loans).map((l) => l.id)).toEqual(['3', '2', '1']);
  });
});

describe('buildNewLoan', () => {
  const input = {
    bookId: 'isbn-9784591000000',
    book: { title: ' おしりたんてい ', authors: ['トロル', ''], coverUrl: '', isbn: '9784591000000' },
    locationId: 'loc1',
    borrowerUid: 'u2',
    borrowedOn: '2026-11-08',
    dueOn: '2026-11-22',
  };

  it('貸出中の記録を型どおりのフィールドだけで作る', () => {
    expect(buildNewLoan(input, 'u1')).toEqual({
      bookId: 'isbn-9784591000000',
      book: { title: 'おしりたんてい', authors: ['トロル'], coverUrl: null, isbn: '9784591000000' },
      locationId: 'loc1',
      borrowerUid: 'u2',
      borrowedOn: '2026-11-08',
      dueOn: '2026-11-22',
      returnedOn: null,
      readStatus: null,
      rating: null,
      review: null,
      createdBy: 'u1',
    });
  });

  it('余計なフィールドを持ち込まない', () => {
    const withExtra = { ...input, book: { ...input.book, publisher: 'X' } as LoanBookSnapshot, extra: 1 };
    const out = buildNewLoan(withExtra, 'u1');
    expect(Object.keys(out.book).sort()).toEqual(['authors', 'coverUrl', 'isbn', 'title']);
    expect('extra' in out).toBe(false);
  });

  it('日付の誤りを弾く', () => {
    expect(() => buildNewLoan({ ...input, dueOn: '2026-11-01' }, 'u1')).toThrow('返却日は借りた日以降');
    expect(() => buildNewLoan({ ...input, borrowedOn: '2026/11/08' }, 'u1')).toThrow('借りた日');
    expect(() => buildNewLoan({ ...input, locationId: '' }, 'u1')).toThrow('場所');
  });
});

describe('cleanLoanPatch', () => {
  it('undefined を除き、値を整える', () => {
    expect(cleanLoanPatch({ dueOn: '2026-12-01', review: '  面白かった ', rating: undefined })).toEqual({
      dueOn: '2026-12-01',
      review: '面白かった',
    });
    expect(cleanLoanPatch({ review: '   ', rating: null, returnedOn: null, readStatus: null })).toEqual({
      review: null,
      rating: null,
      returnedOn: null,
      readStatus: null,
    });
  });

  it('不正な値を弾く', () => {
    expect(() => cleanLoanPatch({ dueOn: 'x' })).toThrow('返却日');
    expect(() => cleanLoanPatch({ rating: 6 })).toThrow('評価');
    // @ts-expect-error 不正な読書状況
    expect(() => cleanLoanPatch({ readStatus: 'done' })).toThrow('読書状況');
  });
});

describe('cleanRating / cleanReview', () => {
  it('評価は 1〜5 の整数か null', () => {
    expect(cleanRating(1)).toBe(1);
    expect(cleanRating(5)).toBe(5);
    expect(cleanRating(null)).toBeNull();
    expect(() => cleanRating(0)).toThrow();
    expect(() => cleanRating(2.5)).toThrow();
  });

  it('感想は空なら null', () => {
    expect(cleanReview('')).toBeNull();
    expect(cleanReview(' よかった ')).toBe('よかった');
  });
});
