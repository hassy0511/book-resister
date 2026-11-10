// @vitest-environment jsdom
/* 本の詳細画面の表示・編集・もう一度借りるのテスト（データ層・グループ・カートはモック） */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import type { Book, Loan, Location, Series, WithId } from '../../types';
import { ToastProvider } from '../../components/ui/ToastProvider';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const state = vi.hoisted(() => ({
  book: { data: null as unknown, loading: false, error: null as Error | null },
  loans: { data: [] as unknown[], loading: false, error: null as Error | null },
  locations: { data: [] as unknown[], loading: false, error: null as Error | null },
  series: { data: null as unknown, loading: false, error: null as Error | null },
  seriesList: { data: [] as unknown[], loading: false, error: null as Error | null },
}));

const api = vi.hoisted(() => ({
  updateBook: vi.fn(async () => undefined),
  findOrCreateSeries: vi.fn(async () => 's-new'),
  addExistingBook: vi.fn(() => 'added' as 'added' | 'duplicate'),
  useSeriesArg: vi.fn(),
}));

vi.mock('../../data/books', () => ({
  useBook: () => state.book,
  updateBook: api.updateBook,
}));
vi.mock('../../data/loans', () => ({
  useLoansForBook: () => state.loans,
}));
vi.mock('../../data/locations', () => ({
  useLocations: () => state.locations,
}));
vi.mock('../../data/series', () => ({
  useSeries: (id: string | undefined) => {
    api.useSeriesArg(id);
    return id ? state.series : { data: null, loading: false, error: null };
  },
  useSeriesList: () => state.seriesList,
  findOrCreateSeries: api.findOrCreateSeries,
}));
vi.mock('../../state/borrowCart', () => ({
  useBorrowCart: () => ({ addExistingBook: api.addExistingBook }),
}));
vi.mock('../../group/GroupProvider', () => {
  const names: Record<string, string> = { u1: 'ママ', u2: 'はなこ' };
  const memberName = (uid: string) => names[uid] ?? '（不明）';
  return {
    useGroup: () => ({ members: [], memberName }),
    useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1', members: [], memberName }),
  };
});

import BookDetailPage from './BookDetailPage';

