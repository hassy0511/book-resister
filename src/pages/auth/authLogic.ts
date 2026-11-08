/*
 * ログイン・グループ作成・参加の画面で使う純粋ロジック（入力チェック、招待コードの取り出しなど）。
 * 設定画面（表示名・グループ名の変更）からも使う。
 */
import { isInviteCodeFormat } from '../../data/invites';

/** パスワードの最小文字数（Firebase Authentication の既定と同じ） */
export const MIN_PASSWORD_LENGTH = 6;
/** 表示名・グループ名の最大文字数（firestore.rules と同じ） */
export const MAX_NAME_LENGTH = 50;

/** 見た目の文字数（絵文字などのサロゲートペアを 1 文字として数える） */
export function textLength(value: string): number {
  return Array.from(value).length;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** メールアドレスの簡易チェック。問題なければ null、あればメッセージ */
export function validateEmail(email: string): string | null {
  const t = email.trim();
  if (!t) return 'メールアドレスを入力してください';
  if (!EMAIL_RE.test(t)) return 'メールアドレスの形式が正しくありません';
  return null;
}

export type EmailAuthMode = 'signin' | 'signup';

/** パスワードのチェック。新規登録のときだけ文字数を確認する（ログイン時は Firebase に任せる） */
export function validatePassword(password: string, mode: EmailAuthMode): string | null {
  if (!password) return 'パスワードを入力してください';
  if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
    return `パスワードは ${MIN_PASSWORD_LENGTH} 文字以上にしてください`;
  }
  return null;
}

function validateName(value: string, label: string): string | null {
  const t = value.trim();
  if (!t) return `${label}を入力してください`;
  if (textLength(t) > MAX_NAME_LENGTH) return `${label}は ${MAX_NAME_LENGTH} 文字以内にしてください`;
  return null;
}

/** 表示名（「借りた人」として表示される名前） */
export function validateDisplayName(value: string): string | null {
  return validateName(value, '表示名');
}

/** グループ名（例「山田家」） */
export function validateGroupName(value: string): string | null {
  return validateName(value, 'グループ名');
}

/**
 * 貼り付けられた招待リンク（URL や共有メッセージ全体）またはコードから、招待コードを取り出す。
 * 取り出せなければ null。
 */
export function parseInviteInput(input: string): string | null {
  // 全角英数字で貼り付けられても受け付ける
  const text = input.normalize('NFKC').trim();
  if (!text) return null;
  const fromUrl = /\/join\/([A-Za-z0-9_-]+)/.exec(text);
  const candidate = fromUrl ? fromUrl[1] : text;
  return isInviteCodeFormat(candidate) ? candidate : null;
}

/** ログイン後の戻り先（App.tsx が sessionStorage 'returnTo' に保存する）が招待リンクか */
export function hasPendingInvite(storage: Pick<Storage, 'getItem'> | null = safeSessionStorage()): boolean {
  if (!storage) return false;
  try {
    const value = storage.getItem('returnTo');
    return typeof value === 'string' && value.startsWith('/join/');
  } catch {
    return false;
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
