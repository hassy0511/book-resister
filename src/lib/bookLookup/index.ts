/**
 * 書誌情報の検索。
 * - lookupByIsbn: openBD → 国立国会図書館サーチ → Google Books の順。最初に見つかった結果を基にし、
 *   欠けている項目（表紙など）があり、それを持っていそうな API だけを続けて呼ぶ（呼び出し回数を抑える）。
 * - searchByTitle: 国立国会図書館サーチと Google Books を並行で呼び、重複を除いて最大 20 件。
 * どの API が失敗（CORS・タイムアウト 8 秒・上限・中断）しても例外は出さない。
 */
import { normalizeIsbn } from '../isbn';
import type { BookCandidate } from '../../types';
import { fetchGoogleByIsbn, searchGoogleByTitle } from './google';
import { dedupeCandidates, fillMissing, finalizeCandidate, interleave, missingFields, type LookupField } from './merge';
import { fetchNdlByIsbn, searchNdlByTitle } from './ndl';
import { normalizeSpaces } from './normalize';
import { fetchOpenBdByIsbn } from './openbd';

export type LookupOptions = { signal?: AbortSignal };

/** タイトル検索の最大件数 */
export const SEARCH_LIMIT = 20;

function googleApiKey(): string | undefined {
  const v: unknown = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

type IsbnSource = {
  /** この API から得られる項目（欠けている項目がこれに含まれるときだけ呼ぶ） */
  provides: LookupField[];
  fetch: (isbn13: string, signal?: AbortSignal) => Promise<BookCandidate | null>;
};

const ISBN_SOURCES: IsbnSource[] = [
  {
    provides: ['title', 'authors', 'publisher', 'coverUrl'],
    fetch: (isbn, signal) => fetchOpenBdByIsbn(isbn, { signal }),
  },
  {
    // NDL の OpenSearch には表紙の URL が無い
    provides: ['title', 'authors', 'publisher'],
    fetch: (isbn, signal) => fetchNdlByIsbn(isbn, { signal }),
  },
  {
    provides: ['title', 'authors', 'publisher', 'coverUrl'],
    fetch: (isbn, signal) => fetchGoogleByIsbn(isbn, { signal, apiKey: googleApiKey() }),
  },
];

/**
 * ISBN から書誌情報を取得する。見つからなければ null。
 * シリーズ名・巻数は API の値を優先し、無ければ guessSeries(title) で推定する。
 * 表紙がどの API にも無ければ NDL の書影 URL を入れる（表示側で読み込み失敗時に差し替える）。
 * 呼び出し側の signal で中断した場合も例外は出さず、それまでに得られた結果（無ければ null）を返す。
 */
export async function lookupByIsbn(isbn13: string, opts: LookupOptions = {}): Promise<BookCandidate | null> {
  const isbn = normalizeIsbn(isbn13);
  if (!isbn) return null;
  const { signal } = opts;

  let result: BookCandidate | null = null;
  for (const source of ISBN_SOURCES) {
    if (signal?.aborted) break;
    if (result) {
      const missing = missingFields(result);
      if (!source.provides.some((f) => missing.includes(f))) continue;
    }
    const found = await safely(() => source.fetch(isbn, signal), null);
    if (!found) continue;
    result = result ? fillMissing(result, found) : { ...found, isbn: found.isbn ?? isbn };
  }
  return result ? finalizeCandidate({ ...result, isbn }) : null;
}

/**
 * タイトル（または ISBN）で検索する。NDL と Google Books を並行で呼び、交互に並べてから
 * ISBN（無ければタイトル＋著者）で重複を除き、最大 20 件。ISBN が入力された場合は lookupByIsbn の結果を返す。
 */
export async function searchByTitle(query: string, opts: LookupOptions = {}): Promise<BookCandidate[]> {
  const q = normalizeSpaces(query);
  if (!q) return [];
  const { signal } = opts;

  const isbn = /^[\dXx\-ー－\s０-９]+$/.test(q) ? normalizeIsbn(q) : null;
  if (isbn) {
    const hit = await lookupByIsbn(isbn, opts);
    return hit ? [hit] : [];
  }

  const [ndl, google] = await Promise.all([
    safely(() => searchNdlByTitle(q, { signal }), [] as BookCandidate[]),
    safely(() => searchGoogleByTitle(q, { signal, apiKey: googleApiKey() }), [] as BookCandidate[]),
  ]);
  return dedupeCandidates(interleave(ndl, google), SEARCH_LIMIT).map((c) => finalizeCandidate(c));
}
