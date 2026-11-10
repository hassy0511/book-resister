import { describe, expect, it } from 'vitest';
import {
  cleanAuthorName,
  cleanAuthors,
  cleanPublisher,
  joinTitle,
  ndlThumbnailUrl,
  normalizeSpaces,
  normalizeTitle,
  resolveApiSeries,
  splitSeriesStatement,
  toHttpsUrl,
} from './normalize';

describe('normalizeSpaces / normalizeTitle', () => {
  it('全角/半角スペース・改行を 1 つの半角スペースにする', () => {
    expect(normalizeSpaces('  ぐりと　　ぐら\n ')).toBe('ぐりと ぐら');
    expect(normalizeSpaces(null)).toBe('');
  });

  it('全角英数字を半角に、半角カナを全角にする（記号はそのまま）', () => {
    expect(normalizeTitle('ＯＮＥ　ＰＩＥＣＥ　１０４')).toBe('ONE PIECE 104');
    expect(normalizeTitle('ﾉﾝﾀﾝ ぶらんこのせて')).toBe('ノンタン ぶらんこのせて');
    expect(normalizeTitle('かいけつゾロリのきょうふのエイリアン！')).toBe('かいけつゾロリのきょうふのエイリアン！');
  });
});

describe('cleanAuthorName', () => {
  it.each([
    ['J.K.ローリング 作', 'J.K.ローリング'],
    ['松岡佑子 訳', '松岡佑子'],
    ['原ゆたか さく・え', '原ゆたか'],
    ['トロル 作・絵', 'トロル'],
    ['ヨシタケシンスケ 作絵', 'ヨシタケシンスケ'],
    ['なかがわりえこ さく', 'なかがわりえこ'],
    ['おおむらゆりこ え', 'おおむらゆりこ'],
    ['村上春樹／著', '村上春樹'],
    ['村上春樹/著', '村上春樹'],
    ['エリック・カール さく', 'エリック・カール'],
    ['もりひさし やく', 'もりひさし'],
    ['宮沢賢治 文', '宮沢賢治'],
    ['司修 絵', '司修'],
    ['和田誠 画', '和田誠'],
    ['山田太郎 監修', '山田太郎'],
    ['山田太郎 編著', '山田太郎'],
    ['山田太郎 [著]', '山田太郎'],
    ['山田太郎［作］', '山田太郎'],
    ['山田太郎（絵）', '山田太郎'],
    ['山田太郎 [ほか著]', '山田太郎'],
    ['山田太郎 ほか', '山田太郎'],
    ['山田太郎 他', '山田太郎'],
    ['山田太郎ほか', '山田太郎'],
    ['山田太郎ほか著', '山田太郎'],
    ['山田太郎 ほか著', '山田太郎'],
    ['山田太郎／ほか著', '山田太郎'],
    ['ヨシタケシンスケほか', 'ヨシタケシンスケ'],
  ])('役割表記を除く: %s', (raw, name) => {
    expect(cleanAuthorName(raw)).toBe(name);
  });

  it.each([
    ['原, ゆたか, 1953-', '原ゆたか'],
    ['夏目, 漱石, 1867-1916', '夏目漱石'],
    ['ヨシタケ, シンスケ, 1973-', 'ヨシタケシンスケ'],
    ['Rowling, J. K., 1965-', 'J. K. Rowling'],
    ['Carle, Eric', 'Eric Carle'],
    ['ローリング, J. K.', 'J. K. ローリング'],
    ['中川, 李枝子', '中川李枝子'],
    ['竹下, 文', '竹下文'],
  ])('見出し形・生年を整える: %s', (raw, name) => {
    expect(cleanAuthorName(raw)).toBe(name);
  });

  it('生年だけの表記も除く', () => {
    expect(cleanAuthorName('原ゆたか 1953-')).toBe('原ゆたか');
    expect(cleanAuthorName('原ゆたか (1953-)')).toBe('原ゆたか');
    expect(cleanAuthorName('原ゆたか, 1953-')).toBe('原ゆたか');
  });

  it('日本語の姓名の間の空白を詰める', () => {
    expect(cleanAuthorName('原 ゆたか')).toBe('原ゆたか');
    expect(cleanAuthorName('なかがわ　りえこ')).toBe('なかがわりえこ');
    expect(cleanAuthorName('Eric Carle')).toBe('Eric Carle');
    expect(cleanAuthorName('J.K. ローリング')).toBe('J.K. ローリング');
    // 3 語以上は複数人の可能性があるので詰めない
    expect(cleanAuthorName('宮沢 賢治 司 修')).toBe('宮沢 賢治 司 修');
  });

  it('名前に含まれる「作」「絵」「文」「等」「ほか」は消さない', () => {
    expect(cleanAuthorName('山田耕作')).toBe('山田耕作');
    expect(cleanAuthorName('斎藤等')).toBe('斎藤等');
    expect(cleanAuthorName('斎藤 等', { stripSpaceRoles: false })).toBe('斎藤等');
    expect(cleanAuthorName('みやほか')).toBe('みやほか');
    expect(cleanAuthorName('佐藤千絵')).toBe('佐藤千絵');
    expect(cleanAuthorName('林文')).toBe('林文');
  });

  it('stripSpaceRoles: false なら空白の後ろの語を残す（ONIX の氏名用）', () => {
    expect(cleanAuthorName('竹下 文', { stripSpaceRoles: false })).toBe('竹下文');
    expect(cleanAuthorName('竹下 文')).toBe('竹下');
  });

  it('役割だけ・空は空文字', () => {
    expect(cleanAuthorName('著')).toBe('');
    expect(cleanAuthorName('')).toBe('');
    expect(cleanAuthorName(null)).toBe('');
  });
});

