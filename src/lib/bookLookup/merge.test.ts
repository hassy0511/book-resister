import { describe, expect, it } from 'vitest';
import type { BookCandidate } from '../../types';
import { dedupeCandidates, fillMissing, finalizeCandidate, interleave, missingFields } from './merge';

const book = (patch: Partial<BookCandidate> = {}): BookCandidate => ({
  isbn: null,
  title: 'ぐりとぐら',
  authors: [],
  publisher: null,
  coverUrl: null,
  seriesName: null,
  volume: null,
  source: 'ndl',
  ...patch,
});

describe('missingFields', () => {
  it('欠けている項目（シリーズは対象外）', () => {
    expect(missingFields(book())).toEqual(['authors', 'publisher', 'coverUrl']);
    expect(missingFields(book({ title: ' ', authors: ['a'], publisher: 'p', coverUrl: 'https://x' }))).toEqual(['title']);
    expect(missingFields(book({ authors: ['a'], publisher: 'p', coverUrl: 'https://x' }))).toEqual([]);
  });
});

describe('fillMissing', () => {
  it('base の値を優先し、欠けている項目だけ補う', () => {
    const base = book({ authors: ['中川李枝子'], source: 'openbd' });
    const extra = book({
      isbn: '9784834000825',
      title: '別のタイトル',
      authors: ['別人'],
      publisher: '福音館書店',
      coverUrl: 'https://x/c.jpg',
      source: 'google',
    });
    expect(fillMissing(base, extra)).toEqual({
      isbn: '9784834000825',
      title: 'ぐりとぐら',
      authors: ['中川李枝子'],
      publisher: '福音館書店',
      coverUrl: 'https://x/c.jpg',
      seriesName: null,
      volume: null,
      source: 'openbd',
    });
  });

  it('シリーズは base に何も無ければ extra から組で補う', () => {
    expect(fillMissing(book(), book({ seriesName: 'S', volume: 2 }))).toMatchObject({ seriesName: 'S', volume: 2 });
    expect(fillMissing(book({ seriesName: 'A', volume: 1 }), book({ seriesName: 'B', volume: 2 }))).toMatchObject({
      seriesName: 'A',
      volume: 1,
    });
  });

  it('同じシリーズなら巻数だけ補う（別のシリーズの巻数は使わない）', () => {
    expect(fillMissing(book({ seriesName: 'かいけつゾロリ' }), book({ seriesName: 'かいけつゾロリシリーズ', volume: 1 }))).toMatchObject({
      seriesName: 'かいけつゾロリ',
      volume: 1,
    });
    expect(fillMissing(book({ seriesName: 'A' }), book({ seriesName: 'B', volume: 1 }))).toMatchObject({
      seriesName: 'A',
      volume: null,
    });
  });

  it('タイトルが空なら補う', () => {
    expect(fillMissing(book({ title: '' }), book({ title: 'X' })).title).toBe('X');
  });
});

