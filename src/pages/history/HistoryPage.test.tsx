// @vitest-environment jsdom
/* 履歴画面の表示・検索・絞り込み・段階表示のテスト（データ層・グループはモック） */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import type { Loan, Location, WithId } from '../../types';
import { ToastProvider } from '../../components/ui/ToastProvider';

const ts = { toMillis: () => 0 } as unknown as Timestamp;

const state = vi.hoisted(() => ({
  loans: { data: [] as unknown[], loading: false, error: null as Error | null },
  locations: { data: [] as unknown[], loading: false, error: null as Error | null },
  /** 画面が読んだ範囲（kind） */
  scopes: [] as string[],
  cache: new Map<string, { source: unknown; result: unknown }>(),
  /** true の間、全件の読み込みが終わらない */
  allPending: false,
}));

type MockScope =
  | { kind: 'recent'; count: number }
  | { kind: 'range'; from: string | null; to: string | null }
  | { kind: 'all' };

const PENDING = { data: [], loading: true, error: null };

// 本物と同じく、範囲ごとに借りた日の新しい順の記録を返す（同じ範囲・同じ元データなら同じオブジェクト）
vi.mock('../../data/loans', () => ({
  useHistoryLoans: (scope: MockScope) => {
    state.scopes.push(scope.kind);
    if (scope.kind === 'all' && state.allPending) return PENDING;
    const key = JSON.stringify(scope);
    const cached = state.cache.get(key);
    if (cached && cached.source === state.loans) return cached.result;
    let data = [...(state.loans.data as { borrowedOn: string }[])].sort((a, b) => b.borrowedOn.localeCompare(a.borrowedOn));
    if (scope.kind === 'recent') data = data.slice(0, scope.count);
    if (scope.kind === 'range') {
      data = data.filter((l) => (!scope.from || l.borrowedOn >= scope.from) && (!scope.to || l.borrowedOn <= scope.to));
    }
    const result = { ...state.loans, data };
    state.cache.set(key, { source: state.loans, result });
    return result;
  },
}));
vi.mock('../../data/locations', () => ({
  useLocations: () => state.locations,
}));
vi.mock('../../group/GroupProvider', () => {
  const names: Record<string, string> = { u1: 'ママ', u2: 'はなこ' };
  const memberName = (uid: string) => names[uid] ?? '（不明）';
  const members = [
    { id: 'u1', displayName: 'ママ' },
    { id: 'u2', displayName: 'はなこ' },
  ];
  return {
    useGroup: () => ({ members, memberName }),
    useRequiredGroup: () => ({ groupId: 'g1', uid: 'u1', members, memberName }),
  };
});

import HistoryPage from './HistoryPage';

