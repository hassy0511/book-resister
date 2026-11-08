// @vitest-environment jsdom
/* 設定まわりの画面のテスト（認証・グループ・データ層・プッシュはモック） */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import type { Location, Member, WithId } from '../../types';
import type { PushState } from '../../lib/push';
import { ToastProvider } from '../../components/ui/ToastProvider';

const ts = (ms = 0) => ({ toMillis: () => ms }) as unknown as Timestamp;

const mocks = vi.hoisted(() => ({
  locations: { data: [] as unknown[], loading: false, error: null as Error | null },
  loans: { data: [] as unknown[], loading: false, error: null as Error | null },
  members: [] as unknown[],
  group: { id: 'g1', name: '山田家', createdBy: 'u1' } as { id: string; name: string; createdBy: string } | null,
  profile: { displayName: 'ママ', groupId: 'g1' } as { displayName: string; groupId: string } | null,
  pushState: 'off' as string,
  ios: true,
  addLocation: vi.fn<(gid: string, input: unknown) => Promise<string>>(),
  updateLocation: vi.fn<(gid: string, id: string, patch: unknown) => Promise<void>>(),
  createInvite: vi.fn<(gid: string, name: string, uid: string) => Promise<{ code: string; url: string }>>(),
  enablePush: vi.fn<(gid: string, uid: string) => Promise<void>>(),
  disablePush: vi.fn<(gid: string) => Promise<void>>(),
  showTestNotification: vi.fn<() => Promise<void>>(),
  getPushState: vi.fn<() => Promise<string>>(),
  signOut: vi.fn<() => Promise<void>>(),
  updateDisplayName: vi.fn<(name: string) => Promise<void>>(),
  updateGroupName: vi.fn<(name: string) => Promise<void>>(),
}));

vi.mock('../../firebase', () => ({ db: {}, auth: {}, app: {}, isFirebaseConfigured: true }));
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'mama@example.com' }, signOut: mocks.signOut }),
}));
vi.mock('../../group/GroupProvider', () => {
  const value = () => ({
    loading: false,
    groupId: 'g1',
    uid: 'u1',
    group: mocks.group,
    profile: mocks.profile,
    members: mocks.members,
    memberName: (uid: string) =>
      (mocks.members as { id: string; displayName: string }[]).find((m) => m.id === uid)?.displayName ?? '（不明）',
    updateDisplayName: mocks.updateDisplayName,
    updateGroupName: mocks.updateGroupName,
  });
  return { useRequiredGroup: value, useGroup: value };
});
vi.mock('../../data/locations', () => ({
  useLocations: (opts?: { includeArchived?: boolean }) => ({
    ...mocks.locations,
    data: opts?.includeArchived
      ? mocks.locations.data
      : (mocks.locations.data as { archived: boolean }[]).filter((l) => !l.archived),
  }),
  addLocation: mocks.addLocation,
  updateLocation: mocks.updateLocation,
}));
vi.mock('../../data/loans', () => ({ useActiveLoans: () => mocks.loans }));
vi.mock('../../data/invites', () => ({ INVITE_VALID_DAYS: 7, createInvite: mocks.createInvite }));
vi.mock('../../lib/push', () => ({
  getPushState: mocks.getPushState,
  enablePush: mocks.enablePush,
  disablePush: mocks.disablePush,
  showTestNotification: mocks.showTestNotification,
  isIos: () => mocks.ios,
}));

import SettingsPage from './SettingsPage';
import ProfilePage from './ProfilePage';
import LocationsPage from './LocationsPage';
import LocationEditPage from './LocationEditPage';
import MembersPage from './MembersPage';
import NotificationsPage from './NotificationsPage';

function CurrentUrl() {
  const loc = useLocation();
  return <p data-testid="url">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/profile" element={<ProfilePage />} />
          <Route path="/settings/locations" element={<LocationsPage />} />
          <Route path="/settings/locations/new" element={<LocationEditPage />} />
          <Route path="/settings/locations/:id" element={<LocationEditPage />} />
          <Route path="/settings/members" element={<MembersPage />} />
          <Route path="/settings/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<CurrentUrl />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function location(id: string, name: string, patch: Partial<Location> = {}): WithId<Location> {
  return { id, name, defaultLoanDays: 14, memo: '', archived: false, createdAt: ts(), updatedAt: ts(), ...patch };
}

function member(id: string, displayName: string, joinedMs = 0): WithId<Member> {
  return { id, displayName, joinedAt: ts(joinedMs), inviteCode: null };
}

