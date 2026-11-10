// @vitest-environment jsdom
/* シリーズ一覧・シリーズ詳細の表示と操作のテスト（データ層・グループはモック） */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import type { Book, Loan, ReadStatus, Series, WithId } from '../../types';
import { ToastProvider } from '../../components/ui/ToastProvider';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const state = vi.hoisted(() => ({
  series: { data: null as unknown, loading: false, error: null as Error | null },
  seriesList: { data: [] as unknown[], loading: false, error: null as Error | null },
  booksInSeries: { data: [] as unknown[], loading: false, error: null as Error | null },
  books: { data: [] as unknown[], loading: false, error: null as Error | null },
  loansForBooks: { data: [] as unknown[], loading: false, error: null as Error | null },
  allLoans: { data: [] as unknown[], loading: false, error: null as Error | null },
}));

const api = vi.hoisted(() => ({
  updateSeries: vi.fn(async () => undefined),
  mergeSeries: vi.fn(async () => undefined),
  deleteSeries: vi.fn(async () => undefined),
  loansForBooksArg: vi.fn(),
}));

vi.mock('../../data/series', () => ({
  useSeries: () => state.series,
  useSeriesList: () => state.seriesList,
  updateSeries: api.updateSeries,
  mergeSeries: api.mergeSeries,
  deleteSeries: api.deleteSeries,
}));
vi.mock('../../data/books', () => ({
  useSeriesBooks: () => state.books,
  useBooksInSeries: () => state.booksInSeries,
}));
vi.mock('../../data/loans', () => ({
  useAllLoans: () => state.allLoans,
  useLoansForBooks: (ids: string[]) => {
    api.loansForBooksArg(ids);
    return state.loansForBooks;
  },
}));
vi.mock('../../group/GroupProvider', () => {
  const memberName = () => 'ママ';
  return {
    useGroup: () => ({ members: [], memberName }),
    useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1', members: [], memberName }),
  };
});

import SeriesListPage from './SeriesListPage';
import SeriesDetailPage from './SeriesDetailPage';

function series(id: string, name: string, totalVolumes: number | null = null): WithId<Series> {
  return { id, name, totalVolumes, createdAt: ts, updatedAt: ts };
}

function book(id: string, volume: number | null, seriesId: string | null = 's1', title = `本${id}`): WithId<Book> {
  return {
    id,
    isbn: null,
    title,
    authors: [],
    publisher: null,
    coverUrl: null,
    seriesId,
    volume,
    source: 'manual',
    createdAt: ts,
    updatedAt: ts,
  };
}