function makeBook(patch: Partial<Book> = {}): WithId<Book> {
  return {
    id: 'isbn-9784591000007',
    isbn: '9784591000007',
    title: 'おしりたんてい かいとうと ねらわれた はな',
    authors: ['トロル'],
    publisher: 'ポプラ社',
    coverUrl: null,
    seriesId: 's1',
    volume: 3,
    source: 'openbd',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
}

function loan(id: string, patch: Partial<Loan> = {}): WithId<Loan> {
  return {
    id,
    bookId: 'isbn-9784591000007',
    book: { title: 'おしりたんてい', authors: ['トロル'], coverUrl: null, isbn: null },
    locationId: 'L1',
    borrowerUid: 'u1',
    borrowedOn: '2026-10-01',
    dueOn: '2026-10-15',
    returnedOn: '2026-10-10',
    readStatus: 'read',
    rating: null,
    review: null,
    createdBy: 'u1',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
}

function series(patch: Partial<WithId<Series>> = {}): WithId<Series> {
  return { id: 's1', name: 'おしりたんてい', totalVolumes: null, createdAt: ts, updatedAt: ts, ...patch };
}

function location(id: string, name: string): WithId<Location> {
  return { id, name, defaultLoanDays: 14, memo: '', archived: false, createdAt: ts, updatedAt: ts };
}

function CurrentUrl() {
  const loc = useLocation();
  return <p data-testid="url">{`${loc.pathname}${loc.search}`}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/books/isbn-9784591000007']}>
      <ToastProvider>
        <Routes>
          <Route path="/books/:bookId" element={<BookDetailPage />} />
          <Route path="*" element={<p>OTHER</p>} />
        </Routes>
        <CurrentUrl />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T09:00:00'));
  Object.values(api).forEach((fn) => fn.mockClear());
  state.book = { data: makeBook(), loading: false, error: null };
  state.loans = {
    data: [
      loan('l3', { borrowedOn: '2026-11-01', dueOn: '2026-11-15', returnedOn: null, readStatus: null, borrowerUid: 'u2' }),
      loan('l2', { borrowedOn: '2026-08-01', returnedOn: '2026-08-10', readStatus: 'partial', rating: 3, review: 'こわかった' }),
      loan('l1', { borrowedOn: '2026-05-01', returnedOn: '2026-05-10', readStatus: 'read', rating: 5, borrowerUid: 'u2', locationId: 'L2' }),
    ],
    loading: false,
    error: null,
  };
  state.locations = { data: [location('L1', 'あおば図書館'), location('L2', 'いずみ図書室')], loading: false, error: null };
  state.series = { data: series(), loading: false, error: null };
  state.seriesList = { data: [series(), series({ id: 's2', name: 'かいけつゾロリ' })], loading: false, error: null };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BookDetailPage', () => {
  it('書誌・シリーズ・読書状況・借りた回数を表示する', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'おしりたんてい かいとうと ねらわれた はな' })).toBeTruthy();
    expect(screen.getByText('トロル')).toBeTruthy();
    expect(screen.getByText('ポプラ社')).toBeTruthy();
    expect(screen.getByText('978-4-591-00000-7')).toBeTruthy();
    expect(screen.getAllByText('貸出中').length).toBeGreaterThan(0); // 貸出中があるので
    const count = screen.getByText('借りた回数').parentElement;
    expect(count?.textContent).toContain('3回');
    const seriesLink = screen.getByRole('link', { name: /おしりたんてい.*3巻/ });
    expect(seriesLink.getAttribute('href')).toBe('/series/s1');
    expect(api.useSeriesArg).toHaveBeenCalledWith('s1');
  });

  it('貸出の記録（いつ・どこで・誰が・返却日・読書状況）を新しい順に並べ、タップで貸出の詳細へ', () => {
    renderPage();
    const section = screen.getByRole('region', { name: /貸出の記録/ });
    const rows = within(section).getAllByRole('link');
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/loans/l3', '/loans/l2', '/loans/l1']);
    expect(within(rows[0]).getByText('貸出中')).toBeTruthy();
    expect(within(rows[0]).getByText('はなこ')).toBeTruthy();
    expect(within(rows[1]).getByText('途中まで')).toBeTruthy();
    expect(within(rows[1]).getByText(/8月10日.*に返却/)).toBeTruthy();
    expect(within(rows[2]).getByText('いずみ図書室')).toBeTruthy();
  });

  it('家族の評価と感想をまとめて表示する', () => {
    renderPage();
    const section = screen.getByRole('region', { name: /家族の感想/ });
    const items = within(section).getAllByRole('link');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('ママ')).toBeTruthy();
    expect(within(items[0]).getByText('こわかった')).toBeTruthy();
    expect(within(items[1]).getByText('はなこ')).toBeTruthy();
    expect(within(section).getByText(/平均 4\.0（2件）/)).toBeTruthy();
  });

  it('「もう一度借りる」でカートに入れて確認画面へ', () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'もう一度借りる' }));
    });
    expect(api.addExistingBook).toHaveBeenCalledTimes(1);
    expect(api.addExistingBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'isbn-9784591000007' }));
    expect(screen.getByTestId('url').textContent).toBe('/borrow/confirm');
  });

  it('編集: 新しいシリーズ名なら findOrCreateSeries してから変わった項目だけ updateBook する', async () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '本の情報を編集' }));
    });
    const dialog = screen.getByRole('dialog', { name: '本の情報を編集' });
    const save = within(dialog).getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    act(() => {
      fireEvent.change(within(dialog).getByLabelText(/著者/), { target: { value: 'トロル、ほか' } });
      fireEvent.change(within(dialog).getByLabelText('シリーズ名'), { target: { value: 'おしりたんてい ミステリー' } });
      fireEvent.change(within(dialog).getByLabelText('巻数'), { target: { value: '1' } });
    });
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    await flush();
    expect(api.findOrCreateSeries).toHaveBeenCalledWith('g1', 'おしりたんてい ミステリー');
    expect(api.updateBook).toHaveBeenCalledWith('g1', 'isbn-9784591000007', {
      authors: ['トロル', 'ほか'],
      seriesId: 's-new',
      volume: 1,
    });
    expect(screen.getByText('本の情報を保存しました')).toBeTruthy();
  });

  it('編集: シリーズ名が同じ（表記の揺れだけ）ならシリーズは作らない。タイトルが空なら保存できない', async () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '本の情報を編集' }));
    });
    const dialog = screen.getByRole('dialog', { name: '本の情報を編集' });
    const save = within(dialog).getByRole('button', { name: '保存' }) as HTMLButtonElement;

    act(() => {
      fireEvent.change(within(dialog).getByLabelText(/タイトル/), { target: { value: '  ' } });
    });
    expect(within(dialog).getByText('タイトルを入力してください')).toBeTruthy();
    expect(save.disabled).toBe(true);

    act(() => {
      fireEvent.change(within(dialog).getByLabelText(/タイトル/), { target: { value: '新しいタイトル' } });
      fireEvent.change(within(dialog).getByLabelText('シリーズ名'), { target: { value: 'おしりたんていシリーズ' } });
    });
    await act(async () => {
      fireEvent.click(save);
    });
    await flush();
    expect(api.findOrCreateSeries).not.toHaveBeenCalled();
    expect(api.updateBook).toHaveBeenCalledWith('g1', 'isbn-9784591000007', { title: '新しいタイトル' });
  });

  it('編集: 保存に失敗したらエラーのトーストを出してシートは開いたまま', async () => {
    api.updateBook.mockRejectedValueOnce(new Error('通信できませんでした'));
    renderPage();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '本の情報を編集' }));
    });
    const dialog = screen.getByRole('dialog', { name: '本の情報を編集' });
    act(() => {
      fireEvent.change(within(dialog).getByLabelText('出版社'), { target: { value: '' } });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    });
    await flush();
    expect(api.updateBook).toHaveBeenCalledWith('g1', 'isbn-9784591000007', { publisher: null });
    expect(screen.getByText('通信できませんでした')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '本の情報を編集' })).toBeTruthy();
  });

  it('シリーズ未設定・貸出なしの本', () => {
    state.book = { data: makeBook({ seriesId: null, volume: null, isbn: null, publisher: null }), loading: false, error: null };
    state.loans = { data: [], loading: false, error: null };
    renderPage();
    expect(screen.getByText('シリーズ未設定')).toBeTruthy();
    expect(screen.getByText('まだ借りたことはありません')).toBeTruthy();
    expect(screen.getByText('まだ感想はありません')).toBeTruthy();
    expect(screen.getByText('まだ借りていない')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'この本を借りる' })).toBeTruthy();
  });

  it('見つからない本', () => {
    state.book = { data: null, loading: false, error: null };
    renderPage();
    expect(screen.getByText('この本は見つかりません')).toBeTruthy();
  });
});