const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setNavigator(key: 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

beforeEach(() => {
  mocks.locations = { data: [], loading: false, error: null };
  mocks.loans = { data: [], loading: false, error: null };
  mocks.members = [member('u1', 'ママ', Date.UTC(2026, 10, 1, 3)), member('u2', 'パパ', Date.UTC(2026, 10, 3, 3))];
  mocks.group = { id: 'g1', name: '山田家', createdBy: 'u1' };
  mocks.profile = { displayName: 'ママ', groupId: 'g1' };
  mocks.pushState = 'off';
  mocks.ios = true;
  for (const fn of [
    mocks.addLocation,
    mocks.updateLocation,
    mocks.createInvite,
    mocks.enablePush,
    mocks.disablePush,
    mocks.showTestNotification,
    mocks.getPushState,
    mocks.signOut,
    mocks.updateDisplayName,
    mocks.updateGroupName,
  ]) {
    fn.mockReset();
  }
  mocks.getPushState.mockImplementation(() => Promise.resolve(mocks.pushState));
});

afterEach(() => {
  cleanup();
  if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
  else delete (navigator as { share?: unknown }).share;
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

// ---------------------------------------------------------------------------

describe('SettingsPage', () => {
  it('グループ名・表示名・各設定へのリンクを表示する', async () => {
    mocks.locations.data = [location('L1', '中央図書館'), location('L2', '昔の図書室', { archived: true })];
    mocks.pushState = 'on';
    renderAt('/settings');
    expect(screen.getByText('ママ')).toBeTruthy();
    expect(screen.getByText('山田家・メンバー 2人')).toBeTruthy();
    expect(screen.getByRole('link', { name: /借りる場所.*1か所/ }).getAttribute('href')).toBe('/settings/locations');
    expect(screen.getByRole('link', { name: /家族メンバーと招待.*2人/ }).getAttribute('href')).toBe('/settings/members');
    expect(await screen.findByRole('link', { name: /返却日の通知.*オン/ })).toBeTruthy();
    expect(screen.getByText(/バージョン/)).toBeTruthy();
  });

  it('ログアウトは確認してから行い、通知がオンなら先にオフにする', async () => {
    mocks.pushState = 'on';
    mocks.disablePush.mockResolvedValue();
    mocks.signOut.mockResolvedValue();
    renderAt('/settings');
    await screen.findByRole('link', { name: /返却日の通知.*オン/ });
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/この端末への通知はオフになります/)).toBeTruthy();
    expect(mocks.signOut).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ログアウト' }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(mocks.disablePush).toHaveBeenCalledWith('g1');
  });
});

// ---------------------------------------------------------------------------

describe('ProfilePage', () => {
  it('変更したときだけ保存でき、前後の空白を除いて保存する', async () => {
    mocks.updateDisplayName.mockResolvedValue();
    renderAt('/settings/profile');
    const input = screen.getByLabelText(/^表示名/) as HTMLInputElement;
    expect(input.value).toBe('ママ');
    const form = input.closest('form') as HTMLFormElement;
    const save = within(form).getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '  おかあさん ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateDisplayName).toHaveBeenCalledWith('おかあさん'));
    expect(await screen.findByText('表示名を変更しました')).toBeTruthy();
  });

  it('グループ名が空ならエラー', () => {
    renderAt('/settings/profile');
    const input = screen.getByLabelText(/^グループ名/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(within(input.closest('form') as HTMLFormElement).getByRole('button', { name: '保存' }));
    expect(screen.getByText('グループ名を入力してください')).toBeTruthy();
    expect(mocks.updateGroupName).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('LocationsPage', () => {
  it('表示中と非表示を分けて表示し、貸出中の冊数を出す', () => {
    mocks.locations.data = [
      location('L1', '中央図書館', { memo: '月曜休館' }),
      location('L2', '昔の図書室', { archived: true }),
    ];
    mocks.loans.data = [{ locationId: 'L1' }, { locationId: 'L1' }];
    renderAt('/settings/locations');
    const active = screen.getByRole('heading', { name: '表示中の場所' }).closest('section') as HTMLElement;
    const archived = screen.getByRole('heading', { name: '非表示の場所' }).closest('section') as HTMLElement;
    expect(within(active).getByRole('link', { name: /中央図書館/ }).getAttribute('href')).toBe('/settings/locations/L1');
    expect(within(active).getByText('貸出期間 14日・月曜休館')).toBeTruthy();
    expect(within(active).getByText('貸出中 2冊')).toBeTruthy();
    expect(within(archived).getByRole('link', { name: /昔の図書室/ })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /場所を追加/ }).every((a) => a.getAttribute('href') === '/settings/locations/new')).toBe(true);
  });

  it('0 件なら登録を促す', () => {
    renderAt('/settings/locations');
    expect(screen.getByText('借りる場所がまだありません')).toBeTruthy();
  });

  it('読み込み中を表示する', () => {
    mocks.locations = { data: [], loading: true, error: null };
    renderAt('/settings/locations');
    expect(screen.getByText('場所を読み込んでいます')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('LocationEditPage', () => {
  it('新しい場所: 名前は必須。チップで貸出期間を選んで追加する', async () => {
    mocks.addLocation.mockResolvedValue('L9');
    renderAt('/settings/locations/new');
    expect(screen.getByRole('heading', { name: '場所を追加' })).toBeTruthy();
    const days = screen.getByLabelText(/^既定の貸出期間/) as HTMLInputElement;
    expect(days.value).toBe('14');

    fireEvent.click(screen.getByRole('button', { name: '追加する' }));
    expect(screen.getByText('名前を入力してください')).toBeTruthy();
    expect(mocks.addLocation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^名前/), { target: { value: ' 北保育園 ' } });
    fireEvent.click(screen.getByRole('button', { name: /^7日/ }));
    expect(days.value).toBe('7');
    fireEvent.change(screen.getByLabelText(/^メモ/), { target: { value: '連絡帳と一緒に返す' } });
    fireEvent.click(screen.getByRole('button', { name: '追加する' }));
    await waitFor(() =>
      expect(mocks.addLocation).toHaveBeenCalledWith('g1', { name: '北保育園', defaultLoanDays: 7, memo: '連絡帳と一緒に返す' }),
    );
    // 戻れる履歴が無いので場所の一覧へ
    expect(await screen.findByRole('heading', { name: '借りる場所' })).toBeTruthy();
    expect(await screen.findByText('「北保育園」を追加しました')).toBeTruthy();
  });

  it('名前が 40 文字を超えるとエラー', () => {
    renderAt('/settings/locations/new');
    fireEvent.change(screen.getByLabelText(/^名前/), { target: { value: 'あ'.repeat(41) } });
    expect(screen.getByText('名前は 40 文字以内にしてください')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '追加する' }));
    expect(mocks.addLocation).not.toHaveBeenCalled();
  });

  it('編集: 変更するまで保存できず、変更した内容を保存する', async () => {
    mocks.locations.data = [location('L1', '中央図書館', { defaultLoanDays: 14, memo: '' })];
    mocks.updateLocation.mockResolvedValue();
    renderAt('/settings/locations/L1');
    const save = screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement;
    expect((screen.getByLabelText(/^名前/) as HTMLInputElement).value).toBe('中央図書館');
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^21日/ }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.updateLocation).toHaveBeenCalledWith('g1', 'L1', { name: '中央図書館', defaultLoanDays: 21, memo: '' }),
    );
  });

  it('編集: 非表示にする前に確認し、借りている本があれば知らせる', async () => {
    mocks.locations.data = [location('L1', '中央図書館')];
    mocks.loans.data = [{ locationId: 'L1' }, { locationId: 'L2' }];
    mocks.updateLocation.mockResolvedValue();
    renderAt('/settings/locations/L1');
    fireEvent.click(screen.getByRole('button', { name: '非表示にする' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/履歴）は残り/)).toBeTruthy();
    expect(within(dialog).getByText('この場所で借りている本が 1 冊あります。')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '非表示にする' }));
    await waitFor(() => expect(mocks.updateLocation).toHaveBeenCalledWith('g1', 'L1', { archived: true }));
    expect(await screen.findByText('「中央図書館」を非表示にしました')).toBeTruthy();
  });

  it('編集: 非表示の場所は再表示できる', async () => {
    mocks.locations.data = [location('L1', '昔の図書室', { archived: true })];
    mocks.updateLocation.mockResolvedValue();
    renderAt('/settings/locations/L1');
    expect(screen.getByText('この場所は非表示です')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再表示する' }));
    await waitFor(() => expect(mocks.updateLocation).toHaveBeenCalledWith('g1', 'L1', { archived: false }));
  });

  it('見つからない場所はその旨を表示する', () => {
    renderAt('/settings/locations/nope');
    expect(screen.getByText('場所が見つかりません')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('MembersPage', () => {
  it('メンバー一覧で自分に「あなた」を付ける', () => {
    renderAt('/settings/members');
    expect(screen.getByRole('heading', { name: 'メンバー（2人）' })).toBeTruthy();
    const me = screen.getByRole('link', { name: /ママ（あなた）/ });
    expect(me.getAttribute('href')).toBe('/settings/profile');
    expect(within(me).getByText('あなた')).toBeTruthy();
    expect(within(me).getByText('グループを作成')).toBeTruthy();
    expect(screen.getByText('パパ')).toBeTruthy();
    expect(screen.getByText(/7 日間/)).toBeTruthy();
  });

  it('共有シートが無ければクリップボードにコピーし、リンクも表示する', async () => {
    const url = 'https://example.web.app/join/AbCdEfGhIjKlMnOpQrStUv';
    mocks.createInvite.mockResolvedValue({ code: 'AbCdEfGhIjKlMnOpQrStUv', url });
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    setNavigator('share', undefined);
    setNavigator('clipboard', { writeText });
    renderAt('/settings/members');
    fireEvent.click(screen.getByRole('button', { name: '招待リンクを作る' }));
    await waitFor(() => expect(mocks.createInvite).toHaveBeenCalledWith('g1', '山田家', 'u1'));
    // LINE で開いたときに Safari などで開くパラメータを付けて送る
    const shared = `${url}?openExternalBrowser=1`;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shared));
    expect(await screen.findByText(/招待リンクをコピーしました/)).toBeTruthy();
    expect((screen.getByLabelText(/招待リンク（/) as HTMLInputElement).value).toBe(shared);
    expect(screen.getByRole('button', { name: '新しい招待リンクを作る' })).toBeTruthy();
  });

  it('共有シートがあれば開く。開けなければコピーに切り替える', async () => {
    const url = 'https://example.web.app/join/AbCdEfGhIjKlMnOpQrStUv';
    mocks.createInvite.mockResolvedValue({ code: 'x', url });
    const share = vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockRejectedValueOnce(new DOMException('no activation', 'NotAllowedError'))
      .mockResolvedValue();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    setNavigator('share', share);
    setNavigator('clipboard', { writeText });
    renderAt('/settings/members');
    fireEvent.click(screen.getByRole('button', { name: '招待リンクを作る' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0].url).toBe(`${url}?openExternalBrowser=1`);
    expect(share.mock.calls[0][0].text).toContain('山田家');
    expect(share.mock.calls[0][0].text).toContain('Safari で開いてください');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${url}?openExternalBrowser=1`));

    // 「共有する」ボタンから改めて共有シートを開ける
    fireEvent.click(screen.getByRole('button', { name: '共有する' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
  });

  it('コピーもできなければリンクを選択してもらう', async () => {
    mocks.createInvite.mockResolvedValue({ code: 'x', url: 'https://example.web.app/join/x' });
    setNavigator('share', undefined);
    setNavigator('clipboard', undefined);
    renderAt('/settings/members');
    fireEvent.click(screen.getByRole('button', { name: '招待リンクを作る' }));
    expect(await screen.findByText(/リンクを長押ししてコピーしてください/)).toBeTruthy();
  });

  it('共有シートもコピーも使えなければ「共有する」ボタンへ案内する', async () => {
    mocks.createInvite.mockResolvedValue({ code: 'x', url: 'https://example.web.app/join/x' });
    const share = vi.fn<(data: ShareData) => Promise<void>>().mockRejectedValue(new DOMException('x', 'NotAllowedError'));
    setNavigator('share', share);
    setNavigator('clipboard', undefined);
    renderAt('/settings/members');
    fireEvent.click(screen.getByRole('button', { name: '招待リンクを作る' }));
    expect(await screen.findByText(/下の「共有する」から家族に送ってください/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '共有する' })).toBeTruthy();
  });

  it('作成に失敗したらエラーを知らせる', async () => {
    mocks.createInvite.mockRejectedValue(new Error('通信できないため招待リンクを作れませんでした。'));
    renderAt('/settings/members');
    fireEvent.click(screen.getByRole('button', { name: '招待リンクを作る' }));
    expect(await screen.findByText('通信できないため招待リンクを作れませんでした。')).toBeTruthy();
    expect(screen.queryByLabelText(/招待リンク（/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('NotificationsPage', () => {
  async function renderWith(state: PushState) {
    mocks.pushState = state;
    const view = renderAt('/settings/notifications');
    await waitFor(() => expect(screen.queryByText('通知の状態を確認しています')).toBeNull());
    return view;
  }

  it('オフ: ボタンの操作の中で直接 enablePush を呼ぶ', async () => {
    let resolve!: () => void;
    mocks.enablePush.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    await renderWith('off');
    const button = screen.getByRole('button', { name: '通知をオンにする' }) as HTMLButtonElement;
    fireEvent.click(button);
    // await を挟まずに呼ばれている（iOS の許可ダイアログのため）
    expect(mocks.enablePush).toHaveBeenCalledWith('g1', 'u1');
    fireEvent.click(button);
    expect(mocks.enablePush).toHaveBeenCalledTimes(1);

    mocks.pushState = 'on';
    await act(async () => resolve());
    expect(await screen.findByText('通知はオンです')).toBeTruthy();
    expect(screen.getByText(/通知をオンにしました/)).toBeTruthy();
  });

  it('オン: テスト通知とオフにするボタン', async () => {
    mocks.showTestNotification.mockResolvedValue();
    mocks.disablePush.mockResolvedValue();
    await renderWith('on');
    fireEvent.click(screen.getByRole('button', { name: 'テスト通知を送る' }));
    await waitFor(() => expect(mocks.showTestNotification).toHaveBeenCalled());
    expect(await screen.findByText(/テスト通知を送りました/)).toBeTruthy();

    mocks.pushState = 'off';
    fireEvent.click(screen.getByRole('button', { name: 'この端末の通知をオフにする' }));
    await waitFor(() => expect(mocks.disablePush).toHaveBeenCalledWith('g1'));
    expect(await screen.findByText('通知はオフです')).toBeTruthy();
  });

  it('ホーム画面に追加が必要なら手順を表示する', async () => {
    await renderWith('needs-install');
    expect(screen.getByText('ホーム画面に追加すると通知を受け取れます')).toBeTruthy();
    const guide = screen.getByRole('heading', { name: 'ホーム画面に追加する手順' }).closest('section') as HTMLElement;
    expect(within(guide).getAllByRole('listitem')).toHaveLength(5);
    expect(within(guide).getByText('「ホーム画面に追加」をタップ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '通知をオンにする' })).toBeNull();
  });

  it('ホーム画面の図のアプリ名は、ホーム画面に出る名前（かりた本）', async () => {
    await renderWith('needs-install');
    const guide = screen.getByRole('heading', { name: 'ホーム画面に追加する手順' }).closest('section') as HTMLElement;
    expect(within(guide).getByText('かりた本')).toBeTruthy();
    expect(within(guide).queryByText('かりた本ノート')).toBeNull();
    // 普通の Safari ではアプリ内ブラウザの案内を出さない
    expect(screen.queryByText(/の中のブラウザで開いています/)).toBeNull();
  });

  it('LINE の中のブラウザなら、先に Safari で開くよう伝える', async () => {
    const spy = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0',
      );
    try {
      await renderWith('needs-install');
      expect(screen.getByText(/いまは LINE の中のブラウザで開いています/)).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('ブロックされていれば設定アプリでの手順を、ホーム画面に出る名前で案内する。削除して追加し直すのは最後', async () => {
    mocks.ios = true;
    await renderWith('denied');
    expect(screen.getByText('通知がブロックされています')).toBeTruthy();
    const guide = screen.getByRole('heading', { name: 'iPhone で通知を許可する手順' }).closest('section') as HTMLElement;
    expect(within(guide).getByText('一覧から「かりた本」をタップ')).toBeTruthy();
    expect(within(guide).queryByText(/かりた本ノート/)).toBeNull();
    const trouble = within(guide).getByRole('heading', { name: '一覧に見つからないとき' }).nextElementSibling as HTMLElement;
    const items = within(trouble).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('ホーム画面のアイコンの下に出ている名前');
    expect(items[1]).toContain('ホーム画面のアイコンから開いているか');
    expect(items[2]).toContain('それでも見つからないときだけ');
    expect(items[2]).toContain('ログインと「通知をオンにする」をやり直す');
  });

  it('ブロックされていれば設定アプリでの手順を表示する', async () => {
    await renderWith('denied');
    expect(screen.getByText('通知がブロックされています')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'iPhone で通知を許可する手順' })).toBeTruthy();
    mocks.pushState = 'off';
    fireEvent.click(screen.getByRole('button', { name: '状態を確認し直す' }));
    expect(await screen.findByText('通知はオフです')).toBeTruthy();
  });

  it('通知の内容を説明する', async () => {
    await renderWith('unsupported');
    expect(screen.getByText('この端末では通知を使えません')).toBeTruthy();
    expect(screen.getByText('返却日の 3 日前と前日')).toBeTruthy();
    expect(screen.getByText('返却日を過ぎた本は毎朝')).toBeTruthy();
    expect(screen.getByText('毎朝 8 時ごろ')).toBeTruthy();
    expect(screen.getByText('家族全員に届きます')).toBeTruthy();
  });
});