describe('cleanAuthors', () => {
  it('整形し、空と重複（表記ゆれ含む）を除く', () => {
    expect(cleanAuthors(['原ゆたか さく・え', '原 ゆたか', '', null, 'J.K.ローリング 作', 'J. K. ローリング'])).toEqual([
      '原ゆたか',
      'J.K.ローリング',
    ]);
  });

  it('「;」区切りの複数人を分ける', () => {
    expect(cleanAuthors(['宮沢賢治 作 ; 司修 絵'])).toEqual(['宮沢賢治', '司修']);
  });

  it('「 と 」でつながった複数人を分ける（名前の中の「と」は分けない）', () => {
    expect(cleanAuthors(['なかがわりえこ と おおむらゆりこ [著]'])).toEqual(['なかがわりえこ', 'おおむらゆりこ']);
    expect(cleanAuthors(['ひろとし'])).toEqual(['ひろとし']);
  });
});

describe('cleanPublisher', () => {
  it('空白を整え、末尾の区切りを除く', () => {
    expect(cleanPublisher(' 福音館書店 ')).toBe('福音館書店');
    expect(cleanPublisher('ポプラ社,')).toBe('ポプラ社');
    expect(cleanPublisher('')).toBeNull();
    expect(cleanPublisher(undefined)).toBeNull();
  });
});

