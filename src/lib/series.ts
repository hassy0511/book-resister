/**
 * シリーズ名・巻数の推定と、シリーズ名の比較。
 *
 * guessSeries はタイトル末尾の巻表記だけを見る（タイトル中の数字を巻数と誤認しないため）。
 *   「おしりたんてい (3)」「マジック・ツリーハウス 12」「名探偵コナン 第3巻」「ドラえもん 3巻」
 *   「〇〇 vol.2」「〇〇 ③」「〇〇 上／中／下」「恐竜の谷の大冒険 (マジック・ツリーハウス 1)」など。
 *   「100かいだてのいえ」「11ぴきのねこ」「ゴルゴ13」のようにタイトルの一部の数字は巻数にしない。
 *   「第456号」のような号数は巻数にしない（月刊絵本の号数を巻数にすると 1〜455 号が「抜け」になるため）。
 *
 * 上・中・下は、上下 2 冊組のほうがはるかに多いので 上=1・下=2 とする（中=2）。
 * 3 冊組の「下」は、保存の直前に同じシリーズの本を見て resolvePositionVolume で 3 にする。
 */

export type SeriesGuess = { seriesName: string | null; volume: number | null };

/** 巻の位置（上・中・下／前編・後編） */
export type VolumePosition = '上' | '中' | '下' | '前' | '後';

/** guessSeries の結果に、巻表記が上・中・下／前編・後編だった場合の位置を加えたもの */
export type SeriesGuessDetail = SeriesGuess & { position: VolumePosition | null };

const NONE: SeriesGuessDetail = { seriesName: null, volume: null, position: null };

/** 巻数として認める最大値 */
const MAX_VOLUME = 999;

const SP = '[\\s\\u3000]';
const DIGITS = '[0-9０-９]{1,3}';
const KANJI_NUM = '[一二三四五六七八九十百〇零]{1,4}';
/** 丸数字 ①〜⑳ ㉑〜㉟ ㊱〜㊿、黒丸数字 ❶〜❿、➀〜➉、➊〜➓、括弧数字 ⑴〜⒇ */
const CIRCLED = '[\\u2460-\\u2473\\u3251-\\u325F\\u32B1-\\u32BF\\u2776-\\u2793\\u2474-\\u2487]';
/** ローマ数字（1 文字の Unicode 文字 Ⅰ〜Ⅻ・ⅰ〜ⅻ） */
const ROMAN_CHAR = '[\\u2160-\\u216B\\u2170-\\u217B]';
/** ASCII のローマ数字（誤検出しやすい I / V / X 単独は除く） */
const ROMAN_ASCII = '(?:XII|XI|IX|VIII|VII|VI|IV|III|II)';
const OPEN = '[(（\\[［【〔〈《「『]';
const CLOSE = '[)）\\]］】〕〉》」』]';

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const ROMAN_VALUES: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

/** 漢数字（「十二」「二十三」「百五」「一〇」など）を数値にする */
export function kanjiToNumber(s: string): number | null {
  if (!s || !/^[一二三四五六七八九十百〇零]+$/.test(s)) return null;
  if (!/[十百]/.test(s)) {
    // 位取り記法（「一〇」= 10）
    let n = 0;
    for (const ch of s) n = n * 10 + KANJI_DIGITS[ch];
    return n;
  }
  let total = 0;
  let cur: number | null = null;
  let lastUnit = Infinity;
  for (const ch of s) {
    if (ch === '十' || ch === '百') {
      const unit = ch === '十' ? 10 : 100;
      if (unit >= lastUnit) return null; // 「十百」「十十」などは不正
      total += (cur ?? 1) * unit;
      cur = null;
      lastUnit = unit;
    } else {
      if (cur !== null) return null; // 「二三十」などは不正
      cur = KANJI_DIGITS[ch];
    }
  }
  return total + (cur ?? 0);
}

