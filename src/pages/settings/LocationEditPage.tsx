/*
 * 借りる場所の登録・編集（/settings/locations/new, /settings/locations/:id）。F-10, F-11
 *   - 名前（必須、40 文字まで）、既定の貸出期間（1〜365 日、7/14/21/28 のチップ）、メモ
 *   - 編集時は「非表示にする／再表示する」。履歴がある場所も削除せずに非表示にする（履歴は残る）
 * 保存後は前の画面へ戻る（ホームや借りる画面から「場所を登録」で来た場合もそこへ戻る）。
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Location, WithId } from '../../types';
import { useRequiredGroup } from '../../group/GroupProvider';
import { addLocation, updateLocation, useLocations } from '../../data/locations';
import { useActiveLoans } from '../../data/loans';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LinkButton,
  Page,
  Spinner,
  TextArea,
  TextField,
  useToast,
} from '../../components/ui';
import { LocationIcon } from '../../components/ui/icons';
import { textLength } from '../auth/authLogic';
import { LoanDaysField } from './LoanDaysField';
import {
  DEFAULT_LOAN_DAYS,
  LOCATION_MEMO_MAX,
  LOCATION_NAME_MAX,
  hasFormErrors,
  isLocationFormChanged,
  validateLocationForm,
  type LocationForm,
  type LocationFormErrors,
} from './settingsLogic';
import styles from './LocationEditPage.module.css';

const LIST_PATH = '/settings/locations';
const FORM_ID = 'location-form';

/** アプリ内で戻れる履歴があるか（react-router が history.state.idx を持つ） */
function canGoBack(): boolean {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && 'idx' in state) {
    const idx = (state as { idx: unknown }).idx;
    return typeof idx === 'number' && idx > 0;
  }
  return false;
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : '保存できませんでした。もう一度お試しください。';
}

export default function LocationEditPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <LocationEditor location={null} />;
  return <ExistingLocation id={id} />;
}

/** 編集: 場所を読み込んでからフォームを出す */
function ExistingLocation({ id }: { id: string }) {
  const locations = useLocations({ includeArchived: true });
  const location = locations.data.find((l) => l.id === id) ?? null;

  if (locations.loading) {
    return (
      <Page title="場所の編集" back={LIST_PATH}>
        <Spinner size="lg" center showLabel label="読み込んでいます" />
      </Page>
    );
  }
  if (!location) {
    return (
      <Page title="場所の編集" back={LIST_PATH}>
        {locations.error ? (
          <ErrorState error={locations.error} onRetry={() => window.location.reload()} />
        ) : (
          <EmptyState
            icon={<LocationIcon />}
            title="場所が見つかりません"
            description="ほかの家族が削除したか、リンクが正しくない可能性があります。"
            action={
              <LinkButton to={LIST_PATH} replace variant="secondary">
                場所の一覧へ
              </LinkButton>
            }
          />
        )}
      </Page>
    );
  }
  // 別の場所に切り替わったときはフォームを作り直す
  return <LocationEditor key={location.id} location={location} />;
}

// ---------------------------------------------------------------------------
// フォーム
// ---------------------------------------------------------------------------