function loan(id: string, patch: Partial<Loan> = {}, title = `本${id}`, authors: string[] = []): WithId<Loan> {
  return {
    id,
    bookId: `book-${id}`,
    book: { title, authors, coverUrl: null, isbn: null },
    locationId: 'L1',
    borrowerUid: 'u1',
    borrowedOn: '2026-11-01',
    dueOn: '2026-11-15',
    returnedOn: '2026-11-10',
    readStatus: 'read',
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

function CurrentUrl() {
  const loc = useLocation();
  return <p data-testid="url">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<p>OTHER</p>} />
        </Routes>
        <CurrentUrl />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function rowTitles(): string[] {
  return screen.queryAllByRole('link').map((a) => a.querySelector('span span')?.textContent ?? '');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T09:00:00'));
  sessionStorage.clear();
  state.scopes = [];
  state.cache.clear();
  state.allPending = false;
  state.loans = {
    data: [
      loan('a', { borrowedOn: '2026-11-05', returnedOn: null, readStatus: null }, 'かいけつゾロリのドラゴンたいじ', ['原ゆたか']),
      loan('b', { borrowedOn: '2026-10-20', locationId: 'L2', borrowerUid: 'u2', readStatus: 'partial', rating: 4 }, 'ぐりとぐら'),
      loan('c', { borrowedOn: '2025-12-24', readStatus: 'unread' }, 'ノンタン ぶらんこのせて', ['キヨノサチコ']),
    ],
    loading: false,
    error: null,
  };
  state.locations = { data: [location('L1', 'あおば図書館'), location('L2', 'いずみ図書室')], loading: false, error: null };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HistoryPage', () => {
  it('借りた日の新しい順に月ごとの見出しを付けて表示する', () => {
    renderAt('/history');
    // 条件が無ければ新しい順に 1 ページ分だけ読む（全件は読まない）
    expect(new Set(state.scopes)).toEqual(new Set(['recent']));
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['2026年11月1件', '2026年10月1件', '2025年12月1件']);
    expect(screen.getByText('全', { exact: false }).textContent).toContain('3');
    expect(rowTitles()).toEqual(['かいけつゾロリのドラゴンたいじ', 'ぐりとぐら', 'ノンタン ぶらんこのせて']);
  });

  it('行に借りた日・場所・借りた人・状態を出し、タップで本の詳細へ', () => {
    renderAt('/history');
    const row = screen.getByRole('link', { name: /ぐりとぐら/ });
    expect(row.getAttribute('href')).toBe('/books/book-b');
    expect(within(row).getByText('いずみ図書室')).toBeTruthy();
    expect(within(row).getByText('はなこ')).toBeTruthy();
    expect(within(row).getByText('途中まで')).toBeTruthy();
    expect(within(screen.getByRole('link', { name: /ゾロリ/ })).getByText('貸出中')).toBeTruthy();
  });

  it('ひらがな・カタカナ、全角・半角の揺れを吸収してタイトル・著者で検索する', () => {
    renderAt('/history');
    const box = screen.getByRole('searchbox', { name: 'タイトル・著者で検索' });
    act(() => {
      fireEvent.change(box, { target: { value: 'ぞろり' } });
    });
    expect(rowTitles()).toEqual(['かいけつゾロリのドラゴンたいじ']);
    // 全期間の検索は全件を読む
    expect(state.scopes.at(-1)).toBe('all');
    expect(screen.getByTestId('url').textContent).toContain('q=');

    act(() => {
      fireEvent.change(box, { target: { value: 'ｷﾖﾉ' } });
    });
    expect(rowTitles()).toEqual(['ノンタン ぶらんこのせて']);

    act(() => {
      fireEvent.change(box, { target: { value: 'みつからない' } });
    });
    expect(screen.getByText('条件に合う記録はありません')).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '条件をすべてクリア' }));
    });
    expect(rowTitles()).toHaveLength(3);
    expect(screen.getByTestId('url').textContent).toBe('/history');
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('検索語と絞り込みを両方クリアすると URL からも消える', () => {
    renderAt('/history?q=%E3%81%BF%E3%81%A4%E3%81%8B%E3%82%89%E3%81%AA%E3%81%84&state=read');
    expect(screen.getByText('条件に合う記録はありません')).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '条件をすべてクリア' }));
    });
    expect(screen.getByTestId('url').textContent).toBe('/history');
    expect(rowTitles()).toHaveLength(3);
  });

  it('URL の絞り込みを読み、設定中の条件をタップで解除できる', () => {
    renderAt('/history?state=active');
    expect(rowTitles()).toEqual(['かいけつゾロリのドラゴンたいじ']);
    const tag = screen.getByRole('button', { name: '「貸出中」の絞り込みを解除' });
    act(() => {
      fireEvent.click(tag);
    });
    expect(rowTitles()).toHaveLength(3);
    expect(screen.getByTestId('url').textContent).toBe('/history');
  });

  it('絞り込みシートで期間・場所・借りた人を選べる', () => {
    renderAt('/history');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '絞り込み' }));
    });
    const dialog = screen.getByRole('dialog', { name: '絞り込み' });

    act(() => {
      fireEvent.click(within(dialog).getByRole('radio', { name: '去年' }));
    });
    expect(rowTitles()).toEqual(['ノンタン ぶらんこのせて']);
    expect(screen.getByTestId('url').textContent).toContain('period=last-year');
    // 期間で絞り込めばその期間だけ読む
    expect(state.scopes.at(-1)).toBe('range');

    act(() => {
      fireEvent.click(within(dialog).getByRole('radio', { name: 'すべて' }));
    });
    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: /いずみ図書室/ }));
    });
    expect(rowTitles()).toEqual(['ぐりとぐら']);

    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: /すべての場所/ }));
    });
    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^はなこ/ }));
    });
    expect(rowTitles()).toEqual(['ぐりとぐら']);
    expect(within(dialog).getByRole('button', { name: '1件を表示' })).toBeTruthy();

    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'クリア' }));
    });
    expect(rowTitles()).toHaveLength(3);
  });

  it('期間指定にすると今年の 1 月 1 日〜今日が入る', () => {
    renderAt('/history');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '絞り込み' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: '期間指定' }));
    });
    expect(screen.getByTestId('url').textContent).toContain('from=2026-01-01');
    expect(screen.getByTestId('url').textContent).toContain('to=2026-11-08');
    expect(rowTitles()).toHaveLength(2);
  });

  it('最初は新しい順に 100 件だけ読み、「もっと見る」で全件を読んで増やす', () => {
    state.loans = {
      data: Array.from({ length: 250 }, (_, i) =>
        loan(`n${i}`, { borrowedOn: `2026-${String(10 - Math.floor(i / 50)).padStart(2, '0')}-01` }),
      ),
      loading: false,
      error: null,
    };
    renderAt('/history');
    expect(rowTitles()).toHaveLength(100);
    expect(state.scopes).not.toContain('all');
    expect(screen.getByText('最近の', { exact: false }).textContent).toContain('100');
    // 最後の月は続きがあるかもしれないので「以上」
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '2026年10月50件',
      '2026年9月50件以上',
    ]);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }));
    });
    expect(state.scopes.at(-1)).toBe('all');
    expect(rowTitles()).toHaveLength(200);
    // 全件を読んだ後の見出しの件数は月全体の件数
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '2026年10月50件',
      '2026年9月50件',
      '2026年8月50件',
      '2026年7月50件',
    ]);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'もっと見る（残り50件）' }));
    });
    expect(rowTitles()).toHaveLength(250);
    expect(screen.queryByRole('button', { name: /もっと見る/ })).toBeNull();
  });

  it('全件の読み込み中も、前に読んだ記録と検索欄を出したままにする', () => {
    state.allPending = true;
    renderAt('/history');
    const box = screen.getByRole('searchbox', { name: 'タイトル・著者で検索' });
    act(() => {
      fireEvent.change(box, { target: { value: 'ぞろり' } });
    });
    expect(state.scopes.at(-1)).toBe('all');
    expect(screen.getByRole('searchbox', { name: 'タイトル・著者で検索' })).toBe(box);
    expect(screen.getByText('記録を読み込んでいます')).toBeTruthy();
    expect(rowTitles()).toEqual(['かいけつゾロリのドラゴンたいじ']);
  });

  it('期間で絞り込んで記録が無くても、「まだ記録はありません」ではなく条件に合わない旨を出す', () => {
    renderAt('/history?period=range&from=2020-01-01&to=2020-12-31');
    expect(screen.queryByText('まだ貸出の記録はありません')).toBeNull();
    expect(screen.getByText('条件に合う記録はありません')).toBeTruthy();
  });

  it('記録が無いときは案内を出す', () => {
    state.loans = { data: [], loading: false, error: null };
    renderAt('/history');
    expect(screen.getByText('まだ貸出の記録はありません')).toBeTruthy();
  });

  it('読み込み中・エラー', () => {
    state.loans = { data: [], loading: true, error: null };
    const { unmount } = renderAt('/history');
    expect(screen.getByText('履歴を読み込んでいます')).toBeTruthy();
    unmount();
    state.loans = { data: [], loading: false, error: new Error('読み込みに失敗') };
    renderAt('/history');
    expect(screen.getByText('読み込めませんでした')).toBeTruthy();
  });
});