function circledToNumber(ch: string): number | null {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1; // ①〜⑳
  if (c >= 0x3251 && c <= 0x325f) return c - 0x3251 + 21; // ㉑〜㉟
  if (c >= 0x32b1 && c <= 0x32bf) return c - 0x32b1 + 36; // ㊱〜㊿
  if (c >= 0x2776 && c <= 0x277f) return c - 0x2776 + 1; // ❶〜❿
  if (c >= 0x2780 && c <= 0x2789) return c - 0x2780 + 1; // ➀〜➉
  if (c >= 0x278a && c <= 0x2793) return c - 0x278a + 1; // ➊〜➓
  if (c >= 0x2474 && c <= 0x2487) return c - 0x2474 + 1; // ⑴〜⒇
  return null;
}

function romanToNumber(s: string): number | null {
  const c = s.codePointAt(0) ?? 0;
  if (s.length === 1 && c >= 0x2160 && c <= 0x216b) return c - 0x2160 + 1;
  if (s.length === 1 && c >= 0x2170 && c <= 0x217b) return c - 0x2170 + 1;
  return ROMAN_VALUES[s.toUpperCase()] ?? null;
}

/** 数字（半角・全角）、漢数字、丸数字、ローマ数字のいずれかを数値にする */
function tokenToNumber(token: string): number | null {
  const t = token.trim();
  if (/^[0-9０-９]+$/.test(t)) {
    return Number(t.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
  }
  return kanjiToNumber(t) ?? (t.length === 1 ? circledToNumber(t) : null) ?? romanToNumber(t);
}

function validVolume(n: number | null): n is number {
  return n !== null && Number.isInteger(n) && n >= 1 && n <= MAX_VOLUME;
}

/**
 * 上・中・下／前編・後編 → 巻数。
 * 「下」は 2（上下 2 冊組が 3 冊組よりはるかに多い。3 にすると 2 巻が「抜け」と表示される）。
 * 3 冊組の「下」は resolvePositionVolume で 3 にする。
 */
const POSITION_VOLUMES: Record<VolumePosition, number> = { 上: 1, 中: 2, 下: 2, 前: 1, 後: 2 };

/** 3 冊組（上・中・下）の「下」の巻数 */
const THIRD_OF_THREE = 3;

type VolumeInfo = { volume: number; position: VolumePosition | null };

function positionInfo(pos: string): VolumeInfo {
  const position = pos as VolumePosition;
  return { volume: POSITION_VOLUMES[position], position };
}

/** parseVolume の本体（上・中・下などの位置も返す） */
function parseVolumeInfo(text: string | null | undefined): VolumeInfo | null {
  if (!text) return null;
  // 丸数字・黒丸数字は NFKC で崩れる／崩れないものがあるので先に見る
  const raw = text.trim();
  if (raw.length === 1) {
    const c = circledToNumber(raw);
    if (c !== null) return validVolume(c) ? { volume: c, position: null } : null;
  }
  let s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  // 外側の括弧を外す・末尾の括弧書きを除く
  s = s.replace(/^[([{「『【〔〈《]\s*(.*?)\s*[)\]}」』】〕〉》]$/, '$1');
  s = s.replace(/\s*[([{「『【〔〈《][^)\]}」』】〕〉》]*[)\]}」』】〕〉》]$/, '').trim();
  if (!s) return null;

  const pos = /^(上|中|下)巻?$/.exec(s) ?? /^(前|後)[編篇]$/.exec(s);
  if (pos) return positionInfo(pos[1]);

  // 「号」は巻数にしない（月刊誌・月刊絵本の号数）
  const m =
    /^(?:第|巻|vol(?:ume)?\.?|no\.|#|その|part|book)?\s*(\d{1,3}|[一二三四五六七八九十百〇零]{1,4})\s*(?:巻|集|部|弾|冊|編)?$/i.exec(s) ??
    /^(XII|XI|IX|VIII|VII|VI|IV|V|III|II|I|X)$/i.exec(s);
  if (!m) return null;
  const n = tokenToNumber(m[1]);
  return validVolume(n) ? { volume: n, position: null } : null;
}

