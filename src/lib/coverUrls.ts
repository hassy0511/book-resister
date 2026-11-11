/**
 * 表紙の画像 URL の候補（上から順に試し、読み込めなかったら次へ）。
 *
 * 1. 書誌 API が返した URL（Google Books・openBD など。登録した本の coverUrl）
 * 2. 版元ドットコムの書影（img.hanmoto.com。加盟出版社の本。無ければ 404）
 * 3. openBD の書影（cover.openbd.jp。以前の openBD の表紙。無ければ 404）
 *
 * 国立国会図書館サーチの書影 API（ndlsearch.ndl.go.jp/thumbnail/…）は 2026-03-31 で提供が終わったので使わない
 * （以前に保存した coverUrl に入っていても飛ばす）。
 * どれも読み込めなければ、BookCover はタイトルの頭文字のプレースホルダを出す。
 */
import { normalizeIsbn } from './isbn';

/** 提供が終わった書影 URL（保存済みのデータに残っていても使わない） */
export function isRetiredCoverUrl(url: string): boolean {
  return /^https?:\/\/(?:[\w-]+\.)*ndl\.go\.jp\/thumbnail\//i.test(url);
}

function toHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

export function coverCandidates(coverUrl: string | null | undefined, isbn: string | null | undefined): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    if (!out.includes(u)) out.push(u);
  };
  const stored = coverUrl?.trim();
  if (stored && /^(https?:)?\/\//i.test(stored) && !isRetiredCoverUrl(stored)) {
    add(toHttps(stored.startsWith('//') ? `https:${stored}` : stored));
  }
  const isbn13 = isbn ? normalizeIsbn(isbn) : null;
  if (isbn13) {
    add(`https://img.hanmoto.com/bd/img/${isbn13}.jpg`);
    add(`https://cover.openbd.jp/${isbn13}.jpg`);
  }
  return out;
}
