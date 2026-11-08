/**
 * 書誌 API 呼び出し用の fetch。タイムアウト（既定 8 秒）と呼び出し側の signal に対応し、
 * 失敗（ネットワーク・CORS・HTTP エラー・タイムアウト・中断）しても例外を出さず null を返す。
 */

export const LOOKUP_TIMEOUT_MS = 8000;

export type FetchOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** 本文の読み込みまで含めてタイムアウトを効かせる */
async function fetchBody<T>(
  url: string,
  read: (res: Response) => Promise<T>,
  { signal, timeoutMs = LOOKUP_TIMEOUT_MS }: FetchOptions,
): Promise<T | null> {
  if (signal?.aborted) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await globalThis.fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await read(res);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** JSON を取得する。失敗時は null */
export function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  return fetchBody<unknown>(url, (res) => res.json() as Promise<unknown>, opts);
}

/** テキスト（XML など）を取得する。失敗時は null */
export function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  return fetchBody(url, (res) => res.text(), opts);
}
