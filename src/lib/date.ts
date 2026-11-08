/**
 * 日付（'YYYY-MM-DD'）のユーティリティ。
 * タイムゾーンの影響を受けないよう、加減算・差分は Date.UTC を使って自前で計算する。
 * 端末の「今日」だけはローカル日付（todayString）。
 * DOM に依存しないので scripts/notify（Node）からも使える。
 */
import type { DateString } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 返却日まで何日以内を「もうすぐ」とするか（今日〜3 日後） */
export const SOON_DAYS = 3;

type Ymd = { y: number; m: number; d: number };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(y: number, m: number, d: number): DateString {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

/** 'YYYY-MM-DD' を分解する。存在しない日付（2月30日など）は null */
export function parseDateString(date: string): Ymd | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

/** 正しい 'YYYY-MM-DD' か */
export function isDateString(value: unknown): value is DateString {
  return typeof value === 'string' && parseDateString(value) !== null;
}

function daysInMonth(y: number, m: number): number {
  // Date.UTC は年 0〜99 を 1900 年代に読み替えるので setUTCFullYear で組み立てる
  const t = new Date(0);
  t.setUTCFullYear(y, m, 0);
  return t.getUTCDate();
}

/** UTC の 0 時を基準にした通し日数（1970-01-01 = 0） */
function toDayNumber({ y, m, d }: Ymd): number {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  t.setUTCHours(0, 0, 0, 0);
  return Math.round(t.getTime() / DAY_MS);
}

function fromDayNumber(n: number): DateString {
  const t = new Date(n * DAY_MS);
  return toDateString(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 端末のローカル日付（今日）。テスト用に基準時刻を渡せる */
export function todayString(now: Date = new Date()): DateString {
  return toDateString(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * date に days 日を足す（負の値で引く）。月末・年末・うるう年をまたいでも正しく計算する。
 * date が不正な場合や days が数値でない場合は date をそのまま返す（画面描画中に例外を出さないため）。
 */
export function addDays(date: DateString, days: number): DateString {
  const ymd = parseDateString(date);
  if (!ymd || !Number.isFinite(days)) return date;
  return fromDayNumber(toDayNumber(ymd) + Math.trunc(days));
}

/** to - from の日数。どちらかが不正なら NaN */
export function diffDays(from: DateString, to: DateString): number {
  const a = parseDateString(from);
  const b = parseDateString(to);
  if (!a || !b) return Number.NaN;
  return toDayNumber(b) - toDayNumber(a);
}

/** 曜日（0 = 日曜）。不正なら null */
export function weekdayOf(date: DateString): number | null {
  const ymd = parseDateString(date);
  if (!ymd) return null;
  // 1970-01-01 は木曜日（4）
  const n = toDayNumber(ymd);
  return (((n + 4) % 7) + 7) % 7;
}

export type FormatDateOptions = {
  /** true: 常に年を付ける / false: 付けない / 省略: 今年でなければ付ける */
  withYear?: boolean;
  /** 「今年」の判定に使う今日（テスト用。省略時は todayString()） */
  today?: DateString;
};

/**
 * 表示用の日付。例 "11月8日(土)"、今年でなければ "2025年11月8日(土)"。
 * 不正な文字列はそのまま返す（空文字なら空文字）。
 */
export function formatDate(date: DateString, opts: FormatDateOptions = {}): string {
  const ymd = parseDateString(date);
  if (!ymd) return date;
  const wd = weekdayOf(date) ?? 0;
  const body = `${ymd.m}月${ymd.d}日(${WEEKDAYS[wd]})`;
  let withYear = opts.withYear;
  if (withYear === undefined) {
    const today = parseDateString(opts.today ?? todayString());
    withYear = today ? today.y !== ymd.y : false;
  }
  return withYear ? `${ymd.y}年${body}` : body;
}

export type DueStatus = 'overdue' | 'soon' | 'ok';

/** 返却日の状態。overdue = 返却日を過ぎた / soon = 今日〜3 日後 / ok = それ以降（不正な日付も ok） */
export function dueStatus(dueOn: DateString, today: DateString = todayString()): DueStatus {
  const diff = diffDays(today, dueOn);
  if (Number.isNaN(diff)) return 'ok';
  if (diff < 0) return 'overdue';
  if (diff <= SOON_DAYS) return 'soon';
  return 'ok';
}

/** 返却日までの表示。例 "2日超過" "今日まで" "明日まで" "あと5日"。不正な日付は空文字 */
export function dueLabel(dueOn: DateString, today: DateString = todayString()): string {
  const diff = diffDays(today, dueOn);
  if (Number.isNaN(diff)) return '';
  if (diff < 0) return `${-diff}日超過`;
  if (diff === 0) return '今日まで';
  if (diff === 1) return '明日まで';
  return `あと${diff}日`;
}
