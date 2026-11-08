import { describe, expect, it } from 'vitest';
import { TABS, tabForPath } from './BottomTabBar';

describe('tabForPath', () => {
  it('ホームはルートと貸出・返却の画面', () => {
    expect(tabForPath('/')).toBe('home');
    expect(tabForPath('/loans/abc')).toBe('home');
    expect(tabForPath('/return')).toBe('home');
  });

  it('スキャンは借りる流れの画面も含む', () => {
    expect(tabForPath('/scan')).toBe('scan');
    expect(tabForPath('/borrow/confirm')).toBe('scan');
    expect(tabForPath('/borrow/add')).toBe('scan');
  });

  it('履歴は本の詳細も含む', () => {
    expect(tabForPath('/history')).toBe('history');
    expect(tabForPath('/books/isbn-9784000000000')).toBe('history');
  });

  it('シリーズ・設定は配下の画面も含む', () => {
    expect(tabForPath('/series')).toBe('series');
    expect(tabForPath('/series/xyz')).toBe('series');
    expect(tabForPath('/settings')).toBe('settings');
    expect(tabForPath('/settings/locations/new')).toBe('settings');
  });

  it('前方一致は区切りで判定する', () => {
    expect(tabForPath('/seriesfoo')).toBeNull();
    expect(tabForPath('/welcome')).toBeNull();
    expect(tabForPath('/join/abc')).toBeNull();
  });

  it('タブは 5 つで、スキャンは借りるモードで開く', () => {
    expect(TABS.map((t) => t.label)).toEqual(['ホーム', 'スキャン', '履歴', 'シリーズ', '設定']);
    expect(TABS.find((t) => t.key === 'scan')?.to).toBe('/scan?mode=borrow');
  });
});
