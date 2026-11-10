/**
 * 書誌 API の値の整形（タイトル・著者・出版社・URL・シリーズ）。各 API のパーサから共通で使う。
 */
import { guessSeries, isLabelLikeSeriesName, normalizeSeriesName, parseVolume } from '../series';

/** 全角/半角スペース・改行などを半角スペース 1 つにまとめて前後を除く */
export function normalizeSpaces(s: string | null | undefined): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\s　 ]+/g, ' ').trim();
}

/** 全角英数字を半角に、半角カナを全角にする（記号はそのまま） */
function normalizeWidth(s: string): string {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[｡-ﾟ]+/g, (m) => m.normalize('NFKC'));
}

/** タイトルの整形（空白の正規化、全角英数字→半角、半角カナ→全角） */
export function normalizeTitle(s: string | null | undefined): string {
  return normalizeSpaces(normalizeWidth(normalizeSpaces(s)));
}

/** 出版社名の整形 */
export function cleanPublisher(s: string | null | undefined): string | null {
  const p = normalizeTitle(s).replace(/[\s,，、;；:：/／]+$/, '').trim();
  return p || null;
}

/** 著者名の後ろに付く役割表記 */
const ROLE_WORDS = [
  '著者', '著', '作者', '作', '原作', '原著', '原案', '文', '絵', '画', '挿絵', '挿画', '装画', '作画',
  '漫画', 'まんが', 'マンガ', '訳', '翻訳', '監訳', '編訳', '共訳', '抄訳', '編', '編著', '編集', '編者', '共著',
  '監修', '監', '構成', '脚本', '脚色', '写真', '撮影', 'イラスト', '解説', '再話', '案', '選', '作詞', '作曲',
  'さく', 'え', 'ぶん', 'やく', 'へん', 'しゃしん', 'さく・え', '作・絵', '文・絵', '作絵', '文絵', '著・絵',
];
const ROLE = `(?:${[...ROLE_WORDS].sort((a, b) => b.length - a.length).join('|')})`;
const ROLE_LIST = `${ROLE}(?:\\s*[・･,、＆&]\\s*${ROLE})*`;
/** 括弧付きの役割（[著]［作］(絵)〔編〕【作・絵】）と、[ほか] など */
const BRACKET_ROLE_RE = new RegExp(
  `\\s*[\\[［(（〔【]\\s*(?:(?:(?:ほか|他)\\s*)?${ROLE_LIST}(?:\\s*(?:ほか|他))?|ほか|他)\\s*[\\]］)）〕】]`,
  'g',
);
/** 「ほか著」のように役割の前に付く「ほか」 */
const OTHERS_ROLE_LIST = `(?:(?:ほか|他)\\s*)?${ROLE_LIST}`;
/** 「／著」「/作」の形の役割 */
const SLASH_ROLE_RE = new RegExp(`\\s*[／/]\\s*${OTHERS_ROLE_LIST}\\s*$`);
/** 「 作」「 さく・え」「 ほか著」のように空白の後の役割 */
const SPACE_ROLE_RE = new RegExp(`(?:^|\\s+)${OTHERS_ROLE_LIST}\\s*$`);
/** 生没年（「, 1950-」「, 1867-1916」「(1950-)」「1950-」「?-1950」） */
const YEARS_RE = /[,，、]?\s*[(（]?\s*(?:\d{3,4}|\?|？)\s*[-‐－–—~～]\s*(?:\d{3,4}|\?|？)?\s*[)）]?\s*$/;
/** 漢字・カタカナの名前に続く「ほか」「ほか著」（「山田太郎ほか」） */
const OTHERS_ATTACHED_RE = new RegExp(`(\\p{Script=Han}|\\p{Script=Katakana}|ー)ほか(?:${ROLE_LIST})?\\s*$`, 'u');
/** 空白の後の「ほか」「他」（「山田太郎 他」） */
const OTHERS_SPACED_RE = /\s+(?:ほか|他)\s*$/;