/**
 * 巻数だけを表す文字列（API の巻次「3」「第3巻」「巻3」「vol.2」「上」「③」「Ⅱ」など）を数値にする。
 * 「1-3」のような範囲や、巻数と分からないもの、「第5号」のような号数は null。
 * 末尾の括弧書き（「1 (〇〇シリーズ)」）は無視する。上=1・中=2・下=2（上下 2 冊組を基本にする）。
 */
export function parseVolume(text: string | null | undefined): number | null {
  return parseVolumeInfo(text)?.volume ?? null;
}

/** 巻数だけを表す文字列が上・中・下／前編・後編なら、その位置（「下」「下巻」「(下)」→ '下'）。それ以外は null */
export function parseVolumePosition(text: string | null | undefined): VolumePosition | null {
  return parseVolumeInfo(text)?.position ?? null;
}

/** シリーズ名の前後の区切り記号を取り除く */
function cleanName(name: string): string {
  return name
    .replace(/^[\s・:：\-－‐―~～〜,、，/／|｜]+/, '')
    .replace(/[\s・:：\-－‐―~～〜,、，/／|｜]+$/, '')
    .trim();
}

/** シリーズ名として成り立つか（文字を 1 つ以上含む。数字・記号だけは不可） */
function isPlausibleName(name: string): boolean {
  return /\p{L}/u.test(name);
}

/** 出版社のレーベル・叢書名らしい名前（「講談社青い鳥文庫」「こどものとも傑作集」など）か */
export function isLabelLikeSeriesName(name: string): boolean {
  const n = name.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  return /(文庫|新書|選書|叢書|双書|コミックス|コミック|comics|comic|ブックス|books|ノベルズ|ノベルス|novels|ライブラリー|ライブラリ|library|傑作集|絵本|えほん|童話)$/.test(
    n,
  );
}

type Rule = {
  re: RegExp;
  num: (m: RegExpExecArray) => number | null;
  check?: (m: RegExpExecArray) => boolean;
  /** 上・中・下／前編・後編のルールだけ */
  position?: (m: RegExpExecArray) => VolumePosition;
};

const g = (m: RegExpExecArray, key: string): string => m.groups?.[key] ?? '';

/** 名前の直後に区切りが無く数字が続く場合（「ゴルゴ13」「〇〇123巻」の途中で切れたもの）は不可 */
const notGluedToDigit = (m: RegExpExecArray): boolean => !/[0-9０-９]$/.test(g(m, 'name'));

