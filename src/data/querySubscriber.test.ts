// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Query, QuerySnapshot } from 'firebase/firestore';

// onSnapshot だけ差し替え、届くスナップショットをテストから流す
const listeners: ((snap: QuerySnapshot) => void)[] = [];
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    onSnapshot: (_q: unknown, ...args: unknown[]) => {
      const onNext = args.find((a) => typeof a === 'function') as (snap: QuerySnapshot) => void;
      listeners.push(onNext);
      return () => undefined;
    },
  };
});

const { querySubscriber } = await import('./common');

function snap(ids: string[], fromCache: boolean): QuerySnapshot {
  return {
    metadata: { fromCache, hasPendingWrites: false },
    docs: ids.map((id) => ({ id, data: () => ({ title: id }) })),
  } as unknown as QuerySnapshot;
}

afterEach(() => {
  listeners.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('querySubscriber（preferServerMs）', () => {
  it('オンラインならキャッシュの結果は返さず、サーバーの結果を待つ', () => {
    vi.useFakeTimers();
    const next = vi.fn();
    querySubscriber({} as Query, { preferServerMs: 3000 })(next, vi.fn());
    listeners[0](snap(['a'], true));
    vi.advanceTimersByTime(1000);
    expect(next).not.toHaveBeenCalled();
    listeners[0](snap(['a', 'b', 'c'], false));
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].map((d: { id: string }) => d.id)).toEqual(['a', 'b', 'c']);
    // その後はキャッシュからの変更もそのまま返す
    listeners[0](snap(['a', 'b'], true));
    expect(next).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('サーバーの結果が来ないまま時間が過ぎたら、キャッシュの結果を返す', () => {
    vi.useFakeTimers();
    const next = vi.fn();
    querySubscriber({} as Query, { preferServerMs: 3000 })(next, vi.fn());
    listeners[0](snap(['a'], true));
    listeners[0](snap(['a', 'b'], true));
    vi.advanceTimersByTime(3000);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].map((d: { id: string }) => d.id)).toEqual(['a', 'b']);
  });

  it('オフラインならキャッシュの結果をすぐ返す。指定しなければ従来どおりすぐ返す', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const next = vi.fn();
    querySubscriber({} as Query, { preferServerMs: 3000 })(next, vi.fn());
    listeners[0](snap(['a'], true));
    expect(next).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
    const plain = vi.fn();
    querySubscriber({} as Query)(plain, vi.fn());
    listeners[1](snap(['x'], true));
    expect(plain).toHaveBeenCalledTimes(1);
  });
});
