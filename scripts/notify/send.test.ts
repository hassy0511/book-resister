import { describe, expect, it, vi } from 'vitest';
import { Agent } from 'node:https';
import { WebPushError, type RequestOptions } from 'web-push';
import type { StoredSubscription } from './firestore';
import { mapWithConcurrency, sendPush } from './send';

const SUB: StoredSubscription = {
  id: 'abcdef0123456789',
  uid: 'u1',
  endpoint: 'https://web.push.apple.com/abc',
  keys: { p256dh: 'P', auth: 'A' },
  createdAtMillis: 0,
};

describe('sendPush', () => {
  it('成功', async () => {
    const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
    await expect(sendPush(SUB, '{}', { send })).resolves.toEqual({ kind: 'sent', statusCode: 201 });
    const options = (send.mock.calls[0] as unknown[])[2] as RequestOptions;
    // 締め切りで接続を切れるよう、送信ごとの Agent を渡す
    expect(options.agent).toBeInstanceOf(Agent);
  });

  it('404/410 は gone、413 は内容が大きすぎると分かるメッセージ', async () => {
    const gone = vi.fn(async () => {
      throw new WebPushError('x', 410, {}, '', SUB.endpoint);
    });
    await expect(sendPush(SUB, '{}', { send: gone })).resolves.toEqual({ kind: 'gone', statusCode: 410 });
    const tooLarge = vi.fn(async () => {
      throw new WebPushError('x', 413, {}, 'Payload Too Large', SUB.endpoint);
    });
    const outcome = await sendPush(SUB, '{}', { send: tooLarge });
    expect(outcome).toMatchObject({ kind: 'failed', statusCode: 413 });
    expect(outcome.kind === 'failed' && outcome.message).toMatch(/HTTP 413（通知の内容が大きすぎます）/);
  });

  it('応答が終わらない相手は締め切りで打ち切り、接続を切る', async () => {
    let destroy: ReturnType<typeof vi.spyOn> | undefined;
    const send = vi.fn(
      (_sub: unknown, _payload: string, options: RequestOptions) =>
        new Promise<never>(() => {
          destroy = vi.spyOn(options.agent as Agent, 'destroy');
        }),
    );
    const started = Date.now();
    const outcome = await sendPush(SUB, '{}', { send, deadlineMs: 50 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(outcome).toMatchObject({ kind: 'failed', statusCode: null });
    expect(outcome.kind === 'failed' && outcome.message).toMatch(/打ち切りました/);
    expect(destroy).toHaveBeenCalled();
  });

  it('プロキシ経由のときは Agent を渡さない', async () => {
    const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
    await sendPush(SUB, '{}', { send, proxy: 'http://proxy.local:8080' });
    const options = (send.mock.calls[0] as unknown[])[2] as RequestOptions;
    expect(options.agent).toBeUndefined();
    expect(options.proxy).toBe('http://proxy.local:8080');
  });
});

describe('mapWithConcurrency', () => {
  it('同時に limit 件までしか動かさず、結果は元の順番', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30, 0, 60]);
    expect(peak).toBe(3);
  });

  it('空の配列', async () => {
    await expect(mapWithConcurrency([], 5, async () => 1)).resolves.toEqual([]);
  });
});
