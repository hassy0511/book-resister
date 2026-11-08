/**
 * シリーズ（groups/{gid}/series）。
 */
import { useMemo } from 'react';
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useRequiredGroup } from '../group/GroupProvider';
import { findMatchingSeries, normalizeSeriesName } from '../lib/series';
import type { Series, WithId } from '../types';
import {
  EMPTY_LIST,
  TEXT_LIMITS,
  clipText,
  compareJa,
  docSubscriber,
  docWithId,
  isValidDocId,
  noopSubscriber,
  querySubscriber,
  settleWrite,
  stripUndefined,
  toDataError,
  useSubscription,
  type QueryResult,
} from './common';

function seriesCol(gid: string) {
  return collection(db, 'groups', gid, 'series');
}

/** シリーズ名は書誌 API から自動で入ることもあるため、長すぎる場合はルールの上限に切り詰める */
function cleanName(name: string): string {
  const t = clipText(name.trim(), TEXT_LIMITS.seriesName);
  if (!t) throw new Error('シリーズ名を入力してください');
  return t;
}

/** 全巻数は 1 以上の整数か null */
export function cleanTotalVolumes(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 9999) {
    throw new Error('全巻数は 1 以上の整数で入力してください');
  }
  return value;
}

/** シリーズ一覧（名前順） */
export function useSeriesList(): QueryResult<WithId<Series>[]> {
  const { groupId } = useRequiredGroup();
  const result = useSubscription(`series/${groupId}`, querySubscriber<Series>(seriesCol(groupId)), EMPTY_LIST);
  return useMemo(
    () => ({ ...result, data: [...result.data].sort((a, b) => compareJa(a.name, b.name)) }),
    [result],
  );
}

/** 1 つのシリーズ。seriesId が無ければ null */
export function useSeries(seriesId: string | undefined): QueryResult<WithId<Series> | null> {
  const { groupId } = useRequiredGroup();
  const valid = isValidDocId(seriesId);
  return useSubscription(
    valid ? `series/${groupId}/${seriesId}` : null,
    valid ? docSubscriber<Series>(doc(seriesCol(groupId), seriesId)) : noopSubscriber,
    null,
  );
}

export async function createSeries(gid: string, name: string, totalVolumes?: number | null): Promise<string> {
  const data = {
    name: cleanName(name),
    totalVolumes: cleanTotalVolumes(totalVolumes),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = doc(seriesCol(gid));
  await settleWrite(setDoc(ref, data));
  return ref.id;
}

export async function updateSeries(
  gid: string,
  id: string,
  patch: Partial<Pick<Series, 'name' | 'totalVolumes'>>,
): Promise<void> {
  const clean = stripUndefined({
    name: patch.name === undefined ? undefined : cleanName(patch.name),
    totalVolumes: patch.totalVolumes === undefined ? undefined : cleanTotalVolumes(patch.totalVolumes),
  });
  await settleWrite(updateDoc(doc(seriesCol(gid), id), { ...clean, updatedAt: serverTimestamp() }));
}

/** 同じ名前のシリーズを同時に作らないための実行中の処理 */
const inflight = new Map<string, Promise<string>>();

/** 名前（normalizeSeriesName で比較）が一致する既存シリーズの ID を返す。無ければ作成する */
export function findOrCreateSeries(gid: string, name: string): Promise<string> {
  let cleaned: string;
  try {
    cleaned = cleanName(name);
  } catch (e) {
    return Promise.reject(e);
  }
  const key = `${gid}/${normalizeSeriesName(cleaned)}`;
  const running = inflight.get(key);
  if (running) return running;

  const task = (async () => {
    let list: WithId<Series>[];
    try {
      // オフラインのときはキャッシュの内容で照合する
      const snap = await getDocs(seriesCol(gid));
      list = snap.docs.map((d) => docWithId<Series>(d));
    } catch (e) {
      throw toDataError(e);
    }
    const found = findMatchingSeries(cleaned, list);
    if (found) return found.id;
    return createSeries(gid, cleaned, null);
  })();
  inflight.set(key, task);
  // 完了後は外す（失敗時も）
  task.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  );
  return task;
}
