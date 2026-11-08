/**
 * openBD（https://openbd.jp/）クライアント。
 * GET https://api.openbd.jp/v1/get?isbn=<ISBN13> → [ { onix, hanmoto, summary } | null ]
 * summary: { isbn, title, volume, series, publisher, pubdate, cover, author }
 * onix.DescriptiveDetail: TitleDetail（書名・副題・巻次）、Collection（シリーズ・レーベル）、Contributor（著者）
 */
import { normalizeIsbn } from '../isbn';
import type { BookCandidate } from '../../types';
import { fetchJson, type FetchOptions } from './http';
import { asArray, asRecord, asString, pick } from './json';
import { cleanAuthors, cleanPublisher, normalizeTitle, resolveApiSeries, toHttpsUrl } from './normalize';

export const OPENBD_ENDPOINT = 'https://api.openbd.jp/v1/get';

export function openBdUrl(isbn13: string): string {
  return `${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn13)}`;
}

type TitleElement = { level: string; title: string; subtitle: string; partNumber: string };

function titleElements(v: unknown): TitleElement[] {
  return asArray(v).flatMap((el) => {
    const rec = asRecord(el);
    if (!rec) return [];
    return [
      {
        level: asString(rec.TitleElementLevel),
        title: asString(pick(rec, 'TitleText', 'content')),
        subtitle: asString(pick(rec, 'Subtitle', 'content')),
        partNumber: asString(rec.PartNumber),
      },
    ];
  });
}

/** summary.author（「J.K.ローリング／作 松岡佑子／訳」）を人ごとに分ける */
export function splitOpenBdAuthor(author: string): string[] {
  const s = normalizeTitle(author);
  if (!s) return [];
  if (!/[／/]/.test(s)) return [s];
  return s.split(/[／/][^\s／/]*(?:\s+|$)/).filter((p) => p.trim());
}

/** ONIX の Contributor から著者名（SequenceNumber 順） */
function onixContributors(v: unknown): string[] {
  const list = asArray(v)
    .map((c, i) => {
      const rec = asRecord(c);
      const seq = Number(asString(rec?.SequenceNumber));
      return { seq: Number.isFinite(seq) && seq > 0 ? seq : 1000 + i, name: asString(pick(rec, 'PersonName', 'content')) };
    })
    .filter((c) => c.name.trim())
    .sort((a, b) => a.seq - b.seq);
  // ONIX の氏名には役割が含まれないので、空白の後ろの語（「竹下 文」の「文」など）は役割として消さない
  return cleanAuthors(
    list.map((c) => c.name),
    { stripSpaceRoles: false },
  );
}

/** openBD の 1 件分を BookCandidate にする。書名が無ければ null */
export function parseOpenBdItem(item: unknown, isbnHint?: string): BookCandidate | null {
  const rec = asRecord(item);
  if (!rec) return null;
  const summary = asRecord(rec.summary) ?? {};
  const detail = pick(rec, 'onix', 'DescriptiveDetail');

  const product = titleElements(pick(detail, 'TitleDetail', 'TitleElement'));
  const productEl = product.find((e) => e.level === '01') ?? product[0];
  const collection = titleElements(pick(detail, 'Collection', 'TitleDetail', 'TitleElement'));

  const baseTitle = normalizeTitle(asString(summary.title)) || normalizeTitle(productEl?.title);
  if (!baseTitle) return null;

  // シリーズ候補: サブコレクション（03）→ コレクション（02）→ summary.series。レーベル名は resolveApiSeries で除く
  const seriesCandidates = [
    ...collection.filter((e) => e.level === '03'),
    ...collection.filter((e) => e.level !== '03'),
  ].map((e) => (e.partNumber ? `${e.title} ; ${e.partNumber}` : e.title));
  seriesCandidates.push(asString(summary.series));

  const resolved = resolveApiSeries({
    title: baseTitle,
    subtitle: productEl?.subtitle,
    series: seriesCandidates,
    volume: asString(summary.volume) || productEl?.partNumber || null,
  });

  let authors = onixContributors(pick(detail, 'Contributor'));
  if (authors.length === 0) authors = cleanAuthors(splitOpenBdAuthor(asString(summary.author)));

  const publisher =
    cleanPublisher(asString(summary.publisher)) ??
    cleanPublisher(asString(pick(rec, 'onix', 'PublishingDetail', 'Imprint', 'ImprintName'))) ??
    cleanPublisher(asString(pick(rec, 'onix', 'PublishingDetail', 'Publisher', 'PublisherName')));

  return {
    isbn: normalizeIsbn(asString(summary.isbn)) ?? (isbnHint ? normalizeIsbn(isbnHint) : null),
    title: resolved.title,
    authors,
    publisher,
    coverUrl: toHttpsUrl(asString(summary.cover)),
    seriesName: resolved.seriesName,
    volume: resolved.volume,
    source: 'openbd',
  };
}

/** openBD の応答（配列）から、指定 ISBN の本を取り出す。見つからなければ null */
export function parseOpenBdResponse(json: unknown, isbn13?: string): BookCandidate | null {
  const items = asArray(json)
    .map((item) => parseOpenBdItem(item, isbn13))
    .filter((c): c is BookCandidate => c !== null);
  if (items.length === 0) return null;
  const want = isbn13 ? normalizeIsbn(isbn13) : null;
  return (want && items.find((c) => c.isbn === want)) || items[0];
}

/** ISBN で openBD を引く。失敗・未登録は null（例外は出さない） */
export async function fetchOpenBdByIsbn(isbn13: string, opts: FetchOptions = {}): Promise<BookCandidate | null> {
  const json = await fetchJson(openBdUrl(isbn13), opts);
  if (json === null) return null;
  try {
    return parseOpenBdResponse(json, isbn13);
  } catch {
    return null;
  }
}
