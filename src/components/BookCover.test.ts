import { describe, expect, it } from 'vitest';
import { coverInitial } from './BookCover';

describe('coverInitial', () => {
  it('タイトルの最初の 1 文字', () => {
    expect(coverInitial('おしりたんてい')).toBe('お');
    expect(coverInitial('  ぐりとぐら')).toBe('ぐ');
  });

  it('先頭の括弧や記号は飛ばす', () => {
    expect(coverInitial('「はらぺこあおむし」')).toBe('は');
    expect(coverInitial('【新装版】ちいさいおうち')).toBe('新');
  });

  it('サロゲートペアも 1 文字として扱う', () => {
    expect(coverInitial('𠮷野家のほん')).toBe('𠮷');
  });

  it('空なら「本」', () => {
    expect(coverInitial('')).toBe('本');
    expect(coverInitial('   ')).toBe('本');
  });
});