const CJK = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々〆・]';
const CJK_ONLY_RE = new RegExp(`^${CJK}+$`, 'u');
const LATIN_ONLY_RE = /^[A-Za-z][A-Za-z.\-' ]*$/;
const CJK_TWO_TOKENS_RE = new RegExp(`^(${CJK}+) (${CJK}+)$`, 'u');

export type CleanAuthorOptions = {
  /** 空白の後ろの役割表記（「原ゆたか さく・え」の「さく・え」）も除くか。既定 true */
  stripSpaceRoles?: boolean;
};

/**
 * 著者名の整形。役割表記（著・作・文・絵・訳・さく・え など）、生没年（, 1950-）、「ほか」を除き、
 * 「夏目, 漱石」のような見出し形は「夏目漱石」に、「Rowling, J. K.」は「J. K. Rowling」にする。
 * 日本語の姓名の間の空白（「原 ゆたか」）は詰める。
 */
export function cleanAuthorName(raw: string | null | undefined, opts: CleanAuthorOptions = {}): string {
  const stripSpaceRoles = opts.stripSpaceRoles ?? true;
  let s = normalizeTitle(raw);
  if (!s) return '';
  s = s.replace(BRACKET_ROLE_RE, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(YEARS_RE, '').trim();
    s = s.replace(SLASH_ROLE_RE, '').trim();
    s = s.replace(OTHERS_ATTACHED_RE, '$1').trim();
    if (s === before) break;
  }

  const parts = s.split(/\s*[,，]\s*/).filter(Boolean);
  if (parts.length === 2) {
    // 見出し形「姓, 名」
    const [family, given] = parts;
    if (CJK_ONLY_RE.test(family) && CJK_ONLY_RE.test(given)) s = `${family}${given}`;
    else if (LATIN_ONLY_RE.test(family) && LATIN_ONLY_RE.test(given)) s = `${given} ${family}`;
    else if (CJK_ONLY_RE.test(family) && LATIN_ONLY_RE.test(given)) s = `${given} ${family}`;
    else s = parts.join(', ');
  } else if (stripSpaceRoles) {
    s = s.replace(SPACE_ROLE_RE, '').trim();
    s = s.replace(OTHERS_SPACED_RE, '').trim();
  }
  // 「原 ゆたか」のように日本語の 2 語だけなら姓名とみなして詰める（3 語以上は複数人の可能性があるので触らない）
  s = s.replace(CJK_TWO_TOKENS_RE, '$1$2');
  return s.replace(/^[\s,，、;；:：/／]+|[\s,，、;；:：/／]+$/g, '').trim();
}

/** 重複判定用のキー（NFKC・小文字化・空白と記号の除去） */
export function compareKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 著者名の配列を整形し、空と重複を除く。「;」や「 と 」でつながった複数人は分ける */
export function cleanAuthors(list: Array<string | null | undefined>, opts: CleanAuthorOptions = {}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    for (const piece of raw.split(/\s*[;；]\s*|[\s\u3000]+と[\s\u3000]+/)) {
      const name = cleanAuthorName(piece, opts);
      const key = compareKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** http の画像 URL を https にする。Google Books の「めくれ」効果（edge=curl）も外す。不正なら null */
export function toHttpsUrl(url: string | null | undefined): string | null {
  const u = normalizeSpaces(url);
  if (!u) return null;
  let out: string;
  if (u.startsWith('https://')) out = u;
  else if (u.startsWith('http://')) out = `https://${u.slice('http://'.length)}`;
  else if (u.startsWith('//')) out = `https:${u}`;
  else return null;
  return out.replace(/([?&])edge=curl(&|$)/, (_, p: string, q: string) => (q ? p : '')).replace(/[?&]$/, '');
}

/** 国立国会図書館サーチの書影 URL（存在しない場合もある。表示側で読み込み失敗時に差し替える） */
export function ndlThumbnailUrl(isbn13: string): string {
  return `https://ndlsearch.ndl.go.jp/thumbnail/${isbn13}.jpg`;
}

export type ApiSeriesInput = {
  /** 書名（巻次・副題を含まない） */
  title: string;
  /** 副題（あれば書名の後ろに付ける） */
  subtitle?: string | null;
  /** API のシリーズ名の候補（優先順）。「かいけつゾロリシリーズ ; 1」のような巻次付きも可 */
  series: Array<string | null | undefined>;
  /** 書名の巻次（openBD の summary.volume、NDL の dcndl:volume など） */
  volume?: string | null;
};

export type ApiSeriesResult = { title: string; seriesName: string | null; volume: number | null };

/** 「ポプラ社の小さな童話 ; 48. かいけつゾロリシリーズ ; 1」を名前と巻次の組に分ける */
export function splitSeriesStatement(s: string): Array<{ name: string; volume: number | null }> {
  // 「; 48. 」のように巻次の後ろのピリオドで区切る（後読みは古い Safari で使えないので置換で分ける）
  return normalizeTitle(s)
    .replace(/(\d)\s*[.．]\s+/g, '$1\u0000')
    .split('\u0000')
    .map((part) => {
      const [name, ...rest] = part.split(/\s*[;；]\s*/);
      return { name: normalizeTitle(name).replace(/[\s.．,，:：]+$/, ''), volume: parseVolume(rest.join(' ')) };
    })
    .filter((p) => p.name);
}

/** 巻次の表示用文字列（数字なら数字だけ、「上」などはそのまま） */
function volumeDisplay(text: string, n: number): string {
  const t = normalizeTitle(text);
  return /^(?:第|巻|vol\.?\s*)?\d+\s*巻?$/i.test(t) ? String(n) : t;
}

/** 2 つのシリーズ名が同じとみなせるか（正規化して一致、または一方が他方の先頭） */
export function isSameSeries(a: string, b: string): boolean {
  const x = normalizeSeriesName(a);
  const y = normalizeSeriesName(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * API のシリーズ情報からシリーズ名・巻数を決め、表示用の書名（副題付き）を作る。
 * - 出版社のレーベル名（「講談社青い鳥文庫」「ジャンプコミックス」など）はシリーズとみなさない。
 * - 巻次だけあってシリーズ名が無い（またはレーベル名だけの）場合は、書名をシリーズ名にする。
 * - 書名がシリーズ名そのもので副題も無い場合は、一覧で区別できるよう書名に巻次を付ける
 *   （例: 書名「ONE PIECE」巻次「104」→ シリーズ「ONE PIECE」、書名「ONE PIECE 104」）。
 * - どちらも無ければ null（呼び出し側で guessSeries(title) を使う）。
 */
export function resolveApiSeries(input: ApiSeriesInput): ApiSeriesResult {
  const base = normalizeTitle(input.title);
  const subtitle = normalizeTitle(input.subtitle);
  const candidates = input.series
    .flatMap((s) => (typeof s === 'string' ? splitSeriesStatement(s) : []))
    .filter((c) => !isLabelLikeSeriesName(c.name));
  const volumeText = normalizeTitle(input.volume);
  const productVolume = parseVolume(volumeText);
  const withVolume = (vol: number): string =>
    `${base} ${productVolume !== null ? volumeDisplay(volumeText, productVolume) : vol}`;

  if (candidates.length > 0) {
    const series = candidates[0];
    const volume = productVolume ?? series.volume;
    const needsVolume =
      volume !== null &&
      !subtitle &&
      normalizeSeriesName(base) === normalizeSeriesName(series.name) &&
      guessSeries(base).volume === null;
    return {
      title: needsVolume && volume !== null ? withVolume(volume) : joinTitle(base, subtitle),
      seriesName: series.name,
      volume,
    };
  }

  if (productVolume !== null && base) {
    const guessed = guessSeries(base);
    if (guessed.seriesName && guessed.volume === productVolume) {
      return { title: joinTitle(base, subtitle), seriesName: guessed.seriesName, volume: productVolume };
    }
    return { title: subtitle ? joinTitle(base, subtitle) : withVolume(productVolume), seriesName: base, volume: productVolume };
  }

  return { title: joinTitle(base, subtitle), seriesName: null, volume: null };
}

/** 書名と副題をつなぐ（副題がすでに書名に含まれていれば付けない） */
export function joinTitle(title: string, subtitle: string | null | undefined): string {
  const t = normalizeTitle(title);
  const sub = normalizeTitle(subtitle);
  if (!sub) return t;
  if (!t) return sub;
  if (compareKey(t).includes(compareKey(sub))) return t;
  return `${t} ${sub}`;
}
