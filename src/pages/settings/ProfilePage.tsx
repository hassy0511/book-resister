/*
 * 表示名とグループ名（/settings/profile）。F-04
 *   - 表示名の変更（updateDisplayName: users と members の両方）
 *   - グループ名の変更（updateGroupName）
 * 編集していない間は最新の値（他の家族が変えた場合も）を表示し、編集を始めたら入力中の値を保つ。
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useRequiredGroup } from '../../group/GroupProvider';
import { Button, Card, Page, TextField, useToast } from '../../components/ui';
import { MAX_NAME_LENGTH, validateDisplayName, validateGroupName } from '../auth/authLogic';
import styles from './ProfilePage.module.css';

export default function ProfilePage() {
  const { uid, profile, group, members, updateDisplayName, updateGroupName } = useRequiredGroup();
  const currentDisplayName = profile?.displayName || members.find((m) => m.id === uid)?.displayName || '';
  const currentGroupName = group?.name ?? '';

  return (
    <Page title="表示名とグループ名" back="/settings">
      <NameForm
        title="あなたの表示名"
        label="表示名"
        current={currentDisplayName}
        placeholder="例：ママ、はなこ"
        autoComplete="nickname"
        hint={`本を「借りた人」として家族に表示されます（${MAX_NAME_LENGTH} 文字まで）。これまでの記録の表示も変わります。`}
        validate={validateDisplayName}
        save={updateDisplayName}
        successMessage="表示名を変更しました"
      />
      <NameForm
        title="グループ名"
        label="グループ名"
        current={currentGroupName}
        placeholder="例：山田家"
        autoComplete="off"
        hint={`家族全員の画面と、これから作る招待リンクに表示されます（${MAX_NAME_LENGTH} 文字まで）。`}
        validate={validateGroupName}
        save={updateGroupName}
        successMessage="グループ名を変更しました"
      />
    </Page>
  );
}

type NameFormProps = {
  title: string;
  label: string;
  current: string;
  placeholder: string;
  autoComplete: string;
  hint: ReactNode;
  validate: (value: string) => string | null;
  save: (value: string) => Promise<void>;
  successMessage: string;
};

function NameForm({ title, label, current, placeholder, autoComplete, hint, validate, save, successMessage }: NameFormProps) {
  const toast = useToast();
  // null = 編集していない（最新の値を表示する）
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = draft ?? current;
  const changed = value.trim() !== current.trim();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || !changed) return;
    const invalid = validate(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await save(value.trim());
      setDraft(null);
      toast.show(successMessage, { tone: 'success' });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error && err.message ? err.message : '保存できませんでした。もう一度お試しください。';
      toast.show(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={title} className={styles.section}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <TextField
          label={label}
          hideLabel
          value={value}
          onChange={(v) => {
            setDraft(v);
            setError(null);
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          disabled={busy}
          error={error ?? undefined}
          hint={hint}
        />
        <div className={styles.actions}>
          {draft !== null && changed && !busy ? (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              元に戻す
            </Button>
          ) : null}
          <Button type="submit" loading={busy} disabled={!changed}>
            保存
          </Button>
        </div>
      </form>
    </Card>
  );
}
