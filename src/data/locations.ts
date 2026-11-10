/**
 * 借りる場所（groups/{gid}/locations）。
 */
import { useMemo } from 'react';
import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useRequiredGroup } from '../group/GroupProvider';
import type { Location, WithId } from '../types';
import {
  EMPTY_LIST,
  TEXT_LIMITS,
  compareJa,
  querySubscriber,
  settleWrite,
  stripUndefined,
  useSubscription,
  type QueryResult,
} from './common';

export const MIN_LOAN_DAYS = 1;
export const MAX_LOAN_DAYS = 365;

function locationsCol(gid: string) {
  return collection(db, 'groups', gid, 'locations');
}

/** 名前順に並べる（同名は作成順） */
export function sortLocations<T extends Pick<Location, 'name'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => compareJa(a.name, b.name));
}

function cleanName(name: string): string {
  const t = name.trim();
  if (!t) throw new Error('場所の名前を入力してください');
  if (t.length > TEXT_LIMITS.locationName) throw new Error(`場所の名前は ${TEXT_LIMITS.locationName} 文字以内にしてください`);
  return t;
}

function cleanMemo(memo: string | null | undefined): string {
  const t = (memo ?? '').trim();
  if (t.length > TEXT_LIMITS.locationMemo) throw new Error(`メモは ${TEXT_LIMITS.locationMemo} 文字以内にしてください`);
  return t;
}

function cleanLoanDays(days: number): number {
  if (!Number.isInteger(days) || days < MIN_LOAN_DAYS || days > MAX_LOAN_DAYS) {
    throw new Error(`貸出期間は ${MIN_LOAN_DAYS}〜${MAX_LOAN_DAYS} 日の整数で入力してください`);
  }
  return days;
}

/** 場所一覧（名前順）。既定では非表示の場所を除く */
export function useLocations(opts?: { includeArchived?: boolean }): QueryResult<WithId<Location>[]> {
  const { groupId } = useRequiredGroup();
  const includeArchived = opts?.includeArchived ?? false;
  const result = useSubscription(
    `locations/${groupId}`,
    querySubscriber<Location>(locationsCol(groupId)),
    EMPTY_LIST,
  );
  return useMemo(() => {
    const visible = includeArchived ? result.data : result.data.filter((l) => !l.archived);
    return { ...result, data: sortLocations(visible) };
  }, [result, includeArchived]);
}

export async function addLocation(
  gid: string,
  input: { name: string; defaultLoanDays: number; memo: string },
): Promise<string> {
  const data = {
    name: cleanName(input.name),
    defaultLoanDays: cleanLoanDays(input.defaultLoanDays),
    memo: cleanMemo(input.memo),
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = doc(locationsCol(gid));
  await settleWrite(setDoc(ref, data));
  return ref.id;
}

export async function updateLocation(
  gid: string,
  id: string,
  patch: Partial<Pick<Location, 'name' | 'defaultLoanDays' | 'memo' | 'archived'>>,
): Promise<void> {
  const clean = stripUndefined({
    name: patch.name === undefined ? undefined : cleanName(patch.name),
    defaultLoanDays: patch.defaultLoanDays === undefined ? undefined : cleanLoanDays(patch.defaultLoanDays),
    memo: patch.memo === undefined ? undefined : cleanMemo(patch.memo),
    archived: patch.archived,
  });
  await settleWrite(updateDoc(doc(locationsCol(gid), id), { ...clean, updatedAt: serverTimestamp() }));
}
