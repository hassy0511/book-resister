// @vitest-environment jsdom
/* ログイン・はじめての方・招待からの参加の画面のテスト（認証・グループ・データ層はモック） */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import { ToastProvider } from '../../components/ui/ToastProvider';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

type GroupState = {
  loading: boolean;
  groupId: string | null;
  profile: { displayName: string; groupId: string | null } | null;
  group: { id: string; name: string } | null;
};

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    value: { loading: false, groupId: null, profile: null, group: null } as GroupState,
    set(patch: Partial<GroupState>) {
      store.value = { ...store.value, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    store,
    auth: {
      user: { uid: 'u1', email: 'mama@example.com', displayName: 'Google 花子' } as { uid: string; email: string; displayName: string } | null,
      redirectError: null as string | null,
      signInWithGoogle: vi.fn<() => Promise<void>>(),
      signInWithEmail: vi.fn<(email: string, password: string) => Promise<void>>(),
      signUpWithEmail: vi.fn<(email: string, password: string) => Promise<void>>(),
      sendPasswordReset: vi.fn<(email: string) => Promise<void>>(),
      signOut: vi.fn<() => Promise<void>>(),
    },
    createGroup: vi.fn<(groupName: string, displayName: string) => Promise<string>>(),
    joinGroup: vi.fn<(code: string, displayName: string) => Promise<void>>(),
    getInvite: vi.fn<(code: string) => Promise<unknown>>(),
    addLocation: vi.fn<(gid: string, input: unknown) => Promise<string>>(),
  };
});

vi.mock('../../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: true }));
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
  authErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'ログインに失敗しました。'),
}));
vi.mock('../../group/GroupProvider', () => ({
  useGroup: () => {
    const value = useSyncExternalStore(mocks.store.subscribe, () => mocks.store.value);
    return { ...value, createGroup: mocks.createGroup, joinGroup: mocks.joinGroup, members: [] };
  },
}));
vi.mock('../../data/invites', () => ({
  INVITE_VALID_DAYS: 7,
  isInviteCodeFormat: (code: string) => /^[A-Za-z0-9_-]{16,64}$/.test(code),
  getInvite: mocks.getInvite,
}));
vi.mock('../../data/locations', () => ({ addLocation: mocks.addLocation }));

import LoginPage from './LoginPage';
import WelcomePage from './WelcomePage';
import JoinPage from './JoinPage';

