// @vitest-environment jsdom
/* 返却画面・貸出の詳細画面の表示と操作のテスト（データ層・グループはモック） */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import type { Loan, Location, Member, WithId } from '../../types';
import { ToastProvider } from '../../components/ui/ToastProvider';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const state = vi.hoisted(() => ({
  active: { data: [] as unknown[], loading: false, error: null as Error | null },
  loan: { data: null as unknown, loading: false, error: null as Error | null },
  locations: { data: [] as unknown[], loading: false, error: null as Error | null },
  members: [] as unknown[],
}));

const api = vi.hoisted(() => ({
  returnLoans: vi.fn(async () => undefined),
  undoReturn: vi.fn(async () => undefined),
  updateLoan: vi.fn(async () => undefined),
  deleteLoan: vi.fn(async () => undefined),
}));

vi.mock('../../data/loans', () => ({
  useActiveLoans: () => state.active,
  useLoan: () => state.loan,
  returnLoans: api.returnLoans,
  undoReturn: api.undoReturn,
  updateLoan: api.updateLoan,
  deleteLoan: api.deleteLoan,
}));
vi.mock('../../data/locations', () => ({
  useLocations: () => state.locations,
}));
vi.mock('../../group/GroupProvider', () => {
  const names: Record<string, string> = { u1: 'ママ', u2: 'はなこ' };
  const memberName = (uid: string) => names[uid] ?? '（不明）';
  return {
    useGroup: () => ({ members: state.members, memberName }),
    useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1', members: state.members, memberName }),
  };
});

import ReturnPage from './ReturnPage';
import LoanDetailPage from './LoanDetailPage';

