/**
 * ログイン状態の提供（useAuth）。
 * Google はポップアップを試し、使えない環境ではリダイレクトに切り替える。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../firebase';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** リダイレクトでのログインに失敗した場合の日本語メッセージ（ログイン画面で表示する） */
  redirectError: string | null;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** ポップアップが使えないときにリダイレクトへ切り替えるエラー */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/cancelled-popup-request',
]);

/** 利用者が自分で閉じた（エラー表示は不要） */
const USER_CANCEL_CODES = new Set(['auth/popup-closed-by-user', 'auth/user-cancelled']);

const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/missing-email': 'メールアドレスを入力してください。',
  'auth/missing-password': 'パスワードを入力してください。',
  'auth/user-not-found': 'メールアドレスまたはパスワードが違います。',
  'auth/wrong-password': 'メールアドレスまたはパスワードが違います。',
  'auth/invalid-credential': 'メールアドレスまたはパスワードが違います。',
  'auth/invalid-login-credentials': 'メールアドレスまたはパスワードが違います。',
  'auth/user-disabled': 'このアカウントは無効になっています。',
  'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。ログインしてください。',
  'auth/weak-password': 'パスワードは 6 文字以上にしてください。',
  'auth/password-does-not-meet-requirements': 'パスワードが条件を満たしていません。',
  'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからお試しください。',
  'auth/network-request-failed': '通信に失敗しました。電波の良い場所でもう一度お試しください。',
  'auth/timeout': '時間内に応答がありませんでした。もう一度お試しください。',
  'auth/popup-closed-by-user': 'ログインがキャンセルされました。',
  'auth/user-cancelled': 'ログインがキャンセルされました。',
  'auth/cancelled-popup-request': 'ログインがキャンセルされました。',
  'auth/redirect-cancelled-by-user': 'ログインがキャンセルされました。',
  'auth/popup-blocked': 'ログイン画面を開けませんでした。もう一度お試しください。',
  'auth/account-exists-with-different-credential':
    'このメールアドレスは別のログイン方法で登録されています。前回と同じ方法でログインしてください。',
  'auth/credential-already-in-use': 'このアカウントはすでに使われています。',
  'auth/operation-not-allowed':
    'このログイン方法は有効になっていません（Firebase コンソールの Authentication で有効にしてください）。',
  'auth/unauthorized-domain':
    'このドメインからのログインは許可されていません（Firebase コンソールの承認済みドメインに追加してください）。',
  'auth/operation-not-supported-in-this-environment': 'このブラウザではログインできません。Safari で開いてください。',
  'auth/web-storage-unsupported': 'ブラウザの設定でデータの保存が無効になっているため、ログインできません。',
  'auth/invalid-api-key': 'Firebase の API キーが正しくありません。設定を確認してください。',
  'auth/app-not-authorized': 'このアプリは Firebase の利用を許可されていません。設定を確認してください。',
  'auth/requires-recent-login': 'セキュリティのため、もう一度ログインしてからお試しください。',
  'auth/user-token-expired': 'ログインの有効期限が切れました。もう一度ログインしてください。',
  'auth/expired-action-code': 'リンクの有効期限が切れています。',
  'auth/invalid-action-code': 'リンクが無効です。もう一度やり直してください。',
  'auth/quota-exceeded': '利用量の上限に達しました。しばらく時間をおいてお試しください。',
  'auth/internal-error': 'ログイン中にエラーが発生しました。もう一度お試しください。',
};

function errorCode(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** 認証エラーを日本語メッセージに変換する */
export function authErrorMessage(e: unknown): string {
  const code = errorCode(e);
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (code && code.startsWith('auth/')) return `ログインに失敗しました（${code}）。`;
  // 自前の日本語エラー（未設定など）はそのまま
  if (e instanceof Error && e.message && code === null) return e.message;
  return 'ログインに失敗しました。もう一度お試しください。';
}

/** 画面にそのまま出せる日本語メッセージの Error に変換する（code と元のエラーは残す） */
export function toAuthError(e: unknown): Error {
  const err = new Error(authErrorMessage(e), { cause: e });
  const code = errorCode(e);
  if (code) Object.assign(err, { code });
  return err;
}

async function withAuthError(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    throw toAuthError(e);
  }
}

function requireConfigured(): void {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase が設定されていないため、ログインできません。');
  }
}

/** getRedirectResult は 1 回だけ呼ぶ（StrictMode で effect が 2 回走っても結果を失わない） */
let redirectResultPromise: Promise<UserCredential | null> | null = null;
function redirectResultOnce(): Promise<UserCredential | null> {
  redirectResultPromise ??= getRedirectResult(auth);
  return redirectResultPromise;
}

function signInWithGoogle(): Promise<void> {
  return withAuthError(async () => {
    requireConfigured();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = errorCode(e);
      if (code && REDIRECT_FALLBACK_CODES.has(code)) {
        // ページ遷移するので、この Promise は基本的に解決しない
        await signInWithRedirect(auth, provider);
        return;
      }
      // 利用者が自分で閉じた場合はエラーにしない
      if (code && USER_CANCEL_CODES.has(code)) return;
      throw e;
    }
  });
}

function signInWithEmail(email: string, password: string): Promise<void> {
  return withAuthError(async () => {
    requireConfigured();
    await signInWithEmailAndPassword(auth, email.trim(), password);
  });
}

function signUpWithEmail(email: string, password: string): Promise<void> {
  return withAuthError(async () => {
    requireConfigured();
    await createUserWithEmailAndPassword(auth, email.trim(), password);
  });
}

function sendPasswordReset(email: string): Promise<void> {
  return withAuthError(async () => {
    requireConfigured();
    await sendPasswordResetEmail(auth, email.trim());
  });
}

function signOut(): Promise<void> {
  return withAuthError(async () => {
    if (!isFirebaseConfigured) return;
    await firebaseSignOut(auth);
  });
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({ user: null, loading: isFirebaseConfigured }));
  const [redirectError, setRedirectError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    return onAuthStateChanged(
      auth,
      (user) => setState({ user, loading: false }),
      (e) => {
        console.error('[auth] ログイン状態の取得に失敗しました', e);
        setState({ user: null, loading: false });
      },
    );
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    let active = true;
    redirectResultOnce().catch((e: unknown) => {
      console.error('[auth] リダイレクトでのログインに失敗しました', e);
      const code = errorCode(e);
      if (active && !(code && USER_CANCEL_CODES.has(code))) setRedirectError(authErrorMessage(e));
    });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      loading: state.loading,
      redirectError,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      signOut,
    }),
    [state, redirectError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth は AuthProvider の内側で使ってください');
  return ctx;
}