function CurrentUrl() {
  const loc = useLocation();
  return <p data-testid="url">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="*" element={<CurrentUrl />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.store.value = { loading: false, groupId: null, profile: { displayName: '', groupId: null }, group: null };
  mocks.auth.user = { uid: 'u1', email: 'mama@example.com', displayName: 'Google 花子' };
  mocks.auth.redirectError = null;
  for (const fn of [
    mocks.auth.signInWithGoogle,
    mocks.auth.signInWithEmail,
    mocks.auth.signUpWithEmail,
    mocks.auth.sendPasswordReset,
    mocks.auth.signOut,
    mocks.createGroup,
    mocks.joinGroup,
    mocks.getInvite,
    mocks.addLocation,
  ]) {
    fn.mockReset();
  }
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------

describe('LoginPage', () => {
  it('新規登録では 6 文字未満のパスワードを止め、6 文字以上なら登録する', async () => {
    mocks.auth.signUpWithEmail.mockResolvedValue();
    renderAt('/login');
    fireEvent.click(screen.getByRole('radio', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'papa@example.com' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: '登録してはじめる' }));
    expect(screen.getByText('パスワードは 6 文字以上にしてください')).toBeTruthy();
    expect(mocks.auth.signUpWithEmail).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '登録してはじめる' }));
    await waitFor(() => expect(mocks.auth.signUpWithEmail).toHaveBeenCalledWith('papa@example.com', '123456'));
  });

  it('ログインに失敗したら日本語のエラーを表示する', async () => {
    mocks.auth.signInWithEmail.mockRejectedValue(new Error('メールアドレスまたはパスワードが違います。'));
    renderAt('/login');
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'mama@example.com' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    const alert = await screen.findByText('メールアドレスまたはパスワードが違います。');
    expect(alert.closest('[role="alert"]')).toBeTruthy();
  });

  it('Google ログイン中はボタンを押せない（二重送信しない）', async () => {
    const pending = deferred<void>();
    mocks.auth.signInWithGoogle.mockReturnValue(pending.promise);
    renderAt('/login');
    const button = screen.getByRole('button', { name: /Google でログイン/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.auth.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve());
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('Google の画面から戻ってこなくても、キャンセルやメールアドレスでのログインができる', async () => {
    const pending = deferred<void>();
    mocks.auth.signInWithGoogle.mockReturnValue(pending.promise);
    mocks.auth.signInWithEmail.mockResolvedValue();
    renderAt('/login');
    const google = screen.getByRole('button', { name: /Google でログイン/ });
    fireEvent.click(google);
    expect((google as HTMLButtonElement).disabled).toBe(true);

    // Google の待ち中もメールアドレスの欄は使える
    const emailField = screen.getByLabelText('メールアドレス') as HTMLInputElement;
    expect(emailField.disabled).toBe(false);
    expect((screen.getByLabelText('パスワード') as HTMLInputElement).disabled).toBe(false);

    // キャンセルで Google のボタンも元に戻る（後から前の呼び出しが終わっても影響しない）
    fireEvent.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect((google as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /キャンセル/ })).toBeNull();

    // もう一度 Google を押して待っている間に、メールアドレスでログインする
    fireEvent.click(google);
    fireEvent.change(emailField, { target: { value: 'mama@example.com' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    await waitFor(() => expect(mocks.auth.signInWithEmail).toHaveBeenCalledWith('mama@example.com', 'secret1'));
    await act(async () => pending.reject(new Error('前の Google ログインの失敗')));
    expect(screen.queryByText('前の Google ログインの失敗')).toBeNull();
    expect((google as HTMLButtonElement).disabled).toBe(false);
  });

  it('パスワード再設定のメールを送る', async () => {
    mocks.auth.sendPasswordReset.mockResolvedValue();
    renderAt('/login');
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'mama@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを忘れた場合' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('メールアドレス') as HTMLInputElement).value).toBe('mama@example.com');
    fireEvent.click(within(dialog).getByRole('button', { name: '再設定メールを送る' }));
    await waitFor(() => expect(mocks.auth.sendPasswordReset).toHaveBeenCalledWith('mama@example.com'));
    expect(await screen.findByText(/再設定用のメールを送りました/)).toBeTruthy();
  });

  it('招待リンクから来た場合は案内を出す', () => {
    sessionStorage.setItem('returnTo', `/join/${CODE}`);
    renderAt('/login');
    expect(screen.getByText(/招待リンクから開きました/)).toBeTruthy();
  });
});

describe('LoginPage（LINE などのアプリ内ブラウザ）', () => {
  const LINE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0';

  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('Safari で開くよう案内し、Google のボタンは薄くして理由を添える（メールアドレスでのログインはそのまま）', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINE_UA);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/login');
    const notice = screen.getByRole('region', { name: 'Safari で開いてください' });
    expect(within(notice).getByText('LINE の中のブラウザで開いています')).toBeTruthy();
    expect(within(notice).getByText(/「Safari で開く」/)).toBeTruthy();

    const google = screen.getByRole('button', { name: /Google でログイン/ });
    expect(google.className).toContain('googleDimmed');
    expect(google).toHaveProperty('disabled', false);
    expect(screen.getByText(/Google のログインは Google によって止められます/)).toBeTruthy();
    expect(screen.getByLabelText('メールアドレス')).toHaveProperty('disabled', false);

    await act(async () => {
      fireEvent.click(within(notice).getByRole('button', { name: 'このページのリンクをコピー' }));
    });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(within(notice).getByText(/コピーしました/)).toBeTruthy();
  });

  it('普通の Safari では案内を出さない', () => {
    renderAt('/login');
    expect(screen.queryByRole('region', { name: 'Safari で開いてください' })).toBeNull();
    expect(screen.getByRole('button', { name: /Google でログイン/ }).className).not.toContain('googleDimmed');
  });
});

// ---------------------------------------------------------------------------

describe('WelcomePage', () => {
  it('グループを作り、続けて最初の場所を登録してホームへ進む', async () => {
    mocks.createGroup.mockImplementation(async () => {
      // 実際の GroupProvider と同じく、書き込みの完了前に groupId が入る
      mocks.store.set({ groupId: 'g1', profile: { displayName: 'ママ', groupId: 'g1' } });
      return 'g1';
    });
    mocks.addLocation.mockResolvedValue('L1');
    renderAt('/welcome');

    fireEvent.click(screen.getByRole('button', { name: /新しく始める/ }));
    // Google の表示名が初期値
    expect((screen.getByLabelText(/あなたの表示名/) as HTMLInputElement).value).toBe('Google 花子');
    fireEvent.change(screen.getByLabelText(/あなたの表示名/), { target: { value: 'ママ' } });
    fireEvent.click(screen.getByRole('button', { name: 'グループを作る' }));
    expect(await screen.findByText('グループ名を入力してください')).toBeTruthy();
    expect(mocks.createGroup).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/グループ名/), { target: { value: '山田家' } });
    fireEvent.click(screen.getByRole('button', { name: 'グループを作る' }));
    await waitFor(() => expect(mocks.createGroup).toHaveBeenCalledWith('山田家', 'ママ'));

    // groupId が入ってもホームへは移らず、場所の登録に進む
    expect(await screen.findByRole('heading', { name: '借りる場所の登録' })).toBeTruthy();
    expect((screen.getByLabelText(/^貸出期間/) as HTMLInputElement).value).toBe('14');
    fireEvent.change(screen.getByLabelText(/場所の名前/), { target: { value: '中央図書館' } });
    fireEvent.click(screen.getByRole('button', { name: /21日/ }));
    fireEvent.click(screen.getByRole('button', { name: '登録してはじめる' }));
    await waitFor(() =>
      expect(mocks.addLocation).toHaveBeenCalledWith('g1', { name: '中央図書館', defaultLoanDays: 21, memo: '' }),
    );
    expect((await screen.findByTestId('url')).textContent).toBe('/');
  });

  it('場所の登録はスキップできる', async () => {
    mocks.createGroup.mockResolvedValue('g1');
    renderAt('/welcome');
    fireEvent.click(screen.getByRole('button', { name: /新しく始める/ }));
    fireEvent.change(screen.getByLabelText(/グループ名/), { target: { value: '山田家' } });
    fireEvent.click(screen.getByRole('button', { name: 'グループを作る' }));
    fireEvent.click(await screen.findByRole('button', { name: 'あとで登録する' }));
    expect(screen.getByTestId('url').textContent).toBe('/');
    expect(mocks.addLocation).not.toHaveBeenCalled();
  });

  it('招待された場合は、貼り付けたリンクから参加の確認へ進む', () => {
    renderAt('/welcome');
    fireEvent.click(screen.getByRole('button', { name: /家族に招待された/ }));
    const input = screen.getByLabelText('招待リンク');
    fireEvent.change(input, { target: { value: 'こんにちは' } });
    fireEvent.click(screen.getByRole('button', { name: '参加の確認へ進む' }));
    expect(screen.getByText(/招待リンクの形式が正しくありません/)).toBeTruthy();

    fireEvent.change(input, { target: { value: `https://example.web.app/join/${CODE}` } });
    mocks.getInvite.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: '参加の確認へ進む' }));
    expect(screen.getByText('招待を確認しています')).toBeTruthy();
  });

  it('すでにグループに参加していればホームへ移る', () => {
    mocks.store.value = { ...mocks.store.value, groupId: 'g1' };
    renderAt('/welcome');
    expect(screen.getByTestId('url').textContent).toBe('/');
  });
});

