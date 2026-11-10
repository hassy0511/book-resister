// @vitest-environment jsdom
/* スキャン・本の追加・借りる本の確認の画面テスト（データ層・書誌検索・カメラはモック。カートは本物） */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import type { Book, BookCandidate, Loan, Location, Member, Series, WithId } from '../../types';
import { ToastProvider } from '../../components/ui/ToastProvider';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const state = vi.hoisted(() => ({
  books: { data: [] as unknown[], loading: false, error: null as Error | null },
  active: { data: [] as unknown[], loading: false, error: null as Error | null },
  bookLoans: { data: [] as unknown[], loading: false, error: null as Error | null },
  locations: { data: [] as unknown[], loading: false, error: null as Error | null },
  series: { data: [] as unknown[], loading: false, error: null as Error | null },
  members: [] as unknown[],
}));

const api = vi.hoisted(() => ({
  lookupByIsbn: vi.fn(),
  searchByTitle: vi.fn(),
  /** true なら、見つからなかったときに通信の失敗（failed）として返す */
  lookupFailed: false,
  getBook: vi.fn(),
  findBookForCandidate: vi.fn(),
  upsertBookFromCandidate: vi.fn(),
  updateBook: vi.fn(),
  createLoans: vi.fn(),
  findOrCreateSeries: vi.fn(),
}));

vi.mock('../../group/GroupProvider', () => {
  const names: Record<string, string> = { u1: 'ママ', u2: 'はなこ' };
  const memberName = (uid: string) => names[uid] ?? '（不明）';
  return {
    useGroup: () => ({ groupId: 'g1', loading: false, members: state.members, memberName }),
    useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1', loading: false, members: state.members, memberName }),
  };
});
vi.mock('../../data/books', () => {
  type B = { id: string; isbn: string | null; seriesId: string | null };
  const books = () => state.books.data as B[];
  const subset = (pred: (b: B) => boolean) => ({ ...state.books, data: books().filter(pred) });
  return {
    useBooks: () => state.books,
    useBook: (id: string | undefined) => ({
      data: books().find((b) => b.id === id) ?? null,
      loading: state.books.loading,
      error: state.books.error,
    }),
    useBooksByIds: (ids: readonly string[]) => subset((b) => ids.includes(b.id)),
    useBooksWithoutIsbn: () => subset((b) => b.isbn === null),
    useBooksInSeries: (seriesId: string | undefined) => subset((b) => seriesId !== undefined && b.seriesId === seriesId),
    getBook: api.getBook,
    findBookForCandidate: api.findBookForCandidate,
    upsertBookFromCandidate: api.upsertBookFromCandidate,
    // 本物と同じく、結び付けた本の ID と、既存の本ならその内容を返す
    saveBookFromCandidate: async (gid: string, c: unknown, series: unknown, opts: unknown) => {
      const id = (await api.upsertBookFromCandidate(gid, c, series, opts)) as string;
      return { id, existing: books().find((b) => b.id === id) ?? null };
    },
    updateBook: api.updateBook,
  };
});
vi.mock('../../data/loans', () => ({
  useActiveLoans: () => state.active,
  useLoansForBooks: () => state.bookLoans,
  useLoansForBook: () => state.bookLoans,
  createLoans: api.createLoans,
}));
vi.mock('../../data/locations', () => ({
  useLocations: () => state.locations,
}));
vi.mock('../../data/series', () => ({
  useSeriesList: () => state.series,
  findOrCreateSeries: api.findOrCreateSeries,
}));
vi.mock('../../lib/bookLookup', () => ({
  lookupByIsbn: api.lookupByIsbn,
  searchByTitle: api.searchByTitle,
  lookupByIsbnDetailed: async (isbn: string, opts?: unknown) => {
    const candidate = (await api.lookupByIsbn(isbn, opts)) as BookCandidate | null;
    return { candidate, failed: candidate === null && api.lookupFailed };
  },
  searchByTitleDetailed: async (q: string, opts?: unknown) => {
    const candidates = (await api.searchByTitle(q, opts)) as BookCandidate[];
    return { candidates, failed: candidates.length === 0 && api.lookupFailed };
  },
}));
vi.mock('../home/useToday', () => ({ useToday: () => '2026-11-08' }));
// カメラの代わりに「読み取り」ボタンを出す
vi.mock('../../components/scanner', () => ({
  BarcodeScanner: ({ onDetect, active }: { onDetect: (isbn: string) => void; active: boolean }) => (
    <div>
      <p>{active ? 'カメラ動作中' : 'カメラ停止中'}</p>
      <button type="button" onClick={() => onDetect('9784834000825')}>
        読み取り1
      </button>
      <button type="button" onClick={() => onDetect('9784591005262')}>
        読み取り2
      </button>
    </div>
  ),
}));

