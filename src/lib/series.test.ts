import { describe, expect, it } from 'vitest';
import {
  findMatchingSeries,
  guessSeries,
  isLabelLikeSeriesName,
  kanjiToNumber,
  normalizeSeriesName,
  parseVolume,
} from './series';

const S = (seriesName: string | null, volume: number | null) => ({ seriesName, volume });

describe('guessSeries: 末尾の数字', () => {
  it.each([
    ['マジック・ツリーハウス 12', 'マジック・ツリーハウス', 12],
    ['マジック・ツリーハウス　１２', 'マジック・ツリーハウス', 12],
    ['ONE PIECE 104', 'ONE PIECE', 104],
    ['ちびまる子ちゃん 1', 'ちびまる子ちゃん', 1],
    ['SPY×FAMILY 12', 'SPY×FAMILY', 12],
    ['  おばけのアッチ   3  ', 'おばけのアッチ', 3],
  ])('%s', (title, name, vol) => {
    expect(guessSeries(title)).toEqual(S(name, vol));
  });
});

describe('guessSeries: 括弧', () => {
  it.each([
    ['おしりたんてい (3)', 'おしりたんてい', 3],
    ['おしりたんてい(3)', 'おしりたんてい', 3],
    ['おしりたんてい（3）', 'おしりたんてい', 3],
    ['おしりたんてい（３）', 'おしりたんてい', 3],
    ['名探偵コナン（104）', '名探偵コナン', 104],
    ['かいけつゾロリ [5]', 'かいけつゾロリ', 5],
    ['かいけつゾロリ【5】', 'かいけつゾロリ', 5],
    ['ねこ (第3巻)', 'ねこ', 3],
    ['ねこ（3巻）', 'ねこ', 3],
    ['ねこ (vol.2)', 'ねこ', 2],
    ['ねこ（上）', 'ねこ', 1],
    ['ねこ (下)', 'ねこ', 3],
  ])('%s', (title, name, vol) => {
    expect(guessSeries(title)).toEqual(S(name, vol));
  });

  it('括弧の中にシリーズ名と巻数があればそれを使う', () => {
    expect(guessSeries('恐竜の谷の大冒険 (マジック・ツリーハウス 1)')).toEqual(S('マジック・ツリーハウス', 1));
    expect(guessSeries('ドラゴンたいじ（かいけつゾロリ　第1巻）')).toEqual(S('かいけつゾロリ', 1));
  });

  it('括弧の中が出版社のレーベル名なら使わない', () => {
    expect(guessSeries('ふたりはともだち (ミセスこどもの文庫 5)')).toEqual(S(null, null));
    expect(guessSeries('ドラゴンたいじ (ポプラ社の新・小さな童話 1)')).toEqual(S(null, null));
    expect(guessSeries('かいけつゾロリ 3 (ポプラ社の新・小さな童話)')).toEqual(S('かいけつゾロリ', 3));
  });

  it('巻数でない括弧書きは無視して、その前を見る', () => {
    expect(guessSeries('ドラえもん 5 (てんとう虫コミックス)')).toEqual(S('ドラえもん', 5));
    expect(guessSeries('ぐりとぐら (新装版)')).toEqual(S(null, null));
    expect(guessSeries('11ぴきのねこ (こどものとも傑作集)')).toEqual(S(null, null));
    expect(guessSeries('『ぐりとぐら』')).toEqual(S(null, null));
    expect(guessSeries('(3)')).toEqual(S(null, null));
  });
});

describe('guessSeries: 巻・第', () => {
  it.each([
    ['名探偵コナン 第3巻', '名探偵コナン', 3],
    ['名探偵コナン第3巻', '名探偵コナン', 3],
    ['名探偵コナン 第 3 巻', '名探偵コナン', 3],
    ['名探偵コナン 第３巻', '名探偵コナン', 3],
    ['三国志 第三巻', '三国志', 3],
    ['三国志 第十二巻', '三国志', 12],
    ['ねこ 第2集', 'ねこ', 2],
    ['ねこ 第3', 'ねこ', 3],
    ['ドラえもん 3巻', 'ドラえもん', 3],
    ['ドラえもん3巻', 'ドラえもん', 3],
    ['ONE PIECE 104巻', 'ONE PIECE', 104],
    ['ドラえもん 二十三巻', 'ドラえもん', 23],
  ])('%s', (title, name, vol) => {
    expect(guessSeries(title)).toEqual(S(name, vol));
  });

  it('「全3巻」「1〜3巻」はセットなので巻数にしない', () => {
    expect(guessSeries('はらぺこあおむし 全3巻')).toEqual(S(null, null));
    expect(guessSeries('ねこ 1〜3巻')).toEqual(S(null, null));
    expect(guessSeries('ねこ 全十巻')).toEqual(S(null, null));
  });

  it('漢数字は「巻」などが無ければ巻数にしない', () => {
    expect(guessSeries('ルパン三世')).toEqual(S(null, null));
    expect(guessSeries('ねこ 第一')).toEqual(S(null, null));
  });

  it('巻表記の後ろに副題が続く場合', () => {
    expect(guessSeries('名探偵コナン 第3巻 ひみつの事件')).toEqual(S('名探偵コナン', 3));
    expect(guessSeries('ドラえもん 3巻 ひみつ道具')).toEqual(S('ドラえもん', 3));
    expect(guessSeries('ねこ vol.2 つづき')).toEqual(S('ねこ', 2));
  });
});

