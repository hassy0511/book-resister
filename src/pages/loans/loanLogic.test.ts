import { describe, expect, it } from 'vitest';
import {
  MAX_RETURN_IDS,
  buildReturnItems,
  commonLocationId,
  defaultReturnDraft,
  dueOptions,
  errorText,
  hasReviewContent,
  latestBorrowedOn,
  parseReturnTarget,
  selectReturnLoans,
  validateBorrowedOn,
  validateDueOn,
  validateReturnedOn,
  type ReturnDraft,
} from './loanLogic';

const p = (query: string) => new URLSearchParams(query);

describe('parseReturnTarget', () => {
  it('?location=ID', () => {
    expect(parseReturnTarget(p('location=L1'))).toEqual({ kind: 'location', locationId: 'L1' });
  });

  it('?loans=a,b（空・重複・スラッシュを除く）', () => {
    expect(parseReturnTarget(p('loans=a,,b, a ,x/y'))).toEqual({ kind: 'loans', loanIds: ['a', 'b'] });
  });

  it('両方あれば ?loans を優先', () => {
    expect(parseReturnTarget(p('location=L1&loans=a'))).toEqual({ kind: 'loans', loanIds: ['a'] });
  });

  it('?loans が空なら ?location を使う', () => {
    expect(parseReturnTarget(p('loans=,&location=L1'))).toEqual({ kind: 'location', locationId: 'L1' });
  });

  it('どちらも無ければ none', () => {
    expect(parseReturnTarget(p(''))).toEqual({ kind: 'none' });
    expect(parseReturnTarget(p('location='))).toEqual({ kind: 'none' });
  });

  it('件数の上限', () => {
    const ids = Array.from({ length: MAX_RETURN_IDS + 10 }, (_, i) => `id${i}`).join(',');
    const t = parseReturnTarget(p(`loans=${ids}`));
    expect(t.kind === 'loans' && t.loanIds.length).toBe(MAX_RETURN_IDS);
  });
});

describe('selectReturnLoans', () => {
  const active = [
    { id: 'a', locationId: 'L1' },
    { id: 'b', locationId: 'L2' },
    { id: 'c', locationId: 'L1' },
  ];

  it('場所の貸出中すべて（一覧の順を保つ）', () => {
    const r = selectReturnLoans(active, { kind: 'location', locationId: 'L1' });
    expect(r.loans.map((l) => l.id)).toEqual(['a', 'c']);
    expect(r.missingCount).toBe(0);
  });

  it('指定した貸出記録。見つからない分を数える', () => {
    const r = selectReturnLoans(active, { kind: 'loans', loanIds: ['c', 'zzz', 'a'] });
    expect(r.loans.map((l) => l.id)).toEqual(['a', 'c']);
    expect(r.missingCount).toBe(1);
  });

  it('none は空', () => {
    expect(selectReturnLoans(active, { kind: 'none' })).toEqual({ loans: [], missingCount: 0 });
  });
});

describe('commonLocationId', () => {
  it('同じ場所ならその ID、混在・空は null', () => {
    expect(commonLocationId([{ locationId: 'L1' }, { locationId: 'L1' }])).toBe('L1');
    expect(commonLocationId([{ locationId: 'L1' }, { locationId: 'L2' }])).toBeNull();
    expect(commonLocationId([])).toBeNull();
  });
});

describe('返却内容', () => {
  it('既定はチェックオン・読んだ。既存の評価と感想は引き継ぐ', () => {
    expect(defaultReturnDraft({ rating: null, review: null })).toEqual({
      checked: true,
      readStatus: 'read',
      rating: null,
      review: '',
      reviewOpen: false,
    });
    expect(defaultReturnDraft({ rating: 4, review: 'よかった' })).toMatchObject({ rating: 4, review: 'よかった' });
  });

  it('hasReviewContent', () => {
    expect(hasReviewContent({ rating: null, review: '  ' })).toBe(false);
    expect(hasReviewContent({ rating: 3, review: '' })).toBe(true);
    expect(hasReviewContent({ rating: null, review: 'a' })).toBe(true);
  });

  it('チェックの付いた本だけ組み立て、感想は前後の空白を除き空なら null', () => {
    const loans = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const drafts: Record<string, ReturnDraft> = {
      a: { checked: true, readStatus: 'read', rating: 5, review: '  おもしろい \n', reviewOpen: true },
      b: { checked: false, readStatus: 'read', rating: null, review: '', reviewOpen: false },
      c: { checked: true, readStatus: 'partial', rating: null, review: '   ', reviewOpen: false },
    };
    expect(buildReturnItems(loans, (l) => drafts[l.id], '2026-11-08')).toEqual([
      { loanId: 'a', returnedOn: '2026-11-08', readStatus: 'read', rating: 5, review: 'おもしろい' },
      { loanId: 'c', returnedOn: '2026-11-08', readStatus: 'partial', rating: null, review: null },
    ]);
  });
});