import { BorrowCartProvider, useBorrowCart, type BorrowCart } from '../../state/borrowCart';
import ScanPage from '../scan/ScanPage';
import AddBookPage from './AddBookPage';
import BorrowConfirmPage from './BorrowConfirmPage';

const ISBN1 = '9784834000825';
const ISBN2 = '9784591005262';

function cand(patch: Partial<BookCandidate> = {}): BookCandidate {
  return {
    isbn: ISBN1,
    title: 'ぐりとぐら',
    authors: ['なかがわりえこ'],
    publisher: '福音館書店',
    coverUrl: null,
    seriesName: null,
    volume: null,
    source: 'openbd',
    ...patch,
  };
}

function location(id: string, name: string, days = 14): WithId<Location> {
  return { id, name, defaultLoanDays: days, memo: '', archived: false, createdAt: ts, updatedAt: ts };
}

function member(id: string, displayName: string): WithId<Member> {
  return { id, displayName, joinedAt: ts, inviteCode: null };
}

function loan(id: string, patch: Partial<Loan> = {}): WithId<Loan> {
  return {
    id,
    bookId: `isbn-${ISBN1}`,
    book: { title: 'ぐりとぐら', authors: [], coverUrl: null, isbn: ISBN1 },
    locationId: 'L1',
    borrowerUid: 'u2',
    borrowedOn: '2025-03-02',
    dueOn: '2025-03-16',
    returnedOn: '2025-03-10',
    readStatus: 'read',
    rating: null,
    review: null,
    createdBy: 'u1',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
}

function book(patch: Partial<WithId<Book>> = {}): WithId<Book> {
  return {
    id: `isbn-${ISBN1}`,
    isbn: ISBN1,
    title: 'ぐりとぐら',
    authors: ['なかがわりえこ'],
    publisher: null,
    coverUrl: null,
    seriesId: null,
    volume: null,
    source: 'openbd',
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
}

function series(id: string, name: string, totalVolumes: number | null = null): WithId<Series> {
  return { id, name, totalVolumes, createdAt: ts, updatedAt: ts };
}

let cart: BorrowCart;
function CartProbe() {
  cart = useBorrowCart();
  return null;
}

function CurrentUrl() {
  const loc = useLocation();
  return <p data-testid="url">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string, extra?: ReactNode) {
  return render(
    <ToastProvider>
      <BorrowCartProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<p>PAGE:home</p>} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/borrow/confirm" element={<BorrowConfirmPage />} />
            <Route path="/borrow/add" element={<AddBookPage />} />
            <Route path="*" element={<p>PAGE:other</p>} />
          </Routes>
          <CurrentUrl />
          <CartProbe />
          {extra}
        </MemoryRouter>
      </BorrowCartProvider>
    </ToastProvider>,
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
  state.books = { data: [], loading: false, error: null };
  state.active = { data: [], loading: false, error: null };
  state.bookLoans = { data: [], loading: false, error: null };
  state.locations = { data: [location('L1', '中央図書館', 14)], loading: false, error: null };
  state.series = { data: [], loading: false, error: null };
  state.members = [member('u1', 'ママ'), member('u2', 'はなこ')];
  api.lookupByIsbn.mockReset().mockResolvedValue(null);
  api.searchByTitle.mockReset().mockResolvedValue([]);
  api.lookupFailed = false;
  api.getBook.mockReset().mockResolvedValue(null);
  api.findBookForCandidate.mockReset().mockResolvedValue(null);
  api.upsertBookFromCandidate.mockReset().mockImplementation(async (_gid: string, c: BookCandidate) =>
    c.isbn ? `isbn-${c.isbn}` : 'new-book',
  );
  api.updateBook.mockReset().mockResolvedValue(undefined);
  api.createLoans.mockReset().mockResolvedValue(['loan-1']);
  api.findOrCreateSeries.mockReset().mockResolvedValue('s-new');
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.tabbar;
});

describe('ScanPage（借りる）', () => {
  it('読み取るとカートに追加し、通知と「次へ」を出す。重複は「すでに追加済み」', async () => {
    api.lookupByIsbn.mockResolvedValue(cand());
    renderAt('/scan');
    expect(screen.getByRole('button', { name: '次へ（0冊）' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByText('読み取り1'));
    expect(screen.getByText(/追加：タイトルを取得中/)).toBeTruthy();
    await flush();
    expect(screen.getByText('追加：ぐりとぐら')).toBeTruthy();

    fireEvent.click(screen.getByText('読み取り1'));
    expect(screen.getByText('すでに追加済み：ぐりとぐら')).toBeTruthy();
    expect(cart.items).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '次へ（1冊）' }));
    expect(screen.getByTestId('url').textContent).toBe('/borrow/confirm');
  });

  it('通信の失敗で取れなかった本は通知で知らせ、もう一度読み取ると取り直す', async () => {
    api.lookupFailed = true;
    renderAt('/scan');
    fireEvent.click(screen.getByText('読み取り1'));
    await flush();
    expect(screen.getByText(/検索サービスにつながりませんでした/)).toBeTruthy();
    expect(cart.items[0].status).toBe('error');

    api.lookupByIsbn.mockResolvedValue(cand());
    fireEvent.click(screen.getByText('読み取り1'));
    expect(screen.getByText('すでに追加済みです（本の情報を取り直しています…）')).toBeTruthy();
    await flush();
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].status).toBe('ready');
    expect(api.lookupByIsbn).toHaveBeenCalledTimes(2);
  });

  it('サムネイルをタップするとリストから外せる', async () => {
    api.lookupByIsbn.mockResolvedValue(cand());
    renderAt('/scan?mode=borrow');
    fireEvent.click(screen.getByText('読み取り1'));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'ぐりとぐら（タップで外す）' }));
    expect(screen.getByText('カメラ停止中')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '外す' }));
    await flush();
    expect(cart.items).toHaveLength(0);
  });
});

