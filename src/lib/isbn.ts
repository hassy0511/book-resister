/**
 * ISBN の正規化・検証。
 * アプリ内では ISBN は常にハイフンなしの 13 桁（978/979 で始まる）で扱う。
 */

/** ハイフン・空白として読み飛ばす文字（全角・各種ダッシュ含む） */
const SEPARATORS_RE = /[\s　\-‐‑‒–—―−－ｰー_]/g;

/** 「ISBN」「ISBN-13:」「isbn10」などの接頭辞（label は 10／13） */
const PREFIX_RE = /^isbn(?<label>[-\s]?1[03])?\s*[:：]?\s*/i;
/** 「ISBN」と区切り・コロンだけ（10／13 は残す） */
const BARE_PREFIX_RE = /^isbn\s*[:：]?\s*/i;

function stripSeparators(s: string): string {
  return s.replace(SEPARATORS_RE, '').toUpperCase();
}

/**
 * 全角英数字などを半角にし、区切り文字と「ISBN」の接頭辞を取り除いた候補。
 * 「ISBN 1338878921」の 13 は ISBN-10 の先頭の数字のこともあるので、
 * 接頭辞の後ろの 10／13 を取り除いたものと残したものの両方を返す（桁数が違うので両方が正しい ISBN になることはない）。
 */
function compactCandidates(input: string): string[] {
  const s = input.normalize('NFKC').trim();
  const m = PREFIX_RE.exec(s);
  if (!m) return [stripSeparators(s)];
  const out = [stripSeparators(s.slice(m[0].length))];
  if (m.groups?.label) out.push(stripSeparators(s.replace(BARE_PREFIX_RE, '')));
  return out;
}

/** 区切りを除いた 10／13 桁を ISBN-13 にする。不正なら null */
function fromCompact(code: string): string | null {
  if (code.length === 13) {
    return isBookEan(code) ? code : null;
  }
  if (code.length === 10 && isValidIsbn10(code)) {
    const first12 = `978${code.slice(0, 9)}`;
    return `${first12}${ean13CheckDigit(first12)}`;
  }
  return null;
}

/** 先頭 12 桁から EAN-13 のチェックディジットを計算する */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n : n * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

function isValidIsbn10(code: string): boolean {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = code[i];
    const n = ch === 'X' ? 10 : Number(ch);
    sum += n * (10 - i);
  }
  return sum % 11 === 0;
}

/**
 * ISBN-10 / ISBN-13（ハイフン・空白・全角数字・「ISBN」接頭辞可）を ISBN-13 に正規化する。
 * チェックディジットが不正、978/979 以外（192 で始まる価格コードなど）は null。
 */
export function normalizeIsbn(input: string): string | null {
  if (typeof input !== 'string') return null;
  for (const code of compactCandidates(input)) {
    const isbn = fromCompact(code);
    if (isbn) return isbn;
  }
  return null;
}

/** 978/979 で始まり、チェックディジットが正しい 13 桁の数字（バーコードの読み取り結果の判定用） */
export function isBookEan(code: string): boolean {
  if (typeof code !== 'string') return false;
  const c = code.trim();
  return /^97[89]\d{10}$/.test(c) && isValidEan13(c);
}

/** ISBN-13 を ISBN-10 に変換する（979 で始まるものは ISBN-10 が無いので null） */
export function toIsbn10(isbn13: string): string | null {
  const isbn = normalizeIsbn(isbn13);
  if (!isbn || !isbn.startsWith('978')) return null;
  const body = isbn.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return `${body}${check === 10 ? 'X' : String(check)}`;
}

/** 本のドキュメント ID（`isbn-<ISBN13>`）。正規化できる入力なら正規化してから付ける */
export function bookIdForIsbn(isbn13: string): string {
  return `isbn-${normalizeIsbn(isbn13) ?? isbn13.trim()}`;
}

/** 日本（978-4）の出版者記号の桁数の範囲 */
const JP_REGISTRANT_RANGES: Array<{ max: number; digits: number }> = [
  { max: 19, digits: 2 }, // 00–19
  { max: 699, digits: 3 }, // 200–699
  { max: 8499, digits: 4 }, // 7000–8499
  { max: 89999, digits: 5 }, // 85000–89999
  { max: 949999, digits: 6 }, // 900000–949999
  { max: 9999999, digits: 7 }, // 9500000–9999999
];

/**
 * 表示用の ISBN。日本の本（978-4）はハイフン区切り（例 978-4-8340-0082-5）、
 * それ以外はハイフンなしの 13 桁。正規化できない入力はそのまま返す。
 */
export function formatIsbn(isbn13: string): string {
  const isbn = normalizeIsbn(isbn13);
  if (!isbn) return isbn13;
  if (!isbn.startsWith('9784')) return isbn;
  const rest = isbn.slice(4, 12); // 出版者記号＋書名記号（8 桁）
  for (const { max, digits } of JP_REGISTRANT_RANGES) {
    const head = Number(rest.slice(0, digits));
    if (head <= max) {
      return `978-4-${rest.slice(0, digits)}-${rest.slice(digits)}-${isbn[12]}`;
    }
  }
  return isbn;
}
