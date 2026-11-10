/*
 * 検索用の文字列の正規化（履歴・シリーズ一覧で共通）。
 *   - 全角英数 → 半角、半角カナ → 全角カナ（NFKC）
 *   - 大文字 → 小文字
 *   - カタカナ → ひらがな
 *   - 空白・記号（「・」「（」など）を除く
 * 検索語は空白で区切ると AND 検索になる。
 */

/** カタカナ（ァ〜ヶ）をひらがなに直す */
function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 比較用に正規化する */
export function normalizeForSearch(text: string): string {
  return katakanaToHiragana(text.normalize('NFKC').toLowerCase()).replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 区切り（正規化後の文字列には現れない） */
const SEP = '\u0001';

/** 検索対象の文字列（タイトルと著者をまとめたもの）を作る */
export function buildSearchText(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .map(normalizeForSearch)
    .join(SEP);
}

/** 検索語を空白で区切って正規化する（空の語は除く） */
export function parseSearchQuery(query: string): string[] {
  return query
    .split(/[\s　]+/)
    .map(normalizeForSearch)
    .filter((t) => t !== '');
}

/** すべての語を含むか（語が無ければ true） */
export function matchesTerms(searchText: string, terms: readonly string[]): boolean {
  return terms.every((t) => searchText.includes(t));
}
