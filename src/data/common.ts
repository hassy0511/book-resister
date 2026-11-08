/**
 * data/* 共通の部品: 購読フック、スナップショット変換、書き込み前の整形、エラー文言。
 * このファイルは Firebase の初期化（../firebase）に依存しない（テストしやすくするため）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import type { DateString, WithId } from '../types';

/** フックの戻り値 */
export interface QueryResult<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** 購読関数。next / fail を受け取り、解除関数を返す */
export type Subscriber<T> = (next: (data: T) => void, fail: (error: unknown) => void) => Unsubscribe;

/** 何も購読しない購読関数（key が null のときの穴埋め用） */
export const noopSubscriber: Subscriber<never> = () => () => undefined;

/** 空配列（参照を安定させるための共有定数。変更しないこと） */
export const EMPTY_LIST: never[] = Object.freeze([]) as never[];

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

function errorCode(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function isPermissionDenied(e: unknown): boolean {
  return errorCode(e) === 'permission-denied';
}

/** Firestore のエラーを日本語の説明に変換する */
export function dataErrorMessage(e: unknown): string {
  switch (errorCode(e)) {
    case 'permission-denied':
      return 'データを読み書きする権限がありません。グループに参加しているか確認してください。';
    case 'unauthenticated':
      return 'ログインの有効期限が切れました。もう一度ログインしてください。';
    case 'unavailable':
    case 'deadline-exceeded':
      return '通信できませんでした。電波の良い場所でもう一度お試しください。';
    case 'not-found':
      return 'データが見つかりませんでした。削除された可能性があります。';
    case 'resource-exhausted':
      return '利用量の上限に達しました。しばらく時間をおいてお試しください。';
    case 'failed-precondition':
      return 'データの状態が変わったため処理できませんでした。画面を開き直してください。';
    case 'invalid-argument':
      return '入力内容に誤りがあります。';
    case 'cancelled':
    case 'aborted':
      return '処理が中断されました。もう一度お試しください。';
    default:
      break;
  }
  // 自前で投げた日本語のエラーはそのまま使う
  if (e instanceof Error && e.message && errorCode(e) === null) return e.message;
  return 'エラーが発生しました。もう一度お試しください。';
}

/** 画面に出せる日本語メッセージの Error に変換する（元のエラーは cause に入れる） */
export function toDataError(e: unknown): Error {
  if (e instanceof Error && errorCode(e) === null) return e;
  const err = new Error(dataErrorMessage(e), { cause: e });
  const code = errorCode(e);
  if (code) Object.assign(err, { code });
  return err;
}

// ---------------------------------------------------------------------------
// 購読フック
// ---------------------------------------------------------------------------

/**
 * permission-denied の再試行間隔（ミリ秒）。
 * グループ作成・参加の直後は、メンバー登録がサーバーに反映される前に読み取りが届いて
 * 拒否されることがあるため、数回だけ購読をやり直す。
 */
const PERMISSION_RETRY_DELAYS = [500, 1500, 3000, 6000];

interface SubscriptionState<T> {
  key: string;
  data: T;
  error: Error | null;
}

/**
 * 購読フック。key が変わったら購読し直し、アンマウント時に解除する。
 * key が null のときは購読せず { data: empty, loading: false } を返す。
 * empty は参照が安定した値（EMPTY_LIST や null）を渡すこと。
 */
export function useSubscription<T>(key: string | null, subscribe: Subscriber<T>, empty: T): QueryResult<T> {
  const [state, setState] = useState<SubscriptionState<T> | null>(null);
  const subscribeRef = useRef(subscribe);
  const emptyRef = useRef(empty);

  // 最新の購読関数を保持する（下の購読エフェクトより先に実行される）
  useEffect(() => {
    subscribeRef.current = subscribe;
    emptyRef.current = empty;
  });

  useEffect(() => {
    if (key === null) return undefined;
    let active = true;
    let unsubscribe: Unsubscribe | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const start = () => {
      // 複数のリスナーをまとめた購読では fail が何度も呼ばれうるので、1 回目だけ扱う
      let failed = false;
      const unsub = subscribeRef.current(
        (data) => {
          if (!active || failed) return;
          setState({ key, data, error: null });
        },
        (error) => {
          if (!active || failed) return;
          failed = true;
          unsubscribe?.();
          unsubscribe = null;
          if (isPermissionDenied(error) && attempt < PERMISSION_RETRY_DELAYS.length) {
            const delay = PERMISSION_RETRY_DELAYS[attempt];
            attempt += 1;
            timer = setTimeout(() => {
              if (active) start();
            }, delay);
            return;
          }
          console.error(`[data] 購読エラー (${key})`, error);
          setState((prev) => ({
            key,
            data: prev && prev.key === key ? prev.data : emptyRef.current,
            error: toDataError(error),
          }));
        },
      );
      if (failed || !active) unsub();
      else unsubscribe = unsub;
    };

    start();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      unsubscribe = null;
    };
  }, [key]);

  return useMemo<QueryResult<T>>(() => {
    if (key === null) return { data: empty, loading: false, error: null };
    if (!state || state.key !== key) return { data: empty, loading: true, error: null };
    return { data: state.data, loading: false, error: state.error };
  }, [key, state, empty]);
}

/** ドキュメントを ID 付きのオブジェクトに変換する（保留中の serverTimestamp は推定値にする） */
export function docWithId<T>(snap: DocumentSnapshot): WithId<T> {
  const data = snap.data({ serverTimestamps: 'estimate' }) as T;
  return { ...data, id: snap.id };
}

