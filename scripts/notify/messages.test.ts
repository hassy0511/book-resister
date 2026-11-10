import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_LENGTH,
  buildGroupNotification,
  buildPushPayload,
  classifyDue,
  formatCategoryLine,
  limitBody,
  summarizeDueLoans,
  tokyoToday,
  type NotifyLoan,
  type NotifyLocation,
} from './messages';

const TODAY = '2026-11-08';

const locations = new Map<string, NotifyLocation>([
  ['lib', { name: '中央図書館' }],
  ['nursery', { name: 'ひまわり保育園' }],
  ['school', { name: '小学校の図書室' }],
]);

function loan(dueOn: string, locationId = 'lib', returnedOn: string | null = null): NotifyLoan {
  return { dueOn, locationId, returnedOn };
}

describe('tokyoToday', () => {
  it('UTC の前日 15:00 以降は日本時間では翌日', () => {
    expect(tokyoToday(new Date('2026-11-07T14:59:59Z'))).toBe('2026-11-07');
    expect(tokyoToday(new Date('2026-11-07T15:00:00Z'))).toBe('2026-11-08');
  });

  it('GitHub Actions の起動時刻（UTC 22:45）は日本時間の翌朝 7:45', () => {
    expect(tokyoToday(new Date('2026-12-31T22:45:00Z'))).toBe('2027-01-01');
  });

  it('月・日は 2 桁', () => {
    expect(tokyoToday(new Date('2026-02-03T00:00:00Z'))).toBe('2026-02-03');
  });
});

describe('classifyDue', () => {
  it('今日が返却日の本は対象外', () => {
    expect(classifyDue('2026-11-08', TODAY)).toBeNull();
  });

  it('明日は tomorrow、3 日後は in3days', () => {
    expect(classifyDue('2026-11-09', TODAY)).toBe('tomorrow');
    expect(classifyDue('2026-11-11', TODAY)).toBe('in3days');
  });

  it('2 日後・4 日後以降は対象外', () => {
    expect(classifyDue('2026-11-10', TODAY)).toBeNull();
    expect(classifyDue('2026-11-12', TODAY)).toBeNull();
    expect(classifyDue('2026-12-08', TODAY)).toBeNull();
  });

  it('昨日以前は何日過ぎていても overdue', () => {
    expect(classifyDue('2026-11-07', TODAY)).toBe('overdue');
    expect(classifyDue('2025-01-01', TODAY)).toBe('overdue');
  });

  it('月末・年末をまたいでも数える', () => {
    expect(classifyDue('2026-12-01', '2026-11-30')).toBe('tomorrow');
    expect(classifyDue('2027-01-02', '2026-12-30')).toBe('in3days');
    // うるう年は 2/29 を挟む
    expect(classifyDue('2028-03-01', '2028-02-27')).toBe('in3days');
    expect(classifyDue('2028-03-01', '2028-02-28')).toBeNull();
    expect(classifyDue('2027-03-01', '2027-02-26')).toBe('in3days');
    expect(classifyDue('2027-03-01', '2027-02-28')).toBe('tomorrow');
  });

  it('不正な日付は対象外', () => {
    expect(classifyDue('', TODAY)).toBeNull();
    expect(classifyDue('2026/11/09', TODAY)).toBeNull();
    expect(classifyDue('2026-02-30', TODAY)).toBeNull();
  });
});

