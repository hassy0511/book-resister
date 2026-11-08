/**
 * Google Books API クライアント。
 * GET https://www.googleapis.com/books/v1/volumes?q=isbn:<ISBN13>
 * GET https://www.googleapis.com/books/v1/volumes?q=intitle:<語>+intitle:<語>&maxResults=20&printType=books
 * items[].volumeInfo: title, subtitle, authors[], publisher, imageLinks.thumbnail, industryIdentifiers[]
 * API キー（VITE_GOOGLE_BOOKS_API_KEY）があれば key= を付ける。
 */
import { normalizeIsbn } from '../isbn';
import type { BookCandidate } from '../../types';
import { fetchJson, type FetchOptions } from './http';
import { asArray, asRecord, asString, pick } from './json';
import { cleanAuthors, cleanPublisher, joinTitle, normalizeSpaces, toHttpsUrl } from './normalize';

export const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
export const GOOGLE_SEARCH_COUNT = 20;

export type GoogleOptions = FetchOptions & { apiKey?: string };

function withKey(params: URLSearchParams, apiKey?: string): string {
  if (apiKey) params.set('key', apiKey);
  return `${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`;
}

export function googleIsbnUrl(isbn13: string, apiKey?: string): string {
  return withKey(new URLSearchParams({ q: `isbn:${isbn13}` }), apiKey);
}

export function googleTitleUrl(title: string, apiKey?: string): string {
  const q = normalizeSpaces(title)
    .split(' ')
    .filter(Boolean)
    .map((w) => `intitle:${w}`)
    .join(' ');
  return withKey(
    new URLSearchParams({ q, maxResults: String(GOOGLE_SEARCH_COUNT), printType: 'books' }),
    apiKey,
  );
}

/** industryIdentifiers から ISBN-13 を取り出す（ISBN_13 → ISBN_10 の順） */
function pickIsbn(identifiers: unknown): string | null {
  const list = asArray(identifiers).map((x) => ({
    type: asString(pick(x, 'type')),
    id: asString(pick(x, 'identifier')),
  }));
  for (const type of ['ISBN_13', 'ISBN_10']) {
    for (const x of list) {
      if (x.type !== type) continue;
      const isbn = normalizeIsbn(x.id);
      if (isbn) return isbn;
    }
  }
  return null;
}

/** items[] の 1 件を BookCandidate にする。書名が無ければ null */
export function parseGoogleVolume(volume: unknown): BookCandidate | null {
  const info = asRecord(pick(volume, 'volumeInfo'));
  if (!info) return null;
  const title = joinTitle(asString(info.title), asString(info.subtitle));
  if (!title) return null;
  const images = asRecord(info.imageLinks);
  return {
    isbn: pickIsbn(info.industryIdentifiers),
    title,
    authors: cleanAuthors(asArray(info.authors).map(asString)),
    publisher: cleanPublisher(asString(info.publisher)),
    coverUrl: toHttpsUrl(asString(images?.thumbnail) || asString(images?.smallThumbnail)),
    seriesName: null,
    volume: null,
    source: 'google',
  };
}

/** 検索結果（{ totalItems, items }）を BookCandidate の配列にする */
export function parseGoogleBooksResponse(json: unknown): BookCandidate[] {
  return asArray(pick(json, 'items'))
    .map(parseGoogleVolume)
    .filter((c): c is BookCandidate => c !== null);
}

/** ISBN で Google Books を引く。ISBN が一致するものを優先。失敗・該当なしは null */
export async function fetchGoogleByIsbn(isbn13: string, opts: GoogleOptions = {}): Promise<BookCandidate | null> {
  const json = await fetchJson(googleIsbnUrl(isbn13, opts.apiKey), opts);
  if (json === null) return null;
  try {
    const want = normalizeIsbn(isbn13);
    const items = parseGoogleBooksResponse(json);
    // 別の ISBN の本しか返らなかった場合は使わない（ISBN 情報の無い結果は該当とみなす）
    const hit = items.find((c) => c.isbn === want) ?? items.find((c) => c.isbn === null);
    return hit ? { ...hit, isbn: want } : null;
  } catch {
    return null;
  }
}

/** 書名で Google Books を検索する（最大 20 件）。失敗時は空配列 */
export async function searchGoogleByTitle(title: string, opts: GoogleOptions = {}): Promise<BookCandidate[]> {
  if (!normalizeSpaces(title)) return [];
  const json = await fetchJson(googleTitleUrl(title, opts.apiKey), opts);
  if (json === null) return [];
  try {
    return parseGoogleBooksResponse(json);
  } catch {
    return [];
  }
}