// ---------------------------------------------------------------------------

describe('JoinPage', () => {
  const invite = { id: CODE, groupId: 'g9', groupName: '佐藤家', createdBy: 'x' };

  it('招待を確認して参加し、ホームへ進む', async () => {
    mocks.getInvite.mockResolvedValue(invite);
    mocks.joinGroup.mockImplementation(async () => {
      mocks.store.set({ groupId: 'g9' });
    });
    renderAt(`/join/${CODE}`);
    expect(await screen.findByRole('heading', { name: '佐藤家' })).toBeTruthy();
    expect(screen.getByText('に参加しますか？')).toBeTruthy();
    expect(mocks.getInvite).toHaveBeenCalledWith(CODE);

    fireEvent.change(screen.getByLabelText(/あなたの表示名/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '参加する' }));
    expect(screen.getByText('表示名を入力してください')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/あなたの表示名/), { target: { value: 'パパ' } });
    fireEvent.click(screen.getByRole('button', { name: '参加する' }));
    await waitFor(() => expect(mocks.joinGroup).toHaveBeenCalledWith(CODE, 'パパ'));
    expect((await screen.findByTestId('url')).textContent).toBe('/');
  });

  it('LINE で開いた招待リンク（?openExternalBrowser=1 付き）でも参加でき、Safari で開き直すよう添える', async () => {
    const spy = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0',
      );
    try {
      mocks.getInvite.mockResolvedValue(invite);
      renderAt(`/join/${CODE}?openExternalBrowser=1`);
      expect(await screen.findByRole('heading', { name: '佐藤家' })).toBeTruthy();
      expect(mocks.getInvite).toHaveBeenCalledWith(CODE);
      expect(screen.getByText(/いまは LINE の中のブラウザで開いています/)).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('期限切れ・無効な招待はその旨を表示する', async () => {
    mocks.getInvite.mockResolvedValue(null);
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('この招待リンクは使えません')).toBeTruthy();
  });

  it('形式が正しくないコードは問い合わせずに無効と表示する', () => {
    renderAt('/join/abc');
    expect(screen.getByText('この招待リンクは使えません')).toBeTruthy();
    expect(mocks.getInvite).not.toHaveBeenCalled();
  });

  it('別のグループに参加中なら参加できない旨を表示する', async () => {
    mocks.store.value = {
      ...mocks.store.value,
      groupId: 'g1',
      profile: { displayName: 'ママ', groupId: 'g1' },
      group: { id: 'g1', name: '山田家' },
    };
    mocks.getInvite.mockResolvedValue(invite);
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('このグループには参加できません')).toBeTruthy();
    expect(screen.getByText(/すでに「山田家」に参加しています/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '参加する' })).toBeNull();
  });

  it('同じグループに参加済みならそのことを表示する', async () => {
    mocks.store.value = { ...mocks.store.value, groupId: 'g9', group: { id: 'g9', name: '佐藤家' } };
    mocks.getInvite.mockResolvedValue(invite);
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('「佐藤家」に参加しています')).toBeTruthy();
  });

  it('通信エラーは再試行できる', async () => {
    mocks.getInvite.mockRejectedValueOnce(new Error('通信できませんでした。')).mockResolvedValue(invite);
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('招待を確認できませんでした')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
    expect(await screen.findByRole('heading', { name: '佐藤家' })).toBeTruthy();
  });
});
