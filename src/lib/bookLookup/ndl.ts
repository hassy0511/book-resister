/**
 * 国立国会図書館サーチ OpenSearch クライアント（RSS 2.0 の XML を DOMParser で読む）。
 * GET https://ndlsearch.ndl.go.jp/api/opensearch?isbn=<ISBN13>
 * GET https://ndlsearch.ndl.go.jp/api/opensearch?title=<書名>&cnt=50
 * item の主な要素: dc:title, dc:creator, dc:publisher, dcndl:seriesTitle, dcndl:volume,
 *                 dc:identifier[xsi:type=dcndl:ISBN], category
 */
import { normalizeIsbn } from '../isbn';
import type { BookCandidate } from '../../types';
import { fetchTextResult, isLookupFailure, type FetchOptions, type SourceResult } from './http';
import { fillMissing } from './merge';
import { cleanAuthors, cleanPublisher, normalizeSpaces, normalizeTitle, resolveApiSeries } from './normalize';

export const NDL_OPENSEARCH_ENDPOINT = 'https://ndlsearch.ndl.go.jp/api/opensearch';
/**
 * タイトル検索で NDL に求める件数。資料種別は絞らずに受け取り、記事・論文・雑誌などは parseEntries で除く。
 * 除く分と、同じ ISBN の重複レコード（国立国会図書館・公共図書館など。searchByTitle の重複除去でまとまる）も
 * 枠を使うため、表示する最大件数（searchByTitle の 20 件）より多めに取る。
 * （資料種別の絞り込み mediatype は、受け付ける値を本番の API で確かめられないため使わない）
 */
export const NDL_SEARCH_COUNT = 50;

const NS = {
  dc: 'http://purl.org/dc/elements/1.1/',
  dcndl: 'http://ndl.go.jp/dcndl/terms/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
} as const;

export function ndlIsbnUrl(isbn13: string): string {
  return `${NDL_OPENSEARCH_ENDPOINT}?isbn=${encodeURIComponent(isbn13)}`;
}

export function ndlTitleUrl(title: string): string {
  return `${NDL_OPENSEARCH_ENDPOINT}?title=${encodeURIComponent(title)}&cnt=${NDL_SEARCH_COUNT}`;
}

/** item 直下の要素（名前空間 URI か接頭辞付きの名前で照合） */
function childElements(item: Element, prefix: keyof typeof NS | null, local: string): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(item.children)) {
    if (prefix === null) {
      if (!el.namespaceURI && el.localName === local) out.push(el);
      else if (el.nodeName === local) out.push(el);
    } else if ((el.namespaceURI === NS[prefix] && el.localName === local) || el.nodeName === `${prefix}:${local}`) {
      out.push(el);
    }
  }
  return out;
}

function texts(item: Element, prefix: keyof typeof NS | null, local: string): string[] {
  return childElements(item, prefix, local)
    .map((el) => normalizeSpaces(el.textContent))
    .filter(Boolean);
}

function xsiType(el: Element): string {
  return el.getAttributeNS(NS.xsi, 'type') || el.getAttribute('xsi:type') || '';
}

/** ISBN 以外の資料（論文・雑誌記事など）とみなす分類 */
const NON_BOOK_CATEGORY_RE = /記事|論文|雑誌|新聞|レファレンス|立法|地図|音楽|映像|録音|博士論文/;

/** RSS の item 1 件を BookCandidate にする。書名が無ければ null */
export function parseNdlItem(item: Element): BookCandidate | null {
  const baseTitle = normalizeTitle(texts(item, 'dc', 'title')[0] ?? texts(item, null, 'title')[0]);
  if (!baseTitle) return null;

  const isbn = itemIsbns(item)[0] ?? null;

  const resolved = resolveApiSeries({
    title: baseTitle,
    series: texts(item, 'dcndl', 'seriesTitle'),
    volume: texts(item, 'dcndl', 'volume')[0] ?? null,
  });

  let authors = cleanAuthors(texts(item, 'dc', 'creator'));
  if (authors.length === 0) {
    // dc:creator が無い場合は RSS の author（「J.K.ローリング 作,松岡佑子 訳,」）を使う
    const rss = texts(item, null, 'author')[0] ?? '';
    authors = cleanAuthors(rss.split(/\s*[,，]\s*/).filter((p) => !/^\d{3,4}-?\d*$/.test(p)));
  }

  return {
    isbn,
    title: resolved.title,
    authors,
    publisher: cleanPublisher(texts(item, 'dc', 'publisher')[0]),
    coverUrl: null,
    seriesName: resolved.seriesName,
    volume: resolved.volume,
    source: 'ndl',
  };
}

