/*
 * 招待リンクからの参加（/join/:code）。F-02, F-06
 *   - getInvite で招待を確認し「〇〇 に参加しますか？」→ 表示名を入れて joinGroup → ホーム
 *   - 期限切れ・無効なリンク、すでに別のグループに参加している場合（1 人 1 グループ）はその旨を表示
 * 未ログインで開いた場合は App.tsx がログイン後にこの画面へ戻す。
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Invite, WithId } from '../../types';
import { useAuth } from '../../auth/AuthProvider';
import { useGroup } from '../../group/GroupProvider';
import { getInvite, isInviteCodeFormat } from '../../data/invites';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LinkButton,
  Page,
  Spinner,
  TextField,
  useToast,
} from '../../components/ui';
import { AlertIcon, CheckCircleIcon, UsersIcon } from '../../components/ui/icons';
import { MAX_NAME_LENGTH, validateDisplayName } from './authLogic';
import styles from './JoinPage.module.css';

type InviteState =
  | { status: 'loading' }
  | { status: 'ready'; invite: WithId<Invite> }
  | { status: 'invalid' }
  | { status: 'error'; error: Error };

/** 招待を読み込む。形式が不正なコードは問い合わせずに invalid */
function useInvite(code: string): { state: InviteState; reload: () => void } {
  const valid = isInviteCodeFormat(code);
  const [result, setResult] = useState<{ key: string; state: InviteState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${code}#${attempt}`;

  useEffect(() => {
    if (!valid) return undefined;
    let active = true;
    getInvite(code).then(
      (invite) => {
        if (active) setResult({ key, state: invite ? { status: 'ready', invite } : { status: 'invalid' } });
      },
      (e: unknown) => {
        console.error(e);
        const error = e instanceof Error ? e : new Error('招待を確認できませんでした。');
        if (active) setResult({ key, state: { status: 'error', error } });
      },
    );
    return () => {
      active = false;
    };
  }, [code, valid, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  if (!valid) return { state: { status: 'invalid' }, reload };
  return { state: result && result.key === key ? result.state : { status: 'loading' }, reload };
}

export default function JoinPage() {
  const { code = '' } = useParams<{ code: string }>();
  const { user, signOut } = useAuth();
  const group = useGroup();
  const { state, reload } = useInvite(code.trim());
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // 参加の処理中・完了後（groupId が入っても「参加済み」の表示に切り替えない）
  const [joining, setJoining] = useState(false);

  const backTarget = group.groupId ? '/' : '/welcome';

  let body: ReactNode;
  if (state.status === 'loading' || (group.loading && !joining)) {
    body = <Spinner size="lg" center showLabel label="招待を確認しています" />;
  } else if (state.status === 'error') {
    body = <ErrorState title="招待を確認できませんでした" error={state.error} onRetry={reload} />;
  } else if (state.status === 'invalid') {
    body = (
      <EmptyState
        icon={<AlertIcon />}
        title="この招待リンクは使えません"
        description={
          <>
            有効期限（作成から 7 日間）が切れているか、リンクが正しくありません。
            <br />
            家族に新しい招待リンクを作ってもらってください。
          </>
        }
        action={
          <LinkButton to={backTarget} replace variant="secondary">
            {group.groupId ? 'ホームへ' : 'はじめの画面へ'}
          </LinkButton>
        }
      />
    );
  } else if (group.groupId && group.groupId === state.invite.groupId && !joining) {
    body = (
      <EmptyState
        icon={<CheckCircleIcon />}
        title={`「${group.group?.name ?? state.invite.groupName}」に参加しています`}
        description="このグループにはすでに参加しています。"
        action={
          <LinkButton to="/" replace>
            ホームへ
          </LinkButton>
        }
      />
    );
  } else if (group.groupId && group.groupId !== state.invite.groupId && !joining) {
    body = (
      <>
        <EmptyState
          icon={<AlertIcon />}
          title="このグループには参加できません"
          description={
            <>
              あなたはすでに「{group.group?.name ?? '別のグループ'}」に参加しています。1 人が参加できるグループは 1 つだけです。
              <br />
              「{state.invite.groupName}」に参加するには、別のアカウントでログインしてください。
            </>
          }
          action={
            <LinkButton to="/" replace>
              ホームへ
            </LinkButton>
          }
        />
        <div className={styles.switchAccount}>
          <Button variant="ghost" onClick={() => setConfirmSignOut(true)}>
            別のアカウントでログインする
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <JoinForm
        code={code.trim()}
        invite={state.invite}
        defaultDisplayName={group.profile?.displayName || user?.displayName || ''}
        email={user?.email ?? null}
        onJoiningChange={setJoining}
        onSwitchAccount={() => setConfirmSignOut(true)}
      />
    );
  }

  return (
    <Page title="グループに参加" back={joining ? undefined : backTarget}>
      {body}
      <ConfirmDialog
        open={confirmSignOut}
        title="ログアウトしますか？"
        message="ログアウトしたあと、別のアカウントでログインするとこの招待リンクの画面に戻ります。"
        confirmLabel="ログアウト"
        onConfirm={async () => {
          // ログアウトすると App.tsx のガードが戻り先（この招待リンク）を保存してログイン画面へ移す
          await signOut();
          setConfirmSignOut(false);
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 参加フォーム
// ---------------------------------------------------------------------------

type JoinFormProps = {
  code: string;
  invite: WithId<Invite>;
  defaultDisplayName: string;
  email: string | null;
  onJoiningChange: (joining: boolean) => void;
  onSwitchAccount: () => void;
};

function JoinForm({ code, invite, defaultDisplayName, email, onJoiningChange, onSwitchAccount }: JoinFormProps) {
  const { joinGroup } = useGroup();
  const navigate = useNavigate();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const invalid = validateDisplayName(displayName);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    onJoiningChange(true);
    try {
      await joinGroup(code, displayName.trim());
      toast.show(`「${invite.groupName}」に参加しました`, { tone: 'success' });
      navigate('/', { replace: true });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error && err.message ? err.message : '参加できませんでした。もう一度お試しください。';
      toast.show(message, { tone: 'error' });
      setBusy(false);
      onJoiningChange(false);
    }
  };

  return (
    <div className={styles.joinWrap}>
      <Card className={styles.inviteCard}>
        <div className={styles.inviteIcon} aria-hidden="true">
          <UsersIcon size={32} />
        </div>
        <p className={styles.inviteLabel}>家族のグループへの招待</p>
        <h2 className={styles.groupName}>{invite.groupName}</h2>
        <p className={styles.question}>に参加しますか？</p>
      </Card>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <TextField
          label="あなたの表示名"
          value={displayName}
          onChange={(v) => {
            setDisplayName(v);
            setError(null);
          }}
          placeholder="例：パパ、たろう"
          autoComplete="nickname"
          required
          disabled={busy}
          error={error ?? undefined}
          hint={`本を「借りた人」として家族に表示されます（${MAX_NAME_LENGTH} 文字まで）。あとから変更できます。`}
        />
        <Button type="submit" size="lg" block loading={busy} className={styles.submit}>
          参加する
        </Button>
      </form>

      <div className={styles.account}>
        {email ? <p className={styles.accountText}>ログイン中: {email}</p> : null}
        <Button variant="ghost" size="sm" onClick={onSwitchAccount} disabled={busy}>
          別のアカウントでログインする
        </Button>
      </div>
    </div>
  );
}