describe('ScanPage（確認）', () => {
  it('グループに無い本は書誌と「まだ借りたことがありません」。この本を借りるで確認画面へ', async () => {
    api.lookupByIsbn.mockResolvedValue(cand({ isbn: ISBN2, title: 'からすのパンやさん' }));
    renderAt('/scan?mode=check');
    fireEvent.click(screen.getByText('読み取り2'));
    expect(screen.getByText('カメラ停止中')).toBeTruthy();
    await flush();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('からすのパンやさん')).toBeTruthy();
    expect(within(dialog).getByText('まだ借りたことがありません')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'この本を借りる' }));
    expect(screen.getByTestId('url').textContent).toBe('/borrow/confirm');
    expect(cart.items[0]).toMatchObject({ isbn: ISBN2, status: 'ready' });
  });

  it('グループに無い本は、書誌の取得を待たずに「まだ借りたことがありません」を出す', async () => {
    let resolveLookup: (c: BookCandidate | null) => void = () => undefined;
    api.lookupByIsbn.mockImplementation(
      () =>
        new Promise<BookCandidate | null>((resolve) => {
          resolveLookup = resolve;
        }),
    );
    renderAt('/scan?mode=check');
    fireEvent.click(screen.getByText('読み取り2'));
    await flush();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('まだ借りたことがありません')).toBeTruthy();
    expect(within(dialog).getByText('本の情報を取得しています…')).toBeTruthy();
    // 取得中は「見つかりませんでした」や手入力の案内を出さない
    expect(within(dialog).queryByText('本の情報が見つかりませんでした')).toBeNull();
    expect(within(dialog).queryByText(/タイトルを入力して登録できます/)).toBeNull();
    // 取得中でも借りられる（カート側で取得し直す）
    expect(within(dialog).getByRole('button', { name: 'この本を借りる' })).toHaveProperty('disabled', false);

    await act(async () => {
      resolveLookup(cand({ isbn: ISBN2, title: 'からすのパンやさん' }));
    });
    expect(within(dialog).getByText('からすのパンやさん')).toBeTruthy();
    expect(within(dialog).queryByText('本の情報を取得しています…')).toBeNull();
  });

  it('書誌の取得は 10 秒で打ち切り、確かめられなかった扱い（つながりませんでした・再取得）にする', async () => {
    api.lookupByIsbn.mockImplementation(
      (_isbn: string, opts: { signal?: AbortSignal }) =>
        new Promise<BookCandidate | null>((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(null));
        }),
    );
    vi.useFakeTimers();
    try {
      renderAt('/scan?mode=check');
      fireEvent.click(screen.getByText('読み取り2'));
      await act(async () => {
        await Promise.resolve();
      });
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('本の情報を取得しています…')).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(9_999);
      });
      expect(within(dialog).getByText('本の情報を取得しています…')).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(within(dialog).getByText('検索サービスにつながりませんでした')).toBeTruthy();
      expect(within(dialog).getByText(/タイトルを入力して登録できます/)).toBeTruthy();
      // 再取得すると取り直す
      api.lookupByIsbn.mockResolvedValue(cand({ isbn: ISBN2, title: 'からすのパンやさん' }));
      fireEvent.click(within(dialog).getByRole('button', { name: '本の情報を再取得' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(within(dialog).getByText('からすのパンやさん')).toBeTruthy();
      expect(api.lookupByIsbn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('書誌がどこにも無ければ「見つかりませんでした」、通信の失敗なら「つながりませんでした」', async () => {
    renderAt('/scan?mode=check');
    fireEvent.click(screen.getByText('読み取り2'));
    await flush();
    expect(within(screen.getByRole('dialog')).getByText('本の情報が見つかりませんでした')).toBeTruthy();
    cleanup();

    api.lookupFailed = true;
    renderAt('/scan?mode=check');
    fireEvent.click(screen.getByText('読み取り2'));
    await flush();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('検索サービスにつながりませんでした')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '本の情報を再取得' })).toBeTruthy();
  });

  it('書誌のタイトルが ISBN なしで登録した本と同じなら、その本の履歴と詳細へのリンクを出す（同じ本とは決めつけない）', async () => {
    state.books = {
      data: [book({ id: 'm1', isbn: null, title: 'おしりたんてい ププッ ゆうれいなんてこわくない', source: 'manual' })],
      loading: false,
      error: null,
    };
    state.bookLoans = {
      data: [loan('m-old', { bookId: 'm1', borrowerUid: 'u1' }), loan('other', { bookId: 'zzz' })],
      loading: false,
      error: null,
    };
    api.lookupByIsbn.mockResolvedValue(cand({ isbn: ISBN2, title: 'おしりたんてい ププッゆうれいなんてこわくない' }));
    renderAt('/scan?mode=check');
    fireEvent.click(screen.getByText('読み取り2'));
    await flush();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('まだ借りたことがありません')).toBeTruthy();
    expect(within(dialog).getByText(/ISBN なしで登録した同じタイトルの本があります/)).toBeTruthy();
    const section = within(dialog).getByRole('region', { name: 'ISBN なしで登録した同じタイトルの本' });
    expect(within(section).getByText('これまでに1回')).toBeTruthy();
    expect(within(section).getByText('2025年3月2日')).toBeTruthy();
    expect(within(section).getByRole('link', { name: /この本の詳細を見る/ }).getAttribute('href')).toBe('/books/m1');
  });

  it('借りたことがある本は履歴・貸出中・シリーズの状況を出す', async () => {
    state.books = {
      data: [
        book({ seriesId: 's1', volume: 2 }),
        book({ id: 'b1', isbn: null, title: 'ぐりとぐら 1', seriesId: 's1', volume: 1 }),
      ],
      loading: false,
      error: null,
    };
    state.series = { data: [series('s1', 'ぐりとぐら', 4)], loading: false, error: null };
    state.bookLoans = {
      data: [
        loan('a', { borrowerUid: 'u1', returnedOn: null, readStatus: null, borrowedOn: '2026-11-01', dueOn: '2026-11-15' }),
        loan('b'),
        loan('c', { bookId: 'b1' }),
      ],
      loading: false,
      error: null,
    };
    renderAt('/scan?mode=check');
    fireEvent.click(screen.getByText('読み取り1'));
    await flush();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('借りたことがあります')).toBeTruthy();
    expect(within(dialog).getByText(/いまママが中央図書館で借りています/)).toBeTruthy();
    expect(within(dialog).getAllByText('2025年3月2日').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('シリーズの画面を見る')).toBeTruthy();
    // 続けて確認するでカメラ再開
    fireEvent.click(within(dialog).getByRole('button', { name: '続けて確認する' }));
    expect(screen.getByText('カメラ動作中')).toBeTruthy();
    expect(api.lookupByIsbn).not.toHaveBeenCalled();
  });
});

