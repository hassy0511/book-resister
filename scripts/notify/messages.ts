/**
 * 毎朝の返却日通知の内容を組み立てる純粋ロジック（Firestore・Web Push に依存しない）。
 *
 * 区分（日本時間の「今日」基準）:
 *   - 延滞中      … dueOn < 今日（返却されるまで毎日）
 *   - 明日返却    … dueOn == 今日 + 1
 *   - 3日後に返却 … dueOn == 今日 + 3
 * 今日が返却日の本、2 日後・4 日後以降の本は対象外。
 */
import { diffDays } from '../../src/lib/date';
import type { DateString, Loan, Location } from '../../src/types';

/** 通知の判定に使う貸出の項目 */
export type NotifyLoan = Pick<Loan, 'dueOn' | 'locationId' | 'returnedOn'>;
/** 通知の本文に使う場所の項目 */
export type NotifyLocation = Pick<Location, 'name'>;

export type DueCategory = 'overdue' | 'tomorrow' | 'in3days';

/** 1 グループに送る通知（同じグループのメンバー全員に同じ内容を送る） */
export interface GroupNotification {
  title: string;
  body: string;
  /** 'due-YYYY-MM-DD'。端末側で同じ日の通知を置き換えるのに使う */
  tag: string;
}

/**
 * Web Push のペイロード（JSON）。src/sw.ts の push ハンドラと形を合わせること。
 */
export interface PushPayload extends GroupNotification {
  /** 通知をタップしたときに開く URL */
  url: string;
}

export const NOTIFICATION_TITLE = '返却日のお知らせ';
export const UNKNOWN_LOCATION_NAME = '（不明な場所）';
export const NOTIFY_TIME_ZONE = 'Asia/Tokyo';

/**
 * 本文の長さの上限（文字数）。src/sw.ts の MAX_BODY_LENGTH（表示するときに切る長さ）と同じ値にすること。
 * Apple の Web Push は暗号化後 4KB までなので、送る側でも切る（500 文字なら UTF-8 で 1.5KB 程度）。
 */
export const MAX_BODY_LENGTH = 500;
/** 1 つの区分の行に名前を並べる場所の数。残りは「ほか N か所 M冊」にまとめる */
export const MAX_LOCATIONS_PER_LINE = 3;
/** 本文に出す場所の名前の長さの上限（画面で入力できる長さと同じ）。超えた分は「…」 */
export const MAX_LOCATION_NAME_LENGTH = 40;

/** 本文に並べる順番 */
export const DUE_CATEGORY_ORDER: readonly DueCategory[] = ['overdue', 'tomorrow', 'in3days'];

export const DUE_CATEGORY_LABELS: Readonly<Record<DueCategory, string>> = {
  overdue: '延滞中',
  tomorrow: '明日返却',
  in3days: '3日後に返却',
};

/** 場所ごとの冊数 */
export interface LocationCount {
  name: string;
  count: number;
}

export type DueSummary = Record<DueCategory, LocationCount[]>;

const tokyoDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: NOTIFY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 日本時間の今日（'YYYY-MM-DD'）。実行環境のタイムゾーン（GitHub Actions は UTC）に依存しない */
export function tokyoToday(now: Date = new Date()): DateString {
  const parts = tokyoDateFormat.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
}

/** 返却日の区分。対象外（今日・2 日後・4 日後以降・不正な日付）は null */
export function classifyDue(dueOn: string, today: DateString): DueCategory | null {
  const diff = diffDays(today, dueOn);
  if (Number.isNaN(diff)) return null;
  if (diff < 0) return 'overdue';
  if (diff === 1) return 'tomorrow';
  if (diff === 3) return 'in3days';
  return null;
}

function locationName(locationId: string, locationsById: ReadonlyMap<string, NotifyLocation>): string | null {
  const name = locationsById.get(locationId)?.name;
  if (typeof name !== 'string') return null;
  // 改行などは空白 1 つにする（本文の行が崩れないように）
  const trimmed = name.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_LOCATION_NAME_LENGTH ? `${truncateUnits(trimmed, MAX_LOCATION_NAME_LENGTH)}…` : trimmed;
}

