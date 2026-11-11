/**
 * 表紙の無い本の表紙を、あとから探し直して埋める。
 *
 * 借りたときに書誌サービスにつながらなかった（Google Books の上限など）本は coverUrl が空のまま保存される。
 * 画面に表示した本のうち、ISBN があって表紙が無い（または提供が終わった NDL の書影 URL の）本を、
 * 1 冊につき 1 日 1 回まで lookupByIsbn で探し直し、見つかれば updateBook で本とその貸出記録の表紙を更新する。
 * 1 回の表示で探すのは最大 MAX_PER_RUN 冊（書誌 API の回数を抑える）。失敗しても何も表示しない。
 *
 * 使い方: useCoverBackfill(groupId, loans.map((l) => ({ bookId: l.bookId, isbn: l.book.isbn, coverUrl: l.book.coverUrl })))
 */
import { useEffect } from 'react';
import { todayString } from '../lib/date';
import { isRetiredCoverUrl } from '../lib/coverUrls';
import { lookupByIsbn } from '../lib/bookLookup';
import { updateBook } from './books';

export type CoverTarget = { bookId: string; isbn: string | null; coverUrl: string | null };

export const MAX_PER_RUN = 5;
const STORAGE_PREFIX = 'karita:coverTried:';

/** 表紙が無いとみなすか */
export function needsCover(coverUrl: string | null | undefined): boolean {
  const u = coverUrl?.trim();
  return !u || isRetiredCoverUrl(u);
}

/** 探し直す本を選ぶ（同じ本は 1 回、今日すでに試した本は除く、最大 limit 冊） */
export function pickBackfillTargets(
  items: readonly CoverTarget[],
  triedOn: (bookId: string) => string | null,
  today: string,
  limit = MAX_PER_RUN,
): CoverTarget[] {
  const out: CoverTarget[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (out.length >= limit) break;
    if (seen.has(item.bookId)) continue;
    seen.add(item.bookId);
    if (!item.isbn || !needsCover(item.coverUrl)) continue;
    if (triedOn(item.bookId) === today) continue;
    out.push(item);
  }
  return out;
}

function readTried(bookId: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + bookId);
  } catch {
    return null;
  }
}

function writeTried(bookId: string, day: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + bookId, day);
  } catch {
    // 保存できなくても困らない（次に開いたときにもう一度試すだけ）
  }
}

/** いま探している本（同じ本を複数の画面から同時に探さない） */
const inFlight = new Set<string>();

async function backfillOne(gid: string, target: CoverTarget, day: string): Promise<void> {
  if (!target.isbn || inFlight.has(target.bookId)) return;
  inFlight.add(target.bookId);
  writeTried(target.bookId, day);
  try {
    const found = await lookupByIsbn(target.isbn);
    const url = found?.coverUrl?.trim();
    if (url && !isRetiredCoverUrl(url)) await updateBook(gid, target.bookId, { coverUrl: url });
  } catch (e) {
    console.warn('[cover] 表紙を更新できませんでした', e);
  } finally {
    inFlight.delete(target.bookId);
  }
}

export function useCoverBackfill(gid: string | null | undefined, items: readonly CoverTarget[] | null | undefined): void {
  // 表紙が無い本の ID の並びが変わったときだけ動かす
  const key = (items ?? [])
    .filter((i) => i.isbn && needsCover(i.coverUrl))
    .map((i) => i.bookId)
    .join(',');
  useEffect(() => {
    if (!gid || !key || !items) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const day = todayString();
    const targets = pickBackfillTargets(items, readTried, day);
    if (targets.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const t of targets) {
        if (cancelled) return;
        await backfillOne(gid, t, day);
      }
    })();
    return () => {
      cancelled = true;
    };
    // items は key で代表させる（表紙が無い本の並びが変わったときだけ探し直す）
  }, [gid, key]);
}