/** item の ISBN（dc:identifier[xsi:type=dcndl:ISBN]）をすべて ISBN-13 にして返す */
function itemIsbns(item: Element): string[] {
  const out: string[] = [];
  for (const el of childElements(item, 'dc', 'identifier')) {
    if (!/ISBN/i.test(xsiType(el))) continue;
    const isbn = normalizeIsbn(el.textContent ?? '');
    if (isbn && !out.includes(isbn)) out.push(isbn);
  }
  return out;
}

type NdlEntry = { candidate: BookCandidate; isbns: string[] };

function parseEntries(xml: string): NdlEntry[] {
  if (typeof DOMParser === 'undefined' || !xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  const out: NdlEntry[] = [];
  for (const item of Array.from(doc.getElementsByTagName('item'))) {
    const candidate = parseNdlItem(item);
    if (!candidate) continue;
    if (!candidate.isbn) {
      const categories = texts(item, null, 'category').join(' ');
      if (NON_BOOK_CATEGORY_RE.test(categories)) continue;
    }
    out.push({ candidate, isbns: itemIsbns(item) });
  }
  return out;
}

/** OpenSearch の RSS を読み、本らしいものだけを返す（XML が壊れていれば空配列） */
export function parseNdlOpenSearch(xml: string): BookCandidate[] {
  return parseEntries(xml).map((e) => e.candidate);
}

/**
 * ISBN 検索の結果（RSS）から 1 冊にまとめる。ISBN が一致する item を優先し、
 * 同じ ISBN の複数レコード（国立国会図書館・公共図書館など）で欠けている項目を補い合う。
 * ISBN が一致するものが無ければ ISBN の無い item を使い、それも無ければ null。
 */
export function pickNdlByIsbn(xml: string, isbn13: string): BookCandidate | null {
  const want = normalizeIsbn(isbn13);
  if (!want) return null;
  const entries = parseEntries(xml);
  const matched = entries.filter((e) => e.isbns.includes(want));
  const list = (matched.length > 0 ? matched : entries.filter((e) => e.isbns.length === 0)).map((e) => e.candidate);
  if (list.length === 0) return null;
  const merged = list.slice(1).reduce(fillMissing, list[0]);
  return { ...merged, isbn: want };
}

/** ISBN で NDL サーチを引く。該当なしは value: null、通信の失敗は failed: true（例外は出さない） */
export async function fetchNdlByIsbnDetailed(
  isbn13: string,
  opts: FetchOptions = {},
): Promise<SourceResult<BookCandidate | null>> {
  const res = await fetchTextResult(ndlIsbnUrl(isbn13), opts);
  if (!res.ok) return { value: null, failed: isLookupFailure(res) };
  try {
    return { value: pickNdlByIsbn(res.data, isbn13), failed: false };
  } catch {
    return { value: null, failed: true };
  }
}

/** ISBN で NDL サーチを引く。失敗・該当なしは null（例外は出さない） */
export async function fetchNdlByIsbn(isbn13: string, opts: FetchOptions = {}): Promise<BookCandidate | null> {
  return (await fetchNdlByIsbnDetailed(isbn13, opts)).value;
}

/** 書名で NDL サーチを引く（本らしいものだけ）。該当なしは空配列、通信の失敗は failed: true */
export async function searchNdlByTitleDetailed(
  title: string,
  opts: FetchOptions = {},
): Promise<SourceResult<BookCandidate[]>> {
  const q = normalizeSpaces(title);
  if (!q) return { value: [], failed: false };
  const res = await fetchTextResult(ndlTitleUrl(q), opts);
  if (!res.ok) return { value: [], failed: isLookupFailure(res) };
  try {
    return { value: parseNdlOpenSearch(res.data), failed: false };
  } catch {
    return { value: [], failed: true };
  }
}

/** 書名で NDL サーチを引く（本らしいものだけ）。失敗時は空配列 */
export async function searchNdlByTitle(title: string, opts: FetchOptions = {}): Promise<BookCandidate[]> {
  return (await searchNdlByTitleDetailed(title, opts)).value;
}
