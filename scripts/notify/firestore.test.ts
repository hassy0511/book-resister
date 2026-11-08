import { describe, expect, it } from 'vitest';
import { toNotifyLoan, toNotifyLocation, toStoredSubscription } from './firestore';
import { isGoneStatus } from './send';

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
    keys: { p256dh: 'BPx', auth: 'au' },
    userAgent: 'iPhone',
  };

  it('送信に必要な項目を取り出す', () => {
    expect(toStoredSubscription('hash', valid)).toEqual({
      id: 'hash',
      uid: 'u1',
      endpoint: 'https://web.push.apple.com/abc',
      keys: { p256dh: 'BPx', auth: 'au' },
    });
  });

  it('endpoint が https でない・鍵が欠けていれば null', () => {
    expect(toStoredSubscription('h', { ...valid, endpoint: 'http://example.com' })).toBeNull();
    expect(toStoredSubscription('h', { ...valid, keys: { p256dh: 'BPx' } })).toBeNull();
    expect(toStoredSubscription('h', { ...valid, keys: { p256dh: '', auth: 'au' } })).toBeNull();
    expect(toStoredSubscription('h', { ...valid, uid: undefined })).toBeNull();
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