describe('finalizeCandidate', () => {
  it('シリーズが無ければタイトルから推定する', () => {
    expect(finalizeCandidate(book({ title: 'おしりたんてい（３）' }), { ndlThumbnail: false })).toMatchObject({
      title: 'おしりたんてい（3）', // 全角数字は半角に
      seriesName: 'おしりたんてい',
      volume: 3,
    });
  });

  it('API のシリーズがあれば推定より優先。巻数が無ければ同じシリーズの巻表記から補う', () => {
    expect(finalizeCandidate(book({ title: 'かいけつゾロリ 3', seriesName: 'マジック・ツリーハウス', volume: 7 }))).toMatchObject({
      seriesName: 'マジック・ツリーハウス',
      volume: 7,
    });
    expect(finalizeCandidate(book({ title: 'かいけつゾロリ 3', seriesName: 'かいけつゾロリシリーズ' }))).toMatchObject({
      seriesName: 'かいけつゾロリシリーズ',
      volume: 3,
    });
    expect(finalizeCandidate(book({ title: 'ねずみくん 3', seriesName: 'かいけつゾロリシリーズ' }))).toMatchObject({
      seriesName: 'かいけつゾロリシリーズ',
      volume: null,
    });
  });

  it('巻数だけあればタイトルをシリーズ名にする', () => {
    expect(finalizeCandidate(book({ title: 'ONE PIECE', volume: 3 }))).toMatchObject({ seriesName: 'ONE PIECE', volume: 3 });
  });

  it('タイトルの空白を正規化し、ISBN を 13 桁にする', () => {
    expect(finalizeCandidate(book({ title: ' ぐりと　ぐら ', isbn: '4-8340-0082-6' }))).toMatchObject({
      title: 'ぐりと ぐら',
      isbn: '9784834000825',
    });
  });

  it('表紙が無く ISBN があれば NDL の書影 URL を入れる', () => {
    expect(finalizeCandidate(book({ isbn: '9784834000825' })).coverUrl).toBe(
      'https://ndlsearch.ndl.go.jp/thumbnail/9784834000825.jpg',
    );
    expect(finalizeCandidate(book({ isbn: '9784834000825' }), { ndlThumbnail: false }).coverUrl).toBeNull();
    expect(finalizeCandidate(book()).coverUrl).toBeNull();
    expect(finalizeCandidate(book({ isbn: '9784834000825', coverUrl: 'https://x' })).coverUrl).toBe('https://x');
  });
});

describe('dedupeCandidates', () => {
  it('ISBN が同じものは 1 つにまとめ、欠けている項目を補う', () => {
    const list = dedupeCandidates([
      book({ isbn: '9784834000825', authors: ['なかがわりえこ'] }),
      book({ isbn: '4834000826', authors: ['中川李枝子'], coverUrl: 'https://g/c.jpg', source: 'google' }),
    ]);
    expect(list).toEqual([
      book({ isbn: '9784834000825', authors: ['なかがわりえこ'], coverUrl: 'https://g/c.jpg' }),
    ]);
  });

  it('ISBN の無いものはタイトル＋著者でまとめる', () => {
    const list = dedupeCandidates([
      book({ title: 'ぐりとぐら', authors: ['中川李枝子'] }),
      book({ title: 'ぐりと ぐら', authors: ['中川 李枝子'], publisher: '福音館書店' }),
      book({ title: 'ぐりとぐら', authors: ['別の人'] }),
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ authors: ['中川李枝子'], publisher: '福音館書店' });
  });

  it('ISBN の無いものは、同じタイトル＋著者の ISBN のある本に寄せる（順番は先に出た位置）', () => {
    const list = dedupeCandidates([
      book({ title: 'A', authors: ['x'], publisher: 'P' }),
      book({ title: 'B', isbn: '9784834016222' }),
      book({ title: 'A', authors: ['x'], isbn: '9784834000825', source: 'google' }),
      book({ title: 'A', authors: ['x'], coverUrl: 'https://c' }),
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ title: 'A', isbn: '9784834000825', publisher: 'P', coverUrl: 'https://c', source: 'google' });
    expect(list[1].title).toBe('B');
  });

  it('ISBN が違えば同じタイトルでも別の本', () => {
    const list = dedupeCandidates([
      book({ title: 'A', authors: ['x'], isbn: '9784834000825' }),
      book({ title: 'A', authors: ['x'], isbn: '9784834016222' }),
    ]);
    expect(list).toHaveLength(2);
  });

  it('タイトルが空のものは除き、最大件数で切る', () => {
    const many = Array.from({ length: 30 }, (_, i) => book({ title: `本${i}` }));
    expect(dedupeCandidates([book({ title: '' }), ...many], 20)).toHaveLength(20);
    expect(dedupeCandidates([book({ title: ' ' })])).toEqual([]);
  });
});

describe('interleave', () => {
  it('交互に並べる', () => {
    expect(interleave<number | string>([1, 2, 3], ['a'])).toEqual([1, 'a', 2, 3]);
    expect(interleave<string>([], ['a', 'b'])).toEqual(['a', 'b']);
  });
});