function loan(id: string, patch: Partial<Loan> = {}): WithId<Loan> {
  return {
    id,
    bookId: `book-${id}`,
    book: { title: `本${id}`, authors: ['さくしゃ'], coverUrl: null, isbn: null },
    locationId: 'L1',
    borrowerUid: 'u1',
    borrowedOn: '2026-11-01',
    dueOn: '2026-11-15',
    returnedOn: null,
    readStatus: null,
    rating: null,
    review: null,
    createdBy: 'u1',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
}

function location(id: string, name: string): WithId<Location> {
  return { id, name, defaultLoanDays: 14, memo: '', archived: false, createdAt: ts, updatedAt: ts };
}

function member(id: string, displayName: string): WithId<Member> {
  return { id, displayName, joinedAt: ts, inviteCode: null };
}

function CurrentUrl() {
  const loc = useLocation();
  return <p data-testid="url">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<p>HOME</p>} />
          <Route path="/return" element={<ReturnPage />} />
          <Route path="/loans/:loanId" element={<LoanDetailPage />} />
          <Route path="*" element={<CurrentUrl />} />
        </Routes>
        <CurrentUrl />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** 非同期の書き込み（モック）を完了させる */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T09:00:00'));
  Object.values(api).forEach((fn) => fn.mockClear());
  state.active = {
    data: [
      loan('a', { locationId: 'L1', dueOn: '2026-11-10' }),
      loan('b', { locationId: 'L1', dueOn: '2026-11-12', borrowerUid: 'u2', rating: 4, review: '前に書いた感想' }),
      loan('c', { locationId: 'L2', dueOn: '2026-11-11' }),
    ],
    loading: false,
    error: null,
  };
  state.locations = { data: [location('L1', 'あおば図書館'), location('L2', 'いずみ図書室')], loading: false, error: null };
  state.members = [member('u1', 'ママ'), member('u2', 'はなこ')];
  state.loan = { data: null, loading: false, error: null };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReturnPage', () => {
  it('?location= ならその場所の貸出中すべて。一部を外して返却し、取り消しもできる', async () => {
    renderAt('/return?location=L1');
    expect(screen.getByText('あおば図書館')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(screen.getByRole('button', { name: '2冊を返却する' })).toBeTruthy();

    // 1 冊目を外す
    fireEvent.click(boxes[0]);
    expect(screen.getByRole('button', { name: '1冊を返却する' })).toBeTruthy();
    expect(screen.getByText('今回は返却しません')).toBeTruthy();

    // 2 冊目は「途中まで」
    const picker = screen.getByRole('radiogroup', { name: '「本b」の読書状況' });
    expect(within(picker).getByRole('radio', { name: '読んだ' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(picker).getByRole('radio', { name: '途中まで' }));

    fireEvent.click(screen.getByRole('button', { name: '1冊を返却する' }));
    await flush();

    expect(api.returnLoans).toHaveBeenCalledWith('g1', [
      { loanId: 'b', returnedOn: '2026-11-08', readStatus: 'partial', rating: 4, review: '前に書いた感想' },
    ]);
    expect(screen.getByText('HOME')).toBeTruthy();
    expect(screen.getByText('1冊を返却しました')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    await flush();
    expect(api.undoReturn).toHaveBeenCalledWith('g1', 'b');
    expect(screen.getByText('1冊の返却を取り消しました')).toBeTruthy();
  });

  it('?loans= なら指定分だけ。返却済みの分は件数を知らせる', () => {
    renderAt('/return?loans=c,gone');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText('1冊はすでに返却済みか、見つかりませんでした。')).toBeTruthy();
    // 1 か所だけなら場所名を見出しに出す
    expect(screen.getByText('いずみ図書室')).toBeTruthy();
  });

  it('感想を書くを開くと評価と感想を入力でき、返却内容に入る', async () => {
    renderAt('/return?loans=a');
    fireEvent.click(screen.getByRole('button', { name: /感想を書く/ }));
    fireEvent.click(screen.getByRole('radio', { name: '★5' }));
    fireEvent.change(screen.getByRole('textbox', { name: '感想' }), { target: { value: ' たのしかった ' } });
    fireEvent.click(screen.getByRole('button', { name: '1冊を返却する' }));
    await flush();
    expect(api.returnLoans).toHaveBeenCalledWith('g1', [
      { loanId: 'a', returnedOn: '2026-11-08', readStatus: 'read', rating: 5, review: 'たのしかった' },
    ]);
  });

  it('返却した日が借りた日より前ならボタンを押せない', () => {
    renderAt('/return?loans=a');
    fireEvent.change(screen.getByLabelText('返却した日'), { target: { value: '2026-10-30' } });
    expect(screen.getByText(/より前の日付になっています/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '1冊を返却する' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('失敗したらエラーを出して画面に残る', async () => {
    api.returnLoans.mockRejectedValueOnce(new Error('通信できませんでした。'));
    renderAt('/return?loans=a');
    fireEvent.click(screen.getByRole('button', { name: '1冊を返却する' }));
    await flush();
    expect(screen.getByText('通信できませんでした。')).toBeTruthy();
    expect(screen.queryByText('HOME')).toBeNull();
    expect((screen.getByRole('button', { name: '1冊を返却する' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('指定なし・該当なしの表示', () => {
    const view = renderAt('/return');
    expect(screen.getByText('返却する本が選ばれていません')).toBeTruthy();
    view.unmount();
    renderAt('/return?loans=gone');
    expect(screen.getByText('返却する本はありません')).toBeTruthy();
  });
});

describe('LoanDetailPage', () => {
  it('貸出中: 情報を表示し、「返却する」で返却画面へ', () => {
    state.loan = { data: loan('a'), loading: false, error: null };
    renderAt('/loans/a');
    expect(screen.getByText('本a')).toBeTruthy();
    expect(screen.getByRole('link', { name: /本a/ }).getAttribute('href')).toBe('/books/book-a');
    expect(screen.getByText('貸出中')).toBeTruthy();
    expect(screen.getByText('あおば図書館')).toBeTruthy();
    expect(screen.getByText('ママ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'この本を返却する' }));
    expect(screen.getByTestId('url').textContent).toBe('/return?loans=a');
  });

  it('貸出中: 返却日を +7日 で延長する', async () => {
    state.loan = { data: loan('a', { dueOn: '2026-11-15' }), loading: false, error: null };
    renderAt('/loans/a');
    fireEvent.click(screen.getByRole('button', { name: '返却日を変更（延長）' }));
    const dialog = screen.getByRole('dialog', { name: '返却日を変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '+7日' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /11月22日.*に変更/ }));
    await flush();
    expect(api.updateLoan).toHaveBeenCalledWith('g1', 'a', { dueOn: '2026-11-22' });
    expect(screen.getByText(/返却日を11月22日.*に変更しました/)).toBeTruthy();
  });

  it('貸出中: 借りた人を修正する', async () => {
    state.loan = { data: loan('a'), loading: false, error: null };
    renderAt('/loans/a');
    fireEvent.click(screen.getByRole('button', { name: '場所・借りた人・借りた日を修正' }));
    const dialog = screen.getByRole('dialog', { name: '登録内容を修正' });
    fireEvent.change(within(dialog).getByLabelText('借りた人'), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await flush();
    expect(api.updateLoan).toHaveBeenCalledWith('g1', 'a', { locationId: 'L1', borrowerUid: 'u2', borrowedOn: '2026-11-01' });
  });

  it('貸出中: 確認して削除し、ホームへ戻る', async () => {
    state.loan = { data: loan('a'), loading: false, error: null };
    renderAt('/loans/a');
    fireEvent.click(screen.getByRole('button', { name: /この登録を削除/ }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    await flush();
    expect(api.deleteLoan).toHaveBeenCalledWith('g1', 'a');
    expect(screen.getByText('HOME')).toBeTruthy();
  });

  it('返却済み: 感想を保存し、返却を取り消せる', async () => {
    state.loan = {
      data: loan('a', { returnedOn: '2026-11-07', readStatus: 'partial' }),
      loading: false,
      error: null,
    };
    renderAt('/loans/a');
    expect(screen.getByText('返却済み')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'この本を返却する' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '★3' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await flush();
    expect(api.updateLoan).toHaveBeenCalledWith('g1', 'a', { rating: 3, review: null });

    fireEvent.click(screen.getByRole('button', { name: /返却を取り消す/ }));
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    await flush();
    expect(api.undoReturn).toHaveBeenCalledWith('g1', 'a');
  });

  it('返却済み: 読書状況を変更する', async () => {
    state.loan = {
      data: loan('a', { returnedOn: '2026-11-07', readStatus: 'partial' }),
      loading: false,
      error: null,
    };
    renderAt('/loans/a');
    fireEvent.click(screen.getByRole('button', { name: /読書状況/ }));
    const dialog = screen.getByRole('dialog', { name: '返却の内容を変更' });
    fireEvent.click(within(dialog).getByRole('radio', { name: '読んだ' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await flush();
    expect(api.updateLoan).toHaveBeenCalledWith('g1', 'a', { returnedOn: '2026-11-07', readStatus: 'read' });
  });

  it('見つからない場合', () => {
    renderAt('/loans/zzz');
    expect(screen.getByText('この貸出記録は見つかりません')).toBeTruthy();
  });
});