describe('toHttpsUrl', () => {
  it('http を https にし、edge=curl を外す', () => {
    expect(
      toHttpsUrl('http://books.google.com/books/content?id=X&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'),
    ).toBe('https://books.google.com/books/content?id=X&printsec=frontcover&img=1&zoom=1&source=gbs_api');
    expect(toHttpsUrl('http://example.com/a.jpg?edge=curl')).toBe('https://example.com/a.jpg');
    expect(toHttpsUrl('http://example.com/a.jpg?edge=curl&x=1')).toBe('https://example.com/a.jpg?x=1');
    expect(toHttpsUrl('https://cover.openbd.jp/9784834000825.jpg')).toBe('https://cover.openbd.jp/9784834000825.jpg');
    expect(toHttpsUrl('//example.com/a.jpg')).toBe('https://example.com/a.jpg');
  });

  it('空・不正は null', () => {
    expect(toHttpsUrl('')).toBeNull();
    expect(toHttpsUrl(null)).toBeNull();
    expect(toHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(toHttpsUrl('data:image/png;base64,xx')).toBeNull();
  });
});

describe('ndlThumbnailUrl', () => {
  it('ISBN から書影 URL を作る', () => {
    expect(ndlThumbnailUrl('9784834000825')).toBe('https://ndlsearch.ndl.go.jp/thumbnail/9784834000825.jpg');
  });
});

describe('joinTitle', () => {
  it('副題をつなぐ（含まれていれば付けない）', () => {
    expect(joinTitle('おしりたんてい', 'ププッ　ゆきやまのしろいかいぶつ')).toBe('おしりたんてい ププッ ゆきやまのしろいかいぶつ');
    expect(joinTitle('おしりたんてい ププッ ゆきやまのしろいかいぶつ', 'ププッゆきやまのしろいかいぶつ')).toBe(
      'おしりたんてい ププッ ゆきやまのしろいかいぶつ',
    );
    expect(joinTitle('ぐりとぐら', '')).toBe('ぐりとぐら');
    expect(joinTitle('', '副題')).toBe('副題');
  });
});

describe('splitSeriesStatement', () => {
  it('「名前 ; 巻次」に分ける', () => {
    expect(splitSeriesStatement('かいけつゾロリシリーズ ; 1')).toEqual([{ name: 'かいけつゾロリシリーズ', volume: 1 }]);
    expect(splitSeriesStatement('マジック・ツリーハウス')).toEqual([{ name: 'マジック・ツリーハウス', volume: null }]);
  });

  it('複数のシリーズ表記（「; 48. 」区切り）を分ける', () => {
    expect(splitSeriesStatement('ポプラ社の小さな童話 ; 48. かいけつゾロリシリーズ ; 1')).toEqual([
      { name: 'ポプラ社の小さな童話', volume: 48 },
      { name: 'かいけつゾロリシリーズ', volume: 1 },
    ]);
  });
});

describe('resolveApiSeries', () => {
  it('API のシリーズ名と巻次を使う', () => {
    expect(resolveApiSeries({ title: '恐竜の谷の大冒険', series: ['マジック・ツリーハウス ; 1'] })).toEqual({
      title: '恐竜の谷の大冒険',
      seriesName: 'マジック・ツリーハウス',
      volume: 1,
    });
  });

  it('書名の巻次がシリーズの巻次より優先', () => {
    expect(resolveApiSeries({ title: 'X', series: ['Yシリーズ ; 2'], volume: '3' }).volume).toBe(3);
  });

  it('レーベル名はシリーズとみなさない（次の候補を使う）', () => {
    expect(
      resolveApiSeries({ title: 'かいけつゾロリのドラゴンたいじ', series: ['ポプラ社の小さな童話 ; 48', 'かいけつゾロリシリーズ ; 1'] }),
    ).toEqual({ title: 'かいけつゾロリのドラゴンたいじ', seriesName: 'かいけつゾロリシリーズ', volume: 1 });
    expect(resolveApiSeries({ title: 'ぐりとぐら', series: ['こどものとも傑作集 ; 2'] })).toEqual({
      title: 'ぐりとぐら',
      seriesName: null,
      volume: null,
    });
  });

  it('巻次だけ（シリーズがレーベル名）なら書名をシリーズ名にし、書名に巻次を付ける', () => {
    expect(resolveApiSeries({ title: 'ONE PIECE', series: ['ジャンプコミックス'], volume: '104' })).toEqual({
      title: 'ONE PIECE 104',
      seriesName: 'ONE PIECE',
      volume: 104,
    });
    expect(resolveApiSeries({ title: 'ONE PIECE', series: [], volume: '巻104' }).title).toBe('ONE PIECE 104');
    expect(resolveApiSeries({ title: 'ハリー・ポッターと炎のゴブレット', series: [''], volume: '上' })).toEqual({
      title: 'ハリー・ポッターと炎のゴブレット 上',
      seriesName: 'ハリー・ポッターと炎のゴブレット',
      volume: 1,
    });
  });

  it('副題があれば書名に巻次を付けない（副題で区別できるため）', () => {
    expect(
      resolveApiSeries({ title: 'おしりたんてい', subtitle: 'ププッ ゆきやまのしろいかいぶつ', series: ['おしりたんてい ; 5'] }),
    ).toEqual({ title: 'おしりたんてい ププッ ゆきやまのしろいかいぶつ', seriesName: 'おしりたんてい', volume: 5 });
    expect(resolveApiSeries({ title: 'ONE PIECE', subtitle: '副題', series: [], volume: '104' })).toEqual({
      title: 'ONE PIECE 副題',
      seriesName: 'ONE PIECE',
      volume: 104,
    });
    expect(resolveApiSeries({ title: 'ぐりとぐら', subtitle: 'えほん', series: [] }).title).toBe('ぐりとぐら えほん');
  });

  it('書名にすでに巻次があれば付け足さない', () => {
    expect(resolveApiSeries({ title: '名探偵コナン 104', series: [], volume: '104' })).toEqual({
      title: '名探偵コナン 104',
      seriesName: '名探偵コナン',
      volume: 104,
    });
  });

  it('シリーズ名と書名が同じなら書名に巻次を付ける', () => {
    expect(resolveApiSeries({ title: 'ONE PIECE', series: ['ONE PIECE ; 104'] })).toEqual({
      title: 'ONE PIECE 104',
      seriesName: 'ONE PIECE',
      volume: 104,
    });
  });

  it('何も無ければ null', () => {
    expect(resolveApiSeries({ title: 'ぐりとぐら', series: [null, undefined, ''], volume: '' })).toEqual({
      title: 'ぐりとぐら',
      seriesName: null,
      volume: null,
    });
  });

  it('巻次として読めない値は無視する', () => {
    expect(resolveApiSeries({ title: 'ぐりとぐら', series: [], volume: '1-3' }).volume).toBeNull();
  });
});