describe('guessSeries: vol・No・#・その・パート', () => {
  it.each([
    ['ねこ vol.2', 'ねこ', 2],
    ['ねこ Vol.2', 'ねこ', 2],
    ['ねこ VOL 2', 'ねこ', 2],
    ['ねこvol.2', 'ねこ', 2],
    ['ねこ vol. 12', 'ねこ', 12],
    ['ねこ Volume 3', 'ねこ', 3],
    ['ねこ ｖｏｌ．２', 'ねこ', 2],
    ['ねこ ＶＯＬ．２', 'ねこ', 2],
    ['Magic Tree House #1', 'Magic Tree House', 1],
    ['ねこ No.3', 'ねこ', 3],
    ['あたまのたいそう その2', 'あたまのたいそう', 2],
    ['ねこ その三', 'ねこ', 3],
    ['ねこ パート2', 'ねこ', 2],
    ['ねこ Part 2', 'ねこ', 2],
    ['1Q84 BOOK 1', '1Q84', 1],
  ])('%s', (title, name, vol) => {
    expect(guessSeries(title)).toEqual(S(name, vol));
  });
});

describe('guessSeries: 丸数字・ローマ数字', () => {
  it.each([
    ['ねこ ③', 'ねこ', 3],
    ['ねこ③', 'ねこ', 3],
    ['ねこ ⑳', 'ねこ', 20],
    ['ねこ ㉑', 'ねこ', 21],
    ['ねこ ㊿', 'ねこ', 50],
    ['ねこ ❸', 'ねこ', 3],
    ['ねこ Ⅱ', 'ねこ', 2],
    ['ねこⅢ', 'ねこ', 3],
    ['Rocky II', 'Rocky', 2],
    ['STAR WARS EPISODE IV', 'STAR WARS EPISODE', 4],
  ])('%s', (title, name, vol) => {
    expect(guessSeries(title)).toEqual(S(name, vol));
  });

  it('単独の I / V / X は巻数にしない', () => {
    expect(guessSeries('Vitamin C')).toEqual(S(null, null));
    expect(guessSeries('MISSION X')).toEqual(S(null, null));
  });
});

describe('guessSeries: 上・中・下／前編・後編', () => {
  it.each([
    ['ハリー・ポッターと炎のゴブレット 上', 'ハリー・ポッターと炎のゴブレット', 1],
    ['ハリー・ポッターと炎のゴブレット 中', 'ハリー・ポッターと炎のゴブレット', 2],
    ['ハリー・ポッターと炎のゴブレット 下', 'ハリー・ポッターと炎のゴブレット', 3],
    ['ハリー・ポッターと炎のゴブレット　下', 'ハリー・ポッターと炎のゴブレット', 3],
    ['ねこ 上巻', 'ねこ', 1],
    ['ねこ下巻', 'ねこ', 3],
    ['ねこ 前編', 'ねこ', 1],
    ['ねこ 後篇', 'ねこ', 2],
  ])('%s', (title, name, vol) => {
    expect(guessSeries(title)).toEqual(S(name, vol));
  });

  it('タイトルの一部の「上」「下」は巻数にしない', () => {
    expect(guessSeries('木の上')).toEqual(S(null, null));
    expect(guessSeries('ちかてつのちか 地下')).toEqual(S(null, null));
    expect(guessSeries('いちばん上')).toEqual(S(null, null));
  });
});

describe('guessSeries: 誤検出しない', () => {
  it.each([
    '100かいだてのいえ',
    'ちか100かいだてのいえ',
    '11ぴきのねこ',
    '11ぴきのねこ ふくろのなか',
    '14ひきのあさごはん',
    '3びきのこぶた',
    '100万回生きたねこ',
    'ぐりとぐら',
    'ゴルゴ13',
    '2001年宇宙の旅',
    'ちいさなかがくのとも 2024年5月号',
    'かずのえほん 1 2 3',
    '日本の祭り 2024',
    'ねこ 0',
    '1 2 3',
    '123',
    'おしりたんてい ププッ ゆきやまのしろいかいぶつ',
    'ねないこだれだ',
    '',
    '   ',
  ])('%s', (title) => {
    expect(guessSeries(title)).toEqual(S(null, null));
  });
});

describe('guessSeries: シリーズ名の整形', () => {
  it('末尾の区切り記号を除く', () => {
    expect(guessSeries('かいけつゾロリ・3')).toEqual(S(null, null)); // 区切りの空白が無い数字は対象外
    expect(guessSeries('かいけつゾロリ ・ 3')).toEqual(S('かいけつゾロリ', 3));
    expect(guessSeries('かいけつゾロリ： 第3巻')).toEqual(S('かいけつゾロリ', 3));
    expect(guessSeries('かいけつゾロリ - vol.3')).toEqual(S('かいけつゾロリ', 3));
  });

  it('連続する空白は 1 つにする', () => {
    expect(guessSeries('ONE　　PIECE 1')).toEqual(S('ONE PIECE', 1));
  });

  it('文字列以外は null', () => {
    expect(guessSeries(undefined as unknown as string)).toEqual(S(null, null));
  });
});

