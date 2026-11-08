/**
 * プッシュ通知の購読（ブラウザ側）。
 *
 * - iPhone / iPad は「ホーム画面に追加」したアプリ（standalone）でしか Web Push を使えない（iOS 16.4 以上）。
 * - 購読情報は groups/{gid}/pushSubscriptions/{endpoint の SHA-256} に保存し、
 *   毎朝 GitHub Actions の scripts/notify がそこへ送信する。
 * - 公開鍵は VITE_VAPID_PUBLIC_KEY（GitHub Actions の VAPID_PUBLIC_KEY と同じ値）。
 */
import { FirebaseError } from 'firebase/app';
import { deleteDoc, doc, serverTimestamp, setDoc, type FieldValue } from 'firebase/firestore';
import { db } from '../firebase';
import type { PushSubscriptionDoc } from '../types';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

/** Service Worker の準備を待つ上限 */
const SW_READY_TIMEOUT_MS = 10_000;
/** Firestore への保存・削除を待つ上限（オフラインだと完了しないため） */
const FIRESTORE_TIMEOUT_MS = 15_000;

type PushSubscriptionWrite = Omit<PushSubscriptionDoc, 'createdAt'> & { createdAt: FieldValue };

// ---- 端末の判定 ----

/** UA などから iPhone / iPad か判定する（iPadOS のデスクトップ表示は MacIntel + タッチ対応で判定） */
export function detectIos(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

/** iPhone / iPad か */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return detectIos(navigator.userAgent ?? '', navigator.platform ?? '', navigator.maxTouchPoints ?? 0);
}

/** ホーム画面から開いたアプリ（standalone 表示）か */
export function isStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  // iOS Safari 独自のプロパティ
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** Web Push に必要な機能があるか */
function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// ---- 小さなユーティリティ ----

/** URL-safe Base64（VAPID 公開鍵）→ バイト列。不正な文字列なら例外 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** 文字列の SHA-256（16 進）。購読ドキュメントの ID に使う */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 購読に使われている公開鍵が同じか */
export function sameKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  if (a.length !== expected.length) return false;
  return a.every((byte, i) => byte === expected[i]);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readVapidPublicKeyText(): string {
  const value: unknown = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof value === 'string' ? value.trim() : '';
}

/** VITE_VAPID_PUBLIC_KEY をバイト列にする。未設定・不正なら分かりやすいエラー */
function vapidPublicKey(): Uint8Array<ArrayBuffer> {
  const text = readVapidPublicKeyText();
  if (!text) {
    throw new Error(
      '通知の設定（VITE_VAPID_PUBLIC_KEY）がありません。管理者が .env に VAPID の公開鍵を設定して、アプリをビルドし直す必要があります。',
    );
  }
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  try {
    bytes = urlBase64ToUint8Array(text);
  } catch {
    bytes = null;
  }
  // P-256 の非圧縮公開鍵は 65 バイトで 0x04 から始まる
  if (!bytes || bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error(
      '通知の設定（VITE_VAPID_PUBLIC_KEY）の形式が正しくありません。`npm run gen:vapid` で作った Public Key を設定してください。',
    );
  }
  return bytes;
}

/** 有効な VAPID 公開鍵（未設定・不正なら null） */
function vapidPublicKeyOrNull(): Uint8Array<ArrayBuffer> | null {
  try {
    return vapidPublicKey();
  } catch {
    return null;
  }
}

function serviceWorkerNotReadyMessage(): string {
  const base = '通知の準備ができていません。アプリを開き直してから、もう一度お試しください。';
  return import.meta.env.DEV
    ? `${base}（開発サーバーでは Service Worker を登録しないため通知は使えません。npm run build && npm run preview で確認してください）`
    : base;
}

/** 有効な Service Worker の登録を待つ（開発時など登録されない場合はタイムアウトでエラー） */
function readyRegistration(): Promise<ServiceWorkerRegistration> {
  return withTimeout(navigator.serviceWorker.ready, SW_READY_TIMEOUT_MS, serviceWorkerNotReadyMessage());
}

/** 現在の購読（無ければ null。例外は出さない） */
async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.pushManager) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function subscriptionPath(groupId: string, subscriptionId: string) {
  return doc(db, 'groups', groupId, 'pushSubscriptions', subscriptionId);
}