function LocationEditor({ location }: { location: WithId<Location> | null }) {
  const { groupId } = useRequiredGroup();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = location === null;

  const [form, setForm] = useState<LocationForm>(() => ({
    name: location?.name ?? '',
    defaultLoanDays: location?.defaultLoanDays ?? DEFAULT_LOAN_DAYS,
    memo: location?.memo ?? '',
  }));
  const [errors, setErrors] = useState<LocationFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const changed = isNew || (location ? isLocationFormChanged(form, location) : true);

  const goBack = () => {
    if (canGoBack()) navigate(-1);
    else navigate(LIST_PATH, { replace: true });
  };

  const update = <K extends keyof LocationForm>(key: K, value: LocationForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || !changed) return;
    const next = validateLocationForm(form);
    setErrors(next);
    if (hasFormErrors(next) || form.defaultLoanDays == null) return;

    const input = { name: form.name.trim(), defaultLoanDays: form.defaultLoanDays, memo: form.memo.trim() };
    setBusy(true);
    try {
      if (location) {
        await updateLocation(groupId, location.id, input);
        toast.show('保存しました', { tone: 'success' });
      } else {
        await addLocation(groupId, input);
        toast.show(`「${input.name}」を追加しました`, { tone: 'success' });
      }
      goBack();
    } catch (err) {
      console.error(err);
      toast.show(errorText(err), { tone: 'error' });
      setBusy(false);
    }
  };

  const nameLength = textLength(form.name.trim());
  const memoLength = textLength(form.memo.trim());

  return (
    <Page
      title={isNew ? '場所を追加' : '場所の編集'}
      back={busy ? undefined : LIST_PATH}
      footer={
        <Button type="submit" form={FORM_ID} size="lg" block loading={busy} disabled={!changed}>
          {isNew ? '追加する' : '保存する'}
        </Button>
      }
    >
      <form id={FORM_ID} className={styles.form} onSubmit={handleSubmit} noValidate>
        <TextField
          label="名前"
          value={form.name}
          onChange={(v) => update('name', v)}
          placeholder="例：中央図書館、〇〇保育園"
          autoComplete="off"
          required
          disabled={busy}
          error={errors.name ?? (nameLength > LOCATION_NAME_MAX ? `名前は ${LOCATION_NAME_MAX} 文字以内にしてください` : undefined)}
          hint={`${nameLength} / ${LOCATION_NAME_MAX} 文字`}
        />
        <div className={styles.daysField}>
          <LoanDaysField
            value={form.defaultLoanDays}
            onChange={(v) => update('defaultLoanDays', v)}
            error={errors.defaultLoanDays}
            disabled={busy}
          />
        </div>
        <TextArea
          label="メモ（任意）"
          value={form.memo}
          onChange={(v) => update('memo', v)}
          placeholder="例：返却ポストあり。毎週月曜は休館。"
          rows={3}
          disabled={busy}
          error={errors.memo}
          hint={memoLength > LOCATION_MEMO_MAX * 0.8 ? `${memoLength} / ${LOCATION_MEMO_MAX} 文字` : undefined}
          className={styles.memo}
        />
      </form>

      {location ? <ArchiveSection location={location} groupId={groupId} disabled={busy} onArchive={() => setConfirmArchive(true)} /> : null}

      {location ? (
        <ArchiveDialog
          open={confirmArchive}
          location={location}
          groupId={groupId}
          onDone={() => {
            setConfirmArchive(false);
            goBack();
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      ) : null}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 非表示にする／再表示する（F-11）
// ---------------------------------------------------------------------------

type ArchiveSectionProps = {
  location: WithId<Location>;
  groupId: string;
  disabled: boolean;
  onArchive: () => void;
};

function ArchiveSection({ location, groupId, disabled, onArchive }: ArchiveSectionProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateLocation(groupId, location.id, { archived: false });
      toast.show(`「${location.name}」を再表示しました`, { tone: 'success' });
    } catch (err) {
      console.error(err);
      toast.show(errorText(err), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (location.archived) {
    return (
      <Card tone="warning" title="この場所は非表示です" className={styles.archiveCard}>
        <p className={styles.archiveText}>
          本を借りるときの場所の選択肢に出ません。これまでの貸出記録（履歴）はそのまま残っています。
        </p>
        <Button variant="secondary" block loading={busy} disabled={disabled} onClick={handleRestore} className={styles.archiveButton}>
          再表示する
        </Button>
      </Card>
    );
  }

  return (
    <Card title="使わなくなった場所" className={styles.archiveCard}>
      <p className={styles.archiveText}>
        非表示にすると、本を借りるときの場所の選択肢に出なくなります。これまでの貸出記録（履歴）は残り、あとから再表示もできます。
      </p>
      <Button variant="secondary" block disabled={disabled} onClick={onArchive} className={`${styles.archiveButton} ${styles.archiveDanger}`}>
        非表示にする
      </Button>
    </Card>
  );
}

type ArchiveDialogProps = {
  open: boolean;
  location: WithId<Location>;
  groupId: string;
  onDone: () => void;
  onCancel: () => void;
};

function ArchiveDialog({ open, location, groupId, onDone, onCancel }: ArchiveDialogProps) {
  const toast = useToast();
  const activeLoans = useActiveLoans();
  const activeCount = useMemo(
    () => activeLoans.data.filter((l) => l.locationId === location.id).length,
    [activeLoans.data, location.id],
  );

  return (
    <ConfirmDialog
      open={open}
      title={`「${location.name}」を非表示にしますか？`}
      message={
        <>
          本を借りるときの場所の選択肢に出なくなります。これまでの貸出記録（履歴）は残り、あとから再表示できます。
          {activeCount > 0 ? (
            <>
              <br />
              <strong>この場所で借りている本が {activeCount} 冊あります。</strong>非表示にしても、返却や返却日の変更はこれまでどおりできます。
            </>
          ) : null}
        </>
      }
      confirmLabel="非表示にする"
      onConfirm={async () => {
        await updateLocation(groupId, location.id, { archived: true });
        toast.show(`「${location.name}」を非表示にしました`, {
          action: {
            label: '元に戻す',
            onClick: () => {
              updateLocation(groupId, location.id, { archived: false }).catch((e: unknown) => {
                console.error(e);
                toast.show(errorText(e), { tone: 'error' });
              });
            },
          },
        });
        onDone();
      }}
      onCancel={onCancel}
    />
  );
}