/** タイトル末尾の巻表記のルール（上から順に試す） */
const TRAILING_RULES: Rule[] = [
  // 〇〇 第3巻 / 〇〇第三巻 / 〇〇 第3集（漢数字は「巻」などが必須）。「第456号」のような号数は巻数にしない
  {
    re: new RegExp(`^(?<name>.*?)${SP}*第${SP}*(?<vol>${DIGITS})${SP}*(?:巻|集|部|弾)?$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  {
    re: new RegExp(`^(?<name>.*?)${SP}*第${SP}*(?<vol>${KANJI_NUM})${SP}*(?:巻|集|部|弾)$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  // 〇〇 上巻 / 〇〇 上 / 〇〇（前編）
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?<vol>上|中|下)巻$`),
    num: (m) => POSITION_VOLUMES[g(m, 'vol') as VolumePosition],
    position: (m) => g(m, 'vol') as VolumePosition,
  },
  {
    re: new RegExp(`^(?<name>.*\\S)${SP}+(?<vol>上|中|下)$`),
    num: (m) => POSITION_VOLUMES[g(m, 'vol') as VolumePosition],
    position: (m) => g(m, 'vol') as VolumePosition,
  },
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?<vol>前|後)[編篇]$`),
    num: (m) => POSITION_VOLUMES[g(m, 'vol') as VolumePosition],
    position: (m) => g(m, 'vol') as VolumePosition,
  },
  // 〇〇 3巻 / 〇〇三巻（「全3巻」「1〜3巻」は除く）
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?<vol>${DIGITS}|${KANJI_NUM})${SP}*巻$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
    check: (m) => notGluedToDigit(m) && !/(全|[~～〜\-－‐―]|から)$/.test(g(m, 'name').trim()),
  },
  // 〇〇 vol.2 / 〇〇 Vol 2 / 〇〇 volume 2
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?:vol|ｖｏｌ)(?:ume)?${SP}*[.．]?${SP}*(?<vol>${DIGITS})$`, 'i'),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  // 〇〇 No.3 / 〇〇 #3
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?:(?:no|ｎｏ)[.．]|[#＃])${SP}*(?<vol>${DIGITS})$`, 'i'),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  // 〇〇 その2
  {
    re: new RegExp(`^(?<name>.*?)${SP}*その${SP}*(?<vol>${DIGITS}|${KANJI_NUM})$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  // 〇〇 パート2 / 〇〇 Part 2 / 1Q84 BOOK 1
  {
    re: new RegExp(`^(?<name>.*?)${SP}*パート${SP}*(?<vol>${DIGITS})$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  {
    re: new RegExp(`^(?<name>.*\\S)${SP}+(?:part|book)${SP}*(?<vol>${DIGITS})$`, 'i'),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  // 〇〇 ③ / 〇〇③
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?<vol>${CIRCLED})$`, 'u'),
    num: (m) => circledToNumber(g(m, 'vol')),
  },
  // 〇〇 Ⅱ / 〇〇Ⅱ / 〇〇 II
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?<vol>${ROMAN_CHAR})$`, 'u'),
    num: (m) => romanToNumber(g(m, 'vol')),
  },
  {
    re: new RegExp(`^(?<name>.*\\S)${SP}+(?<vol>${ROMAN_ASCII})$`),
    num: (m) => romanToNumber(g(m, 'vol')),
  },
  // 〇〇 12（区切りの空白が必須。「1 2 3」のような数字の並びは除く）
  {
    re: new RegExp(`^(?<name>.*\\S)${SP}+(?<vol>${DIGITS})$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
    check: (m) => !new RegExp(`(?:^|${SP})[0-9０-９]+$`).test(g(m, 'name')),
  },
];

/** 巻表記の後ろに副題が続く形（「名探偵コナン 第3巻 〇〇」「〇〇 3巻 〇〇」「〇〇 vol.2 〇〇」） */
const MIDDLE_RULES: Rule[] = [
  {
    re: new RegExp(`^(?<name>.*?)${SP}*第${SP}*(?<vol>${DIGITS}|${KANJI_NUM})${SP}*(?:巻|集)${SP}+\\S.*$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
  {
    re: new RegExp(`^(?<name>.*\\S)${SP}+(?<vol>${DIGITS})${SP}*巻${SP}+\\S.*$`),
    num: (m) => tokenToNumber(g(m, 'vol')),
    check: (m) => !/全$/.test(g(m, 'name')),
  },
  {
    re: new RegExp(`^(?<name>.*?)${SP}*(?:vol|ｖｏｌ)(?:ume)?${SP}*[.．]?${SP}*(?<vol>${DIGITS})${SP}+\\S.*$`, 'i'),
    num: (m) => tokenToNumber(g(m, 'vol')),
  },
];

function applyRules(s: string, rules: Rule[]): SeriesGuessDetail | null {
  for (const rule of rules) {
    const m = rule.re.exec(s);
    if (!m) continue;
    if (rule.check && !rule.check(m)) continue;
    const vol = rule.num(m);
    if (!validVolume(vol)) continue;
    const name = cleanName(g(m, 'name'));
    if (!isPlausibleName(name)) continue;
    return { seriesName: name, volume: vol, position: rule.position ? rule.position(m) : null };
  }
  return null;
}

/** 括弧を含まないタイトル末尾の巻表記を探す */
function guessTrailing(s: string): SeriesGuessDetail | null {
  return applyRules(s, TRAILING_RULES);
}

/** 末尾の括弧書きを調べる */
function guessParen(s: string): SeriesGuessDetail | null {
  const m = new RegExp(`^(?<before>.*?)${SP}*${OPEN}${SP}*(?<inner>[^()（）\\[\\]［］【】〔〕〈〉《》「」『』]+?)${SP}*${CLOSE}$`).exec(s);
  if (!m) return null;
  const before = cleanName(g(m, 'before'));
  const inner = g(m, 'inner');

  // (3) / （第3巻） / (上) / (vol.2) → 括弧の前がシリーズ名
  const vol = parseVolumeInfo(inner);
  if (vol !== null) {
    return isPlausibleName(before) ? { seriesName: before, volume: vol.volume, position: vol.position } : null;
  }
  // 恐竜の谷の大冒険 (マジック・ツリーハウス 1) → 括弧の中がシリーズ名（出版社のレーベル名は除く）
  const innerGuess = guessTrailing(inner);
  if (innerGuess?.seriesName && !isLabelLikeSeriesName(innerGuess.seriesName)) return innerGuess;
  // 〇〇 3 (新装版) → 括弧を除いた残りで推定
  return before ? guessTrailing(before) : null;
}

/** guessSeries と同じ推定に、巻表記が上・中・下／前編・後編だった場合の位置（position）を加えて返す */
export function guessSeriesDetail(title: string): SeriesGuessDetail {
  if (typeof title !== 'string') return NONE;
  const s = title.replace(/[\s　]+/g, ' ').trim();
  if (!s) return NONE;
  return guessParen(s) ?? guessTrailing(s) ?? applyRules(s, MIDDLE_RULES) ?? NONE;
}

/**
 * タイトルからシリーズ名と巻数を推定する。巻表記が無ければ seriesName も null。
 * シリーズ名は巻表記を除いた部分（前後の空白・区切り記号は除く）。
 */
export function guessSeries(title: string): SeriesGuess {
  const { seriesName, volume } = guessSeriesDetail(title);
  return { seriesName, volume };
}

/** タイトル末尾の巻表記が上・中・下／前編・後編なら、その位置（「〇〇 下」「〇〇（下）」→ '下'） */
export function titleVolumePosition(title: string): VolumePosition | null {
  return guessSeriesDetail(title).position;
}

/** resolvePositionVolume に渡す本（タイトルと巻数。位置が分かっていれば position） */
export type PositionedBook = {
  title: string;
  volume: number | null;
  /** 分かっていれば巻の位置。省略・null ならタイトル末尾の巻表記から判定する */
  position?: VolumePosition | null;
};

function positionOfBook(b: PositionedBook): VolumePosition | null {
  return b.position ?? titleVolumePosition(b.title);
}

/**
 * 保存する本が「下」で、巻数が既定の 2 のとき、同じシリーズの本（同じカートの本・登録済みの本）に
 * 「中」があれば 3 冊組とみなして 3 を返す。それ以外は book.volume をそのまま返す。
 * 他の本の巻数は変えない（利用者が手で直した巻数を上書きしないため。巻数が自動の推定かどうかは記録していない）。
 * 「下」を 2 で保存した後に「中」を登録した場合は、同じ 2 巻が 2 冊になる（抜けは出ない。手で直せる）。
 */
export function resolvePositionVolume(book: PositionedBook, siblings: readonly PositionedBook[]): number | null {
  if (book.volume !== POSITION_VOLUMES['下']) return book.volume;
  if (positionOfBook(book) !== '下') return book.volume;
  return siblings.some((s) => s !== book && positionOfBook(s) === '中') ? THIRD_OF_THREE : book.volume;
}

/**
 * 比較用のシリーズ名。NFKC 正規化、小文字化、空白・記号の除去。
 * 末尾の「シリーズ」も除く（「かいけつゾロリシリーズ」と「かいけつゾロリ」を同じとみなす）。
 */
export function normalizeSeriesName(name: string): string {
  const s = name.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const stripped = s.replace(/シリーズ$/, '');
  return stripped || s;
}

/** 名前が一致する（normalizeSeriesName で比較）シリーズを探す */
export function findMatchingSeries<T extends { name: string }>(name: string, list: T[]): T | null {
  const key = normalizeSeriesName(name);
  if (!key) return null;
  return list.find((s) => normalizeSeriesName(s.name) === key) ?? null;
}
