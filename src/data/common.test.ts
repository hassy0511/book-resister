// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Timestamp, serverTimestamp } from 'firebase/firestore';
import {
  EMPTY_LIST,
  TEXT_LIMITS,
  chunk,
  cleanCoverUrl,
  cleanStringList,
  clipAuthors,
  clipText,
  compareJa,
  dataErrorMessage,
  isDateString,
  isPermissionDenied,
  isValidDocId,
  lateWriteFailureMessage,
  onLateWriteFailure,
  settleWrite,
  stripUndefined,
  toDataError,
  trimOrNull,
  uniqueSorted,
  useSubscription,
  type Subscriber,
} from './common';

describe('stripUndefined', () => {
  it('undefined のプロパティを除き、null は残す', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: null, d: '' })).toEqual({ a: 1, c: null, d: '' });
    expect('b' in stripUndefined({ a: 1, b: undefined })).toBe(false);
  });

  it('入れ子のオブジェクトと配列も処理する', () => {
    const out = stripUndefined({ book: { title: 't', coverUrl: undefined }, list: [1, undefined, { x: undefined, y: 2 }] });
    expect(out).toEqual({ book: { title: 't' }, list: [1, { y: 2 }] });
  });

  it('Timestamp や FieldValue はそのまま残す', () => {
    const ts = Timestamp.fromMillis(0);
    const fv = serverTimestamp();
    const out = stripUndefined({ ts, fv });
    expect(out.ts).toBe(ts);
    expect(out.fv).toBe(fv);
  });

  it('元のオブジェクトは変更しない', () => {
    const input = { a: undefined, b: 1 };
    stripUndefined(input);
    expect('a' in input).toBe(true);
  });
});