describe('parseVolume', () => {
  it.each([
    ['3', 3],
    ['３', 3],
    ['012', 12],
    ['第3巻', 3],
    ['巻3', 3],
    ['3巻', 3],
    ['vol.2', 2],
    ['Vol. 2', 2],
    ['No.5', 5],
    ['第二集', 2],
    ['十二', 12],
    ['上', 1],
    ['中巻', 2],
    ['下', 3],
    ['前編', 1],
    ['後編', 2],
    ['③', 3],
    ['❸', 3],
    ['Ⅱ', 2],
    ['IV', 4],
    ['(3)', 3],
    ['（上）', 1],
    ['1 (おしりたんていシリーズ)', 1],
  ])('%s → %s', (text, vol) => {
    expect(parseVolume(text)).toBe(vol);
  });

  it.each(['', '1-3', '1〜3', '0', '2024', '新装版', 'あ', '上下'])('%s → null', (text) => {
    expect(parseVolume(text)).toBeNull();
  });

  it('null / undefined', () => {
    expect(parseVolume(null)).toBeNull();
    expect(parseVolume(undefined)).toBeNull();
  });
});

describe('kanjiToNumber', () => {
  it.each([
    ['一', 1],
    ['九', 9],
    ['十', 10],
    ['十二', 12],
    ['二十', 20],
    ['二十三', 23],
    ['百', 100],
    ['百五', 105],
    ['三百二十一', 321],
    ['一〇', 10],
    ['二〇三', 203],
  ])('%s → %s', (s, n) => {
    expect(kanjiToNumber(s)).toBe(n);
  });

  it.each(['', '二三十', '十百', '十十', 'あ'])('%s → null', (s) => {
    expect(kanjiToNumber(s)).toBeNull();
  });
});

describe('isLabelLikeSeriesName', () => {
  it.each(['講談社青い鳥文庫', '岩波少年文庫', 'ジャンプコミックス', 'てんとう虫コミックス', 'こどものとも傑作集', '講談社の創作絵本', 'ポプラ社の新・小さな童話', 'わくわくライブラリー', 'Jump Comics'])(
    '%s はレーベル',
    (name) => {
      expect(isLabelLikeSeriesName(name)).toBe(true);
    },
  );

  it.each(['マジック・ツリーハウス', 'かいけつゾロリシリーズ', 'おしりたんてい', 'ONE PIECE', '宮沢賢治全集'])('%s はシリーズ', (name) => {
    expect(isLabelLikeSeriesName(name)).toBe(false);
  });
});

describe('normalizeSeriesName', () => {
  it('NFKC・小文字化・空白と記号の除去', () => {
    expect(normalizeSeriesName('ＯＮＥ　ＰＩＥＣＥ')).toBe('onepiece');
    expect(normalizeSeriesName('One Piece')).toBe('onepiece');
    expect(normalizeSeriesName('マジック・ツリーハウス')).toBe('マジックツリーハウス');
    expect(normalizeSeriesName('ﾏｼﾞｯｸ･ﾂﾘｰﾊｳｽ')).toBe('マジックツリーハウス');
    expect(normalizeSeriesName('SPY×FAMILY')).toBe('spyfamily');
    expect(normalizeSeriesName('かいけつ ゾロリ！')).toBe('かいけつゾロリ');
  });

  it('長音記号は残す', () => {
    expect(normalizeSeriesName('ツリーハウス')).toBe('ツリーハウス');
  });

  it('末尾の「シリーズ」を除く（それだけなら残す）', () => {
    expect(normalizeSeriesName('かいけつゾロリシリーズ')).toBe('かいけつゾロリ');
    expect(normalizeSeriesName('かいけつゾロリ シリーズ')).toBe('かいけつゾロリ');
    expect(normalizeSeriesName('シリーズ')).toBe('シリーズ');
  });
});

describe('findMatchingSeries', () => {
  const list = [
    { id: 'a', name: 'マジック・ツリーハウス' },
    { id: 'b', name: 'かいけつゾロリシリーズ' },
    { id: 'c', name: 'ONE PIECE' },
  ];

  it('正規化して一致するものを返す', () => {
    expect(findMatchingSeries('マジックツリーハウス', list)?.id).toBe('a');
    expect(findMatchingSeries('かいけつゾロリ', list)?.id).toBe('b');
    expect(findMatchingSeries('one piece', list)?.id).toBe('c');
  });

  it('無ければ null／空文字は null', () => {
    expect(findMatchingSeries('おしりたんてい', list)).toBeNull();
    expect(findMatchingSeries('  ', list)).toBeNull();
    expect(findMatchingSeries('マジック', [])).toBeNull();
  });
});
