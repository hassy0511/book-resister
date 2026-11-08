// @vitest-environment jsdom
/* App のルーティングとガードのテスト（認証・グループ・画面はモック） */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  configured: true,
  auth: { user: null as { uid: string } | null, loading: false },
  group: { loading: false, groupId: null as string | null, error: null as Error | null },
}));

const { page } = vi.hoisted(() => ({
  page: (name: string) => ({ default: () => name }),
}));

vi.mock('./firebase', () => ({
  get isFirebaseConfigured() {
    return state.configured;
  },
}));
vi.mock('./auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => state.auth,
}));
vi.mock('./group/GroupProvider', () => ({
  GroupProvider: ({ children }: { children: ReactNode }) => children,
  useGroup: () => state.group,
}));
vi.mock('./state/borrowCart', () => ({
  BorrowCartProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./pages/auth/LoginPage', () => page('PAGE:login'));
vi.mock('./pages/auth/WelcomePage', () => page('PAGE:welcome'));
vi.mock('./pages/auth/JoinPage', () => page('PAGE:join'));
vi.mock('./pages/home/HomePage', () => page('PAGE:home'));
vi.mock('./pages/scan/ScanPage', () => page('PAGE:scan'));
vi.mock('./pages/borrow/BorrowConfirmPage', () => page('PAGE:borrow-confirm'));
vi.mock('./pages/borrow/AddBookPage', () => page('PAGE:borrow-add'));
vi.mock('./pages/loans/ReturnPage', () => page('PAGE:return'));
vi.mock('./pages/loans/LoanDetailPage', () => page('PAGE:loan'));
vi.mock('./pages/history/HistoryPage', () => page('PAGE:history'));
vi.mock('./pages/books/BookDetailPage', () => page('PAGE:book'));
vi.mock('./pages/series/SeriesListPage', () => page('PAGE:series-list'));
vi.mock('./pages/series/SeriesDetailPage', () => page('PAGE:series'));
vi.mock('./pages/settings/SettingsPage', () => page('PAGE:settings'));
vi.mock('./pages/settings/ProfilePage', () => page('PAGE:profile'));
vi.mock('./pages/settings/LocationsPage', () => page('PAGE:locations'));
vi.mock('./pages/settings/LocationEditPage', () => page('PAGE:location-edit'));
vi.mock('./pages/settings/MembersPage', () => page('PAGE:members'));
vi.mock('./pages/settings/NotificationsPage', () => page('PAGE:notifications'));

import App from './App';

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(<App />);
}

beforeEach(() => {
  state.configured = true;
  state.auth = { user: null, loading: false };
  state.group = { loading: false, groupId: null, error: null };
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.tabbar;
});

const LINE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0';

describe('App のガード', () => {
  it('Firebase 未設定ならセットアップ案内', () => {
    state.configured = false;
    renderAt('/');
    expect(screen.getByText('はじめに設定が必要です')).toBeTruthy();
  });

  it('認証の読み込み中はスプラッシュ', () => {
    state.auth = { user: null, loading: true };
    renderAt('/');
    expect(screen.getByText('かりた本ノート')).toBeTruthy();
  });

  it('未ログインなら /login へ', async () => {
    renderAt('/history');
    expect(await screen.findByText('PAGE:login')).toBeTruthy();
    expect(window.location.pathname).toBe('/login');
    expect(sessionStorage.getItem('returnTo')).toBeNull();
  });

  it('未ログインで招待リンクを開いたら戻り先を保存し、ログイン後に戻る', async () => {
    const view = renderAt('/join/abc123');
    expect(await screen.findByText('PAGE:login')).toBeTruthy();
    expect(sessionStorage.getItem('returnTo')).toBe('/join/abc123');
    view.unmount();

    state.auth = { user: { uid: 'u1' }, loading: false };
    renderAt('/login');
    expect(await screen.findByText('PAGE:join')).toBeTruthy();
    expect(window.location.pathname).toBe('/join/abc123');
    expect(sessionStorage.getItem('returnTo')).toBeNull();
  });

  it('招待リンクの戻り先は /login?next= にも載せる（Safari に移って sessionStorage が無くても戻れる）', async () => {
    const view = renderAt('/join/abc123?openExternalBrowser=1');
    expect(await screen.findByText('PAGE:login')).toBeTruthy();
    expect(window.location.pathname).toBe('/login');
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/join/abc123?openExternalBrowser=1');
    view.unmount();

    // 別のブラウザ（sessionStorage が空）で /login?next=... を開いてログインした
    sessionStorage.clear();
    const second = renderAt('/login?next=%2Fjoin%2Fabc123');
    expect(await screen.findByText('PAGE:login')).toBeTruthy();
    expect(sessionStorage.getItem('returnTo')).toBe('/join/abc123');
    second.unmount();

    sessionStorage.clear();
    state.auth = { user: { uid: 'u1' }, loading: false };
    renderAt('/login?next=%2Fjoin%2Fabc123');
    expect(await screen.findByText('PAGE:join')).toBeTruthy();
    expect(window.location.pathname).toBe('/join/abc123');
  });

  it('next に招待リンク以外・外部 URL を入れても使わない', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: 'g1', error: null };
    const view = renderAt('/login?next=%2Fsettings');
    expect(await screen.findByText('PAGE:home')).toBeTruthy();
    view.unmount();
    renderAt('/login?next=%2F%2Fevil.example.com%2Fjoin%2Fx');
    expect(await screen.findByText('PAGE:home')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('LINE などのアプリ内ブラウザで招待リンクを開いたら、ログイン画面へ移る前に Safari で開くよう案内する', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINE_UA);
    renderAt('/join/abc123');
    expect(await screen.findByText('LINE の中のブラウザで開いています')).toBeTruthy();
    // アドレス欄は招待リンクのまま（メニューの「Safari で開く」でそのまま参加の画面へ進める）
    expect(window.location.pathname).toBe('/join/abc123');
    expect(sessionStorage.getItem('returnTo')).toBe('/join/abc123');
    expect(screen.queryByText('PAGE:login')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'このままメールアドレスでログインする' }));
    expect(await screen.findByText('PAGE:login')).toBeTruthy();
    expect(window.location.pathname).toBe('/login');
  });

  it('アプリ内ブラウザでも招待リンク以外はそのままログイン画面へ', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINE_UA);
    renderAt('/history');
    expect(await screen.findByText('PAGE:login')).toBeTruthy();
  });

  it('ログイン済みで /login に来たら / へ', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: 'g1', error: null };
    renderAt('/login');
    expect(await screen.findByText('PAGE:home')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('外部 URL の戻り先は使わない', async () => {
    sessionStorage.setItem('returnTo', '//evil.example.com/');
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: 'g1', error: null };
    renderAt('/login');
    expect(await screen.findByText('PAGE:home')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('グループ未参加なら /welcome へ', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    renderAt('/settings');
    expect(await screen.findByText('PAGE:welcome')).toBeTruthy();
    expect(window.location.pathname).toBe('/welcome');
    expect(screen.queryByRole('navigation', { name: 'メイン' })).toBeNull();
  });

  it('グループ情報の読み込みが権限以外のエラーなら /welcome へ送らずエラーを出す', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: null, error: Object.assign(new Error('通信できませんでした'), { code: 'unavailable' }) };
    renderAt('/');
    expect(await screen.findByText('グループの情報を読み込めませんでした')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('グループの読み取りが拒否された（メンバーでなくなった）なら /welcome へ', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: null, error: Object.assign(new Error('権限がありません'), { code: 'permission-denied' }) };
    renderAt('/');
    expect(await screen.findByText('PAGE:welcome')).toBeTruthy();
  });

  it('グループ未参加でも招待リンクは開ける', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    renderAt('/join/abc123');
    expect(await screen.findByText('PAGE:join')).toBeTruthy();
  });

  it('グループの読み込み中はスプラッシュ', () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: true, groupId: null, error: null };
    renderAt('/');
    expect(screen.getByText('かりた本ノート')).toBeTruthy();
  });

  it('グループ参加済みなら画面と下部タブを表示', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: 'g1', error: null };
    renderAt('/series/s1');
    expect(await screen.findByText('PAGE:series')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'メイン' });
    expect(nav).toBeTruthy();
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain('シリーズ');
    expect(document.documentElement.dataset.tabbar).toBe('shown');
  });

  it('場所の新規と編集は同じ画面', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: 'g1', error: null };
    const view = renderAt('/settings/locations/new');
    expect(await screen.findByText('PAGE:location-edit')).toBeTruthy();
    view.unmount();
    renderAt('/settings/locations/abc');
    expect(await screen.findByText('PAGE:location-edit')).toBeTruthy();
  });

  it('知らないパスは / へ', async () => {
    state.auth = { user: { uid: 'u1' }, loading: false };
    state.group = { loading: false, groupId: 'g1', error: null };
    renderAt('/no/such/page');
    expect(await screen.findByText('PAGE:home')).toBeTruthy();
  });
});
