import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));
vi.mock('../group/GroupProvider', () => ({ useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1' }) }));

const { sortLocations, addLocation, updateLocation } = await import('./locations');

describe('sortLocations', () => {
  it('名前順に並べる（数字は自然順）', () => {
    const list = [{ name: 'みどり図書館' }, { name: 'あおば保育園' }, { name: '第10分室' }, { name: '第2分室' }];
    expect(sortLocations(list).map((l) => l.name)).toEqual(['あおば保育園', 'みどり図書館', '第2分室', '第10分室']);
  });
});

describe('入力チェック', () => {
  it('名前が空・貸出期間が範囲外なら書き込まずに例外', async () => {
    await expect(addLocation('g1', { name: ' ', defaultLoanDays: 14, memo: '' })).rejects.toThrow('名前');
    await expect(addLocation('g1', { name: '図書館', defaultLoanDays: 0, memo: '' })).rejects.toThrow('貸出期間');
    await expect(addLocation('g1', { name: '図書館', defaultLoanDays: 366, memo: '' })).rejects.toThrow('貸出期間');
    await expect(addLocation('g1', { name: '図書館', defaultLoanDays: 1.5, memo: '' })).rejects.toThrow('貸出期間');
    await expect(updateLocation('g1', 'id', { name: '' })).rejects.toThrow('名前');
  });
});
