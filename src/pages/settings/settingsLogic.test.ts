import { describe, expect, it, vi } from 'vitest';

vi.mock('../../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: false }));

const {
  LOAN_DAY_PRESETS,
  LOCATION_MEMO_MAX,
  LOCATION_NAME_MAX,
  countByLocation,
  hasFormErrors,
  inviteExpiryDate,
  inviteShareText,
  isLocationFormChanged,
  locationSummary,
  pushStateLabel,
  splitLocations,
  validateLoanDays,
  validateLocationForm,
} = await import('./settingsLogic');

describe('validateLocationForm', () => {
  const ok = { name: '中央図書館', defaultLoanDays: 14, memo: '' };

  it('正しい入力はエラーなし', () => {
    const errors = validateLocationForm(ok);
    expect(errors).toEqual({});
    expect(hasFormErrors(errors)).toBe(false);
  });

  it('名前は必須で 40 文字まで', () => {
    expect(validateLocationForm({ ...ok, name: '  ' }).name).toBe('名前を入力してください');
    expect(validateLocationForm({ ...ok, name: 'あ'.repeat(LOCATION_NAME_MAX) }).name).toBeUndefined();
    expect(validateLocationForm({ ...ok, name: 'あ'.repeat(LOCATION_NAME_MAX + 1) }).name).toBe(
      '名前は 40 文字以内にしてください',
    );
  });

  it('貸出期間は 1〜365 の整数', () => {
    expect(validateLoanDays(null)).toBe('貸出期間を入力してください');
    expect(validateLoanDays(0)).toBe('貸出期間は 1〜365 日で入力してください');
    expect(validateLoanDays(366)).toBe('貸出期間は 1〜365 日で入力してください');
    expect(validateLoanDays(1.5)).toBe('貸出期間は 1〜365 日で入力してください');
    expect(validateLoanDays(1)).toBeUndefined();
    expect(validateLoanDays(365)).toBeUndefined();
    expect(hasFormErrors(validateLocationForm({ ...ok, defaultLoanDays: null }))).toBe(true);
  });

  it('メモは上限まで', () => {
    expect(validateLocationForm({ ...ok, memo: 'a'.repeat(LOCATION_MEMO_MAX) }).memo).toBeUndefined();
    expect(validateLocationForm({ ...ok, memo: 'a'.repeat(LOCATION_MEMO_MAX + 1) }).memo).toBeDefined();
  });

  it('プリセットは 7/14/21/28', () => {
    expect(LOAN_DAY_PRESETS).toEqual([7, 14, 21, 28]);
  });
});

describe('isLocationFormChanged', () => {
  const original = { name: '中央図書館', defaultLoanDays: 14, memo: '月曜休館' };

  it('前後の空白だけの違いは変更なし', () => {
    expect(isLocationFormChanged({ name: ' 中央図書館 ', defaultLoanDays: 14, memo: '月曜休館\n' }, original)).toBe(false);
  });

  it('どれかが変われば変更あり', () => {
    expect(isLocationFormChanged({ ...original, name: '北図書館' }, original)).toBe(true);
    expect(isLocationFormChanged({ ...original, defaultLoanDays: 21 }, original)).toBe(true);
    expect(isLocationFormChanged({ ...original, defaultLoanDays: null }, original)).toBe(true);
    expect(isLocationFormChanged({ ...original, memo: '' }, original)).toBe(true);
  });
});

describe('splitLocations / countByLocation / locationSummary', () => {
  it('表示中と非表示に分ける（順序は保つ）', () => {
    const list = [
      { id: 'a', archived: false },
      { id: 'b', archived: true },
      { id: 'c', archived: false },
    ];
    const { active, archived } = splitLocations(list);
    expect(active.map((l) => l.id)).toEqual(['a', 'c']);
    expect(archived.map((l) => l.id)).toEqual(['b']);
  });

  it('場所ごとの件数', () => {
    expect(countByLocation([{ locationId: 'a' }, { locationId: 'b' }, { locationId: 'a' }])).toEqual({ a: 2, b: 1 });
    expect(countByLocation([])).toEqual({});
  });

  it('貸出期間とメモの冒頭', () => {
    expect(locationSummary({ defaultLoanDays: 14, memo: '' })).toBe('貸出期間 14日');
    expect(locationSummary({ defaultLoanDays: 21, memo: '返却ポスト\nあり' })).toBe('貸出期間 21日・返却ポスト あり');
    expect(locationSummary({ defaultLoanDays: 7, memo: 'あ'.repeat(40) }, 10)).toBe(`貸出期間 7日・${'あ'.repeat(10)}…`);
  });
});

describe('招待', () => {
  it('有効期限は 7 日後の日付', () => {
    const now = new Date(2026, 10, 8, 9, 0).getTime(); // 2026-11-08 09:00（ローカル）
    expect(inviteExpiryDate(now)).toBe('2026-11-15');
    // 月末・年末をまたぐ
    expect(inviteExpiryDate(new Date(2026, 11, 28, 23, 0).getTime())).toBe('2027-01-04');
  });

  it('共有の文面にグループ名と期限が入る', () => {
    const text = inviteShareText('山田家', '2026-11-15', '2026-11-08');
    expect(text).toContain('「山田家」');
    expect(text).toContain('11月15日(日)まで有効');
    expect(inviteShareText('  ', '2026-11-15', '2026-11-08')).toContain('「家族のグループ」');
  });
});

describe('pushStateLabel', () => {
  it('状態ごとの表示', () => {
    expect(pushStateLabel('on')).toBe('オン');
    expect(pushStateLabel('off')).toBe('オフ');
    expect(pushStateLabel('denied')).toBe('ブロック中');
    expect(pushStateLabel('needs-install')).toBe('要設定');
    expect(pushStateLabel('unsupported')).toBe('非対応');
    expect(pushStateLabel(null)).toBe('');
  });
});
