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
vi.mock('../../data/books', () => ({
  useBooks: () => state.books,
  getBook: api.getBook,
  findBookForCandidate: api.findBookForCandidate,
  upsertBookFromCandidate: api.upsertBookFromCandidate,
  updateBook: api.updateBook,
}));
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

  it('以前に登録した本をタイトルの部分一致で出す', () => {
    state.books = { data: [book({ id: 'b9', isbn: null, title: 'ノンタン ぶらんこのせて' })], loading: false, error: null };
    renderAt('/borrow/add');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'のんたん' } });
    expect(screen.queryByText('ノンタン ぶらんこのせて')).toBeNull();
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'ノンタン' } });
    fireEvent.click(screen.getByRole('button', { name: 'ノンタン ぶらんこのせてを追加' }));
    expect(cart.items[0]).toMatchObject({ existingBookId: 'b9' });
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
