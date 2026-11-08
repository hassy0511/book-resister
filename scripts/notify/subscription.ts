/**
 * 購読（groups/{gid}/pushSubscriptions/{id}）の形式の検証（純粋関数）。
 *
 * 購読はグループのメンバーなら誰でも登録できるので、通知スクリプトは中身を信用しない:
 *   - endpoint は主要なブラウザのプッシュサービスのホストだけ（それ以外のサーバーへは送らない。
 *     送ると VAPID の JWT（VAPID_SUBJECT の連絡先を含む）がそのサーバーに渡る）
 *   - p256dh は P-256 の公開鍵（非圧縮 65 バイト）、auth は 16 バイト（どちらも base64url）
 * 形式が違う購読は送らずに読み飛ばす（失敗には数えない。削除もしない）。
 *
 * firestore.rules の pushSubscriptions（pushFields）と src/lib/push.ts の isSupportedPushEndpoint も
 * 同じ条件にしている。変えるときは 3 か所をそろえること。
 */
import { ECDH } from 'node:crypto';

/**
 * 送信してよい endpoint（プッシュサービス）。ホストの直後は必ず「/」（ポート・ユーザー情報は不可）。
 *   - web.push.apple.com                  … iPhone / iPad / Mac の Safari
 *   - fcm.googleapis.com                  … Chrome・Android
 *   - updates.push.services.mozilla.com   … Firefox
 *   - *.notify.windows.com                … Edge（Windows）
 */
export const PUSH_ENDPOINT_PATTERN =
  /^https:\/\/(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)\/.+$/;

/** endpoint の長さの上限（firestore.rules と同じ） */
export const MAX_ENDPOINT_LENGTH = 2048;

/** p256dh: 65 バイトの base64url（パディング無しで 87 文字。有りなら末尾に = が 1 つ） */
const P256DH_PATTERN = /^[A-Za-z0-9_-]{87}=?$/;
/** auth: 16 バイトの base64url（パディング無しで 22 文字。有りなら末尾に == ） */
const AUTH_PATTERN = /^[A-Za-z0-9_-]{22}(==)?$/;

/** 対応しているプッシュサービスの endpoint か */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  return endpoint.length <= MAX_ENDPOINT_LENGTH && PUSH_ENDPOINT_PATTERN.test(endpoint);
}

/** p256dh が P-256 曲線上の点（非圧縮形式）か。曲線上にない値は暗号化の段階で必ず失敗する */
export function isValidP256dh(p256dh: string): boolean {
  if (!P256DH_PATTERN.test(p256dh)) return false;
  const bytes = Buffer.from(p256dh, 'base64url');
  if (bytes.length !== 65 || bytes[0] !== 0x04) return false;
  try {
    ECDH.convertKey(bytes, 'prime256v1');
    return true;
  } catch {
    return false;
  }
}

/** auth が 16 バイトか */
export function isValidAuthSecret(auth: string): boolean {
  return AUTH_PATTERN.test(auth) && Buffer.from(auth, 'base64url').length === 16;
}

export type SubscriptionProblem = 'endpoint' | 'keys';

/** 送信してよい購読か。問題があればその種類 */
export function checkSubscription(endpoint: string, keys: { p256dh: string; auth: string }): SubscriptionProblem | null {
  if (!isAllowedPushEndpoint(endpoint)) return 'endpoint';
  if (!isValidP256dh(keys.p256dh) || !isValidAuthSecret(keys.auth)) return 'keys';
  return null;
}

/** 1 グループで送る購読の上限（家族のメンバーの端末には十分な数。部外者の大量の購読に備える） */
export const MAX_SUBSCRIPTIONS_PER_GROUP = 20;

export interface TargetSelection<T> {
  /** 送る購読（新しく登録した順） */
  targets: T[];
  /** メンバーでない人の購読の数（送らない） */
  nonMembers: number;
  /** 上限を超えたため送らない購読の数 */
  overLimit: number;
}

/** メンバーの購読だけを、新しいものから max 件まで選ぶ */
export function selectTargets<T extends { uid: string; createdAtMillis: number }>(
  subscriptions: readonly T[],
  memberUids: ReadonlySet<string>,
  max: number = MAX_SUBSCRIPTIONS_PER_GROUP,
): TargetSelection<T> {
  const members = subscriptions.filter((sub) => memberUids.has(sub.uid));
  const sorted = [...members].sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  return {
    targets: sorted.slice(0, max),
    nonMembers: subscriptions.length - members.length,
    overLimit: Math.max(0, sorted.length - max),
  };
}