/** 場所の並び: 冊数の多い順 → 名前順。不明な場所は最後 */
function compareLocationCount(a: LocationCount, b: LocationCount): number {
  const aUnknown = a.name === UNKNOWN_LOCATION_NAME;
  const bUnknown = b.name === UNKNOWN_LOCATION_NAME;
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  if (a.count !== b.count) return b.count - a.count;
  return a.name.localeCompare(b.name, 'ja');
}

/**
 * 貸出中の本を区分・場所ごとに数える。
 * 返却済み（returnedOn が入っている）の本は数えない。同じ名前の場所は 1 つにまとめる。
 */
export function summarizeDueLoans(
  loans: readonly NotifyLoan[],
  locationsById: ReadonlyMap<string, NotifyLocation>,
  today: DateString,
): DueSummary {
  const counts: Record<DueCategory, Map<string, number>> = {
    overdue: new Map(),
    tomorrow: new Map(),
    in3days: new Map(),
  };
  for (const loan of loans) {
    if (loan.returnedOn != null) continue;
    const category = classifyDue(loan.dueOn, today);
    if (!category) continue;
    const name = locationName(loan.locationId, locationsById) ?? UNKNOWN_LOCATION_NAME;
    const map = counts[category];
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  const toList = (map: Map<string, number>): LocationCount[] =>
    [...map].map(([name, count]) => ({ name, count })).sort(compareLocationCount);
  return {
    overdue: toList(counts.overdue),
    tomorrow: toList(counts.tomorrow),
    in3days: toList(counts.in3days),
  };
}

/**
 * 本文の 1 行。例「明日返却：○○図書館 3冊、△△保育園 1冊」。
 * 場所が MAX_LOCATIONS_PER_LINE を超えるときは、冊数の多い順に先頭だけ並べ、残りを「ほか 2 か所 5冊」にまとめる。
 */
export function formatCategoryLine(category: DueCategory, items: readonly LocationCount[]): string {
  const shown = items.length > MAX_LOCATIONS_PER_LINE ? items.slice(0, MAX_LOCATIONS_PER_LINE) : items;
  const parts = shown.map((item) => `${item.name} ${item.count}冊`);
  const rest = items.slice(shown.length);
  if (rest.length > 0) {
    const restCount = rest.reduce((sum, item) => sum + item.count, 0);
    parts.push(`ほか ${rest.length} か所 ${restCount}冊`);
  }
  return `${DUE_CATEGORY_LABELS[category]}：${parts.join('、')}`;
}

/** text を max 文字（UTF-16 の長さ。sw.ts の slice と同じ数え方）以内にする。サロゲートペアは分けない */
function truncateUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** 本文を max 文字以内にする。できるだけ行の単位で切り、収まらない行は末尾を「…」にする */
export function limitBody(lines: readonly string[], max: number = MAX_BODY_LENGTH): string {
  let body = '';
  for (const line of lines) {
    const next = body === '' ? line : `${body}\n${line}`;
    if (next.length <= max) {
      body = next;
      continue;
    }
    // 入りきらない行は、入る分だけ残して「…」で終える
    return `${truncateUnits(next, max - 1).trimEnd()}…`;
  }
  return body;
}

/** 通知の tag。同じ日の通知は端末側で置き換わる */
export function notificationTag(today: DateString): string {
  return `due-${today}`;
}

/**
 * グループに送る通知を組み立てる。対象の本が 1 冊も無ければ null。
 * 本文は「延滞中 → 明日返却 → 3日後に返却」の順に改行区切り（MAX_BODY_LENGTH 文字まで）。
 */
export function buildGroupNotification(
  loans: readonly NotifyLoan[],
  locationsById: ReadonlyMap<string, NotifyLocation>,
  today: DateString,
): GroupNotification | null {
  const summary = summarizeDueLoans(loans, locationsById, today);
  const lines = DUE_CATEGORY_ORDER.filter((category) => summary[category].length > 0).map((category) =>
    formatCategoryLine(category, summary[category]),
  );
  if (lines.length === 0) return null;
  return {
    title: NOTIFICATION_TITLE,
    body: limitBody(lines),
    tag: notificationTag(today),
  };
}

/** Web Push で送る JSON 文字列 */
export function buildPushPayload(notification: GroupNotification, url: string): string {
  const payload: PushPayload = {
    title: notification.title,
    body: notification.body,
    url,
    tag: notification.tag,
  };
  return JSON.stringify(payload);
}
