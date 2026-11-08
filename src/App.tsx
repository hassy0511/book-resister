/*
 * ルーティングと Provider の組み立て、ログイン／グループ参加のガード。
 *
 * ガード:
 *   - Firebase 未設定 → すべての画面で SetupRequired
 *   - 未ログイン → /login（/join/:code から来た場合は sessionStorage 'returnTo' に保存し、ログイン後に戻す。
 *     戻り先は /login?next=/join/... として URL にも載せる。アプリ内ブラウザから Safari に移ると
 *     sessionStorage は引き継がれないため）
 *   - LINE などのアプリ内ブラウザで /join/:code を未ログインで開いた → /login へ移る前に「Safari で開いて」と案内する
 *     （アドレス欄に招待リンクが残るので、メニューの「Safari で開く」でそのまま参加の画面へ進める）
 *   - ログイン済みで /login → returnTo か "/" へ（ログイン画面側で遷移させる必要はない）
 *   - ログイン済みでグループ未参加 → /welcome（/join/:code と /welcome 自身は除く）
 *   - 認証・グループの読み込み中はスプラッシュ
 * /welcome はグループ作成後も表示し続けられる（作成直後に「最初の場所の登録」へ進むため）。
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { isFirebaseConfigured } from './firebase';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { GroupProvider, useGroup } from './group/GroupProvider';
import { BorrowCartProvider } from './state/borrowCart';
import { ToastProvider } from './components/ui/ToastProvider';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { SetupRequired } from './components/layout/SetupRequired';
import { SplashScreen } from './components/layout/SplashScreen';
import { ErrorState } from './components/ui/EmptyState';
import { Button } from './components/ui/Button';
import { Page } from './components/ui/Page';
import { InAppBrowserNotice } from './components/InAppBrowserNotice';
import { detectInAppBrowser, type InAppBrowserName } from './components/inAppBrowser';
import { isPermissionDenied } from './data/common';

// 画面は分割して読み込む
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const WelcomePage = lazy(() => import('./pages/auth/WelcomePage'));
const JoinPage = lazy(() => import('./pages/auth/JoinPage'));
const HomePage = lazy(() => import('./pages/home/HomePage'));
const ScanPage = lazy(() => import('./pages/scan/ScanPage'));
const BorrowConfirmPage = lazy(() => import('./pages/borrow/BorrowConfirmPage'));
const AddBookPage = lazy(() => import('./pages/borrow/AddBookPage'));
const ReturnPage = lazy(() => import('./pages/loans/ReturnPage'));
const LoanDetailPage = lazy(() => import('./pages/loans/LoanDetailPage'));
const HistoryPage = lazy(() => import('./pages/history/HistoryPage'));
const BookDetailPage = lazy(() => import('./pages/books/BookDetailPage'));
const SeriesListPage = lazy(() => import('./pages/series/SeriesListPage'));
const SeriesDetailPage = lazy(() => import('./pages/series/SeriesDetailPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const ProfilePage = lazy(() => import('./pages/settings/ProfilePage'));
const LocationsPage = lazy(() => import('./pages/settings/LocationsPage'));
const LocationEditPage = lazy(() => import('./pages/settings/LocationEditPage'));
const MembersPage = lazy(() => import('./pages/settings/MembersPage'));
const NotificationsPage = lazy(() => import('./pages/settings/NotificationsPage'));

// ---------------------------------------------------------------------------
// ログイン後の戻り先（sessionStorage 'returnTo'）
// ---------------------------------------------------------------------------

const RETURN_TO_KEY = 'returnTo';

/** アプリ内のパスだけを戻り先として認める（外部 URL への転送を防ぐ） */
function isSafeReturnTo(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
}

function saveReturnTo(path: string): void {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch {
    // プライベートブラウズなどで保存できなくても続行する
  }
}

function readReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY);
    return isSafeReturnTo(value) && value !== '/login' ? value : null;
  } catch {
    return null;
  }
}

function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // 何もしない
  }
}

/** ログイン後に戻すため、戻り先として保存するパスか（招待リンクのみ） */
function shouldRememberPath(pathname: string): boolean {
  return pathname.startsWith('/join/');
}

/** /login?next=… の戻り先（アプリ内の招待リンクだけを認める）。無ければ null */
function nextFromSearch(search: string): string | null {
  let next: string | null;
  try {
    next = new URLSearchParams(search).get('next');
  } catch {
    return null;
  }
  return isSafeReturnTo(next) && shouldRememberPath(next) ? next : null;
}

// ---------------------------------------------------------------------------
// ガード
// ---------------------------------------------------------------------------

