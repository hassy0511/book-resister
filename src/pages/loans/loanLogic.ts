/*
 * 返却画面・貸出の詳細画面の純粋ロジック（URL の解釈、返却内容の組み立て、日付の検証）。
 * Firebase・React に依存しない。
 */
import type { DateString, Loan, ReadStatus } from '../../types';
import type { ReturnInput } from '../../data/loans';
import { addDays, formatDate, isDateString } from '../../lib/date';

// ---------------------------------------------------------------------------
// 返却の対象（/return?location=ID または /return?loans=a,b）
// ---------------------------------------------------------------------------

export type ReturnTarget =
  | { kind: 'location'; locationId: string }
  | { kind: 'loans'; loanIds: string[] }
  | { kind: 'none' };

/** 1 回に指定できる貸出記録の上限（URL が極端に長い場合の保険） */
export const MAX_RETURN_IDS = 200;

/** ?loans= を優先し、無ければ ?location=。どちらも無ければ none */
export function parseReturnTarget(params: URLSearchParams): ReturnTarget {
  const loansParam = params.get('loans');
  if (loansParam !== null) {
    const ids = Array.from(
      new Set(
        loansParam
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.includes('/')),
      ),
    ).slice(0, MAX_RETURN_IDS);
    if (ids.length > 0) return { kind: 'loans', loanIds: ids };
  }
  const locationId = params.get('location')?.trim();
  if (locationId) return { kind: 'location', locationId };
  return { kind: 'none' };
}

/**
 * 貸出中の一覧から返却の対象を選ぶ（並びは貸出中一覧の順＝返却日が近い順のまま）。
 * missingCount は ?loans= で指定されたのに貸出中に無かった件数（返却済み・削除済み）。
 */
export function selectReturnLoans<T extends Pick<Loan, 'locationId'> & { id: string }>(
  activeLoans: readonly T[],
  target: ReturnTarget,
): { loans: T[]; missingCount: number } {
  switch (target.kind) {
    case 'location':
      return { loans: activeLoans.filter((l) => l.locationId === target.locationId), missingCount: 0 };
    case 'loans': {
      const wanted = new Set(target.loanIds);
      const loans = activeLoans.filter((l) => wanted.has(l.id));
      return { loans, missingCount: wanted.size - loans.length };
    }
    case 'none':
      return { loans: [], missingCount: 0 };
  }
}

/** すべて同じ場所ならその ID、混ざっていれば null */
export function commonLocationId(loans: readonly Pick<Loan, 'locationId'>[]): string | null {
  if (loans.length === 0) return null;
  const first = loans[0].locationId;
  return loans.every((l) => l.locationId === first) ? first : null;
}

// ---------------------------------------------------------------------------
// 1 冊ごとの返却内容
// ---------------------------------------------------------------------------

export type ReturnDraft = {
  /** 返却する（チェックを外すと今回は返却しない） */
  checked: boolean;
  readStatus: ReadStatus;
  rating: number | null;
  review: string;
  /** 「感想を書く」を開いているか */
  reviewOpen: boolean;
};

/**
 * 既定の返却内容。チェックはオン、読書状況は「読んだ」。
 * 評価・感想は記録に残っていれば引き継ぐ（返却の取り消し後に再度返却したときに消さないため）。
 */
export function defaultReturnDraft(loan: Pick<Loan, 'rating' | 'review'>): ReturnDraft {
  return {
    checked: true,
    readStatus: 'read',
    rating: loan.rating ?? null,
    review: loan.review ?? '',
    reviewOpen: false,
  };
}

export function hasReviewContent(draft: Pick<ReturnDraft, 'rating' | 'review'>): boolean {
  return draft.rating !== null || draft.review.trim() !== '';
}

/** チェックの付いた本の返却内容（returnLoans に渡す形） */
export function buildReturnItems<T extends { id: string }>(
  loans: readonly T[],
  draftOf: (loan: T) => ReturnDraft,
  returnedOn: DateString,
): ReturnInput[] {
  const items: ReturnInput[] = [];
  for (const loan of loans) {
    const d = draftOf(loan);
    if (!d.checked) continue;
    const review = d.review.trim();
    items.push({
      loanId: loan.id,
      returnedOn,
      readStatus: d.readStatus,
      rating: d.rating,
      review: review === '' ? null : review,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 日付の検証（エラーなら日本語の文、問題なければ null）
// ---------------------------------------------------------------------------

/** いちばん遅い「借りた日」 */
export function latestBorrowedOn(loans: readonly Pick<Loan, 'borrowedOn'>[]): DateString | null {
  let latest: DateString | null = null;
  for (const l of loans) {
    if (isDateString(l.borrowedOn) && (latest === null || l.borrowedOn > latest)) latest = l.borrowedOn;
  }
  return latest;
}

/** 返却した日（今日以前で、選んだ本の借りた日以降） */
export function validateReturnedOn(
  returnedOn: DateString,
  loans: readonly Pick<Loan, 'borrowedOn'>[],
  today: DateString,
): string | null {
  if (!isDateString(returnedOn)) return '返却した日を入力してください';
  if (returnedOn > today) return '今日より後の日付は選べません';
  const latest = latestBorrowedOn(loans);
  if (latest !== null && returnedOn < latest) {
    return `借りた日（${formatDate(latest)}）より前の日付になっています`;
  }
  return null;
}

/** 返却日（延長）。借りた日以降 */
export function validateDueOn(dueOn: DateString, borrowedOn: DateString): string | null {
  if (!isDateString(dueOn)) return '返却日を入力してください';
  if (isDateString(borrowedOn) && dueOn < borrowedOn) return '返却日は借りた日以降にしてください';
  return null;
}

/** 借りた日の修正。今日以前で、返却日・返却した日より後にならないこと */
export function validateBorrowedOn(
  borrowedOn: DateString,
  loan: Pick<Loan, 'dueOn' | 'returnedOn'>,
  today: DateString,
): string | null {
  if (!isDateString(borrowedOn)) return '借りた日を入力してください';
  if (borrowedOn > today) return '今日より後の日付は選べません';
  if (isDateString(loan.dueOn) && borrowedOn > loan.dueOn) {
    return `返却日（${formatDate(loan.dueOn)}）より後の日付になっています`;
  }
  if (loan.returnedOn && isDateString(loan.returnedOn) && borrowedOn > loan.returnedOn) {
    return `返却した日（${formatDate(loan.returnedOn)}）より後の日付になっています`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 延長のクイック選択
// ---------------------------------------------------------------------------

export type DueOption = {
  key: string;
  label: string;
  value: DateString;
};

/**
 * 返却日のクイック選択。「+7日」「+14日」はいまの返却日に足す。
 * 場所の既定の貸出期間が分かれば「今日から○日」も出す（延長手続きの日から数える図書館向け）。
 */
export function dueOptions(currentDueOn: DateString, today: DateString, defaultLoanDays: number | null): DueOption[] {
  const options: DueOption[] = [
    { key: 'plus7', label: '+7日', value: addDays(currentDueOn, 7) },
    { key: 'plus14', label: '+14日', value: addDays(currentDueOn, 14) },
  ];
  if (defaultLoanDays !== null && Number.isInteger(defaultLoanDays) && defaultLoanDays > 0) {
    const fromToday = addDays(today, defaultLoanDays);
    if (!options.some((o) => o.value === fromToday)) {
      options.push({ key: 'fromToday', label: `今日から${defaultLoanDays}日`, value: fromToday });
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// その他
// ---------------------------------------------------------------------------

/** 例外を利用者向けの文にする（data/* は日本語メッセージの Error を投げる） */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