function toSubscriptionDoc(subscription: PushSubscription, uid: string): PushSubscriptionWrite {
  const json = subscription.toJSON();
  const endpoint = json.endpoint ?? subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('通知の登録情報を取得できませんでした。もう一度お試しください。');
  }
  return {
    uid,
    endpoint,
    keys: { p256dh, auth },
    userAgent: navigator.userAgent.slice(0, 500),
    createdAt: serverTimestamp(),
  };
}

function toSaveError(e: unknown): Error {
  if (e instanceof FirebaseError && e.code === 'permission-denied') {
    return new Error(
      '通知の登録を保存できませんでした（権限がありません）。この端末で別のメンバーが通知をオンにしている場合は、そのままでもグループの通知が届きます。',
      { cause: e },
    );
  }
  if (e instanceof Error && e.message.startsWith('通知の登録の保存')) return e;
  return new Error('通知の登録を保存できませんでした。通信状態を確認して、もう一度お試しください。', { cause: e });
}

// ---- 公開 API ----

/**
 * この端末の通知の状態。
 * - needs-install: iPhone / iPad でホーム画面から開いていない（追加の手順を案内する）
 * - unsupported:   ブラウザが Web Push に対応していない
 * - denied:        通知がブロックされている（設定アプリから許可が必要）
 * - off / on:      購読していない / している
 */
export async function getPushState(): Promise<PushState> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const subscription = await currentSubscription();
  if (!subscription) return 'off';
  // 公開鍵が変わった後の古い購読には届かないので「オフ」として再登録を促す
  const key = vapidPublicKeyOrNull();
  if (key && subscription.options?.applicationServerKey && !sameKey(subscription.options.applicationServerKey, key)) {
    return 'off';
  }
  return 'on';
}

/**
 * 通知をオンにする: 許可を求め、購読し、Firestore に保存する。
 * iOS では許可のダイアログがユーザー操作の中でしか出ないため、ボタンのクリック処理から直接呼ぶこと。
 */
export async function enablePush(groupId: string, uid: string): Promise<void> {
  if (isIos() && !isStandalone()) {
    throw new Error('iPhone・iPad では、ホーム画面に追加したアプリから通知をオンにしてください。');
  }
  if (!isPushSupported()) {
    throw new Error('この端末・ブラウザはプッシュ通知に対応していません。');
  }
  // 鍵の確認は同期的に済ませ、最初の await で許可を求める（ユーザー操作の扱いを失わないため）
  const applicationServerKey = vapidPublicKey();

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? '通知がブロックされています。端末の設定（iPhone は「設定」>「通知」）から、このアプリの通知を許可してください。'
        : '通知が許可されませんでした。もう一度お試しください。',
    );
  }

  const registration = await readyRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey, applicationServerKey)) {
    // 別の公開鍵で購読済み（鍵を作り直した場合など）。そのままでは subscribe できないので解除する
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    } catch (e) {
      throw new Error('通知の登録に失敗しました。時間をおいて、もう一度お試しください。', { cause: e });
    }
  }

  const data = toSubscriptionDoc(subscription, uid);
  const id = await sha256Hex(data.endpoint);
  try {
    await withTimeout(
      setDoc(subscriptionPath(groupId, id), data),
      FIRESTORE_TIMEOUT_MS,
      '通知の登録の保存に時間がかかっています。通信状態を確認してください（通信が戻ると自動で保存されます）。',
    );
  } catch (e) {
    throw toSaveError(e);
  }
}

/** 通知をオフにする: この端末の購読を解除し、Firestore からも削除する */
export async function disablePush(groupId: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  const id = await sha256Hex(subscription.endpoint);
  // 端末側を先に解除する（Firestore の削除に失敗しても、次回の送信が 410 になりスクリプトが削除する）
  await subscription.unsubscribe();
  try {
    await withTimeout(deleteDoc(subscriptionPath(groupId, id)), FIRESTORE_TIMEOUT_MS, 'timeout');
  } catch (e) {
    console.warn('通知の登録情報を削除できませんでした（次回の送信時に自動で削除されます）', e);
  }
}

/** テスト通知を、この端末にだけ表示する（Service Worker の showNotification を使う） */
export async function showTestNotification(): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('この端末・ブラウザは通知に対応していません。');
  }
  if (Notification.permission !== 'granted') {
    throw new Error('通知が許可されていません。先に通知をオンにしてください。');
  }
  const registration = await readyRegistration();
  const icon = new URL('icons/icon-192.png', registration.scope).href;
  await registration.showNotification('テスト通知', {
    body: 'このように返却日のお知らせが届きます。',
    icon,
    badge: icon,
    lang: 'ja',
    tag: 'test',
    data: { url: registration.scope },
  });
}
