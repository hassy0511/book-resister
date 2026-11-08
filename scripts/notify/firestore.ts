/**
 * 通知スクリプトの Firestore 読み書き（firebase-admin。セキュリティルールは適用されない）。
 */
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { FirebaseTarget } from './config';
import type { NotifyLoan, NotifyLocation } from './messages';
import { checkSubscription, type SubscriptionProblem } from './subscription';

export interface AdminContext {
  app: App;
  db: Firestore;
  projectId: string;
}

/** 送信先の購読（groups/{gid}/pushSubscriptions/{id}） */
export interface StoredSubscription {
  /** ドキュメント ID（endpoint の SHA-256） */
  id: string;
  uid: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** 登録した時刻（ミリ秒）。読めなければ 0 */
  createdAtMillis: number;
}

/** 購読ドキュメントを読んだ結果。'format' は項目の型の誤り、'endpoint'・'keys' は subscription.ts の検証 */
export type SubscriptionReadResult =
  | { ok: true; sub: StoredSubscription }
  | { ok: false; problem: 'format' | SubscriptionProblem };

export interface GroupData {
  /** グループのドキュメントがあるか（無ければ他の項目は空） */
  exists: boolean;
  /** グループ名（ログ用。読めなければ null） */
  groupName: string | null;
  loans: NotifyLoan[];
  locationsById: Map<string, NotifyLocation>;
  subscriptions: StoredSubscription[];
  /** グループのメンバーの uid */
  memberUids: Set<string>;
  /** 形式が正しくなく読み飛ばしたドキュメント（貸出・場所）の数 */
  skippedDocs: number;
  /** 送らずに読み飛ばした購読の数（形式の誤り・対応していない送信先・鍵の誤り） */
  skippedSubscriptions: number;
}

export function openFirestore(target: FirebaseTarget): AdminContext {
  const projectId = target.kind === 'service-account' ? target.credential.projectId : target.projectId;
  const app = initializeApp(
    target.kind === 'service-account' ? { credential: cert(target.credential), projectId } : { projectId },
    `notify-${Date.now()}`,
  );
  const db = getFirestore(app);
  return { app, db, projectId };
}

export async function closeFirestore(ctx: AdminContext): Promise<void> {
  await deleteApp(ctx.app);
}

/** 全グループの ID（ドキュメントの中身は読まない） */
export async function listGroupIds(db: Firestore): Promise<string[]> {
  const snap = await db.collection('groups').select().get();
  return snap.docs.map((d) => d.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 貸出ドキュメント → 通知の判定に使う項目。形式が違えば null */
export function toNotifyLoan(data: DocumentData): NotifyLoan | null {
  const { dueOn, locationId, returnedOn } = data;
  if (typeof dueOn !== 'string' || typeof locationId !== 'string') return null;
  if (returnedOn != null && typeof returnedOn !== 'string') return null;
  return { dueOn, locationId, returnedOn: returnedOn ?? null };
}

/** 場所ドキュメント → 名前。形式が違えば null */
export function toNotifyLocation(data: DocumentData): NotifyLocation | null {
  return typeof data.name === 'string' ? { name: data.name } : null;
}

function toMillis(value: unknown): number {
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const millis: unknown = (value.toMillis as () => unknown).call(value);
    if (typeof millis === 'number' && Number.isFinite(millis)) return millis;
  }
  return 0;
}

/**
 * 購読ドキュメント → 送信先。
 * 対応していないプッシュサービスの endpoint や形式の正しくない鍵は送らない（subscription.ts）。
 */
export function readSubscription(id: string, data: DocumentData): SubscriptionReadResult {
  const { uid, endpoint, keys } = data;
  if (typeof uid !== 'string' || typeof endpoint !== 'string') return { ok: false, problem: 'format' };
  if (!isRecord(keys) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return { ok: false, problem: 'format' };
  }
  const subKeys = { p256dh: keys.p256dh, auth: keys.auth };
  const problem = checkSubscription(endpoint, subKeys);
  if (problem) return { ok: false, problem };
  return { ok: true, sub: { id, uid, endpoint, keys: subKeys, createdAtMillis: toMillis(data.createdAt) } };
}

/** 購読ドキュメント → 送信先。送れないものは null */
export function toStoredSubscription(id: string, data: DocumentData): StoredSubscription | null {
  const result = readSubscription(id, data);
  return result.ok ? result.sub : null;
}

/** 1 グループ分のグループ名・貸出中の本・場所・購読・メンバーを読む */
export async function loadGroupData(db: Firestore, groupId: string): Promise<GroupData> {
  const group = db.collection('groups').doc(groupId);
  const [groupSnap, loanSnap, locationSnap, subscriptionSnap, memberSnap] = await Promise.all([
    group.get(),
    group.collection('loans').where('returnedOn', '==', null).select('dueOn', 'locationId', 'returnedOn').get(),
    group.collection('locations').select('name').get(),
    group.collection('pushSubscriptions').get(),
    group.collection('members').select().get(),
  ]);
  const name: unknown = groupSnap.get('name');
  const groupName = typeof name === 'string' && name.trim() !== '' ? name.trim() : null;

  let skippedDocs = 0;
  const loans: NotifyLoan[] = [];
  for (const d of loanSnap.docs) {
    const loan = toNotifyLoan(d.data());
    if (loan) loans.push(loan);
    else skippedDocs++;
  }
  const locationsById = new Map<string, NotifyLocation>();
  for (const d of locationSnap.docs) {
    const location = toNotifyLocation(d.data());
    if (location) locationsById.set(d.id, location);
    else skippedDocs++;
  }
  let skippedSubscriptions = 0;
  const subscriptions: StoredSubscription[] = [];
  for (const d of subscriptionSnap.docs) {
    const result = readSubscription(d.id, d.data());
    if (result.ok) subscriptions.push(result.sub);
    else skippedSubscriptions++;
  }
  const memberUids = new Set(memberSnap.docs.map((d) => d.id));
  return {
    exists: groupSnap.exists,
    groupName,
    loans,
    locationsById,
    subscriptions,
    memberUids,
    skippedDocs,
    skippedSubscriptions,
  };
}

/** 無効になった購読を削除する */
export async function deleteSubscription(db: Firestore, groupId: string, subscriptionId: string): Promise<void> {
  await db.collection('groups').doc(groupId).collection('pushSubscriptions').doc(subscriptionId).delete();
}