describe('summarizeDueLoans', () => {
  it('返却済みの本は数えない', () => {
    const summary = summarizeDueLoans(
      [loan('2026-11-01', 'lib', '2026-11-05'), loan('2026-11-09', 'lib', '2026-11-08')],
      locations,
      TODAY,
    );
    expect(summary).toEqual({ overdue: [], tomorrow: [], in3days: [] });
  });

  it('区分・場所ごとに数え、冊数の多い順に並べる', () => {
    const summary = summarizeDueLoans(
      [
        loan('2026-11-09', 'nursery'),
        loan('2026-11-09', 'lib'),
        loan('2026-11-09', 'lib'),
        loan('2026-11-09', 'lib'),
        loan('2026-11-11', 'school'),
        loan('2026-11-05', 'lib'),
        loan('2026-10-30', 'nursery'),
      ],
      locations,
      TODAY,
    );
    expect(summary.tomorrow).toEqual([
      { name: '中央図書館', count: 3 },
      { name: 'ひまわり保育園', count: 1 },
    ]);
    expect(summary.in3days).toEqual([{ name: '小学校の図書室', count: 1 }]);
    expect(summary.overdue).toHaveLength(2);
    expect(summary.overdue.map((x) => x.count)).toEqual([1, 1]);
  });

  it('場所が見つからない・名前が空なら「（不明な場所）」にまとめて最後に置く', () => {
    const withEmpty = new Map(locations).set('blank', { name: '  ' });
    const summary = summarizeDueLoans(
      [loan('2026-11-09', 'deleted'), loan('2026-11-09', 'blank'), loan('2026-11-09', 'deleted'), loan('2026-11-09', 'lib')],
      withEmpty,
      TODAY,
    );
    expect(summary.tomorrow).toEqual([
      { name: '中央図書館', count: 1 },
      { name: '（不明な場所）', count: 3 },
    ]);
  });

  it('同じ名前の場所は 1 つにまとめる', () => {
    const dup = new Map(locations).set('lib2', { name: '中央図書館' });
    const summary = summarizeDueLoans([loan('2026-11-11', 'lib'), loan('2026-11-11', 'lib2')], dup, TODAY);
    expect(summary.in3days).toEqual([{ name: '中央図書館', count: 2 }]);
  });
});

describe('formatCategoryLine', () => {
  it('複数の場所は「、」で区切る', () => {
    expect(
      formatCategoryLine('tomorrow', [
        { name: '○○図書館', count: 3 },
        { name: '△△保育園', count: 1 },
      ]),
    ).toBe('明日返却：○○図書館 3冊、△△保育園 1冊');
  });

  it('場所が 3 か所を超えたら、残りを「ほか N か所 M冊」にまとめる', () => {
    expect(
      formatCategoryLine('overdue', [
        { name: 'A館', count: 4 },
        { name: 'B館', count: 3 },
        { name: 'C館', count: 2 },
        { name: 'D館', count: 2 },
        { name: 'E館', count: 1 },
      ]),
    ).toBe('延滞中：A館 4冊、B館 3冊、C館 2冊、ほか 2 か所 3冊');
    // ちょうど 3 か所ならまとめない
    expect(
      formatCategoryLine('in3days', [
        { name: 'A館', count: 1 },
        { name: 'B館', count: 1 },
        { name: 'C館', count: 1 },
      ]),
    ).toBe('3日後に返却：A館 1冊、B館 1冊、C館 1冊');
  });
});

describe('limitBody', () => {
  it('収まれば改行でつなぐだけ', () => {
    expect(limitBody(['a', 'b'], 3)).toBe('a\nb');
  });

  it('収まらない行は入る分だけ残して「…」', () => {
    expect(limitBody(['abc', 'defgh'], 6)).toBe('abc\nd…');
    expect(limitBody(['abcdefgh'], 5)).toBe('abcd…');
    // 改行の直後で切れるときは改行を残さない
    expect(limitBody(['abc', 'defgh'], 5)).toBe('abc…');
  });

  it('サロゲートペアを分けない', () => {
    expect(limitBody(['𠮷𠮷𠮷'], 4)).toBe('𠮷…');
  });
});

