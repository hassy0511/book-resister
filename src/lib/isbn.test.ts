import { describe, expect, it } from 'vitest';
import { bookIdForIsbn, ean13CheckDigit, formatIsbn, isBookEan, normalizeIsbn, toIsbn10 } from './isbn';

// ぐりとぐら（福音館書店）
const GURI = '9784834000825';
const GURI10 = '4834000826';

describe('ean13CheckDigit', () => {
  it('チェックディジットを計算する', () => {
    expect(ean13CheckDigit('978483400082')).toBe(5);
    expect(ean13CheckDigit('979103230569')).toBe(0);
  });
});

describe('normalizeIsbn', () => {
  it('ISBN-13 はそのまま', () => {
    expect(normalizeIsbn(GURI)).toBe(GURI);
  });

  it('ハイフン・空白付き', () => {
    expect(normalizeIsbn('978-4-8340-0082-5')).toBe(GURI);
    expect(normalizeIsbn(' 978 4 8340 0082 5 ')).toBe(GURI);
    expect(normalizeIsbn('978‐4‐8340‐0082‐5')).toBe(GURI); // U+2010
    expect(normalizeIsbn('978ー4ー8340ー0082ー5')).toBe(GURI); // 長音記号で入力された場合
  });

  it('全角数字・全角ハイフン', () => {
    expect(normalizeIsbn('９７８－４－８３４０－００８２－５')).toBe(GURI);
    expect(normalizeIsbn('９７８４８３４０００８２５')).toBe(GURI);
  });

  it('「ISBN」の接頭辞', () => {
    expect(normalizeIsbn('ISBN978-4-8340-0082-5')).toBe(GURI);
    expect(normalizeIsbn('ISBN: 978-4-8340-0082-5')).toBe(GURI);
    expect(normalizeIsbn('isbn-13: 9784834000825')).toBe(GURI);
    expect(normalizeIsbn('ISBN 4-8340-0082-6')).toBe(GURI);
    expect(normalizeIsbn('ＩＳＢＮ４－８３４０－００８２－６')).toBe(GURI);
  });

  it('ISBN-10 を ISBN-13 に変換する', () => {
    expect(normalizeIsbn(GURI10)).toBe(GURI);
    expect(normalizeIsbn('4-8340-0082-6')).toBe(GURI);
  });

  it('ISBN-10 のチェックディジット X（小文字も可）', () => {
    expect(normalizeIsbn('0-8044-2957-X')).toBe('9780804429573');
    expect(normalizeIsbn('080442957x')).toBe('9780804429573');
  });

  it('979 で始まる ISBN', () => {
    expect(normalizeIsbn('979-10-323-0569-0')).toBe('9791032305690');
  });

  it('チェックディジット不正は null', () => {
    expect(normalizeIsbn('9784834000826')).toBeNull();
    expect(normalizeIsbn('4834000827')).toBeNull();
    expect(normalizeIsbn('080442957-0')).toBeNull();
  });

  it('192 で始まる価格コード（チェックディジットが正しくても）は null', () => {
    expect(ean13CheckDigit('192019301200')).toBe(2);
    expect(normalizeIsbn('1920193012002')).toBeNull();
  });

  it('桁数違い・文字混じりは null', () => {
    expect(normalizeIsbn('')).toBeNull();
    expect(normalizeIsbn('978483400082')).toBeNull();
    expect(normalizeIsbn('97848340008255')).toBeNull();
    expect(normalizeIsbn('97848340a0825')).toBeNull();
    expect(normalizeIsbn('X834000826')).toBeNull();
    expect(normalizeIsbn('48340008X6')).toBeNull();
  });
});

describe('isBookEan', () => {
  it('978/979 でチェックディジットが正しい 13 桁なら true', () => {
    expect(isBookEan(GURI)).toBe(true);
    expect(isBookEan('9791032305690')).toBe(true);
    expect(isBookEan(` ${GURI}\n`)).toBe(true);
  });

  it('価格コード・不正なチェックディジット・ISBN-10・ハイフン付きは false', () => {
    expect(isBookEan('1920193012002')).toBe(false);
    expect(isBookEan('9784834000826')).toBe(false);
    expect(isBookEan(GURI10)).toBe(false);
    expect(isBookEan('978-4-8340-0082-5')).toBe(false);
    expect(isBookEan('4901234567894')).toBe(false); // 一般商品の JAN
    expect(isBookEan('')).toBe(false);
  });
});

describe('toIsbn10', () => {
  it('978 なら ISBN-10 に変換する', () => {
    expect(toIsbn10(GURI)).toBe(GURI10);
    expect(toIsbn10('9780804429573')).toBe('080442957X');
  });

  it('979 や不正な値は null', () => {
    expect(toIsbn10('9791032305690')).toBeNull();
    expect(toIsbn10('123')).toBeNull();
  });
});

describe('bookIdForIsbn', () => {
  it('isbn- を付ける', () => {
    expect(bookIdForIsbn(GURI)).toBe(`isbn-${GURI}`);
  });

  it('ハイフン付き・ISBN-10 でも正規化した ID になる', () => {
    expect(bookIdForIsbn('978-4-8340-0082-5')).toBe(`isbn-${GURI}`);
    expect(bookIdForIsbn(GURI10)).toBe(`isbn-${GURI}`);
  });
});

describe('formatIsbn', () => {
  it('日本の本はハイフン区切り（出版者記号の桁数に応じる）', () => {
    expect(formatIsbn(GURI)).toBe('978-4-8340-0082-5'); // 4 桁（7000–8499）
    expect(formatIsbn('9784062748681')).toBe('978-4-06-274868-1'); // 2 桁（00–19）
    expect(formatIsbn('9784591000014')).toMatch(/^978-4-591-/); // 3 桁（200–699）
    expect(formatIsbn('9784864721004')).toMatch(/^978-4-86472-/); // 5 桁（85000–89999）
    expect(formatIsbn('9784904000007')).toMatch(/^978-4-904000-/); // 6 桁
    expect(formatIsbn('9784990000004')).toMatch(/^978-4-9900000-/); // 7 桁
  });

  it('日本以外はハイフンなしの 13 桁', () => {
    expect(formatIsbn('9780804429573')).toBe('9780804429573');
    expect(formatIsbn('9791032305690')).toBe('9791032305690');
  });

  it('正規化してから整形する／不正ならそのまま', () => {
    expect(formatIsbn(GURI10)).toBe('978-4-8340-0082-5');
    expect(formatIsbn('abc')).toBe('abc');
  });
});
