/*
 * 設定（/settings）: グループ名と自分の表示名、各設定へのリンク、ログアウト、アプリのバージョン。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useRequiredGroup } from '../../group/GroupProvider';
import { useLocations } from '../../data/locations';
import { disablePush } from '../../lib/push';
import { ConfirmDialog, ListGroup, ListRow, Page } from '../../components/ui';
import { BellIcon, ChevronRightIcon, LocationIcon, LogoutIcon, UserIcon, UsersIcon } from '../../components/ui/icons';
import { MemberAvatar } from './MemberAvatar';
import { pushStateLabel } from './settingsLogic';
import { usePushState } from './usePushState';
import styles from './SettingsPage.module.css';

/** アプリのバージョン（表示用） */
/** package.json の version（vite.config.ts の define で埋め込む。テストなどで無い場合は「開発版」） */
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '開発版';

/** ログアウト前に通知を止める処理を待つ上限 */
const DISABLE_PUSH_WAIT_MS = 3000;

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { groupId, uid, group, members, profile, memberName } = useRequiredGroup();
  const locations = useLocations();
  const { state: pushState } = usePushState();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const displayName = profile?.displayName || memberName(uid);
  const groupName = group?.name ?? '';

  const handleSignOut = async () => {
    // この端末に家族の通知が届き続けないよう、通知をオフにしてからログアウトする（失敗しても続行）
    if (pushState === 'on') {
      await Promise.race([
        disablePush(groupId).catch((e: unknown) => console.warn('[push] 通知をオフにできませんでした', e)),
        new Promise((resolve) => setTimeout(resolve, DISABLE_PUSH_WAIT_MS)),
      ]);
    }
    await signOut();
    // ログアウトするとログイン画面へ移る（ダイアログはこの画面ごと消える）
  };

  return (
    <Page title="設定" large>
      <Link to="/settings/profile" className={styles.profileCard}>
        <MemberAvatar name={displayName} size="lg" />
        <span className={styles.profileText}>
          <span className={styles.profileName}>{displayName}</span>
          <span className={styles.profileGroup}>
            {groupName}
            {members.length > 0 ? `・メンバー ${members.length}人` : ''}
          </span>
        </span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </Link>

      <ListGroup title="設定">
        <ListRow
          leading={<UserIcon size={22} />}
          title="表示名とグループ名"
          subtitle="「借りた人」として表示される名前"
          to="/settings/profile"
        />
        <ListRow
          leading={<LocationIcon size={22} />}
          title="借りる場所"
          subtitle="図書館・図書室・学校など"
          trailing={locations.loading || locations.error ? null : `${locations.data.length}か所`}
          to="/settings/locations"
        />
        <ListRow
          leading={<UsersIcon size={22} />}
          title="家族メンバーと招待"
          trailing={members.length > 0 ? `${members.length}人` : null}
          to="/settings/members"
        />
        <ListRow
          leading={<BellIcon size={22} />}
          title="返却日の通知"
          trailing={pushState ? pushStateLabel(pushState) : null}
          to="/settings/notifications"
        />
      </ListGroup>

      <ListGroup>
        <ListRow
          leading={<LogoutIcon size={22} />}
          title="ログアウト"
          danger
          chevron={false}
          onClick={() => setConfirmSignOut(true)}
        />
      </ListGroup>

      <footer className={styles.appInfo}>
        <p>かりた本ノート バージョン {APP_VERSION}</p>
        {user?.email ? <p className={styles.email}>ログイン中: {user.email}</p> : null}
      </footer>

      <ConfirmDialog
        open={confirmSignOut}
        title="ログアウトしますか？"
        message={
          <>
            記録した本や履歴は消えません。もう一度ログインすれば、そのまま使えます。
            {pushState === 'on' ? <><br />この端末への通知はオフになります。</> : null}
          </>
        }
        confirmLabel="ログアウト"
        danger
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Page>
  );
}