let loanSeq = 0;
function loan(bookId: string, readStatus: ReadStatus | null, borrowedOn = '2026-10-01', returned = true): WithId<Loan> {
  loanSeq += 1;
  return {
    id: `loan${loanSeq}`,
    bookId,
    book: { title: bookId, authors: [], coverUrl: null, isbn: null },
    locationId: 'L1',
    borrowerUid: 'u1',
    borrowedOn,
    dueOn: '2026-11-20',
    returnedOn: returned ? '2026-10-15' : null,
    readStatus: returned ? readStatus : null,
    rating: null,
    review: null,
    createdBy: 'u1',
    createdAt: ts,
    updatedAt: ts,
  };
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
          <Route path="/series" element={<SeriesListPage />} />
          <Route path="/series/:seriesId" element={<SeriesDetailPage />} />
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
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T09:00:00'));
  api.updateSeries.mockClear();
  api.mergeSeries.mockClear();
  api.deleteSeries.mockClear();
  api.loansForBooksArg.mockClear();
  localStorage.clear();
  loanSeq = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SeriesDetailPage', () => {
  beforeEach(() => {
    state.series = { data: series('s1', 'おしりたんてい', 9), loading: false, error: null };
    state.seriesList = { data: [series('s1', 'おしりたんてい', 9)], loading: false, error: null };
    state.booksInSeries = {
      data: [
        book('b1', 1),
        book('b3a', 3, 's1', '3巻（初版）'),
        book('b3b', 3, 's1', '3巻（新装版）'),
        book('b4', 4),
        book('b6', 6),
        book('x', null, 's1', 'おしりたんてい ファイル'),
      ],
      loading: false,
      error: null,
    };
    state.loansForBooks = {
      data: [
        loan('b1', 'read'),
        loan('b3a', 'unread'),
        loan('b3b', 'partial'),
        loan('b4', null, '2026-11-01', false),
        loan('b6', 'unread'),
        loan('x', 'read'),
      ],
      loading: false,
      error: null,
    };
  });

  it('巻ごとの状態をマス目で表示し、まだ借りていない巻を範囲表記でまとめる', () => {
    renderAt('/series/s1');
    expect(screen.getByRole('heading', { name: 'おしりたんてい', level: 1 })).toBeTruthy();
    const grid = screen.getByRole('list', { name: '巻ごとの状況' });
    const cells = within(grid).getAllByRole('listitem');
    expect(cells).toHaveLength(9);
    expect(within(grid).getByRole('link', { name: '1巻 読んだ' }).getAttribute('href')).toBe('/books/b1');
    expect(within(grid).getByRole('img', { name: '2巻 まだ借りていない' })).toBeTruthy();
    expect(within(grid).getByRole('button', { name: '3巻 途中まで、2冊あります' })).toBeTruthy();
    expect(within(grid).getByRole('link', { name: '4巻 貸出中' })).toBeTruthy();
    expect(within(grid).getByRole('link', { name: '6巻 読んでいない' })).toBeTruthy();
    expect(screen.getByText('まだ借りていない巻：')).toBeTruthy();
    expect(screen.getByText('2, 5, 7〜9')).toBeTruthy();
    expect(api.loansForBooksArg).toHaveBeenLastCalledWith(['b1', 'b3a', 'b3b', 'b4', 'b6', 'x']);
  });

  it('前に読んだ巻をもう一度借りている間は、貸出中の色に読んだ印を添え、「読んだ」の巻数にも数える', () => {
    state.series = { data: series('s1', 'おしりたんてい', 3), loading: false, error: null };
    state.booksInSeries = { data: [book('b1', 1), book('b2', 2)], loading: false, error: null };
    state.loansForBooks = {
      data: [loan('b1', 'read', '2026-09-01'), loan('b1', null, '2026-11-01', false), loan('b2', 'read')],
      loading: false,
      error: null,
    };
    renderAt('/series/s1');
    const grid = screen.getByRole('list', { name: '巻ごとの状況' });
    const cell1 = within(grid).getByRole('link', { name: '1巻 貸出中（前に読んだ）' });
    expect(cell1.className).toContain('stateReading');
    expect(within(grid).getByRole('link', { name: '2巻 読んだ' })).toBeTruthy();
    // 要約の「読んだ」は 2巻（マス目の読んだ印と合う）
    expect(screen.getByText('読んだ', { selector: 'dt' }).parentElement?.textContent).toBe('読んだ2巻');
    expect(screen.getByText(/の付いた貸出中の巻は、前に読んだ巻です/)).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: '一覧' }));
    });
    const list = screen.getByRole('list', { name: '巻ごとの状況' });
    expect(within(list).getByText('貸出中（前に読んだ）')).toBeTruthy();
  });

  it('前に読んだ巻が無ければ、読んだ印の説明は出さない', () => {
    renderAt('/series/s1');
    expect(screen.queryByText(/前に読んだ巻です/)).toBeNull();
    expect(screen.getByText('読んだ', { selector: 'dt' }).parentElement?.textContent).toBe('読んだ1巻');
  });

  it('同じ巻に複数の本があればタップで選べる', () => {
    renderAt('/series/s1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '3巻 途中まで、2冊あります' }));
    });
    const dialog = screen.getByRole('dialog', { name: '3巻の本（2冊）' });
    const links = within(dialog).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/books/b3a', '/books/b3b']);
  });

  it('巻数が未設定の本は「巻数なし」に分ける', () => {
    renderAt('/series/s1');
    const section = screen.getByRole('region', { name: /巻数なし/ });
    expect(within(section).getByRole('link', { name: /おしりたんてい ファイル/ }).getAttribute('href')).toBe('/books/x');
  });

  it('一覧表示に切り替えると、本の無い巻は連続をまとめて 1 行にする', () => {
    renderAt('/series/s1');
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: '一覧' }));
    });
    const list = screen.getByRole('list', { name: '巻ごとの状況' });
    const items = within(list).getAllByRole('listitem');
    // 1, 2(空), 3a, 3b, 4, 5(空), 6, 7〜9(空)
    expect(items).toHaveLength(8);
    expect(items[7].textContent).toContain('7〜9');
    expect(localStorage.getItem('seriesVolumeView')).toBe('list');
  });

  it('全巻数が無ければ借りた巻の最大値までの抜け番を出し、設定を促す', () => {
    state.series = { data: series('s1', 'おしりたんてい', null), loading: false, error: null };
    renderAt('/series/s1');
    expect(screen.getByText('抜けている巻：')).toBeTruthy();
    expect(screen.getByText('2, 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: '全巻数を設定' })).toBeTruthy();
    expect(screen.getByText('未設定')).toBeTruthy();
  });

  it('シリーズ名と全巻数を編集して保存する', async () => {
    renderAt('/series/s1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'シリーズを編集' }));
    });
    const dialog = screen.getByRole('dialog', { name: 'シリーズを編集' });
    const save = within(dialog).getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    act(() => {
      fireEvent.change(within(dialog).getByLabelText('全巻数'), { target: { value: '12' } });
    });
    await act(async () => {
      fireEvent.click(save);
    });
    await flush();
    expect(api.updateSeries).toHaveBeenCalledWith('g1', 's1', { totalVolumes: 12 });
    expect(screen.getByText('シリーズを保存しました')).toBeTruthy();
  });

  it('同じ名前のシリーズがほかにもあれば、そちらにまとめてその画面へ移る', async () => {
    state.seriesList = {
      data: [series('s1', 'おしりたんてい', 9), series('s0', 'おしりたんてい', null)],
      loading: false,
      error: null,
    };
    renderAt('/series/s1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'シリーズを編集' }));
    });
    const dialog = screen.getByRole('dialog', { name: 'シリーズを編集' });
    expect(within(dialog).getByText(/同じ名前のシリーズ「おしりたんてい」がほかにもあります/)).toBeTruthy();
    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: '「おしりたんてい」にまとめる' }));
    });
    const confirm = screen.getByRole('dialog', { name: '「おしりたんてい」にまとめますか？' });
    expect(within(confirm).getByText(/本 6冊を「おしりたんてい」に移し/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'まとめる' }));
    });
    await flush();
    expect(api.mergeSeries).toHaveBeenCalledWith('g1', 's1', 's0');
    expect(screen.getByTestId('url').textContent).toBe('/series/s0');
  });

  it('シリーズを削除すると、本をシリーズから外して一覧へ戻る', async () => {
    renderAt('/series/s1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'シリーズを編集' }));
    });
    const dialog = screen.getByRole('dialog', { name: 'シリーズを編集' });
    expect(within(dialog).queryByRole('button', { name: /にまとめる/ })).toBeNull();
    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'シリーズを削除' }));
    });
    const confirm = screen.getByRole('dialog', { name: 'シリーズ「おしりたんてい」を削除しますか？' });
    expect(within(confirm).getByText(/本 6冊はシリーズから外れます/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: '削除する' }));
    });
    await flush();
    expect(api.deleteSeries).toHaveBeenCalledWith('g1', 's1', { detachBooks: true });
    expect(screen.getByTestId('url').textContent).toBe('/series');
  });

  it('本が無いシリーズ・見つからないシリーズ', () => {
    state.booksInSeries = { data: [], loading: false, error: null };
    state.loansForBooks = { data: [], loading: false, error: null };
    const { unmount } = renderAt('/series/s1');
    expect(screen.getByText('このシリーズの本はまだありません')).toBeTruthy();
    unmount();
    state.series = { data: null, loading: false, error: null };
    renderAt('/series/s1');
    expect(screen.getByText('このシリーズは見つかりません')).toBeTruthy();
  });

  it('貸出記録の読み込み中はスピナー', () => {
    state.loansForBooks = { data: [], loading: true, error: null };
    renderAt('/series/s1');
    expect(screen.getByText('シリーズを読み込んでいます')).toBeTruthy();
  });
});

