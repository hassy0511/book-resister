/*
 * はじめての方（/welcome）。グループ未参加のときに表示する。F-02, F-04
 *   1. 「新しく始める」か「家族に招待された」を選ぶ
 *   2a. 新しく始める: 表示名＋グループ名で createGroup → 最初の借りる場所を登録（スキップ可）→ ホーム
 *   2b. 招待された: 招待リンクを開くよう案内。リンク（またはコード）を貼り付けて /join/:code へ進める
 * グループ作成直後は groupId が入るが、場所の登録ステップを続けて表示する（App.tsx もそれを想定）。
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useGroup } from '../../group/GroupProvider';
import { addLocation } from '../../data/locations';
import { Button, Card, ConfirmDialog, Page, Spinner, TextField, useToast } from '../../components/ui';
import { BookIcon, ChevronRightIcon, LinkIcon, LocationIcon, PlusIcon, UsersIcon } from '../../components/ui/icons';
import { INVITE_VALID_DAYS } from '../../data/invites';
import { LoanDaysField } from '../settings/LoanDaysField';
import {
  DEFAULT_LOAN_DAYS,
  LOCATION_NAME_MAX,
  hasFormErrors,
  validateLocationForm,
  type LocationFormErrors,
} from '../settings/settingsLogic';
import { MAX_NAME_LENGTH, parseInviteInput, textLength, validateDisplayName, validateGroupName } from './authLogic';
import styles from './WelcomePage.module.css';

type Stage = 'choose' | 'create' | 'location' | 'join';

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function WelcomePage() {
  const { user, signOut } = useAuth();
  const { loading, groupId } = useGroup();
  const [stage, setStage] = useState<Stage>('choose');
  // グループ作成の処理中（作成直後に groupId が入ってもホームへ移動しないようにする）
  const [creating, setCreating] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<{ id: string; name: string } | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  if (loading && !creating && !createdGroup) {
    return (
      <Page>
        <Spinner size="lg" center label="読み込み中" />
      </Page>
    );
  }

  // すでにグループに参加している（作成直後の場所登録ステップを除く）
  if (groupId && !creating && !createdGroup) return <Navigate to="/" replace />;

  if (stage === 'location' && createdGroup) {
    return <FirstLocationStep groupId={createdGroup.id} groupName={createdGroup.name} />;
  }

  if (stage === 'create') {
    return (
      <CreateGroupStep
        defaultDisplayName={user?.displayName ?? ''}
        onBack={() => setStage('choose')}
        onCreatingChange={setCreating}
        onCreated={(group) => {
          setCreatedGroup(group);
          setStage('location');
        }}
      />
    );
  }

  if (stage === 'join') return <JoinGuideStep onBack={() => setStage('choose')} />;

  return (
    <Page>
      <div className={styles.container}>
        <header className={styles.hero}>
          <div className={styles.logo} aria-hidden="true">
            <BookIcon size={36} />
          </div>
          <h1 className={styles.heroTitle}>ようこそ</h1>
          <p className={styles.heroLead}>
            家族で本の貸出を共有するために、
            <wbr />
            はじめにグループを用意します。
          </p>
        </header>

        <div className={styles.choices}>
          <button type="button" className={styles.choice} onClick={() => setStage('create')}>
            <span className={styles.choiceIcon} aria-hidden="true">
              <PlusIcon size={26} />
            </span>
            <span className={styles.choiceBody}>
              <span className={styles.choiceTitle}>新しく始める</span>
              <span className={styles.choiceText}>家族の中で最初に使う人はこちら。グループを作って、あとから家族を招待します。</span>
            </span>
            <ChevronRightIcon size={20} className={styles.choiceChevron} />
          </button>

          <button type="button" className={styles.choice} onClick={() => setStage('join')}>
            <span className={styles.choiceIcon} aria-hidden="true">
              <UsersIcon size={26} />
            </span>
            <span className={styles.choiceBody}>
              <span className={styles.choiceTitle}>家族に招待された</span>
              <span className={styles.choiceText}>家族から届いた招待リンクを開いて、グループに参加します。</span>
            </span>
            <ChevronRightIcon size={20} className={styles.choiceChevron} />
          </button>
        </div>

        <div className={styles.account}>
          {user?.email ? <p className={styles.accountText}>ログイン中: {user.email}</p> : null}
          <Button variant="ghost" size="sm" onClick={() => setConfirmSignOut(true)}>
            別のアカウントでログインする
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="ログアウトしますか？"
        message="ログアウトして、ログインの画面に戻ります。"
        confirmLabel="ログアウト"
        onConfirm={async () => {
          await signOut();
          setConfirmSignOut(false);
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 新しく始める: 表示名とグループ名
// ---------------------------------------------------------------------------

type CreateGroupStepProps = {
  defaultDisplayName: string;
  onBack: () => void;
  onCreatingChange: (creating: boolean) => void;
  onCreated: (group: { id: string; name: string }) => void;
};

function CreateGroupStep({ defaultDisplayName, onBack, onCreatingChange, onCreated }: CreateGroupStepProps) {
  const { profile, createGroup } = useGroup();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(() => profile?.displayName || defaultDisplayName);
  const [groupName, setGroupName] = useState('');
  const [errors, setErrors] = useState<{ displayName?: string; groupName?: string }>({});
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const next = {
      displayName: validateDisplayName(displayName) ?? undefined,
      groupName: validateGroupName(groupName) ?? undefined,
    };
    setErrors(next);
    if (next.displayName || next.groupName) return;

    setBusy(true);
    onCreatingChange(true);
    try {
      const name = groupName.trim();
      const id = await createGroup(name, displayName.trim());
      toast.show(`「${name}」を作りました`, { tone: 'success' });
      onCreated({ id, name });
    } catch (err) {
      console.error(err);
      toast.show(errorText(err, 'グループを作れませんでした。もう一度お試しください。'), { tone: 'error' });
    } finally {
      setBusy(false);
      onCreatingChange(false);
    }
  };

  return (
    <Page
      title="新しく始める"
      back={busy ? undefined : onBack}
      footer={
        <Button type="submit" form="create-group-form" size="lg" block loading={busy}>
          グループを作る
        </Button>
      }
    >
      <p className={styles.stepLabel}>ステップ 1 / 2</p>
      <p className={styles.lead}>あなたの名前と、家族のグループの名前を決めてください。どちらもあとから変更できます。</p>
      <form id="create-group-form" className={styles.form} onSubmit={handleSubmit} noValidate>
        <TextField
          label="あなたの表示名"
          value={displayName}
          onChange={(v) => {
            setDisplayName(v);
            if (errors.displayName) setErrors((p) => ({ ...p, displayName: undefined }));
          }}
          placeholder="例：ママ、はなこ"
          autoComplete="nickname"
          required
          disabled={busy}
          error={errors.displayName}
          hint={`本を「借りた人」として家族に表示されます（${MAX_NAME_LENGTH} 文字まで）。`}
        />
        <TextField
          label="グループ名"
          value={groupName}
          onChange={(v) => {
            setGroupName(v);
            if (errors.groupName) setErrors((p) => ({ ...p, groupName: undefined }));
          }}
          placeholder="例：山田家"
          autoComplete="off"
          required
          disabled={busy}
          error={errors.groupName}
          hint="招待した家族にも表示されます。"
        />
      </form>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 最初の借りる場所
// ---------------------------------------------------------------------------

function FirstLocationStep({ groupId, groupName }: { groupId: string; groupName: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [days, setDays] = useState<number | null>(DEFAULT_LOAN_DAYS);
  const [errors, setErrors] = useState<LocationFormErrors>({});
  const [busy, setBusy] = useState(false);

  const goHome = () => navigate('/', { replace: true });

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const next = validateLocationForm({ name, defaultLoanDays: days, memo: '' });
    setErrors(next);
    if (hasFormErrors(next) || days == null) return;

    setBusy(true);
    try {
      await addLocation(groupId, { name: name.trim(), defaultLoanDays: days, memo: '' });
      toast.show(`「${name.trim()}」を登録しました`, { tone: 'success' });
      goHome();
    } catch (err) {
      console.error(err);
      toast.show(errorText(err, '場所を登録できませんでした。もう一度お試しください。'), { tone: 'error' });
      setBusy(false);
    }
  };

  const nameLength = textLength(name.trim());

  return (
    <Page
      title="借りる場所の登録"
      subtitle={groupName}
      footer={
        <>
          <Button type="submit" form="first-location-form" size="lg" block loading={busy}>
            登録してはじめる
          </Button>
          <Button variant="ghost" block onClick={goHome} disabled={busy}>
            あとで登録する
          </Button>
        </>
      }
    >
      <p className={styles.stepLabel}>ステップ 2 / 2</p>
      <div className={styles.locationIntro}>
        <span className={styles.locationIcon} aria-hidden="true">
          <LocationIcon size={24} />
        </span>
        <p className={styles.lead}>
          よく本を借りる場所を 1 つ登録しましょう。図書館・図書室・学校・保育園など、あとから設定画面で追加や変更ができます。
        </p>
      </div>
      <form id="first-location-form" className={styles.form} onSubmit={handleSubmit} noValidate>
        <TextField
          label="場所の名前"
          value={name}
          onChange={(v) => {
            setName(v);
            if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
          }}
          placeholder="例：中央図書館"
          autoComplete="off"
          required
          disabled={busy}
          error={errors.name}
          hint={`${nameLength} / ${LOCATION_NAME_MAX} 文字`}
        />
        <div className={styles.daysField}>
          <LoanDaysField
            value={days}
            onChange={(v) => {
              setDays(v);
              if (errors.defaultLoanDays) setErrors((p) => ({ ...p, defaultLoanDays: undefined }));
            }}
            error={errors.defaultLoanDays}
            disabled={busy}
            label="貸出期間"
          />
        </div>
      </form>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 家族に招待された
// ---------------------------------------------------------------------------

function JoinGuideStep({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) {
      setError('招待リンクを貼り付けてください');
      return;
    }
    const code = parseInviteInput(input);
    if (!code) {
      setError('招待リンクの形式が正しくありません。届いたリンク全体をコピーして貼り付けてください。');
      return;
    }
    navigate(`/join/${code}`);
  };

  return (
    <Page title="家族に招待された" back={onBack}>
      <Card className={styles.guideCard}>
        <ol className={styles.guideSteps}>
          <li>
            <span className={styles.guideNum} aria-hidden="true">
              1
            </span>
            <p>
              家族に、設定の「家族メンバー」から<strong>招待リンク</strong>を作って送ってもらいます（LINE やメッセージなど）。
            </p>
          </li>
          <li>
            <span className={styles.guideNum} aria-hidden="true">
              2
            </span>
            <div>
              <p>
                届いたリンクを<strong>タップして開きます</strong>。参加の確認画面が表示されるので「参加する」を押します。
              </p>
              <p className={styles.guideSub}>
                iPhone では Safari で開いてください。LINE などのアプリの中で開いた場合は、画面のメニューから「Safari
                で開く」を選びます（アプリの中では Google でログインできません）。
              </p>
            </div>
          </li>
        </ol>
        <p className={styles.guideNote}>
          招待リンクの有効期限は作成から {INVITE_VALID_DAYS} 日間です。期限が切れていたら、新しいリンクを作ってもらってください。
        </p>
      </Card>

      <section className={styles.pasteSection} aria-labelledby="paste-title">
        <h2 id="paste-title" className={styles.sectionTitle}>
          リンクを貼り付けて参加する
        </h2>
        <p className={styles.sectionText}>
          ホーム画面に追加したアプリで使っている場合など、リンクからうまく開けないときは、リンクを長押しして「コピー」し、ここに貼り付けてください。
        </p>
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <TextField
            label="招待リンク"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            placeholder="https://…/join/…"
            leading={<LinkIcon size={20} />}
            clearable
            value={input}
            onChange={(v) => {
              setInput(v);
              setError(null);
            }}
            error={error ?? undefined}
          />
          <Button type="submit" variant="secondary" size="lg" block className={styles.submit}>
            参加の確認へ進む
          </Button>
        </form>
      </section>
    </Page>
  );
}