describe('chunk', () => {
  it('指定件数ずつに分割する', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 30)).toEqual([]);
    const ids = Array.from({ length: 61 }, (_, i) => `id${i}`);
    expect(chunk(ids, 30).map((c) => c.length)).toEqual([30, 30, 1]);
  });

  it('size が 0 以下なら例外', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('uniqueSorted', () => {
  it('重複を除いて並べる', () => {
    expect(uniqueSorted(['b', 'a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('trimOrNull / cleanStringList', () => {
  it('前後空白を除き、空なら null', () => {
    expect(trimOrNull('  abc ')).toBe('abc');
    expect(trimOrNull('   ')).toBeNull();
    expect(trimOrNull(null)).toBeNull();
    expect(trimOrNull(undefined)).toBeNull();
  });

  it('文字列配列から空と重複を除く', () => {
    expect(cleanStringList([' 作者A ', '', '作者B', '作者A', null, undefined])).toEqual(['作者A', '作者B']);
    expect(cleanStringList(undefined)).toEqual([]);
  });
});

describe('isDateString', () => {
  it('YYYY-MM-DD の実在する日付だけ true', () => {
    expect(isDateString('2026-11-08')).toBe(true);
    expect(isDateString('2024-02-29')).toBe(true);
    expect(isDateString('2025-02-29')).toBe(false);
    expect(isDateString('2026-13-01')).toBe(false);
    expect(isDateString('2026/11/08')).toBe(false);
    expect(isDateString('2026-1-8')).toBe(false);
    expect(isDateString(null)).toBe(false);
  });
});

describe('isValidDocId', () => {
  it('ドキュメント ID に使えない値を弾く', () => {
    expect(isValidDocId('isbn-9784591000000')).toBe(true);
    expect(isValidDocId('AbC123')).toBe(true);
    expect(isValidDocId('')).toBe(false);
    expect(isValidDocId(undefined)).toBe(false);
    expect(isValidDocId('a/b')).toBe(false);
    expect(isValidDocId('..')).toBe(false);
    expect(isValidDocId('__id__')).toBe(false);
  });
});

describe('compareJa', () => {
  it('日本語と数字を自然な順に並べる', () => {
    expect(['第10巻', '第2巻', '第1巻'].sort(compareJa)).toEqual(['第1巻', '第2巻', '第10巻']);
    expect(['さくら', 'あおぞら', 'かがみ'].sort(compareJa)).toEqual(['あおぞら', 'かがみ', 'さくら']);
  });
});

describe('エラー変換', () => {
  it('Firestore のエラーコードを日本語にする', () => {
    expect(isPermissionDenied({ code: 'permission-denied' })).toBe(true);
    expect(isPermissionDenied(new Error('x'))).toBe(false);
    expect(dataErrorMessage({ code: 'permission-denied' })).toContain('権限');
    expect(dataErrorMessage({ code: 'unavailable' })).toContain('通信');
    expect(dataErrorMessage({ code: 'resource-exhausted' })).toContain('17 時');
    expect(dataErrorMessage({ code: 'something-else' })).toBe('エラーが発生しました。もう一度お試しください。');
  });

  it('自前の日本語エラーはそのまま使う', () => {
    const own = new Error('タイトルを入力してください');
    expect(dataErrorMessage(own)).toBe('タイトルを入力してください');
    expect(toDataError(own)).toBe(own);
  });

  it('toDataError は code と元のエラーを残す', () => {
    const original = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    const err = toDataError(original);
    expect(err.message).toContain('権限');
    expect(err.cause).toBe(original);
    expect(isPermissionDenied(err)).toBe(true);
  });
});

describe('settleWrite', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('書き込みが完了したら confirmed で解決する', async () => {
    await expect(settleWrite(Promise.resolve())).resolves.toBe('confirmed');
  });

  it('すぐに失敗した書き込みは日本語のエラーで失敗する', async () => {
    const write = Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(settleWrite(write)).rejects.toThrow('権限');
  });

  it('ignoreError に当たるエラーは失敗にしない', async () => {
    const write = Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(settleWrite(write, { ignoreError: isPermissionDenied })).resolves.toBe('confirmed');
  });

  it('応答が無いままなら一定時間で local として解決し、その後しばらくは長く待たない', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let outcome: string | null = null;
    const p = settleWrite(new Promise<void>(() => undefined)).then((o) => {
      outcome = o;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(outcome).toBe('local');

    // 直後の書き込みは長くは待たずに local で解決する
    const pending = settleWrite(new Promise<void>(() => undefined));
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe('local');
  });

  it('待たない期間でも、すぐ返る拒否は日本語のエラーで投げ、待たない期間を終える', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const slow = settleWrite(new Promise<void>(() => undefined));
    await vi.advanceTimersByTimeAsync(5000);
    await expect(slow).resolves.toBe('local');

    const denied = settleWrite(Promise.reject(Object.assign(new Error('x'), { code: 'permission-denied' })));
    const assertion = expect(denied).rejects.toThrow('権限');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;

    // 拒否が返った（サーバーに届いている）ので、次の書き込みはまた 4 秒まで待つ
    let outcome: string | null = null;
    const next = settleWrite(new Promise<void>(() => undefined)).then((o) => {
      outcome = o;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(4000);
    await next;
    expect(outcome).toBe('local');
  });

  it('完了扱いにした後でサーバーに拒否されたら、登録した関数に知らせる', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const off = onLateWriteFailure(listener);
    let rejectLater: (e: unknown) => void = () => undefined;
    const write = new Promise<void>((_, reject) => {
      rejectLater = reject;
    });
    const p = settleWrite(write);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe('local');
    expect(listener).not.toHaveBeenCalled();

    rejectLater(Object.assign(new Error('gone'), { code: 'not-found' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(1);
    const error = listener.mock.calls[0][0] as Error;
    expect(error.message).toContain('見つかりません');
    expect(lateWriteFailureMessage(error)).toContain('保存できなかった変更があります');

    // ignoreError に当たる失敗と、解除した後は知らせない
    let rejectIgnored: (e: unknown) => void = () => undefined;
    const ignoredWrite = settleWrite(
      new Promise<void>((_, reject) => {
        rejectIgnored = reject;
      }),
      { ignoreError: isPermissionDenied },
    );
    await vi.advanceTimersByTimeAsync(5000);
    await ignoredWrite;
    rejectIgnored(Object.assign(new Error('x'), { code: 'permission-denied' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    let rejectAfterOff: (e: unknown) => void = () => undefined;
    const afterOff = settleWrite(
      new Promise<void>((_, reject) => {
        rejectAfterOff = reject;
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    await afterOff;
    rejectAfterOff(new Error('later'));
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('オフラインなら長くは待たずに local で解決し、すぐ返る拒否は投げる', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const p = settleWrite(new Promise<void>(() => undefined));
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe('local');
    const denied = settleWrite(Promise.reject(Object.assign(new Error('x'), { code: 'permission-denied' })));
    const assertion = expect(denied).rejects.toThrow('権限');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});

/** テスト用の購読関数。呼び出しごとに next / fail を記録する */
function fakeSubscriber<T>() {
  const calls: { next: (data: T) => void; fail: (e: unknown) => void; unsubscribed: boolean }[] = [];
  const subscribe: Subscriber<T> = (next, fail) => {
    const call = { next, fail, unsubscribed: false };
    calls.push(call);
    return () => {
      call.unsubscribed = true;
    };
  };
  return { calls, subscribe };
}

describe('useSubscription', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('key が null なら購読せず loading=false', () => {
    const { calls, subscribe } = fakeSubscriber<string[]>();
    const { result } = renderHook(() => useSubscription<string[]>(null, subscribe, EMPTY_LIST));
    expect(calls).toHaveLength(0);
    expect(result.current).toEqual({ data: [], loading: false, error: null });
  });

  it('最初のデータが届くまで loading、届いたら data を返す', () => {
    const { calls, subscribe } = fakeSubscriber<string[]>();
    const { result } = renderHook(() => useSubscription<string[]>('k1', subscribe, EMPTY_LIST));
    expect(result.current.loading).toBe(true);
    act(() => calls[0].next(['a']));
    expect(result.current).toEqual({ data: ['a'], loading: false, error: null });
  });

  it('key が変わったら購読し直し、アンマウントで解除する', () => {
    const { calls, subscribe } = fakeSubscriber<string[]>();
    const { result, rerender, unmount } = renderHook(
      ({ k }: { k: string }) => useSubscription<string[]>(k, subscribe, EMPTY_LIST),
      { initialProps: { k: 'k1' } },
    );
    act(() => calls[0].next(['a']));
    rerender({ k: 'k2' });
    expect(calls[0].unsubscribed).toBe(true);
    expect(calls).toHaveLength(2);
    // 新しい key のデータが届くまでは前の key のデータを出さない
    expect(result.current).toEqual({ data: [], loading: true, error: null });
    // 解除済みの購読から届いた値は無視する
    act(() => calls[0].next(['old']));
    expect(result.current.loading).toBe(true);
    act(() => calls[1].next(['b']));
    expect(result.current.data).toEqual(['b']);
    unmount();
    expect(calls[1].unsubscribed).toBe(true);
  });

  it('permission-denied は少し待って購読し直す', async () => {
    vi.useFakeTimers();
    const { calls, subscribe } = fakeSubscriber<string[]>();
    const { result } = renderHook(() => useSubscription<string[]>('k1', subscribe, EMPTY_LIST));
    act(() => calls[0].fail({ code: 'permission-denied' }));
    expect(calls[0].unsubscribed).toBe(true);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(calls).toHaveLength(2);
    act(() => calls[1].next(['ok']));
    expect(result.current).toEqual({ data: ['ok'], loading: false, error: null });
  });

  it('再試行しても拒否され続けたら日本語のエラーを返す', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { calls, subscribe } = fakeSubscriber<string[]>();
    const { result } = renderHook(() => useSubscription<string[]>('k1', subscribe, EMPTY_LIST));
    for (let i = 0; i < 5; i++) {
      act(() => calls[i].fail({ code: 'permission-denied' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }
    expect(calls).toHaveLength(5);
    expect(result.current.loading).toBe(false);
    expect(result.current.error?.message).toContain('権限');
    errorSpy.mockRestore();
  });

  it('その他のエラーは再試行せず、それまでのデータを残す', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { calls, subscribe } = fakeSubscriber<string[]>();
    const { result } = renderHook(() => useSubscription<string[]>('k1', subscribe, EMPTY_LIST));
    act(() => calls[0].next(['a']));
    act(() => calls[0].fail({ code: 'failed-precondition' }));
    // 2 回目の fail は無視される
    act(() => calls[0].fail({ code: 'permission-denied' }));
    expect(calls).toHaveLength(1);
    expect(result.current.data).toEqual(['a']);
    expect(result.current.error).toBeInstanceOf(Error);
    errorSpy.mockRestore();
  });
});

describe('clipText / clipAuthors / cleanCoverUrl（firestore.rules の上限に合わせる）', () => {
  it('clipText は上限以内ならそのまま、超えたら切り詰める。サロゲートペアを分断しない', () => {
    expect(clipText('あいう', 3)).toBe('あいう');
    expect(clipText('あいうえ', 3)).toBe('あいう');
    expect(clipText('ab😀', 3)).toBe('ab');
  });

  it('clipAuthors は 1 人 200 文字・50 人・合計 2000 文字に収める', () => {
    const many = Array.from({ length: 60 }, (_, i) => `著者${i}`);
    expect(clipAuthors(many)).toHaveLength(TEXT_LIMITS.authorsCount);
    expect(clipAuthors(['あ'.repeat(250)])[0]).toHaveLength(TEXT_LIMITS.author);
    const long = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(150, 'x'));
    expect(clipAuthors(long).join('\n').length).toBeLessThanOrEqual(TEXT_LIMITS.authorsTotal);
  });

  it('cleanCoverUrl は http(s) の URL だけを残す', () => {
    expect(cleanCoverUrl(' https://example.com/a.jpg ')).toBe('https://example.com/a.jpg');
    expect(cleanCoverUrl('http://example.com/a.jpg')).toBe('http://example.com/a.jpg');
    expect(cleanCoverUrl('javascript:alert(1)')).toBeNull();
    expect(cleanCoverUrl('example.com/a.jpg')).toBeNull();
    expect(cleanCoverUrl('')).toBeNull();
    expect(cleanCoverUrl(null)).toBeNull();
    expect(cleanCoverUrl(`https://e.com/${'a'.repeat(2100)}`)).toBeNull();
  });
});