describe('SeriesListPage', () => {
  beforeEach(() => {
    state.seriesList = {
      data: [series('s1', 'おしりたんてい'), series('s2', 'かいけつゾロリ', 70), series('s3', 'ノンタン')],
      loading: false,
      error: null,
    };
    state.books = {
      data: [book('o1', 1, 's1'), book('o2', 2, 's1'), book('z1', 1, 's2'), book('n1', null, 's3'), book('free', null, null)],
      loading: false,
      error: null,
    };
    state.allLoans = {
      data: [
        loan('o1', 'read', '2026-06-01'),
        loan('o2', 'partial', '2026-07-01'),
        loan('z1', 'read', '2026-10-01'),
      ],
      loading: false,
      error: null,
    };
  });

  function rowNames(): string[] {
    return screen.getAllByRole('link').map((a) => a.querySelector('span span')?.textContent ?? '');
  }

  it('最後に借りた日の新しい順に、借りた巻数・全巻数・読んだ巻数を表示する', () => {
    renderAt('/series');
    expect(rowNames()).toEqual(['かいけつゾロリ', 'おしりたんてい', 'ノンタン']);
    const zorori = screen.getByRole('link', { name: /かいけつゾロリ/ });
    expect(zorori.getAttribute('href')).toBe('/series/s2');
    expect(within(zorori).getByText('借りた 1巻／全70巻')).toBeTruthy();
    expect(within(zorori).getByText('読んだ 1巻')).toBeTruthy();
    expect(within(zorori).getByText(/最後に借りた日 10月1日/)).toBeTruthy();
    const oshiri = screen.getByRole('link', { name: /おしりたんてい/ });
    expect(within(oshiri).getByText('借りた 2巻')).toBeTruthy();
    expect(within(oshiri).getByText('読んだ 1巻')).toBeTruthy();
    const nontan = screen.getByRole('link', { name: /ノンタン/ });
    expect(within(nontan).getByText('巻数なし 1冊')).toBeTruthy();
    expect(within(nontan).getByText('まだ借りていません')).toBeTruthy();
  });

  it('名前で検索する（カタカナ・ひらがなの揺れを吸収）', () => {
    renderAt('/series');
    act(() => {
      fireEvent.change(screen.getByRole('searchbox', { name: 'シリーズ名で検索' }), { target: { value: 'ぞろり' } });
    });
    expect(rowNames()).toEqual(['かいけつゾロリ']);
    expect(screen.getByTestId('url').textContent).toContain('q=');
  });

  it('シリーズが無いときは自動で作られることを説明する', () => {
    state.seriesList = { data: [], loading: false, error: null };
    renderAt('/series');
    expect(screen.getByText('シリーズはまだありません')).toBeTruthy();
    expect(screen.getByText(/借りた本のタイトルから、シリーズは自動で作られます/)).toBeTruthy();
    expect(screen.getByText(/本の詳細の「編集」でシリーズ名と巻数を設定できます/)).toBeTruthy();
  });
});
