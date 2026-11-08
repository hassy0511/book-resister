/**
 * 書誌 API 呼び出し用の fetch。タイムアウト（既定 8 秒）と呼び出し側の signal に対応し、
 * 失敗（ネットワーク・CORS・HTTP エラー・タイムアウト・中断）しても例外を出さない。
 * - fetchJsonResult / fetchTextResult: 成功か、失敗の理由（FetchResult）を返す
 * - fetchJson / fetchText: 失敗時は null（理由が要らない呼び出し用）
 */

export const LOOKUP_TIMEOUT_MS = 8000;

export type FetchOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * 失敗の理由。
 *   - 'aborted': 呼び出し側の signal で中断した（失敗として扱わない）
 *   - 'timeout': タイムアウト
 *   - 'network': 通信できない（オフライン・CORS・接続の切断など）
 *   - 'http': HTTP エラー（429・5xx など。status に入れる）
 *   - 'invalid': 応答を読めない（壊れた JSON など）
 */
export type FetchFailureReason = 'aborted' | 'timeout' | 'network' | 'http' | 'invalid';

export type FetchResult<T> = { ok: true; data: T } | { ok: false; reason: FetchFailureReason; status?: number };

/**
 * API 1 回分の結果。failed は「通信に失敗して、該当なしかどうか確かめられなかった」こと
 * （呼び出し側の signal による中断は failed にしない）。
 */
export type SourceResult<T> = { value: T; failed: boolean };

/** FetchResult の失敗を、SourceResult の failed（呼び出し側の中断は除く）にする */
export function isLookupFailure(result: FetchResult<unknown>): boolean {
  return !result.ok && result.reason !== 'aborted';
}

/** 本文の読み込みまで含めてタイムアウトを効かせる */
async function fetchBody<T>(
  url: string,
  read: (res: Response) => Promise<T>,
  { signal, timeoutMs = LOOKUP_TIMEOUT_MS }: FetchOptions,
): Promise<FetchResult<T>> {
  if (signal?.aborted) return { ok: false, reason: 'aborted' };
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const interrupted = (): FetchFailureReason | null => {
    if (signal?.aborted) return 'aborted';
    if (timedOut) return 'timeout';
    return null;
  };
  try {
    let res: Response;
    try {
      res = await globalThis.fetch(url, { signal: ctrl.signal });
    } catch {
      return { ok: false, reason: interrupted() ?? 'network' };
    }
    if (!res.ok) return { ok: false, reason: 'http', status: res.status };
    try {
      return { ok: true, data: await read(res) };
    } catch (e) {
      return { ok: false, reason: interrupted() ?? (e instanceof SyntaxError ? 'invalid' : 'network') };
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** JSON を取得する（失敗の理由付き） */
export function fetchJsonResult(url: string, opts: FetchOptions = {}): Promise<FetchResult<unknown>> {
  return fetchBody<unknown>(url, (res) => res.json() as Promise<unknown>, opts);
}

/** テキスト（XML など）を取得する（失敗の理由付き） */
export function fetchTextResult(url: string, opts: FetchOptions = {}): Promise<FetchResult<string>> {
  return fetchBody(url, (res) => res.text(), opts);
}

/** JSON を取得する。失敗時は null */
export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const r = await fetchJsonResult(url, opts);
  return r.ok ? r.data : null;
}

/** テキスト（XML など）を取得する。失敗時は null */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const r = await fetchTextResult(url, opts);
  return r.ok ? r.data : null;
}
