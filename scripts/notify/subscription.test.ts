import { describe, expect, it } from 'vitest';
import {
  MAX_SUBSCRIPTIONS_PER_GROUP,
  checkSubscription,
  isAllowedPushEndpoint,
  isValidAuthSecret,
  isValidP256dh,
  selectTargets,
} from './subscription';

/** P-256 の公開鍵（非圧縮 65 バイト） */
const VALID_P256DH = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
/** 16 バイト */
const VALID_AUTH = '5_uHGMO9sKvEahQK3OF5Bw';

describe('isAllowedPushEndpoint', () => {
  it('Safari・Chrome・Firefox・Edge のプッシュサービスは送る', () => {
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGxhYmVsLWZvci10ZXN0')).toBe(true);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:APA91b')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAAAA')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB')).toBe(true);
  });

  it('それ以外のホスト・紛らわしいホスト・ポート指定・パスなしは送らない', () => {
    expect(isAllowedPushEndpoint('https://attacker.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1:1/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://victim.example/api/anything?a=1')).toBe(false);
    expect(isAllowedPushEndpoint('https://web.push.apple.com.attacker.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.web.push.apple.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://web.push.apple.com:8443/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://user@web.push.apple.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://a.b.notify.windows.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/')).toBe(false);
    expect(isAllowedPushEndpoint('https://web.push.apple.com')).toBe(false);
    expect(isAllowedPushEndpoint('http://web.push.apple.com/x')).toBe(false);
    expect(isAllowedPushEndpoint(`https://web.push.apple.com/${'a'.repeat(2048)}`)).toBe(false);
  });
});

describe('isValidP256dh / isValidAuthSecret', () => {
  it('ブラウザが返す形（パディングなし・あり）を受け付ける', () => {
    expect(isValidP256dh(VALID_P256DH)).toBe(true);
    expect(isValidP256dh(`${VALID_P256DH}=`)).toBe(true);
    expect(isValidAuthSecret(VALID_AUTH)).toBe(true);
    expect(isValidAuthSecret(`${VALID_AUTH}==`)).toBe(true);
  });

  it('長さ・文字種・曲線上にない点は不可', () => {
    expect(isValidP256dh('BPx')).toBe(false);
    expect(isValidP256dh(VALID_P256DH.slice(0, 86))).toBe(false);
    expect(isValidP256dh(`${VALID_P256DH.slice(0, 86)}+`)).toBe(false);
    // 65 バイトで先頭も 0x04 だが曲線上にない（暗号化で必ず失敗する）
    const offCurve = Buffer.alloc(65, 1);
    offCurve[0] = 0x04;
    expect(offCurve.toString('base64url')).toHaveLength(87);
    expect(isValidP256dh(offCurve.toString('base64url'))).toBe(false);
    // 先頭が 0x04 でない
    expect(isValidP256dh(`AA${VALID_P256DH.slice(2)}`)).toBe(false);
    expect(isValidAuthSecret('au')).toBe(false);
    expect(isValidAuthSecret(`${VALID_AUTH}A`)).toBe(false);
    expect(isValidAuthSecret(`${VALID_AUTH.slice(0, 21)}/`)).toBe(false);
  });
});

describe('checkSubscription', () => {
  it('問題の種類を返す', () => {
    const keys = { p256dh: VALID_P256DH, auth: VALID_AUTH };
    expect(checkSubscription('https://web.push.apple.com/abc', keys)).toBeNull();
    expect(checkSubscription('https://attacker.example/x', keys)).toBe('endpoint');
    expect(checkSubscription('https://web.push.apple.com/abc', { ...keys, p256dh: 'BPx' })).toBe('keys');
    expect(checkSubscription('https://web.push.apple.com/abc', { ...keys, auth: 'au' })).toBe('keys');
  });
});

describe('selectTargets', () => {
  const sub = (id: string, uid: string, createdAtMillis: number) => ({ id, uid, createdAtMillis });

  it('メンバーの購読だけを新しい順に選ぶ', () => {
    const result = selectTargets([sub('a', 'u1', 1), sub('b', 'x', 3), sub('c', 'u2', 2)], new Set(['u1', 'u2']));
    expect(result.targets.map((s) => s.id)).toEqual(['c', 'a']);
    expect(result.nonMembers).toBe(1);
    expect(result.overLimit).toBe(0);
  });

  it('上限を超えた古い購読には送らない', () => {
    const subs = Array.from({ length: MAX_SUBSCRIPTIONS_PER_GROUP + 5 }, (_, i) => sub(`s${i}`, 'u1', i));
    const result = selectTargets(subs, new Set(['u1']));
    expect(result.targets).toHaveLength(MAX_SUBSCRIPTIONS_PER_GROUP);
    expect(result.targets[0].id).toBe(`s${MAX_SUBSCRIPTIONS_PER_GROUP + 4}`);
    expect(result.overLimit).toBe(5);
  });
});