describe('AddBookPage', () => {
  it('タイトルで検索して追加し、確認画面へ進める', async () => {
    api.searchByTitle.mockResolvedValue([
      cand({ isbn: null, title: 'ぐりとぐらのおきゃくさま', authors: ['ほかのひと'] }),
      cand({ isbn: ISBN2, title: 'ぐりとぐらのえんそく' }),
    ]);
    renderAt('/borrow/add');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'ぐりとぐら' } });
    fireEvent.change(screen.getByLabelText('著者（任意）'), { target: { value: 'なかがわ' } });
    fireEvent.click(screen.getByRole('button', { name: '検索する' }));
    await flush();
    expect(api.searchByTitle).toHaveBeenCalledWith('ぐりとぐら', expect.anything());
    const buttons = screen.getAllByRole('button', { name: /を追加$/ });
    // 著者が一致するものが先
    expect(buttons[0].getAttribute('aria-label')).toBe('ぐりとぐらのえんそくを追加');
    fireEvent.click(buttons[0]);
    expect(screen.getByText('追加しました')).toBeTruthy();
    expect(cart.items).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '借りる内容の確認へ（1冊）' }));
    expect(screen.getByTestId('url').textContent).toBe('/borrow/confirm');
  });

  it('検索サービスとの通信に失敗したら「見つかりませんでした」ではなく「つながりませんでした」', async () => {
    api.lookupFailed = true;
    renderAt('/borrow/add');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'ぐりとぐら' } });
    fireEvent.click(screen.getByRole('button', { name: '検索する' }));
    await flush();
    expect(screen.getByText('検索サービスにつながりませんでした')).toBeTruthy();
    expect(screen.getByText(/電波のよい場所でもう一度検索するか、手入力で追加してください/)).toBeTruthy();
    expect(screen.queryByText(/ひらがな・カタカナを変えたり/)).toBeNull();
    expect(screen.getByRole('button', { name: '手入力で追加する' })).toBeTruthy();
  });

  it('以前に登録した本をタイトルの部分一致で出す', () => {
    state.books = { data: [book({ id: 'b9', isbn: null, title: 'ノンタン ぶらんこのせて' })], loading: false, error: null };
    renderAt('/borrow/add');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'のんたん' } });
    expect(screen.queryByText('ノンタン ぶらんこのせて')).toBeNull();
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'ノンタン' } });
    fireEvent.click(screen.getByRole('button', { name: 'ノンタン ぶらんこのせてを追加' }));
    expect(cart.items[0]).toMatchObject({ existingBookId: 'b9' });
  });

  it('検索欄の ISBN が見つからなければ「ISBN で追加する」で ISBN を残して追加する（手入力に数字を写さない）', async () => {
    api.searchByTitle.mockResolvedValue([]);
    api.lookupByIsbn.mockResolvedValue(null);
    renderAt('/borrow/add');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: ISBN1 } });
    fireEvent.click(screen.getByRole('button', { name: '検索する' }));
    await flush();
    expect(screen.getByText(`「${ISBN1}」は見つかりませんでした`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '手入力で追加する' })).toBeNull();

    // 手入力を開いても ISBN の数字はタイトルに入れない
    fireEvent.click(screen.getByRole('button', { name: /見つからない場合は手入力/ }));
    expect((screen.getByLabelText(/^タイトル必須/) as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'ISBN で追加する（タイトルは確認画面で入力）' }));
    expect(screen.getByText('追加しました')).toBeTruthy();
    expect(screen.getByText(/「ISBN 978-4-8340-0082-5」を借りる本のリストに追加しました。/)).toBeTruthy();
    await flush();
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ key: ISBN1, isbn: ISBN1, status: 'not-found' });

    // もう一度押しても二重には入らない
    fireEvent.click(screen.getByRole('button', { name: '続けて追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'ISBN で追加する（タイトルは確認画面で入力）' }));
    expect(screen.getByText('すでに追加済みです')).toBeTruthy();
    expect(cart.items).toHaveLength(1);
  });

  it('検索欄に ISBN を入れると、その ISBN の登録済みの本を「以前に登録した本」に出す', () => {
    state.books = { data: [book({ title: 'ぐりとぐら' })], loading: false, error: null };
    renderAt('/borrow/add');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '978-4-8340-0082-5' } });
    expect(screen.getByRole('button', { name: 'ぐりとぐらを追加' })).toBeTruthy();
  });

  it('手入力で追加（シリーズはタイトルから推定）', async () => {
    renderAt('/borrow/add');
    fireEvent.click(screen.getByRole('button', { name: /見つからない場合は手入力/ }));
    fireEvent.change(screen.getByLabelText(/^タイトル必須/), { target: { value: 'おしりたんてい (3)' } });
    fireEvent.click(screen.getByRole('button', { name: 'この内容で追加する' }));
    await flush();
    expect(cart.items[0].candidate).toMatchObject({ title: 'おしりたんてい (3)', source: 'manual', isbn: null });
    expect(cart.items[0].seriesName).toBe('おしりたんてい');
    expect(cart.items[0].volume).toBe(3);
  });
});

