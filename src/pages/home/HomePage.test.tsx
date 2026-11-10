// @vitest-environment jsdom
/* ホーム画面の表示と操作のテスト（データ層・グループはモック） */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import type { Loan, Location, Member, WithId } from '../../types';
import { ToastProvider } from '../../components/ui/ToastProvider';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const state = vi.hoisted(() => ({
  loans: { data: [] as unknown[], loading: false, error: null as Error | null },
  locations: { data: [] as unknown[], loading: false, error: null as Error | null },
  members: [] as unknown[],
}));

vi.mock('../../data/loans', () => ({
  useActiveLoans: () => state.loans,
}));
vi.mock('../../data/locations', () => ({
  useLocations: () => state.locations,
}));
vi.mock('../../group/GroupProvider', () => {
  const names: Record<string, string> = { u1: 'ママ', u2: 'はなこ' };
  return {
    useGroup: () => ({ members: state.members, memberName: (uid: string) => names[uid] ?? '（不明）' }),
    useRequiredGroup: () => ({
      groupId: 'g1',
      uid: 'u1',
      members: state.members,
      memberName: (uid: string) => names[uid] ?? '（不明）',
    }),
  };
});

import HomePage from './HomePage';

function loan(id: string, patch: Partial<Loan> = {}): WithId<Loan> {
  return {
    id,
    bookId: `book-${id}`,
    book: { title: `本${id}`, authors: [], coverUrl: null, isbn: null },
    locationId: 'L1',
    borrowerUid: 'u1',
    borrowedOn: '2026-11-01',
    dueOn: '2026-11-20',
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

function location(id: string, name: string, archived = false): WithId<Location> {
  return { id, name, defaultLoanDays: 14, memo: '', archived, createdAt: ts, updatedAt: ts };
}

function member(id: string, displayName: string): WithId<Member> {
  return { id, displayName, joinedAt: ts, inviteCode: null };
}

function CurrentUrl() {
  const loc = useLocation();
  return <p data-testid="url">{`${loc.pathname}${loc.search}`}</p>;
}

function renderHome(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <HomePage />
                <CurrentUrl />
              </>
            }
          />
          <Route path="*" element={<CurrentUrl />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T09:00:00'));
  localStorage.clear();
  state.loans = {
    data: [
      loan('a', { locationId: 'L1', dueOn: '2026-11-05', borrowerUid: 'u1' }), // 延滞
      loan('b', { locationId: 'L2', dueOn: '2026-11-09', borrowerUid: 'u2' }), // 3日以内
      loan('c', { locationId: 'L1', dueOn: '2026-11-30', borrowerUid: 'u2' }),
    ],
    loading: false,
    error: null,
  };
  state.locations = {
    data: [location('L1', 'あおば図書館'), location('L2', 'いずみ図書室')],
    loading: false,
    error: null,
  };
  state.members = [member('u1', 'ママ'), member('u2', 'はなこ')];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HomePage', () => {
  it('要約と場所ごとのまとまりを表示する', () => {
    renderHome();
    expect(screen.getByText('延滞 1冊')).toBeTruthy();
    expect(screen.getByText('3日以内 1冊')).toBeTruthy();
    expect(screen.getByText('貸出中 3冊')).toBeTruthy();

    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => within(s).getByRole('heading').textContent)).toEqual([
      'あおば図書館2冊',
      'いずみ図書室1冊',
    ]);
    // セクション内は返却日順
    const first = within(sections[0]).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/loans/'));
    expect(first.map((a) => a.getAttribute('href'))).toEqual(['/loans/a', '/loans/c']);
    // まとめて返却
    expect(within(sections[0]).getByRole('link', { name: /まとめて返却/ }).getAttribute('href')).toBe(
      '/return?location=L1',
    );
  });

  it('返却日順に切り替えると保存し、全体を返却日順に並べる', () => {
    renderHome();
    fireEvent.click(screen.getByRole('radio', { name: '返却日順' }));
    expect(localStorage.getItem('home.viewMode')).toBe('byDue');
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    const rows = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/loans/'));
    expect(rows.map((a) => a.getAttribute('href'))).toEqual(['/loans/a', '/loans/b', '/loans/c']);
  });

  it('保存した表示形式で開く', () => {
    localStorage.setItem('home.viewMode', 'byDue');
    renderHome();
    expect(screen.getByRole('radio', { name: '返却日順' }).getAttribute('aria-checked')).toBe('true');
  });

  it('借りた人で絞り込むと URL に残り、まとめて返却は見えている本だけ', () => {
    renderHome();
    const group = screen.getByRole('group', { name: '借りた人で絞り込み' });
    fireEvent.click(within(group).getByRole('button', { name: /はなこ/ }));
    expect(screen.getByTestId('url').textContent).toBe('/?borrower=u2');
    expect(screen.getByText('貸出中 2冊')).toBeTruthy();
    // いずみ図書室（b, 11/9）→ あおば図書館（c だけ。a はママの本なので含めない）
    expect(screen.getByRole('link', { name: 'いずみ図書室の1冊をまとめて返却' }).getAttribute('href')).toBe(
      '/return?loans=b',
    );
    expect(screen.getByRole('link', { name: 'あおば図書館の1冊をまとめて返却' }).getAttribute('href')).toBe(
      '/return?loans=c',
    );
  });

  it('URL の絞り込み条件で開き、該当なしなら解除ボタンを出す', () => {
    renderHome('/?location=L2&borrower=u1');
    expect(screen.getByText('条件に合う本はありません')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '絞り込みを解除' }));
    expect(screen.getByTestId('url').textContent).toBe('/');
    expect(screen.getByText('貸出中 3冊')).toBeTruthy();
  });

  it('貸出中が 0 件ならスキャンへの案内を出す', () => {
    state.loans = { data: [], loading: false, error: null };
    renderHome();
    expect(screen.getByText('借りている本はありません')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'スキャンして借りた本を登録' }).getAttribute('href')).toBe(
      '/scan?mode=borrow',
    );
  });

  it('場所が 0 件なら場所の登録を促す', () => {
    state.loans = { data: [], loading: false, error: null };
    state.locations = { data: [location('old', '昔の図書館', true)], loading: false, error: null };
    renderHome();
    expect(screen.getByText('まずは本を借りる場所を登録しましょう')).toBeTruthy();
    expect(screen.getByRole('link', { name: '場所を登録する' }).getAttribute('href')).toBe('/settings/locations/new');
  });

  it('読み込み中・エラーを表示する', () => {
    state.loans = { data: [], loading: true, error: null };
    const view = renderHome();
    expect(screen.getByText('貸出中の本を読み込んでいます')).toBeTruthy();
    view.unmount();

    state.loans = { data: [], loading: false, error: new Error('通信できませんでした。') };
    renderHome();
    expect(screen.getByRole('alert').textContent).toContain('通信できませんでした。');
  });

  it('右上に「借りる」ボタン', () => {
    renderHome();
    expect(screen.getByRole('link', { name: '借りる（スキャン）' }).getAttribute('href')).toBe('/scan?mode=borrow');
  });
});
