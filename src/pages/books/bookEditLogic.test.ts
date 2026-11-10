import { describe, expect, it } from 'vitest';
import {
  buildBookPatch,
  coverUrlError,
  draftFromBook,
  formatAuthors,
  isDraftDirty,
  parseAuthors,
  seriesNameChanged,
  titleError,
} from './bookEditLogic';

const book = {
  title: 'おしりたんてい ププッ ゆうかいじけん',
  authors: ['トロル'],
  publisher: 'ポプラ社',
  coverUrl: null,
  seriesId: 's1',
  volume: 3,
};

describe('著者', () => {
  it('カンマ・読点（全角・半角）で区切り、空白と重複を除く', () => {
    expect(parseAuthors('なかがわりえこ、おおむらゆりこ')).toEqual(['なかがわりえこ', 'おおむらゆりこ']);
    expect(parseAuthors(' A , B，C､ A ,, ')).toEqual(['A', 'B', 'C']);
    expect(parseAuthors('')).toEqual([]);
  });

  it('名前の中の空白は区切りにしない', () => {
    expect(parseAuthors('ヨシタケ シンスケ')).toEqual(['ヨシタケ シンスケ']);
  });

  it('入力欄の文字列にする', () => {
    expect(formatAuthors(['A', 'B'])).toBe('A、B');
  });
});

describe('検証', () => {
  it('タイトルは必須', () => {
    expect(titleError('  ')).not.toBeNull();
    expect(titleError('ぐりとぐら')).toBeNull();
  });

  it('表紙の URL は空欄か http(s)', () => {
    expect(coverUrlError('')).toBeNull();
    expect(coverUrlError('https://example.com/a.jpg')).toBeNull();
    expect(coverUrlError('http://example.com/a.jpg')).toBeNull();
    expect(coverUrlError('example.com/a.jpg')).not.toBeNull();
    expect(coverUrlError('javascript:alert(1)')).not.toBeNull();
    expect(coverUrlError('https://exa mple.com')).not.toBeNull();
  });
});

describe('変更の判定', () => {
  const initial = draftFromBook(book, 'おしりたんてい');

  it('最初の値なら変更なし', () => {
    expect(initial).toEqual({
      title: book.title,
      authors: 'トロル',
      publisher: 'ポプラ社',
      coverUrl: '',
      seriesName: 'おしりたんてい',
      volume: 3,
    });
    expect(isDraftDirty(initial, initial)).toBe(false);
  });

  it('前後の空白や著者の区切り方の違いは変更とみなさない', () => {
    expect(isDraftDirty({ ...initial, title: ` ${book.title} `, authors: 'トロル、' }, initial)).toBe(false);
  });

  it('シリーズ名は表記の揺れを同じとみなす', () => {
    expect(seriesNameChanged({ seriesName: 'おしりたんてい シリーズ' }, initial)).toBe(false);
    expect(seriesNameChanged({ seriesName: 'ＯＳＨＩＲＩ' }, { seriesName: 'oshiri' })).toBe(false);
    expect(seriesNameChanged({ seriesName: 'かいけつゾロリ' }, initial)).toBe(true);
    expect(seriesNameChanged({ seriesName: ' ' }, { seriesName: null })).toBe(false);
  });

  it('値を変えれば変更あり', () => {
    expect(isDraftDirty({ ...initial, volume: 4 }, initial)).toBe(true);
    expect(isDraftDirty({ ...initial, publisher: '' }, initial)).toBe(true);
    expect(isDraftDirty({ ...initial, seriesName: null }, initial)).toBe(true);
  });
});

describe('buildBookPatch', () => {
  const initial = draftFromBook(book, 'おしりたんてい');

  it('変わった項目だけを返す', () => {
    expect(buildBookPatch(book, initial, undefined)).toEqual({});
    expect(
      buildBookPatch(book, { ...initial, title: ' 新しいタイトル ', authors: 'トロル、ほか', coverUrl: ' https://x/y.jpg ' }, undefined),
    ).toEqual({ title: '新しいタイトル', authors: ['トロル', 'ほか'], coverUrl: 'https://x/y.jpg' });
  });

  it('空欄は null にする', () => {
    expect(buildBookPatch(book, { ...initial, publisher: '  ' }, undefined)).toEqual({ publisher: null });
  });

  it('シリーズ ID は指定されて変わったときだけ', () => {
    expect(buildBookPatch(book, initial, 's1')).toEqual({});
    expect(buildBookPatch(book, initial, 's2')).toEqual({ seriesId: 's2' });
    expect(buildBookPatch(book, { ...initial, seriesName: null, volume: null }, null)).toEqual({
      seriesId: null,
      volume: null,
    });
  });
});
