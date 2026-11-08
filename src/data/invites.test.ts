import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));

const { INVITE_CODE_LENGTH, generateInviteCode, inviteUrl, isInviteCodeFormat, isInviteExpired } = await import(
  './invites'
);

describe('generateInviteCode', () => {
  it('22 文字の英数字', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(code).toMatch(/^[A-Za-z0-9]+$/);
    expect(isInviteCodeFormat(code)).toBe(true);
  });

  it('毎回異なる', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
    expect(codes.size).toBe(500);
  });

  it('文字の偏りが小さい', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      for (const ch of generateInviteCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    // 62 種すべてが出現し、極端な偏りがない
    expect(counts.size).toBe(62);
    const values = [...counts.values()];
    const avg = (2000 * INVITE_CODE_LENGTH) / 62;
    expect(Math.min(...values)).toBeGreaterThan(avg * 0.7);
    expect(Math.max(...values)).toBeLessThan(avg * 1.3);
  });

  it('長さを指定できる', () => {
    expect(generateInviteCode(30)).toHaveLength(30);
  });
});

describe('isInviteCodeFormat', () => {
  it('パスに使えない文字や短すぎるコードを弾く', () => {
    expect(isInviteCodeFormat('abc')).toBe(false);
    expect(isInviteCodeFormat('abcdefghijklmnop/qrstu')).toBe(false);
    expect(isInviteCodeFormat('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isInviteCodeFormat('')).toBe(false);
  });
});

describe('isInviteExpired', () => {
  it('期限を過ぎていれば true', () => {
    const now = Date.UTC(2026, 10, 8);
    expect(isInviteExpired({ expiresAt: Timestamp.fromMillis(now + 1000) }, now)).toBe(false);
    expect(isInviteExpired({ expiresAt: Timestamp.fromMillis(now - 1000) }, now)).toBe(true);
    expect(isInviteExpired({ expiresAt: Timestamp.fromMillis(now) }, now)).toBe(true);
  });

  it('期限が無い（不正な）招待は期限切れ扱い', () => {
    // @ts-expect-error 不正なデータ
    expect(isInviteExpired({ expiresAt: null })).toBe(true);
  });
});

describe('inviteUrl', () => {
  it('/join/{code} の URL を作る', () => {
    expect(inviteUrl('abc')).toMatch(/\/join\/abc$/);
  });
});
