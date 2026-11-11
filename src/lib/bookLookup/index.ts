/**
 * 書誌情報の検索。
 * - lookupByIsbn: openBD → 国立国会図書館サーチ → Google Books の順。最初に見つかった結果を基にし、
 *   欠けている項目（表紙など）があり、それを持っていそうな API だけを続けて呼ぶ（呼び出し回数を抑える）。
 *   シリーズ名・巻数が定まらない場合（API にもタイトルにも無い）は、シリーズ情報（「〇〇シリーズ ; 36」）を持つ NDL も呼ぶ。
 * - searchByTitle: 国立国会図書館サーチと Google Books を並行で呼び、重複を除いて最大 20 件。
 * どの API が失敗（CORS・タイムアウト 8 秒・上限・中断）しても例外は出さない。
 * - lookupByIsbnDetailed / searchByTitleDetailed: 結果に加えて、見つからなかったのが「通信の失敗で確かめられなかった」
 *   のか（failed）を返す。画面で「見つかりませんでした」と「つながりませんでした（再取得）」を分けるため。
 *
 * openBD について: openBD API v1 は 2023-07 に提供終了が告知され、2023-08 以降の api.openbd.jp/v1/get は
 * 国立国会図書館の書誌（CC-BY）を元にした代替データを同じ仕様で返している（少なくとも 60 か月。2028 年ごろに見直す）。
 * 新刊・書影の収録は以前より狭いが、未登録は [null] がすぐ返るので先頭のままにしている（docs/design.md 4.4）。
 */
import { normalizeIsbn } from '../isbn';
import type { BookCandidate } from '../../types';
import { fetchGoogleByIsbnDetailed, searchGoogleByTitleDetailed } from './google';
import type { SourceResult } from './http';
import { dedupeCandidates, fillMissing, finalizeCandidate, interleave, missingFields, type LookupField } from './merge';
import { fetchNdlByIsbnDetailed, searchNdlByTitleDetailed } from './ndl';
import { normalizeSpaces } from './normalize';
import { fetchOpenBdByIsbnDetailed } from './openbd';

export type LookupOptions = { signal?: AbortSignal };

/**
 * ISBN で引いた結果。
 * failed: 見つからず（candidate が null）、しかも 1 つ以上の API が通信に失敗した（タイムアウト・通信エラー・429 など）。
 *   該当なしと確かめられていないので、画面では「つながりませんでした」と再取得を案内する。
 *   呼び出し側の signal による中断は失敗に数えない。
 */
export type LookupResult = { candidate: BookCandidate | null; failed: boolean };

/** タイトルで検索した結果。failed: 0 件で、しかも 1 つ以上の API が通信に失敗した */
export type SearchResult = { candidates: BookCandidate[]; failed: boolean };

/** タイトル検索の最大件数 */
export const SEARCH_LIMIT = 20;

