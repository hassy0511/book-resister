/**
 * 通知スクリプトの Firestore 読み書き（firebase-admin。セキュリティルールは適用されない）。
 */
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { FirebaseTarget } from './config';
import type { NotifyLoan, NotifyLocation } from './messages';

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
}

export interface GroupData {
  loans: NotifyLoan[];
  locationsById: Map<string, NotifyLocation>;
  subscriptions: StoredSubscription[];
  /** グループのメンバーの uid */
  memberUids: Set<string>;
  /** 形式が正しくなく読み飛ばしたドキュメントの数 */
  skippedDocs: number;
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

/** 購読ドキュメント → 送信先。形式が違えば null */
export function toStoredSubscription(id: string, data: DocumentData): StoredSubscription | null {
  const { uid, endpoint, keys } = data;
  if (typeof uid !== 'string' || typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return null;
  if (!isRecord(keys) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (!keys.p256dh || !keys.auth) return null;
  return { id, uid, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** 1 グループ分の貸出中の本・場所・購読・メンバーを読む */
export async function loadGroupData(db: Firestore, groupId: string): Promise<GroupData> {
  const group = db.collection('groups').doc(groupId);
  const [loanSnap, locationSnap, subscriptionSnap, memberSnap] = await Promise.all([
    group.collection('loans').where('returnedOn', '==', null).select('dueOn', 'locationId', 'returnedOn').get(),
    group.collection('locations').select('name').get(),
    group.collection('pushSubscriptions').get(),
    group.collection('members').select().get(),
  ]);

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
  const subscriptions: StoredSubscription[] = [];
  for (const d of subscriptionSnap.docs) {
    const sub = toStoredSubscription(d.id, d.data());
    if (sub) subscriptions.push(sub);
    else skippedDocs++;
  }
  const memberUids = new Set(memberSnap.docs.map((d) => d.id));
  return { loans, locationsById, subscriptions, memberUids, skippedDocs };
}

/** 無効になった購読を削除する */
export async function deleteSubscription(db: Firestore, groupId: string, subscriptionId: string): Promise<void> {
  await db.collection('groups').doc(groupId).collection('pushSubscriptions').doc(subscriptionId).delete();
}
