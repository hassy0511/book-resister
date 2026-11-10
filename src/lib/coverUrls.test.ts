import { describe, expect, it } from 'vitest';
import { coverCandidates, isRetiredCoverUrl } from './coverUrls';

describe('coverCandidates', () => {
  it('保存した URL を先頭に、ISBN があれば版元ドットコムと openBD の書影を続ける', () => {
    expect(coverCandidates('http://books.google.com/books/content?id=x&img=1', '978-4-8340-0082-5')).toEqual([
      'https://books.google.com/books/content?id=x&img=1',
      'https://img.hanmoto.com/bd/img/9784834000825.jpg',
      'https://cover.openbd.jp/9784834000825.jpg',
    ]);
  });

  it('提供が終わった国会図書館の書影 URL は飛ばす', () => {
    expect(isRetiredCoverUrl('https://ndlsearch.ndl.go.jp/thumbnail/9784834000825.jpg')).toBe(true);
    expect(coverCandidates('https://ndlsearch.ndl.go.jp/thumbnail/9784834000825.jpg', '9784834000825')).toEqual([
      'https://img.hanmoto.com/bd/img/9784834000825.jpg',
      'https://cover.openbd.jp/9784834000825.jpg',
    ]);
  });

  it('ISBN も URL も無ければ空。同じ URL は 1 回だけ', () => {
    expect(coverCandidates(null, null)).toEqual([]);
    expect(coverCandidates('', 'abc')).toEqual([]);
    expect(coverCandidates('https://img.hanmoto.com/bd/img/9784834000825.jpg', '9784834000825')).toHaveLength(2);
  });

  it('http(s) でない値は使わない', () => {
    expect(coverCandidates('javascript:alert(1)', null)).toEqual([]);
  });
});
