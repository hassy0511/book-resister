import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  dueLabel,
  dueStatus,
  formatDate,
  isDateString,
  parseDateString,
  todayString,
  weekdayOf,
} from './date';

describe('todayString', () => {
  it('端末のローカル日付を YYYY-MM-DD で返す', () => {
    // ローカル時刻で 2026-01-05 23:59
    expect(todayString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(todayString(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('引数なしでも形式が正しい', () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseDateString / isDateString', () => {
  it('正しい日付を分解する', () => {
    expect(parseDateString('2026-11-08')).toEqual({ y: 2026, m: 11, d: 8 });
  });

  it('存在しない日付・形式違いは null', () => {
    expect(parseDateString('2026-02-29')).toBeNull(); // 平年
    expect(parseDateString('2024-02-30')).toBeNull();
    expect(parseDateString('2026-13-01')).toBeNull();
    expect(parseDateString('2026-00-10')).toBeNull();
    expect(parseDateString('2026-04-31')).toBeNull();
    expect(parseDateString('2026-1-5')).toBeNull();
    expect(parseDateString('')).toBeNull();
    expect(parseDateString('2026/11/08')).toBeNull();
  });

  it('うるう年の 2月29日は正しい', () => {
    expect(isDateString('2024-02-29')).toBe(true);
    expect(isDateString('2000-02-29')).toBe(true);
    expect(isDateString('1900-02-29')).toBe(false);
    expect(isDateString(20240229)).toBe(false);
  });
});

describe('addDays', () => {
  it('同じ月の中', () => {
    expect(addDays('2026-11-08', 14)).toBe('2026-11-22');
    expect(addDays('2026-11-08', 0)).toBe('2026-11-08');
  });

  it('月末をまたぐ', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('年末をまたぐ', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('うるう年', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2028-02-15', 14)).toBe('2028-02-29');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01'); // 100 で割り切れる年は平年
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29'); // 400 で割り切れる年はうるう年
    expect(addDays('2024-01-01', 366)).toBe('2025-01-01');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('負の日数で引く', () => {
    expect(addDays('2026-11-08', -8)).toBe('2026-10-31');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('小数は切り捨てる', () => {
    expect(addDays('2026-11-08', 1.9)).toBe('2026-11-09');
  });

  it('不正な入力はそのまま返す（例外を出さない）', () => {
    expect(addDays('', 14)).toBe('');
    expect(addDays('2026-02-30', 1)).toBe('2026-02-30');
    expect(addDays('2026-11-08', Number.NaN)).toBe('2026-11-08');
  });
});

describe('diffDays', () => {
  it('to - from を返す', () => {
    expect(diffDays('2026-11-08', '2026-11-22')).toBe(14);
    expect(diffDays('2026-11-22', '2026-11-08')).toBe(-14);
    expect(diffDays('2026-11-08', '2026-11-08')).toBe(0);
  });

  it('月末・年末・うるう年をまたぐ', () => {
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffDays('2024-02-28', '2024-03-01')).toBe(2);
    expect(diffDays('2026-02-28', '2026-03-01')).toBe(1);
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('addDays と整合する', () => {
    for (const d of [-400, -31, -1, 0, 1, 29, 60, 365, 1000]) {
      expect(diffDays('2026-11-08', addDays('2026-11-08', d))).toBe(d);
    }
  });

  it('不正なら NaN', () => {
    expect(diffDays('', '2026-11-08')).toBeNaN();
    expect(diffDays('2026-11-08', 'x')).toBeNaN();
  });
});

describe('weekdayOf', () => {
  it('曜日を返す', () => {
    expect(weekdayOf('2026-11-08')).toBe(0); // 日曜
    expect(weekdayOf('1970-01-01')).toBe(4); // 木曜
    expect(weekdayOf('2024-02-29')).toBe(4); // 木曜
    expect(weekdayOf('1969-12-31')).toBe(3); // 水曜（1970 年より前）
    expect(weekdayOf('bad')).toBeNull();
  });
});

describe('formatDate', () => {
  const today = '2026-11-08';

  it('今年なら年を付けない（曜日付き）', () => {
    expect(formatDate('2026-11-08', { today })).toBe('11月8日(日)');
    expect(formatDate('2026-11-14', { today })).toBe('11月14日(土)');
    expect(formatDate('2026-01-01', { today })).toBe('1月1日(木)');
  });

  it('今年でなければ年を付ける', () => {
    expect(formatDate('2027-01-08', { today })).toBe('2027年1月8日(金)');
    expect(formatDate('2025-12-31', { today })).toBe('2025年12月31日(水)');
  });

  it('withYear で年の有無を指定できる', () => {
    expect(formatDate('2026-11-08', { today, withYear: true })).toBe('2026年11月8日(日)');
    expect(formatDate('2025-11-08', { today, withYear: false })).toBe('11月8日(土)');
  });

  it('引数を省略しても使える', () => {
    const t = todayString();
    expect(formatDate(t)).toMatch(/^\d{1,2}月\d{1,2}日\([日月火水木金土]\)$/);
  });

  it('うるう日', () => {
    expect(formatDate('2024-02-29', { today })).toBe('2024年2月29日(木)');
  });

  it('不正な文字列はそのまま返す', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('abc')).toBe('abc');
  });
});

describe('dueStatus', () => {
  const today = '2026-11-08';

  it('過ぎていれば overdue', () => {
    expect(dueStatus('2026-11-07', today)).toBe('overdue');
    expect(dueStatus('2025-12-31', today)).toBe('overdue');
  });

  it('今日〜3日後は soon', () => {
    expect(dueStatus('2026-11-08', today)).toBe('soon');
    expect(dueStatus('2026-11-09', today)).toBe('soon');
    expect(dueStatus('2026-11-11', today)).toBe('soon');
  });

  it('4日後以降は ok', () => {
    expect(dueStatus('2026-11-12', today)).toBe('ok');
    expect(dueStatus('2027-01-01', today)).toBe('ok');
  });

  it('月末・年末をまたいでも正しい', () => {
    expect(dueStatus('2027-01-02', '2026-12-30')).toBe('soon');
    expect(dueStatus('2027-01-03', '2026-12-30')).toBe('ok');
    // うるう年は 2/29 を挟むので 3/2 が 3 日後、3/3 は 4 日後
    expect(dueStatus('2024-03-02', '2024-02-28')).toBe('soon');
    expect(dueStatus('2024-03-03', '2024-02-28')).toBe('ok');
    // 平年は 3/3 が 3 日後
    expect(dueStatus('2026-03-03', '2026-02-28')).toBe('soon');
  });

  it('不正な日付は ok', () => {
    expect(dueStatus('', today)).toBe('ok');
  });

  it('today を省略すると端末の今日を使う', () => {
    expect(dueStatus(todayString())).toBe('soon');
    expect(dueStatus(addDays(todayString(), -1))).toBe('overdue');
  });
});

describe('dueLabel', () => {
  const today = '2026-11-08';

  it('文言', () => {
    expect(dueLabel('2026-11-06', today)).toBe('2日超過');
    expect(dueLabel('2026-11-07', today)).toBe('1日超過');
    expect(dueLabel('2026-11-08', today)).toBe('今日まで');
    expect(dueLabel('2026-11-09', today)).toBe('明日まで');
    expect(dueLabel('2026-11-13', today)).toBe('あと5日');
  });

  it('年末をまたぐ', () => {
    expect(dueLabel('2027-01-01', '2026-12-31')).toBe('明日まで');
    expect(dueLabel('2026-12-31', '2027-01-02')).toBe('2日超過');
  });

  it('不正な日付は空文字', () => {
    expect(dueLabel('x', today)).toBe('');
  });

  it('today を省略すると端末の今日を使う', () => {
    expect(dueLabel(todayString())).toBe('今日まで');
  });
});