describe('buildGroupNotification', () => {
  it('対象が無ければ null', () => {
    expect(buildGroupNotification([], locations, TODAY)).toBeNull();
    expect(
      buildGroupNotification(
        [loan('2026-11-08'), loan('2026-11-10'), loan('2026-11-20'), loan('2026-11-01', 'lib', '2026-11-02')],
        locations,
        TODAY,
      ),
    ).toBeNull();
  });

  it('延滞 → 明日 → 3日後の順に改行区切り', () => {
    const n = buildGroupNotification(
      [
        loan('2026-11-11', 'lib'),
        loan('2026-11-11', 'lib'),
        loan('2026-11-11', 'lib'),
        loan('2026-11-11', 'lib'),
        loan('2026-11-09', 'nursery'),
        loan('2026-11-07', 'school'),
        loan('2026-11-01', 'school'),
        loan('2026-11-08', 'lib'), // 今日返却は対象外
      ],
      locations,
      TODAY,
    );
    expect(n).toEqual({
      title: '返却日のお知らせ',
      body: ['延滞中：小学校の図書室 2冊', '明日返却：ひまわり保育園 1冊', '3日後に返却：中央図書館 4冊'].join('\n'),
      tag: 'due-2026-11-08',
    });
  });

  it('対象のある区分だけを出す', () => {
    const n = buildGroupNotification([loan('2026-11-11', 'missing')], locations, TODAY);
    expect(n?.body).toBe('3日後に返却：（不明な場所） 1冊');
  });

  it('延滞だけでも毎日通知する', () => {
    const loans = [loan('2026-11-01', 'lib')];
    expect(buildGroupNotification(loans, locations, '2026-11-02')?.body).toBe('延滞中：中央図書館 1冊');
    expect(buildGroupNotification(loans, locations, '2026-11-30')?.tag).toBe('due-2026-11-30');
  });
});

describe('buildPushPayload', () => {
  it('SW が読む JSON { title, body, url, tag }', () => {
    const json = buildPushPayload({ title: 't', body: 'b', tag: 'due-2026-11-08' }, '/');
    expect(JSON.parse(json)).toEqual({ title: 't', body: 'b', url: '/', tag: 'due-2026-11-08' });
  });
});

describe('通知の大きさ（Apple の Web Push は暗号化後 4KB まで）', () => {
  /** n か所の場所（名前は len 文字）と、各場所に延滞・明日・3日後の本が 1 冊ずつ */
  function manyLocations(n: number, len: number) {
    const locs = new Map<string, NotifyLocation>();
    const loans: NotifyLoan[] = [];
    for (let i = 0; i < n; i++) {
      const id = `loc${i}`;
      locs.set(id, { name: `${String(i).padStart(2, '0')}${'図'.repeat(len - 2)}` });
      loans.push(loan('2026-11-01', id), loan('2026-11-09', id), loan('2026-11-11', id));
    }
    return { locs, loans };
  }

  it('12 か所 × 40 文字 × 3 区分でも 3 区分すべてが本文に残り、ペイロードは十分小さい', () => {
    const { locs, loans } = manyLocations(12, 40);
    const n = buildGroupNotification(loans, locs, TODAY);
    expect(n).not.toBeNull();
    const lines = n!.body.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^延滞中：.*、ほか 9 か所 9冊$/);
    expect(lines[1]).toMatch(/^明日返却：.*、ほか 9 か所 9冊$/);
    expect(lines[2]).toMatch(/^3日後に返却：.*、ほか 9 か所 9冊$/);
    expect(n!.body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    const payload = buildPushPayload(n!, 'https://karita-hon-1a2b3.web.app/');
    // 暗号化で増えるのは 100 バイト程度
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThan(2000);
  });

  it('ルールで許される 100 文字の名前でも長さの上限を超えない', () => {
    const { locs, loans } = manyLocations(40, 100);
    const n = buildGroupNotification(loans, locs, TODAY)!;
    expect(n.body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(n.body.split('\n')).toHaveLength(3);
    // 名前は 40 文字で切る
    expect(n.body).toContain(`00${'図'.repeat(38)}… 1冊`);
    expect(Buffer.byteLength(buildPushPayload(n, '/'), 'utf8')).toBeLessThan(2000);
  });

  it('場所の名前の改行は空白にする（本文の行を崩さない）', () => {
    const locs = new Map<string, NotifyLocation>([['x', { name: '中央\n図書館' }]]);
    expect(buildGroupNotification([loan('2026-11-09', 'x')], locs, TODAY)?.body).toBe('明日返却：中央 図書館 1冊');
  });
});
