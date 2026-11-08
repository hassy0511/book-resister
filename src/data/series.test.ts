import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));
vi.mock('../group/GroupProvider', () => ({ useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1' }) }));
vi.mock('../lib/series', () => ({
  normalizeSeriesName: (name: string) => name.normalize('NFKC').replace(/\s/g, '').toLowerCase(),
  findMatchingSeries: () => null,
}));

const { cleanTotalVolumes, createSeries, findOrCreateSeries, updateSeries } = await import('./series');

describe('cleanTotalVolumes', () => {
  it('1 以上の整数か null', () => {
    expect(cleanTotalVolumes(12)).toBe(12);
    expect(cleanTotalVolumes(null)).toBeNull();
    expect(cleanTotalVolumes(undefined)).toBeNull();
    expect(() => cleanTotalVolumes(0)).toThrow('全巻数');
    expect(() => cleanTotalVolumes(2.5)).toThrow('全巻数');
  });
});

describe('入力チェック', () => {
  it('シリーズ名が空なら書き込まずに例外', async () => {
    await expect(createSeries('g1', '  ')).rejects.toThrow('シリーズ名');
    await expect(findOrCreateSeries('g1', '')).rejects.toThrow('シリーズ名');
    await expect(updateSeries('g1', 's1', { name: ' ' })).rejects.toThrow('シリーズ名');
    await expect(updateSeries('g1', 's1', { totalVolumes: -1 })).rejects.toThrow('全巻数');
  });
});
