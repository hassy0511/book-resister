import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));
vi.mock('../group/GroupProvider', () => ({ useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1' }) }));
vi.mock('../lib/series', () => ({
  normalizeSeriesName: (name: string) => name.normalize('NFKC').replace(/\s/g, '').toLowerCase(),
  findMatchingSeries: () => null,
}));

const { cleanTotalVolumes, createSeries, deleteSeries, findOrCreateSeries, mergeSeries, seriesIdForName, updateSeries } =
  await import('./series');

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

describe('seriesIdForName', () => {
  it('同じ名前（表記の揺れを含む）なら、どの端末でも同じ ID になる', () => {
    const id = seriesIdForName('おしりたんてい');
    expect(id).toMatch(/^s-[0-9a-f]{32}$/);
    expect(seriesIdForName('おしり たんてい')).toBe(id);
    expect(seriesIdForName('ｵｼﾘ')).toMatch(/^s-[0-9a-f]{32}$/); // ルールの ID の上限（128 文字）に収まる
    expect(seriesIdForName('かいけつゾロリ')).not.toBe(id);
  });

  it('正規化すると空になる名前は null（ランダムな ID で作る）', () => {
    expect(seriesIdForName('   ')).toBeNull();
  });
});

describe('まとめる・削除の入力チェック', () => {
  it('同じシリーズや不正な ID は書き込まずに例外', async () => {
    await expect(mergeSeries('g1', 's1', 's1')).rejects.toThrow('同じシリーズ');
    await expect(mergeSeries('g1', 'a/b', 's1')).rejects.toThrow('シリーズが見つかりません');
    await expect(deleteSeries('g1', '')).rejects.toThrow('シリーズが見つかりません');
  });
});
