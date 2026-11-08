import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, fetchText, LOOKUP_TIMEOUT_MS } from './http';

/** signal が中断されるまで応答しない fetch */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchJson / fetchText', () => {
  it('成功時は本文を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"a":1}', { status: 200 })));
    await expect(fetchJson('https://example.com')).resolves.toEqual({ a: 1 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<rss/>', { status: 200 })));
    await expect(fetchText('https://example.com')).resolves.toBe('<rss/>');
  });

  it('HTTP エラー・例外・壊れた JSON は null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
    await expect(fetchJson('https://example.com')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchText('https://example.com')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(fetchJson('https://example.com')).resolves.toBeNull();
  });

  it('8 秒でタイムアウトして null', async () => {
    expect(LOOKUP_TIMEOUT_MS).toBe(8000);
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;
    const p = fetchJson('https://example.com').then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBeNull();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('timeoutMs を指定できる', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const p = fetchText('https://example.com', { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBeNull();
  });

  it('呼び出し側の signal で中断すると null', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    const p = fetchJson('https://example.com', { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).resolves.toBeNull();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('すでに中断済みの signal なら通信しない', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(fetchJson('https://example.com', { signal: ctrl.signal })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('完了後はタイマーと signal のリスナーを片付ける', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const ctrl = new AbortController();
    const remove = vi.spyOn(ctrl.signal, 'removeEventListener');
    await fetchJson('https://example.com', { signal: ctrl.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
