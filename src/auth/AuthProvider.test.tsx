// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { AuthContextValue } from './AuthProvider';

const mocks = vi.hoisted(() => ({
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  onAuthStateChanged: vi.fn(),
  isIos: vi.fn(() => false),
  isStandalone: vi.fn(() => false),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  createUserWithEmailAndPassword: vi.fn(),
  getRedirectResult: mocks.getRedirectResult,
  onAuthStateChanged: mocks.onAuthStateChanged,
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  signOut: vi.fn(),
}));
vi.mock('../firebase', () => ({ auth: {}, db: {}, app: {}, isFirebaseConfigured: true }));
vi.mock('../lib/push', () => ({ isIos: mocks.isIos, isStandalone: mocks.isStandalone }));

const { AuthProvider, prefersRedirectSignIn, useAuth } = await import('./AuthProvider');

function renderAuth(): AuthContextValue {
  let value: AuthContextValue | null = null;
  function Probe() {
    value = useAuth();
    return null;
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  if (!value) throw new Error('useAuth の値を取得できませんでした');
  return value;
}

beforeEach(() => {
  mocks.onAuthStateChanged.mockImplementation(() => () => undefined);
  mocks.getRedirectResult.mockResolvedValue(null);
  mocks.signInWithRedirect.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  mocks.isIos.mockReturnValue(false);
  mocks.isStandalone.mockReturnValue(false);
});

describe('signInWithGoogle', () => {
  it('ホーム画面の iPhone アプリ（standalone）では、ポップアップを使わず最初からリダイレクトにする', async () => {
    mocks.isIos.mockReturnValue(true);
    mocks.isStandalone.mockReturnValue(true);
    expect(prefersRedirectSignIn()).toBe(true);
    const auth = renderAuth();
    await act(() => auth.signInWithGoogle());
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('Safari などのブラウザではポップアップを使う', async () => {
    mocks.isIos.mockReturnValue(true);
    mocks.isStandalone.mockReturnValue(false);
    mocks.signInWithPopup.mockResolvedValue({});
    const auth = renderAuth();
    await act(() => auth.signInWithGoogle());
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('ポップアップがブロックされたらリダイレクトに切り替える', async () => {
    mocks.signInWithPopup.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }));
    const auth = renderAuth();
    await act(() => auth.signInWithGoogle());
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('利用者が閉じた場合はエラーにしない', async () => {
    mocks.signInWithPopup.mockRejectedValue(
      Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }),
    );
    const auth = renderAuth();
    await expect(auth.signInWithGoogle()).resolves.toBeUndefined();
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('新しいログインを始めて前のポップアップが取り消されても、前の呼び出しはリダイレクトに切り替えない', async () => {
    let rejectFirst: (e: unknown) => void = () => undefined;
    mocks.signInWithPopup
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce({});
    const auth = renderAuth();
    const first = auth.signInWithGoogle();
    await act(() => auth.signInWithGoogle());
    rejectFirst(Object.assign(new Error('cancelled'), { code: 'auth/cancelled-popup-request' }));
    await expect(first).resolves.toBeUndefined();
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });
});
