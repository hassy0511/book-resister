/*
 * ログイン（/login）。F-01
 *   - Google でログイン（ポップアップ → 使えなければリダイレクト。AuthProvider 側で処理）
 *   - メールアドレス＋パスワード（ログイン／新規登録の切り替え、パスワード再設定メール）
 * ログインに成功すると App.tsx の LoginRoute が戻り先（招待リンクなど）か "/" へ移動させる。
 */
import { useState, type FormEvent } from 'react';
import { authErrorMessage, useAuth } from '../../auth/AuthProvider';
import { Button, Card, Page, SegmentedControl, Sheet, TextField, useToast } from '../../components/ui';
import type { SegmentOption } from '../../components/ui';
import { AlertIcon, BookIcon, InfoIcon } from '../../components/ui/icons';
import {
  MIN_PASSWORD_LENGTH,
  hasPendingInvite,
  validateEmail,
  validatePassword,
  type EmailAuthMode,
} from './authLogic';
import styles from './LoginPage.module.css';

const MODE_OPTIONS: SegmentOption<EmailAuthMode>[] = [
  { value: 'signin', label: 'ログイン' },
  { value: 'signup', label: '新規登録' },
];

type Busy = 'google' | 'email' | null;

type FieldErrors = { email?: string; password?: string };

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, redirectError } = useAuth();
  const toast = useToast();

  const [pendingInvite] = useState(() => hasPendingInvite());
  const [mode, setMode] = useState<EmailAuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const changeMode = (next: EmailAuthMode) => {
    setMode(next);
    setFieldErrors({});
    setFormError(null);
  };

  const handleGoogle = async () => {
    if (busy) return;
    setBusy('google');
    setFormError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setFormError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const handleEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const errors: FieldErrors = {
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password, mode) ?? undefined,
    };
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email || errors.password) return;

    setBusy('email');
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email, password);
        toast.show('アカウントを登録しました', { tone: 'success' });
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const errorText = formError ?? redirectError;

  return (
    // ヘッダーなし（セーフエリアの余白は Page が入れる。ブラウザのタイトルはアプリ名になる）
    <Page contentClassName={styles.content}>
      <div className={styles.container}>
        <header className={styles.hero}>
          <div className={styles.logo} aria-hidden="true">
            <BookIcon size={36} />
          </div>
          <h1 className={styles.appName}>かりた本ノート</h1>
          <p className={styles.tagline}>
            図書館などで借りた本と返却日を、
            <wbr />
            家族みんなで管理できます。
          </p>
        </header>

        {pendingInvite ? (
          <Card tone="primary" className={styles.notice}>
            <p className={styles.noticeText}>
              <InfoIcon size={20} className={styles.noticeIcon} />
              <span>招待リンクから開きました。ログインすると、グループへの参加の確認に進みます。</span>
            </p>
          </Card>
        ) : null}

        {errorText ? (
          <div className={styles.error} role="alert">
            <AlertIcon size={20} className={styles.errorIcon} />
            <p>{errorText}</p>
          </div>
        ) : null}

        <Button
          variant="secondary"
          size="lg"
          block
          icon={<GoogleLogo />}
          loading={busy === 'google'}
          disabled={busy !== null}
          onClick={handleGoogle}
          className={styles.googleButton}
        >
          Google でログイン
        </Button>

        <div className={styles.divider} role="separator">
          <span>または メールアドレスで</span>
        </div>

        <SegmentedControl
          ariaLabel="ログインか新規登録か"
          value={mode}
          onChange={changeMode}
          options={MODE_OPTIONS}
          disabled={busy !== null}
          className={styles.modeSwitch}
        />

        <form className={styles.form} onSubmit={handleEmailSubmit} noValidate>
          <TextField
            label="メールアドレス"
            type="email"
            name="email"
            inputMode="email"
            autoComplete={mode === 'signup' ? 'email' : 'username'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(v) => {
              setEmail(v);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            error={fieldErrors.email}
            disabled={busy !== null}
          />
          <TextField
            label="パスワード"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            error={fieldErrors.password}
            hint={mode === 'signup' ? `${MIN_PASSWORD_LENGTH} 文字以上で決めてください` : undefined}
            disabled={busy !== null}
            trailing={
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示する'}
              >
                {showPassword ? '隠す' : '表示'}
              </button>
            }
          />
          <Button
            type="submit"
            size="lg"
            block
            loading={busy === 'email'}
            disabled={busy !== null}
            className={styles.submit}
          >
            {mode === 'signup' ? '登録してはじめる' : 'ログイン'}
          </Button>
        </form>

        {mode === 'signin' ? (
          <Button variant="ghost" block onClick={() => setResetOpen(true)} disabled={busy !== null}>
            パスワードを忘れた場合
          </Button>
        ) : (
          <p className={styles.note}>
            Google アカウントを持っていない家族は、ここでメールアドレスとパスワードを登録してください。
          </p>
        )}
      </div>

      <PasswordResetSheet open={resetOpen} initialEmail={email} onClose={() => setResetOpen(false)} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// パスワード再設定
// ---------------------------------------------------------------------------

function PasswordResetSheet({ open, initialEmail, onClose }: { open: boolean; initialEmail: string; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="パスワードの再設定">
      {/* 開くたびに入力欄を初期化する */}
      {open ? <PasswordResetForm initialEmail={initialEmail} onDone={onClose} /> : null}
    </Sheet>
  );
}

function PasswordResetForm({ initialEmail, onDone }: { initialEmail: string; onDone: () => void }) {
  const { sendPasswordReset } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const invalid = validateEmail(email);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      toast.show('再設定用のメールを送りました。メールのリンクから新しいパスワードを設定してください。', {
        tone: 'success',
        duration: 6000,
      });
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.resetForm} onSubmit={handleSubmit} noValidate>
      <p className={styles.resetLead}>
        登録したメールアドレスに、パスワードを設定し直すためのリンクを送ります。届かないときは迷惑メールのフォルダも確認してください。
      </p>
      <TextField
        label="メールアドレス"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={email}
        onChange={(v) => {
          setEmail(v);
          setError(null);
        }}
        error={error ?? undefined}
        disabled={busy}
      />
      <Button type="submit" size="lg" block loading={busy} className={styles.submit}>
        再設定メールを送る
      </Button>
    </form>
  );
}

/** Google の「G」ロゴ（ログインボタン用） */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
