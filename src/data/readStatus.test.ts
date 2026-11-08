import { describe, expect, it } from 'vitest';
import type { Loan, ReadStatus } from '../types';
import { BOOK_READ_STATE_LABELS, READ_STATUS_LABELS, bookReadState, readStatesByBook } from './readStatus';

type L = Pick<Loan, 'bookId' | 'returnedOn' | 'readStatus'>;

const active = (bookId = 'b1'): L => ({ bookId, returnedOn: null, readStatus: null });
const returned = (readStatus: ReadStatus | null, bookId = 'b1'): L => ({
  bookId,
  returnedOn: '2026-11-01',
  readStatus,
});

describe('bookReadState', () => {
  it('貸出が無ければ none', () => {
    expect(bookReadState([])).toBe('none');
  });

  it('貸出中があれば reading（返却済みに read があっても）', () => {
    expect(bookReadState([active()])).toBe('reading');
    expect(bookReadState([returned('read'), active()])).toBe('reading');
  });

  it('返却済みだけなら最良の状況（read > partial > unread）', () => {
    expect(bookReadState([returned('unread')])).toBe('unread');
    expect(bookReadState([returned('partial')])).toBe('partial');
    expect(bookReadState([returned('read')])).toBe('read');
    expect(bookReadState([returned('unread'), returned('partial')])).toBe('partial');
    expect(bookReadState([returned('partial'), returned('read'), returned('unread')])).toBe('read');
  });

  it('返却済みで readStatus が無い記録は unread とみなす', () => {
    expect(bookReadState([returned(null)])).toBe('unread');
    expect(bookReadState([returned(null), returned('partial')])).toBe('partial');
  });
});

describe('readStatesByBook', () => {
  it('本ごとにまとめて判定する', () => {
    const map = readStatesByBook([
      returned('read', 'a'),
      returned('unread', 'b'),
      active('b'),
      returned('partial', 'c'),
      returned('unread', 'c'),
    ]);
    expect(map.get('a')).toBe('read');
    expect(map.get('b')).toBe('reading');
    expect(map.get('c')).toBe('partial');
    expect(map.has('d')).toBe(false);
  });
});

describe('表示名', () => {
  it('すべての状況に日本語の表示名がある', () => {
    expect(READ_STATUS_LABELS).toEqual({ read: '読んだ', partial: '途中まで', unread: '読んでいない' });
    expect(BOOK_READ_STATE_LABELS.none).toBe('まだ借りていない');
    expect(Object.keys(BOOK_READ_STATE_LABELS).sort()).toEqual(['none', 'partial', 'read', 'reading', 'unread']);
  });
});