describe('BorrowConfirmPage', () => {
  it('カートが空なら案内', () => {
    renderAt('/borrow/confirm');
    expect(screen.getByText('借りる本がまだありません')).toBeTruthy();
  });

  it('まとめて設定して登録する（シリーズ作成 → 本 → 貸出）', async () => {
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand({ seriesName: 'ぐりとぐら', volume: 1 }));
      cart.addCandidate(cand({ isbn: null, title: '手入力の本', source: 'manual' }));
    });
    await flush();
    // 場所が 1 つなら自動で選ばれ、返却日は 14 日後
    expect((screen.getByLabelText(/^借りた場所/) as HTMLSelectElement).value).toBe('L1');
    expect((screen.getByLabelText(/^返却日必須/) as HTMLInputElement).value).toBe('2026-11-22');
    expect(screen.getByText('中央図書館の貸出期間（14日）で自動計算しています')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2冊を登録する' }));
    await flush();
    expect(api.findOrCreateSeries).toHaveBeenCalledWith('g1', 'ぐりとぐら');
    expect(api.upsertBookFromCandidate).toHaveBeenCalledTimes(2);
    expect(api.upsertBookFromCandidate.mock.calls[0][2]).toEqual({ seriesId: 's-new', volume: 1 });
    expect(api.createLoans).toHaveBeenCalledTimes(1);
    const [gid, uid, inputs] = api.createLoans.mock.calls[0] as [string, string, { bookId: string; dueOn: string }[]];
    expect(gid).toBe('g1');
    expect(uid).toBe('u1');
    expect(inputs).toEqual([
      expect.objectContaining({
        bookId: `isbn-${ISBN1}`,
        locationId: 'L1',
        borrowerUid: 'u1',
        borrowedOn: '2026-11-08',
        dueOn: '2026-11-22',
      }),
      expect.objectContaining({ bookId: 'new-book', dueOn: '2026-11-22' }),
    ]);
    expect(screen.getByTestId('url').textContent).toBe('/');
    expect(cart.items).toHaveLength(0);
    expect(localStorage.getItem('borrow.lastLocationId')).toBe('L1');
  });

  it('タイトルで結び付けた本は、その本の ID のまま登録する（タイトルで探し直さない）', async () => {
    const zzz = book({ id: 'zzz', isbn: null, title: 'ももたろう', authors: ['B'] });
    state.books = { data: [zzz], loading: false, error: null };
    api.findBookForCandidate.mockResolvedValue(zzz);
    api.upsertBookFromCandidate.mockImplementation(
      async (_gid: string, _c: BookCandidate, _s: unknown, opts?: { bookId?: string | null }) => opts?.bookId ?? 'aaa',
    );
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand({ isbn: null, title: 'ももたろう', authors: ['B'], source: 'manual' }));
    });
    await flush();
    expect(screen.getByText('同じタイトルの登録済みの本')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1冊を登録する' }));
    await flush();
    expect(api.upsertBookFromCandidate.mock.calls[0][3]).toEqual({ bookId: 'zzz', forceNew: false });
    const inputs = api.createLoans.mock.calls[0][2] as { bookId: string }[];
    expect(inputs[0].bookId).toBe('zzz');
  });

  it('タイトルで結び付けた本は「別の本として登録」で外し、新しい本として登録する', async () => {
    const other = book({ id: 'isbn-9784834000000', isbn: '9784834000000', title: 'ももたろう', authors: [] });
    state.books = { data: [other], loading: false, error: null };
    api.findBookForCandidate.mockResolvedValue(other);
    api.upsertBookFromCandidate.mockImplementation(
      async (_gid: string, _c: BookCandidate, _s: unknown, opts?: { bookId?: string | null }) => opts?.bookId ?? 'new-book',
    );
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand({ isbn: null, title: 'ももたろう', authors: [], publisher: null, source: 'manual' }));
    });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '別の本として登録' }));
    expect(screen.queryByText('同じタイトルの登録済みの本')).toBeNull();
    expect(screen.getByText(/別の本として、新しく登録します/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1冊を登録する' }));
    await flush();
    expect(api.upsertBookFromCandidate.mock.calls[0][3]).toEqual({ bookId: null, forceNew: true });
    expect(api.upsertBookFromCandidate.mock.calls[0][1]).toMatchObject({ isbn: null, title: 'ももたろう', publisher: null });
    const inputs = api.createLoans.mock.calls[0][2] as { bookId: string }[];
    expect(inputs[0].bookId).toBe('new-book');
  });

  it('返却日を手で変えたら場所を変えても保ち、自動計算に戻せる。個別の返却日も使う', async () => {
    state.locations = {
      data: [location('L1', '中央図書館', 14), location('L2', 'マンション図書室', 7)],
      loading: false,
      error: null,
    };
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand());
    });
    await flush();
    const select = screen.getByLabelText(/^借りた場所/) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByText('借りた場所を選んでください')).toBeTruthy();
    fireEvent.change(select, { target: { value: 'L2' } });
    const due = screen.getByLabelText(/^返却日必須/) as HTMLInputElement;
    expect(due.value).toBe('2026-11-15');
    fireEvent.change(due, { target: { value: '2026-11-30' } });
    fireEvent.change(select, { target: { value: 'L1' } });
    expect((screen.getByLabelText(/^返却日必須/) as HTMLInputElement).value).toBe('2026-11-30');
    expect(screen.getByText(/手で変更しています（自動計算では 11月22日/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /自動計算（11月22日\(日\)）に戻す/ }));
    expect((screen.getByLabelText(/^返却日必須/) as HTMLInputElement).value).toBe('2026-11-22');

    // この本だけ変更
    fireEvent.click(screen.getByRole('button', { name: 'この本だけ変更' }));
    fireEvent.change(screen.getByLabelText('返却日（この本だけ）'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: '1冊を登録する' }));
    await flush();
    const inputs = api.createLoans.mock.calls[0][2] as { dueOn: string; locationId: string }[];
    expect(inputs[0]).toMatchObject({ dueOn: '2026-12-01', locationId: 'L1' });
  });

  it('見つからない本はタイトルを入れるまで登録できない', async () => {
    renderAt('/borrow/confirm');
    act(() => {
      cart.addIsbn(ISBN2);
    });
    expect(screen.getByRole('button', { name: '1冊を登録する' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/本の情報を取得しています（1冊）/)).toBeTruthy();
    await flush();
    expect(screen.getByText('本の情報が見つかりませんでした')).toBeTruthy();
    expect(screen.getByText('タイトルが入っていない本があります（1冊）')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^タイトル必須/), { target: { value: 'こどものとも 11月号' } });
    const button = screen.getByRole('button', { name: '1冊を登録する' });
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    await flush();
    expect(api.upsertBookFromCandidate.mock.calls[0][1]).toMatchObject({
      isbn: ISBN2,
      title: 'こどものとも 11月号',
      source: 'manual',
    });
  });

  it('通信の失敗で取れなかった本は「つながりませんでした」と再取得・手入力を出す', async () => {
    api.lookupFailed = true;
    renderAt('/borrow/confirm');
    act(() => {
      cart.addIsbn(ISBN2);
    });
    await flush();
    expect(screen.getByText('検索サービスにつながりませんでした')).toBeTruthy();
    expect(screen.getByText(/電波のよい場所で再取得するか、手入力してください/)).toBeTruthy();
    expect(screen.getByLabelText(/^タイトル必須/)).toBeTruthy();
    expect(cart.items[0].status).toBe('error');

    api.lookupByIsbn.mockResolvedValue(cand({ isbn: ISBN2, title: 'からすのパンやさん' }));
    fireEvent.click(screen.getByRole('button', { name: '本の情報を再取得' }));
    await flush();
    expect(api.lookupByIsbn).toHaveBeenCalledTimes(2);
    expect(screen.getByText('からすのパンやさん')).toBeTruthy();
    expect(cart.items[0].status).toBe('ready');
  });

  it('上下 2 冊組の「下」は 2 巻、「中」もいっしょなら 3 巻で登録する', async () => {
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand({ isbn: null, title: '西の魔女が死んだ 上', seriesName: '西の魔女が死んだ', volume: 1, source: 'manual' }));
      cart.addCandidate(cand({ isbn: null, title: '西の魔女が死んだ 下', seriesName: '西の魔女が死んだ', volume: 2, source: 'manual' }));
      cart.addCandidate(cand({ isbn: null, title: 'みっつのくに 中', seriesName: 'みっつのくに', volume: 2, source: 'manual' }));
      cart.addCandidate(cand({ isbn: null, title: 'みっつのくに 下', seriesName: 'みっつのくに', volume: 2, source: 'manual' }));
    });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '4冊を登録する' }));
    await flush();
    const saved = api.upsertBookFromCandidate.mock.calls.map((c) => [(c[1] as BookCandidate).title, (c[2] as { volume: number }).volume]);
    expect(saved).toEqual([
      ['西の魔女が死んだ 上', 1],
      ['西の魔女が死んだ 下', 2],
      ['みっつのくに 中', 2],
      ['みっつのくに 下', 3],
    ]);
  });

  it('貸出中・前に借りたことがある本を知らせる', async () => {
    state.active = {
      data: [loan('now', { borrowerUid: 'u2', returnedOn: null, readStatus: null, dueOn: '2026-11-20' })],
      loading: false,
      error: null,
    };
    state.bookLoans = { data: [loan('old1'), loan('old2', { borrowedOn: '2024-01-05' })], loading: false, error: null };
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand());
    });
    await flush();
    expect(screen.getByText(/この本はいま貸出中です（はなこ・中央図書館・11月20日/)).toBeTruthy();
    expect(screen.getByText(/前回：2025年3月2日 中央図書館 はなこ（読んだ）（これまでに2回）/)).toBeTruthy();
  });

  it('ISBN なしで登録した同じタイトルの本があれば「同じ本ですか？」と聞き、選べばその本の貸出として登録する', async () => {
    const handTitle = 'おしりたんてい ププッ ゆうれいなんてこわくない';
    state.books = {
      data: [book({ id: 'm1', isbn: null, title: handTitle, authors: [], source: 'manual' })],
      loading: false,
      error: null,
    };
    state.bookLoans = {
      data: [loan('m-old', { bookId: 'm1', book: { title: handTitle, authors: [], coverUrl: null, isbn: null } })],
      loading: false,
      error: null,
    };
    api.lookupByIsbn.mockResolvedValue(
      cand({ isbn: ISBN2, title: 'おしりたんてい ププッゆうれいなんてこわくない', seriesName: 'おしりたんてい', volume: 3 }),
    );
    api.upsertBookFromCandidate.mockImplementation(async (_gid: string, c: BookCandidate) =>
      c.isbn ? `isbn-${c.isbn}` : 'm1',
    );
    renderAt('/borrow/confirm');
    act(() => {
      cart.addIsbn(ISBN2);
      cart.update(ISBN2, { dueOnOverride: '2026-12-01' });
    });
    await flush();
    const hint = screen.getByRole('group', { name: '同じタイトルの本の確認' });
    expect(within(hint).getByText('ISBN なしで登録した同じタイトルの本があります。同じ本ですか？')).toBeTruthy();
    expect(within(hint).getByText(/前回：2025年3月2日 中央図書館 はなこ（読んだ）/)).toBeTruthy();
    // ISBN の本としてはまだ借りたことが無い
    expect(screen.queryByText(/借りたことがあります。前回/)).toBeNull();

    fireEvent.click(within(hint).getByRole('button', { name: `「${handTitle}」と同じ本として借りる` }));
    await flush();
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      existingBookId: 'm1',
      isbn: null,
      seriesName: 'おしりたんてい',
      volume: 3,
      dueOnOverride: '2026-12-01',
    });
    expect(screen.queryByRole('group', { name: '同じタイトルの本の確認' })).toBeNull();
    // 前の本の履歴が F-27 の注意として出る
    expect(screen.getByText(/借りたことがあります。前回：2025年3月2日 中央図書館 はなこ（読んだ）/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '1冊を登録する' }));
    await flush();
    expect(api.upsertBookFromCandidate.mock.calls[0][1]).toMatchObject({ isbn: null, title: handTitle });
    const inputs = api.createLoans.mock.calls[0][2] as { bookId: string; dueOn: string }[];
    expect(inputs[0]).toMatchObject({ bookId: 'm1', dueOn: '2026-12-01' });
  });

  it('同じタイトルの本の確認で「別の本」を選べば、ISBN の本として新しく登録する', async () => {
    state.books = {
      data: [book({ id: 'm1', isbn: null, title: 'からすのパンやさん', source: 'manual' })],
      loading: false,
      error: null,
    };
    state.active = {
      data: [loan('now', { bookId: 'm1', borrowerUid: 'u2', returnedOn: null, readStatus: null, dueOn: '2026-11-20' })],
      loading: false,
      error: null,
    };
    api.lookupByIsbn.mockResolvedValue(cand({ isbn: ISBN2, title: 'からすのパンやさん' }));
    renderAt('/borrow/confirm');
    act(() => {
      cart.addIsbn(ISBN2);
    });
    await flush();
    const hint = screen.getByRole('group', { name: '同じタイトルの本の確認' });
    expect(within(hint).getByText(/いま貸出中（はなこ・中央図書館・11月20日/)).toBeTruthy();
    fireEvent.click(within(hint).getByRole('button', { name: '別の本（このまま新しく登録する）' }));
    expect(screen.queryByRole('group', { name: '同じタイトルの本の確認' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1冊を登録する' }));
    await flush();
    const inputs = api.createLoans.mock.calls[0][2] as { bookId: string }[];
    expect(inputs[0].bookId).toBe(`isbn-${ISBN2}`);
  });

  it('借りた日を今日より後にすると登録できない', async () => {
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand());
    });
    await flush();
    fireEvent.change(screen.getByLabelText(/^借りた日必須/), { target: { value: '2026-11-28' } });
    expect(screen.getByText('今日より後の日付は選べません')).toBeTruthy();
    expect(screen.getByText('借りた日は今日以前にしてください')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1冊を登録する' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/^借りた日必須/), { target: { value: '2026-11-07' } });
    expect(screen.getByRole('button', { name: '1冊を登録する' })).toHaveProperty('disabled', false);
  });

  it('登録に失敗したらカートを残してエラーを出す', async () => {
    api.createLoans.mockRejectedValue(new Error('通信できませんでした。電波の良い場所でもう一度お試しください。'));
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand());
    });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '1冊を登録する' }));
    await flush();
    expect(screen.getByText('登録できませんでした')).toBeTruthy();
    expect(cart.items).toHaveLength(1);
    expect(screen.getByTestId('url').textContent).toBe('/borrow/confirm');
    expect(screen.getByRole('button', { name: '1冊を登録する' })).toHaveProperty('disabled', false);
  });

  it('場所が無ければ登録へのリンク', async () => {
    state.locations = { data: [], loading: false, error: null };
    renderAt('/borrow/confirm');
    act(() => {
      cart.addCandidate(cand());
    });
    await flush();
    expect(screen.getByRole('link', { name: '場所を登録する' }).getAttribute('href')).toBe('/settings/locations/new');
  });
});
