/**
 * 招待（invites/{code}）。code は推測されにくいランダム文字列で、URL（/join/{code}）に載せる。
 */
import { Timestamp, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Invite, WithId } from '../types';
import { docWithId, toDataError } from './common';

/** 招待の有効期間（日） */
export const INVITE_VALID_DAYS = 7;
/** 招待コードの長さ（英数字 62 種 × 22 文字 ≒ 131 ビット） */
export const INVITE_CODE_LENGTH = 22;
/** 招待リンク作成時にサーバーの応答を待つ最大時間 */
const CREATE_TIMEOUT_MS = 15_000;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * URL にそのまま載せられる英数字のランダム文字列を作る（crypto.getRandomValues を使用）。
 * 記号を含めないのは、メッセージアプリのリンク判定で末尾の記号が切れるのを避けるため。
 */
export function generateInviteCode(length: number = INVITE_CODE_LENGTH): string {
  let out = '';
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      // 偏りが出ないよう 62 の倍数（248）未満だけを使う
      if (b < 248) out += ALPHABET[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/** 招待コードとして妥当な形式か（Firestore のパスに使えない文字を弾く） */
export function isInviteCodeFormat(code: string): boolean {
  return CODE_RE.test(code);
}

/** 有効期限切れか */
export function isInviteExpired(invite: Pick<Invite, 'expiresAt'>, nowMs: number = Date.now()): boolean {
  const expiresAt = invite.expiresAt as { toMillis?: unknown } | null | undefined;
  if (!expiresAt || typeof expiresAt.toMillis !== 'function') return true;
  return (expiresAt.toMillis as () => number).call(expiresAt) <= nowMs;
}

export function inviteUrl(code: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}/join/${code}`;
}

/** 招待リンクを作る。有効期限は 7 日後 */
export async function createInvite(
  gid: string,
  groupName: string,
  uid: string,
): Promise<{ code: string; url: string }> {
  const code = generateInviteCode();
  const write = setDoc(doc(db, 'invites', code), {
    groupId: gid,
    groupName: groupName.trim(),
    createdBy: uid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000),
  });
  // サーバーに保存されてから共有できるよう完了を待つ（オフラインで待ち続けないよう上限あり）
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('通信できないため招待リンクを作れませんでした。電波の良い場所でもう一度お試しください。')),
      CREATE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([write, timeout]);
  } catch (e) {
    write.catch(() => undefined);
    throw toDataError(e);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return { code, url: inviteUrl(code) };
}

/** 招待を読む。存在しない・期限切れ・形式が不正なら null */
export async function getInvite(code: string): Promise<WithId<Invite> | null> {
  const trimmed = code.trim();
  if (!isInviteCodeFormat(trimmed)) return null;
  try {
    const snap = await getDoc(doc(db, 'invites', trimmed));
    if (!snap.exists()) return null;
    const invite = docWithId<Invite>(snap);
    return isInviteExpired(invite) ? null : invite;
  } catch (e) {
    throw toDataError(e);
  }
}
