/**
 * 複数の API の結果の統合（欠けている項目の補完、重複除去、最終的な整形）。
 */
import { normalizeIsbn } from '../isbn';
import { guessSeries } from '../series';
import type { BookCandidate } from '../../types';
import { compareKey, isSameSeries, ndlThumbnailUrl, normalizeTitle } from './normalize';

/** 後続の API で補う対象の項目（シリーズは対象外。無くてもタイトルから推定する） */
export type LookupField = 'title' | 'authors' | 'publisher' | 'coverUrl';

/** 欠けている項目 */
export function missingFields(c: BookCandidate): LookupField[] {
  const out: LookupField[] = [];
  if (!c.title.trim()) out.push('title');
  if (c.authors.length === 0) out.push('authors');
  if (!c.publisher) out.push('publisher');
  if (!c.coverUrl) out.push('coverUrl');
  return out;
}

/** base の欠けている項目を extra で補う（base の値が優先。source は base のまま） */
export function fillMissing(base: BookCandidate, extra: BookCandidate): BookCandidate {
  let seriesName = base.seriesName;
  let volume = base.volume;
  if (!seriesName && volume === null) {
    seriesName = extra.seriesName;
    volume = extra.volume;
  } else if (seriesName && volume === null && extra.volume !== null && extra.seriesName && isSameSeries(seriesName, extra.seriesName)) {
    volume = extra.volume;
  }
  return {
    isbn: base.isbn ?? extra.isbn,
    title: base.title.trim() ? base.title : extra.title,
    authors: base.authors.length > 0 ? base.authors : extra.authors,
    publisher: base.publisher ?? extra.publisher,
    coverUrl: base.coverUrl ?? extra.coverUrl,
    seriesName,
    volume,
    source: base.source,
  };
}

export type FinalizeOptions = {
  /** 表紙が無く ISBN がある場合に NDL の書影 URL を入れるか（既定 true） */
  ndlThumbnail?: boolean;
};

/**
 * 最終的な整形。ISBN を 13 桁に、タイトルの空白を正規化し、
 * シリーズ名・巻数が API から得られなかった場合は guessSeries(title) で推定する。
 */
export function finalizeCandidate(c: BookCandidate, opts: FinalizeOptions = {}): BookCandidate {
  const isbn = c.isbn ? normalizeIsbn(c.isbn) : null;
  const title = normalizeTitle(c.title);
  let seriesName = c.seriesName ? normalizeTitle(c.seriesName) || null : null;
  let volume = c.volume;
  if (!seriesName && volume === null) {
    const g = guessSeries(title);
    seriesName = g.seriesName;
    volume = g.volume;
  } else if (seriesName && volume === null) {
    // API のシリーズ名と同じシリーズの巻表記がタイトルにあれば巻数を使う
    const g = guessSeries(title);
    if (g.seriesName && g.volume !== null && isSameSeries(g.seriesName, seriesName)) volume = g.volume;
  } else if (!seriesName && volume !== null) {
    seriesName = guessSeries(title).seriesName ?? (title || null);
  }
  let coverUrl = c.coverUrl;
  if (!coverUrl && isbn && (opts.ndlThumbnail ?? true)) coverUrl = ndlThumbnailUrl(isbn);
  return { ...c, isbn, title, seriesName, volume, coverUrl };
}

function titleAuthorKey(c: BookCandidate): string {
  return `${compareKey(c.title)}|${compareKey(c.authors[0] ?? '')}`;
}

/**
 * 重複を除く。ISBN が同じものは 1 つにまとめ（欠けている項目は後のもので補う）、
 * ISBN の無いものはタイトル＋著者（先頭）が同じものをまとめる（ISBN のある同じ本があればそちらに寄せる）。
 * 先に出てきた順を保ち、最大 max 件。
 */
export function dedupeCandidates(list: BookCandidate[], max = Infinity): BookCandidate[] {
  const out: BookCandidate[] = [];
  const byIsbn = new Map<string, number>();
  const byKey = new Map<string, number>();

  for (const raw of list) {
    const c: BookCandidate = { ...raw, isbn: raw.isbn ? normalizeIsbn(raw.isbn) : null };
    if (!c.title.trim()) continue;
    const key = titleAuthorKey(c);

    if (c.isbn) {
      const i = byIsbn.get(c.isbn);
      if (i !== undefined) {
        out[i] = fillMissing(out[i], c);
        continue;
      }
      const j = byKey.get(key);
      if (j !== undefined && !out[j].isbn) {
        // 先に出ていた ISBN 無しの同じ本を、ISBN のあるもので置き換える
        out[j] = fillMissing(c, out[j]);
        byIsbn.set(c.isbn, j);
        continue;
      }
      byIsbn.set(c.isbn, out.length);
      if (!byKey.has(key)) byKey.set(key, out.length);
      out.push(c);
    } else {
      const j = byKey.get(key);
      if (j !== undefined) {
        out[j] = fillMissing(out[j], c);
        continue;
      }
      byKey.set(key, out.length);
      out.push(c);
    }
  }
  return out.slice(0, max);
}

/** 2 つの配列を交互に並べる（a[0], b[0], a[1], b[1], ...） */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}
