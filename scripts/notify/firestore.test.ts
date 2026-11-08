import { describe, expect, it } from 'vitest';
import { readSubscription, toNotifyLoan, toNotifyLocation, toStoredSubscription } from './firestore';
import { isGoneStatus } from './send';

const P256DH = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const AUTH = '5_uHGMO9sKvEahQK3OF5Bw';

describe('toNotifyLoan', () => {
  it('必要な項目だけを取り出す', () => {
    expect(toNotifyLoan({ dueOn: '2026-11-09', locationId: 'lib', returnedOn: null, book: { title: 'x' } })).toEqual({
      dueOn: '2026-11-09',
      locationId: 'lib',
      returnedOn: null,
    });
  });

  it('形式が違えば null', () => {
    expect(toNotifyLoan({ locationId: 'lib', returnedOn: null })).toBeNull();
    expect(toNotifyLoan({ dueOn: 20261109, locationId: 'lib', returnedOn: null })).toBeNull();
    expect(toNotifyLoan({ dueOn: '2026-11-09', locationId: 'lib', returnedOn: 1 })).toBeNull();
  });
});

describe('toNotifyLocation', () => {
  it('名前があれば取り出す', () => {
    expect(toNotifyLocation({ name: '中央図書館', archived: true })).toEqual({ name: '中央図書館' });
    expect(toNotifyLocation({})).toBeNull();
  });
});

describe('toStoredSubscription', () => {
  const valid = {
    uid: 'u1',
    endpoint: 'https://web.push.apple.com/abc',
    keys: { p256dh: P256DH, auth: AUTH },
    userAgent: 'iPhone',
    createdAt: { toMillis: () => 1_700_000_000_000 },
  };

  it('送信に必要な項目を取り出す', () => {
    expect(toStoredSubscription('hash', valid)).toEqual({
      id: 'hash',
      uid: 'u1',
      endpoint: 'https://web.push.apple.com/abc',
      keys: { p256dh: P256DH, auth: AUTH },
      createdAtMillis: 1_700_000_000_000,
    });
    expect(toStoredSubscription('hash', { ...valid, createdAt: null })?.createdAtMillis).toBe(0);
  });

  it('endpoint が https でない・鍵が欠けていれば null', () => {
    expect(toStoredSubscription('h', { ...valid, endpoint: 'http://example.com' })).toBeNull();
    expect(toStoredSubscription('h', { ...valid, keys: { p256dh: P256DH } })).toBeNull();
    expect(toStoredSubscription('h', { ...valid, keys: { p256dh: '', auth: AUTH } })).toBeNull();
    expect(toStoredSubscription('h', { ...valid, uid: undefined })).toBeNull();
  });
});

describe('readSubscription', () => {
  const valid = {
    uid: 'u1',
    endpoint: 'https://web.push.apple.com/abc',
    keys: { p256dh: P256DH, auth: AUTH },
  };

  it('対応していないプッシュサービスの endpoint は送らない（第三者のサーバーへ送らない）', () => {
    for (const endpoint of [
      'https://attacker.example/x',
      'https://victim.example/api/anything?a=1',
      'https://127.0.0.1:1/x',
    ]) {
      expect(readSubscription('h', { ...valid, endpoint })).toEqual({ ok: false, problem: 'endpoint' });
    }
  });

  it('鍵の形式が違えば送らない（送ると暗号化で失敗し、毎朝ジョブが失敗する）', () => {
    expect(readSubscription('h', { ...valid, keys: { p256dh: 'BPx', auth: AUTH } })).toEqual({
      ok: false,
      problem: 'keys',
    });
    expect(readSubscription('h', { ...valid, keys: { p256dh: P256DH, auth: 'au' } })).toEqual({
      ok: false,
      problem: 'keys',
    });
  });

  it('項目の型が違えば format', () => {
    expect(readSubscription('h', { ...valid, keys: 'x' })).toEqual({ ok: false, problem: 'format' });
    expect(readSubscription('h', { ...valid, endpoint: 1 })).toEqual({ ok: false, problem: 'format' });
  });

  it('正しい購読は ok', () => {
    expect(readSubscription('h', valid).ok).toBe(true);
  });
});

describe('isGoneStatus', () => {
  it('404 と 410 だけが無効な購読', () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(403)).toBe(false);
    expect(isGoneStatus(429)).toBe(false);
    expect(isGoneStatus(500)).toBe(false);
  });
});