/** クエリを購読して ID 付きの配列を返す購読関数 */
export function querySubscriber<T>(q: Query): Subscriber<WithId<T>[]> {
  return (next, fail) =>
    onSnapshot(
      q,
      (snap) => next(snap.docs.map((d) => docWithId<T>(d))),
      fail,
    );
}

/**
 * ドキュメントを購読する購読関数。存在しなければ null。
 * キャッシュに無いだけ（オフライン・初回）の「存在しない」はサーバーの応答を待つ。
 */
export function docSubscriber<T>(ref: DocumentReference): Subscriber<WithId<T> | null> {
  return (next, fail) =>
    onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) {
          // キャッシュに無いだけなら待つ（この端末で削除した直後は待たない）
          if (snap.metadata.fromCache && !snap.metadata.hasPendingWrites) return;
          next(null);
          return;
        }
        next(docWithId<T>(snap));
      },
      fail,
    );
}

/**
 * URL などから受け取った ID がドキュメント ID として使えるか。
 * 使えない ID で doc() を呼ぶと描画中に例外になるため、フックの前で確認する。
 */
export function isValidDocId(id: string | null | undefined): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 1500 &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id)
  );
}

// ---------------------------------------------------------------------------
// 書き込みの補助
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/**
 * undefined のプロパティを取り除く（Firestore は undefined を受け付けない）。
 * 素のオブジェクトと配列は再帰的に処理する。Timestamp や FieldValue などはそのまま。
 */
export function stripUndefined<T extends object>(value: T): Defined<T> {
  return stripValue(value) as Defined<T>;
}

function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map(stripValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripValue(v);
    }
    return out;
  }
  return value;
}

/** 配列を size 件ずつに分割する */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('size は 1 以上にしてください');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 重複を除いて並べた配列（購読キーを安定させるため） */
export function uniqueSorted(items: readonly string[]): string[] {
  return Array.from(new Set(items)).sort();
}

/** 1 回の書き込みバッチに入れる操作数の上限（Firestore の上限 500 に余裕を持たせる） */
export const BATCH_LIMIT = 450;

/** 文字列の前後空白を除く。空なら null */
export function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * firestore.rules の文字数の上限（ルールと同じ値にすること）。
 * 書誌 API から来た値は切り詰め、利用者の入力は日本語のエラーにする。
 */
export const TEXT_LIMITS = {
  bookTitle: 300,
  publisher: 200,
  author: 200,
  authorsCount: 50,
  authorsTotal: 2000,
  url: 2048,
  seriesName: 200,
  locationName: 100,
  locationMemo: 1000,
  review: 2000,
} as const;

/** max 文字に切り詰める（サロゲートペアを途中で切らない） */
export function clipText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return value.slice(0, end).trimEnd();
}

/** 著者名の配列をルールの上限（件数・1 件の長さ・合計の長さ）に収める */
export function clipAuthors(authors: readonly string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const a of authors) {
    if (out.length >= TEXT_LIMITS.authorsCount) break;
    const v = clipText(a, TEXT_LIMITS.author);
    if (!v || out.includes(v)) continue;
    // ルールは join('\n') の長さで判定する
    const add = v.length + (out.length > 0 ? 1 : 0);
    if (total + add > TEXT_LIMITS.authorsTotal) break;
    out.push(v);
    total += add;
  }
  return out;
}

/** 表紙画像の URL（http/https のみ）。使えない値は null */
export function cleanCoverUrl(value: string | null | undefined): string | null {
  const t = trimOrNull(value);
  if (t === null) return null;
  return /^https?:\/\/\S+$/.test(t) && t.length <= TEXT_LIMITS.url ? t : null;
}

/** 著者名などの文字列配列を整える（前後空白を除き、空と重複を取り除く） */
export function cleanStringList(values: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const v of values) {
    const t = trimOrNull(v);
    if (t !== null && !out.includes(t)) out.push(t);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' 形式で、実在する日付か */
export function isDateString(value: unknown): value is DateString {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 日本語の照合順（名前順の並べ替え用） */
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
export function compareJa(a: string, b: string): number {
  return collator.compare(a, b);
}

// ---------------------------------------------------------------------------
// 書き込みの完了待ち
// ---------------------------------------------------------------------------

/** サーバーの応答を待つ最大時間。これを過ぎたら端末に保存済みとして先へ進む */
const WRITE_WAIT_MS = 4000;
/** 応答待ちがタイムアウトした後、この時間は待たずに進む（電波が弱い場所で何度も待たせない） */
const SLOW_NETWORK_COOLDOWN_MS = 30_000;
let skipWaitUntil = 0;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * 書き込みの完了を待つ。Firestore は書き込みを端末に保存してから送信するため、
 * オフラインや電波が弱いときはサーバーの応答を待たずに完了扱いにする（後で自動送信される）。
 * 応答が早く返ってきた場合はエラー（権限など）をそのまま投げる。
 */
export async function settleWrite(write: Promise<unknown>): Promise<void> {
  const tracked = write.then(
    () => {
      skipWaitUntil = 0;
    },
    (e: unknown) => {
      throw toDataError(e);
    },
  );
  if (isOffline() || Date.now() < skipWaitUntil) {
    tracked.catch((e: unknown) => console.error('[data] 保存に失敗しました', e));
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), WRITE_WAIT_MS);
  });
  try {
    const result = await Promise.race([tracked.then(() => 'done' as const), timeout]);
    if (result === 'timeout') {
      skipWaitUntil = Date.now() + SLOW_NETWORK_COOLDOWN_MS;
      tracked.catch((e: unknown) => console.error('[data] 保存に失敗しました', e));
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
