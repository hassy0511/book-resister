/*
 * 設定画面（場所・メンバー・通知）で使う純粋ロジック。
 */
import type { DateString, Location } from '../../types';
import { INVITE_VALID_DAYS } from '../../data/invites';
import { formatDate, todayString } from '../../lib/date';
import type { PushState } from '../../lib/push';
import { textLength } from '../auth/authLogic';

/** 場所の名前の最大文字数 */
export const LOCATION_NAME_MAX = 40;
/** 場所のメモの最大文字数（firestore.rules の上限） */
export const LOCATION_MEMO_MAX = 1000;
export const LOAN_DAYS_MIN = 1;
export const LOAN_DAYS_MAX = 365;
/** 新しい場所の既定の貸出期間 */
export const DEFAULT_LOAN_DAYS = 14;
/** 貸出期間のよく使う値（チップで選べる） */
export const LOAN_DAY_PRESETS: readonly number[] = [7, 14, 21, 28];

export interface LocationForm {
  name: string;
  defaultLoanDays: number | null;
  memo: string;
}

export interface LocationFormErrors {
  name?: string;
  defaultLoanDays?: string;
  memo?: string;
}

export function validateLocationName(name: string): string | undefined {
  const t = name.trim();
  if (!t) return '名前を入力してください';
  if (textLength(t) > LOCATION_NAME_MAX) return `名前は ${LOCATION_NAME_MAX} 文字以内にしてください`;
  return undefined;
}

export function validateLoanDays(days: number | null): string | undefined {
  if (days == null) return '貸出期間を入力してください';
  if (!Number.isInteger(days) || days < LOAN_DAYS_MIN || days > LOAN_DAYS_MAX) {
    return `貸出期間は ${LOAN_DAYS_MIN}〜${LOAN_DAYS_MAX} 日で入力してください`;
  }
  return undefined;
}

export function validateLocationForm(form: LocationForm): LocationFormErrors {
  const errors: LocationFormErrors = {};
  const name = validateLocationName(form.name);
  if (name) errors.name = name;
  const days = validateLoanDays(form.defaultLoanDays);
  if (days) errors.defaultLoanDays = days;
  if (textLength(form.memo.trim()) > LOCATION_MEMO_MAX) {
    errors.memo = `メモは ${LOCATION_MEMO_MAX} 文字以内にしてください`;
  }
  return errors;
}

export function hasFormErrors(errors: LocationFormErrors): boolean {
  return Boolean(errors.name || errors.defaultLoanDays || errors.memo);
}

/** 編集前の値から変わったか（前後の空白は無視） */
export function isLocationFormChanged(
  form: LocationForm,
  original: Pick<Location, 'name' | 'defaultLoanDays' | 'memo'>,
): boolean {
  return (
    form.name.trim() !== original.name.trim() ||
    form.defaultLoanDays !== original.defaultLoanDays ||
    form.memo.trim() !== (original.memo ?? '').trim()
  );
}

/** 表示中と非表示に分ける（並び順は保つ） */
export function splitLocations<T extends Pick<Location, 'archived'>>(list: readonly T[]): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const l of list) (l.archived ? archived : active).push(l);
  return { active, archived };
}

/** 場所ごとの件数 */
export function countByLocation(loans: readonly { locationId: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of loans) out[l.locationId] = (out[l.locationId] ?? 0) + 1;
  return out;
}

/** 一覧の 1 行目の下に出す説明（貸出期間とメモの冒頭） */
export function locationSummary(location: Pick<Location, 'defaultLoanDays' | 'memo'>, memoMax = 30): string {
  const parts = [`貸出期間 ${location.defaultLoanDays}日`];
  const memo = (location.memo ?? '').replace(/\s+/g, ' ').trim();
  if (memo) {
    const chars = Array.from(memo);
    parts.push(chars.length > memoMax ? `${chars.slice(0, memoMax).join('')}…` : memo);
  }
  return parts.join('・');
}

// ---------------------------------------------------------------------------
// 招待
// ---------------------------------------------------------------------------

/** 招待リンクの有効期限（作成時刻から 7 日後の日付） */
export function inviteExpiryDate(nowMs: number = Date.now(), days: number = INVITE_VALID_DAYS): DateString {
  return todayString(new Date(nowMs + days * 24 * 60 * 60 * 1000));
}

/** 共有シートで送る文面（URL は別に渡す） */
export function inviteShareText(groupName: string, expiry: DateString, today?: DateString): string {
  const name = groupName.trim() || '家族のグループ';
  const until = formatDate(expiry, today ? { today } : {});
  return `「${name}」の本の貸出ノートに招待します。リンクを開いてログインすると参加できます（${until}まで有効）。`;
}

// ---------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------

/** 設定一覧に出す通知の状態 */
export function pushStateLabel(state: PushState | null): string {
  switch (state) {
    case 'on':
      return 'オン';
    case 'off':
      return 'オフ';
    case 'denied':
      return 'ブロック中';
    case 'needs-install':
      return '要設定';
    case 'unsupported':
      return '非対応';
    default:
      return '';
  }
}