function googleApiKey(): string | undefined {
  const v: unknown = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 例外は通信の失敗として扱う */
async function safely<T>(fn: () => Promise<SourceResult<T>>, fallback: T): Promise<SourceResult<T>> {
  try {
    return await fn();
  } catch {
    return { value: fallback, failed: true };
  }
}

type IsbnSource = {
  /** この API から得られる項目（欠けている項目がこれに含まれるときだけ呼ぶ） */
  provides: LookupField[];
  fetch: (isbn13: string, signal?: AbortSignal) => Promise<SourceResult<BookCandidate | null>>;
};

const ISBN_SOURCES: IsbnSource[] = [
  {
    provides: ['title', 'authors', 'publisher', 'coverUrl', 'series'],
    fetch: (isbn, signal) => fetchOpenBdByIsbnDetailed(isbn, { signal }),
  },
  {
    // NDL の OpenSearch には表紙の URL が無い。シリーズ（dcndl:seriesTitle「かいけつゾロリシリーズ ; 36」）はある
    provides: ['title', 'authors', 'publisher', 'series'],
    fetch: (isbn, signal) => fetchNdlByIsbnDetailed(isbn, { signal }),
  },
  {
    // Google Books は日本の本のシリーズ情報をほとんど持たないので、シリーズのためには呼ばない
    provides: ['title', 'authors', 'publisher', 'coverUrl'],
    fetch: (isbn, signal) => fetchGoogleByIsbnDetailed(isbn, { signal, apiKey: googleApiKey() }),
  },
];

/**
 * ISBN から書誌情報を取得する（見つからなかった理由付き）。
 * シリーズ名・巻数は API の値を優先し、無ければ guessSeries(title) で推定する。
 * 表紙がどの API にも無ければ coverUrl は null のまま（表示側の BookCover が ISBN から版元ドットコムなどの書影を試す）。
 * 呼び出し側の signal で中断した場合も例外は出さず、それまでに得られた結果（無ければ null）を返す。
 *
 * シリーズ・巻数のためだけに NDL を呼んだ場合（他の欠けている項目は NDL に無い）、NDL のシリーズに巻数が無ければ
 * 使わない（出版社のレーベル・叢書名のことが多く、シリーズの既読状況に役立たないため）。
 * シリーズの無い本（単発の本）は NDL を 1 回多く呼ぶことになる（借りる・既読チェックの待ち時間が少し増える）。
 */
export async function lookupByIsbnDetailed(isbn13: string, opts: LookupOptions = {}): Promise<LookupResult> {
  const isbn = normalizeIsbn(isbn13);
  if (!isbn) return { candidate: null, failed: false };
  const { signal } = opts;

  let result: BookCandidate | null = null;
  let failed = false;
  for (const source of ISBN_SOURCES) {
    if (signal?.aborted) break;
    let onlyForSeries = false;
    if (result) {
      const missing = missingFields(result);
      const wanted = source.provides.filter((f) => missing.includes(f));
      if (wanted.length === 0) continue;
      onlyForSeries = wanted.length === 1 && wanted[0] === 'series';
    }
    const res = await safely(() => source.fetch(isbn, signal), null);
    if (res.failed) failed = true;
    const found = res.value;
    if (!found) continue;
    if (result) {
      if (onlyForSeries && !result.seriesName && found.volume === null) continue;
      result = fillMissing(result, found);
    } else {
      result = { ...found, isbn: found.isbn ?? isbn };
    }
  }
  if (result) return { candidate: finalizeCandidate({ ...result, isbn }), failed: false };
  return { candidate: null, failed };
}

/** ISBN から書誌情報を取得する。見つからなければ null（通信の失敗も null。理由が要るときは lookupByIsbnDetailed） */
export async function lookupByIsbn(isbn13: string, opts: LookupOptions = {}): Promise<BookCandidate | null> {
  return (await lookupByIsbnDetailed(isbn13, opts)).candidate;
}

/**
 * タイトル（または ISBN）で検索する（0 件の理由付き）。NDL と Google Books を並行で呼び、交互に並べてから
 * ISBN（無ければタイトル＋著者）で重複を除き、最大 20 件。
 * ISBN として読める入力（normalizeIsbn。「ISBN978-4-…」「978‐4‐…」「…Ｘ」も可）は lookupByIsbn の結果を返す。
 */
export async function searchByTitleDetailed(query: string, opts: LookupOptions = {}): Promise<SearchResult> {
  const q = normalizeSpaces(query);
  if (!q) return { candidates: [], failed: false };
  const { signal } = opts;

  const isbn = normalizeIsbn(q);
  if (isbn) {
    const hit = await lookupByIsbnDetailed(isbn, opts);
    return { candidates: hit.candidate ? [hit.candidate] : [], failed: hit.failed };
  }

  const [ndl, google] = await Promise.all([
    safely(() => searchNdlByTitleDetailed(q, { signal }), [] as BookCandidate[]),
    safely(() => searchGoogleByTitleDetailed(q, { signal, apiKey: googleApiKey() }), [] as BookCandidate[]),
  ]);
  const candidates = dedupeCandidates(interleave(ndl.value, google.value), SEARCH_LIMIT).map((c) => finalizeCandidate(c));
  return { candidates, failed: candidates.length === 0 && (ndl.failed || google.failed) };
}

/** タイトル（または ISBN）で検索する（0 件の理由が要るときは searchByTitleDetailed） */
export async function searchByTitle(query: string, opts: LookupOptions = {}): Promise<BookCandidate[]> {
  return (await searchByTitleDetailed(query, opts)).candidates;
}