/** 未ログインなら /login へ（/join/:code の場合は戻り先を保存） */
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user) return <RedirectToLogin />;
  return <Outlet />;
}

function RedirectToLogin() {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  const remember = shouldRememberPath(location.pathname);
  // 招待リンクをアプリ内ブラウザで開いた場合は、先に Safari で開き直すよう案内する
  const [inAppBrowser] = useState(() => (remember ? detectInAppBrowser() : null));
  const [proceed, setProceed] = useState(false);
  useEffect(() => {
    if (remember) saveReturnTo(path);
  }, [remember, path]);
  if (inAppBrowser && !proceed) {
    return <InAppBrowserGate appName={inAppBrowser} onContinue={() => setProceed(true)} />;
  }
  return <Navigate to={remember ? `/login?next=${encodeURIComponent(path)}` : '/login'} replace />;
}

/** アプリ内ブラウザで招待リンクを開いたときの案内（アドレス欄は招待リンクのまま） */
function InAppBrowserGate({ appName, onContinue }: { appName: InAppBrowserName; onContinue: () => void }) {
  return (
    <Page title="家族のグループへの招待">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 440, margin: '0 auto' }}>
        <InAppBrowserNotice appName={appName} />
        <Button variant="ghost" block onClick={onContinue}>
          このままメールアドレスでログインする
        </Button>
      </div>
    </Page>
  );
}

/** グループ未参加なら /welcome へ */
function RequireGroup() {
  const { loading, groupId, error } = useGroup();
  if (loading) return <SplashScreen />;
  if (!groupId) {
    // 権限以外の読み込みエラーは「未参加」と区別する（/welcome でグループを二重に作らせないため）
    if (error && !isPermissionDenied(error)) return <GroupLoadError error={error} />;
    return <Navigate to="/welcome" replace />;
  }
  return <Outlet />;
}

function GroupLoadError({ error }: { error: Error }) {
  return (
    <main
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: '0 16px',
      }}
    >
      <ErrorState
        title="グループの情報を読み込めませんでした"
        error={error}
        onRetry={() => window.location.reload()}
      />
    </main>
  );
}

/** /login: ログイン済みなら戻り先（無ければ "/"）へ */
function LoginRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  // URL の戻り先（/login?next=/join/...）を sessionStorage にも入れる。ログイン画面の「招待リンクから開きました」
  // の表示と、ログイン後の移動に使う。最初の描画で 1 回だけ（同じ値を書くだけなので二重描画でも問題ない）
  const [next] = useState(() => {
    const value = nextFromSearch(location.search);
    if (value) saveReturnTo(value);
    return value;
  });
  if (loading) return <SplashScreen />;
  if (user) return <RedirectAfterLogin fallback={next} />;
  return <LoginPage />;
}

function RedirectAfterLogin({ fallback }: { fallback: string | null }) {
  // 描画中は読むだけにして、消すのはエフェクトで（StrictMode の二重描画でも戻り先を失わない）
  const [target] = useState(() => readReturnTo() ?? fallback ?? '/');
  useEffect(() => {
    clearReturnTo();
  }, []);
  return <Navigate to={target} replace />;
}

// ---------------------------------------------------------------------------
// ルート
// ---------------------------------------------------------------------------

function AppRoutes() {
  return (
    <Suspense fallback={<SplashScreen />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />

        <Route element={<RequireAuth />}>
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/welcome" element={<WelcomePage />} />

          <Route element={<RequireGroup />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/scan" element={<ScanPage />} />
              <Route path="/borrow/confirm" element={<BorrowConfirmPage />} />
              <Route path="/borrow/add" element={<AddBookPage />} />
              <Route path="/return" element={<ReturnPage />} />
              <Route path="/loans/:loanId" element={<LoanDetailPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/books/:bookId" element={<BookDetailPage />} />
              <Route path="/series" element={<SeriesListPage />} />
              <Route path="/series/:seriesId" element={<SeriesDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/profile" element={<ProfilePage />} />
              <Route path="/settings/locations" element={<LocationsPage />} />
              <Route path="/settings/locations/new" element={<LocationEditPage />} />
              <Route path="/settings/locations/:id" element={<LocationEditPage />} />
              <Route path="/settings/members" element={<MembersPage />} />
              <Route path="/settings/notifications" element={<NotificationsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (!isFirebaseConfigured) {
    return (
      <ErrorBoundary>
        <SetupRequired />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <GroupProvider>
              <BorrowCartProvider>
                <AppRoutes />
              </BorrowCartProvider>
            </GroupProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