describe('日付の検証', () => {
  const today = '2026-11-08';

  it('latestBorrowedOn', () => {
    expect(latestBorrowedOn([{ borrowedOn: '2026-11-01' }, { borrowedOn: '2026-11-05' }, { borrowedOn: 'bad' }])).toBe(
      '2026-11-05',
    );
    expect(latestBorrowedOn([])).toBeNull();
  });

  it('validateReturnedOn', () => {
    const loans = [{ borrowedOn: '2026-11-01' }, { borrowedOn: '2026-11-05' }];
    expect(validateReturnedOn('2026-11-08', loans, today)).toBeNull();
    expect(validateReturnedOn('2026-11-05', loans, today)).toBeNull();
    expect(validateReturnedOn('', loans, today)).toBe('返却した日を入力してください');
    expect(validateReturnedOn('2026-11-09', loans, today)).toBe('今日より後の日付は選べません');
    expect(validateReturnedOn('2026-11-04', loans, today)).toBe('借りた日（11月5日(木)）より前の日付になっています');
  });

  it('validateDueOn', () => {
    expect(validateDueOn('2026-11-22', '2026-11-08')).toBeNull();
    expect(validateDueOn('2026-11-08', '2026-11-08')).toBeNull();
    expect(validateDueOn('', '2026-11-08')).toBe('返却日を入力してください');
    expect(validateDueOn('2026-11-07', '2026-11-08')).toBe('返却日は借りた日以降にしてください');
  });

  it('validateBorrowedOn', () => {
    const active = { dueOn: '2026-11-20', returnedOn: null };
    expect(validateBorrowedOn('2026-11-01', active, today)).toBeNull();
    expect(validateBorrowedOn('', active, today)).toBe('借りた日を入力してください');
    expect(validateBorrowedOn('2026-11-09', active, today)).toBe('今日より後の日付は選べません');
    expect(validateBorrowedOn('2026-11-05', { dueOn: '2026-11-04', returnedOn: null }, today)).toBe(
      '返却日（11月4日(水)）より後の日付になっています',
    );
    expect(validateBorrowedOn('2026-11-05', { dueOn: '2026-11-20', returnedOn: '2026-11-03' }, today)).toBe(
      '返却した日（11月3日(火)）より後の日付になっています',
    );
  });
});

describe('dueOptions', () => {
  it('+7日・+14日はいまの返却日から。場所の既定があれば「今日から○日」', () => {
    expect(dueOptions('2026-11-10', '2026-11-08', 14)).toEqual([
      { key: 'plus7', label: '+7日', value: '2026-11-17' },
      { key: 'plus14', label: '+14日', value: '2026-11-24' },
      { key: 'fromToday', label: '今日から14日', value: '2026-11-22' },
    ]);
  });

  it('月末をまたぐ', () => {
    expect(dueOptions('2026-12-28', '2026-12-20', null).map((o) => o.value)).toEqual(['2027-01-04', '2027-01-11']);
  });

  it('「今日から」が他と同じ日なら出さない', () => {
    expect(dueOptions('2026-11-08', '2026-11-08', 7).map((o) => o.key)).toEqual(['plus7', 'plus14']);
  });

  it('既定の期間が無い・不正なら出さない', () => {
    expect(dueOptions('2026-11-10', '2026-11-08', null)).toHaveLength(2);
    expect(dueOptions('2026-11-10', '2026-11-08', 0)).toHaveLength(2);
  });
});

describe('errorText', () => {
  it('Error のメッセージ、無ければ代わりの文', () => {
    expect(errorText(new Error('権限がありません'), '失敗')).toBe('権限がありません');
    expect(errorText(new Error(''), '失敗')).toBe('失敗');
    expect(errorText('x', '失敗')).toBe('失敗');
  });
});
