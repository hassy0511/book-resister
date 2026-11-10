// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BookCover } from './BookCover';

describe('BookCover', () => {
  it('読み込めない画像は次の候補（版元ドットコム → openBD）を試し、すべて失敗したら頭文字を出す', () => {
    const { container } = render(
      <BookCover title="ぐりとぐら" coverUrl="https://ndlsearch.ndl.go.jp/thumbnail/9784834000825.jpg" isbn="9784834000825" />,
    );
    const src = () => container.querySelector('img')?.getAttribute('src');
    // 提供が終わった NDL の書影は飛ばす
    expect(src()).toBe('https://img.hanmoto.com/bd/img/9784834000825.jpg');
    fireEvent.error(container.querySelector('img')!);
    expect(src()).toBe('https://cover.openbd.jp/9784834000825.jpg');
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('ぐ');
  });

  it('ISBN も表紙も無ければ最初から頭文字', () => {
    const { container } = render(<BookCover title="おしりたんてい" coverUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('お');
  });
});
