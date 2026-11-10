/**
 * シリーズ（groups/{gid}/series）。
 * 新しく作るシリーズの ID は名前から決める（`seriesIdForName`）。2 台で同時に同じシリーズを作っても 1 つにまとまる。
 * 名前を変えたシリーズと同じ名前のシリーズを作るときや、以前からあるシリーズはランダムな ID。
 * それでも同じ名前のシリーズが 2 つできたら、シリーズの編集から mergeSeries でまとめられる。
 */
import { useMemo } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useRequiredGroup } from '../group/GroupProvider';
import { findMatchingSeries, normalizeSeriesName } from '../lib/series';
import type { Series, WithId } from '../types';
import {
  BATCH_LIMIT,
  EMPTY_LIST,
  TEXT_LIMITS,
  chunk,
  clipText,
  compareJa,
  docSubscriber,
  docWithId,
  isPermissionDenied,
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

function booksCol(gid: string) {
  return collection(db, 'groups', gid, 'books');
}

// ---------------------------------------------------------------------------
// 名前から決まる ID
// ---------------------------------------------------------------------------

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** 文字列（UTF-8）の FNV-1a 64 ビットハッシュ（16 進 16 文字） */
function fnv1a64(text: string): string {
  let hash = FNV64_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * シリーズ名から決まるドキュメント ID（`s-` ＋ 正規化した名前のハッシュ 32 文字）。正規化すると空なら null。
 * どの端末でも同じ名前なら同じ ID になる（normalizeSeriesName で比較するので表記の揺れも同じ ID）。
 */
export function seriesIdForName(name: string): string | null {
  const key = normalizeSeriesName(name);
  if (!key) return null;
  return `s-${fnv1a64(key)}${fnv1a64(`series:${key}`)}`;
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

/** 同じ名前のシリーズを同時に作らないための実行中の処理（この端末の中） */
const inflight = new Map<string, Promise<string>>();

/**
 * 名前（normalizeSeriesName で比較）が一致する既存シリーズの ID を返す。無ければ作成する。
 * 新しく作るときは名前から決まる ID（seriesIdForName）を使うので、別の端末が同時に同じシリーズを作っても
 * 同じ ID にまとまる（後から届いた作成はルールで拒否されるが、ID は同じなので成功とみなす）。
 * その ID のシリーズが別の名前に変えられていたら、ランダムな ID で作る。
 */
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
    const id = seriesIdForName(cleaned);
    // 名前から決まる ID のシリーズが、別の名前に変えられて残っている
    if (id === null || list.some((s) => s.id === id)) return createSeries(gid, cleaned, null);
    await settleWrite(
      setDoc(doc(seriesCol(gid), id), {
        name: cleaned,
        totalVolumes: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      // 別の端末が先に同じ ID で作っていると、この作成は更新として扱われてルールで拒否される（ID は同じなので問題ない）
      { ignoreError: isPermissionDenied },
    );
    return id;
  })();
  inflight.set(key, task);
  // 完了後は外す（失敗時も）
  task.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  );
  return task;
}

// ---------------------------------------------------------------------------
// まとめる・削除する
// ---------------------------------------------------------------------------

/** サーバー優先で読む。オフラインでキャッシュにも無ければ null */
async function readSeries(ref: DocumentReference): Promise<WithId<Series> | null> {
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? docWithId<Series>(snap) : null;
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'unavailable') return null;
    throw toDataError(e);
  }
}

/** シリーズの本の参照（オフラインのときはキャッシュにある本だけ） */
async function seriesBookRefs(gid: string, seriesId: string): Promise<DocumentReference[]> {
  try {
    const snap = await getDocs(query(booksCol(gid), where('seriesId', '==', seriesId)));
    return snap.docs.map((d) => d.ref);
  } catch (e) {
    throw toDataError(e);
  }
}

type BatchOp =
  | { kind: 'update'; ref: DocumentReference; data: Record<string, unknown> }
  | { kind: 'delete'; ref: DocumentReference };

/** 操作を BATCH_LIMIT 件ずつのバッチで書く（最後の操作は最後のバッチに入る） */
async function commitOps(ops: BatchOp[]): Promise<void> {
  const commits = chunk(ops, BATCH_LIMIT).map((group) => {
    const batch = writeBatch(db);
    for (const op of group) {
      if (op.kind === 'update') batch.update(op.ref, op.data);
      else batch.delete(op.ref);
    }
    return batch.commit();
  });
  await settleWrite(Promise.all(commits));
}

/**
 * シリーズ fromId を intoId にまとめる（同じシリーズが 2 つできた場合など）。
 * fromId の本をすべて intoId に移し、fromId を削除する。全巻数は intoId の値を残し、無ければ fromId の値を使う。
 * オフラインでも書ける（writeBatch。後で自動送信）。
 */
export async function mergeSeries(gid: string, fromId: string, intoId: string): Promise<void> {
  if (!isValidDocId(fromId) || !isValidDocId(intoId)) throw new Error('シリーズが見つかりません');
  if (fromId === intoId) throw new Error('同じシリーズにはまとめられません');
  const [from, into, bookRefs] = await Promise.all([
    readSeries(doc(seriesCol(gid), fromId)),
    readSeries(doc(seriesCol(gid), intoId)),
    seriesBookRefs(gid, fromId),
  ]);
  if (!into) throw new Error('まとめる先のシリーズが見つかりません。画面を開き直してください。');
  const ops: BatchOp[] = bookRefs.map((ref) => ({
    kind: 'update',
    ref,
    data: { seriesId: intoId, updatedAt: serverTimestamp() },
  }));
  if (into.totalVolumes === null && from?.totalVolumes != null) {
    ops.push({
      kind: 'update',
      ref: doc(seriesCol(gid), intoId),
      data: { totalVolumes: from.totalVolumes, updatedAt: serverTimestamp() },
    });
  }
  ops.push({ kind: 'delete', ref: doc(seriesCol(gid), fromId) });
  await commitOps(ops);
}

/**
 * シリーズを削除する。本があるときは detachBooks: true のときだけ、本をシリーズから外して（seriesId を null に）削除する。
 * 本の巻数はそのまま残す。貸出記録は変わらない。
 */
export async function deleteSeries(gid: string, id: string, opts: { detachBooks?: boolean } = {}): Promise<void> {
  if (!isValidDocId(id)) throw new Error('シリーズが見つかりません');
  const bookRefs = await seriesBookRefs(gid, id);
  if (bookRefs.length > 0 && !opts.detachBooks) {
    throw new Error(`このシリーズには本が ${bookRefs.length}冊あります。本をシリーズから外してから削除してください。`);
  }
  const ops: BatchOp[] = bookRefs.map((ref) => ({
    kind: 'update',
    ref,
    data: { seriesId: null, updatedAt: serverTimestamp() },
  }));
  ops.push({ kind: 'delete', ref: doc(seriesCol(gid), id) });
  await commitOps(ops);
}
