/*
 * 返却（F-50〜53, F-91）。
 *   /return?location=ID … その場所の貸出中すべて（まとめて返却）
 *   /return?loans=a,b   … 指定した貸出記録だけ（1 冊の返却など）
 * 本ごとにチェック（既定オン。外すと今回は返却しない）・読書状況（既定「読んだ」）・評価と感想（任意）。
 * 返却後はトースト（「取り消す」付き）を出してホームへ戻る。
 */
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Loan, WithId } from '../../types';
import { returnLoans, undoReturn, useActiveLoans } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { useRequiredGroup } from '../../group/GroupProvider';
import { LoanRow } from '../../components/LoanRow';
import { ReadStatusPicker } from '../../components/ReadStatusPicker';
import { ReviewEditor } from '../../components/ReviewEditor';
import {
  Button,
  Card,
  DateField,
  EmptyState,
  ErrorState,
  LinkButton,
  Page,
  Spinner,
  useToast,
} from '../../components/ui';
import { ChevronDownIcon, EditIcon, InfoIcon, ReturnIcon } from '../../components/ui/icons';
import { useToday } from '../home/useToday';
import {
  buildReturnItems,
  commonLocationId,
  defaultReturnDraft,
  errorText,
  hasReviewContent,
  latestBorrowedOn,
  parseReturnTarget,
  selectReturnLoans,
  validateReturnedOn,
  type ReturnDraft,
} from './loanLogic';
import styles from './ReturnPage.module.css';

const UNKNOWN_LOCATION = '（不明な場所）';

export default function ReturnPage() {
  const { groupId, memberName } = useRequiredGroup();
  const [params] = useSearchParams();
  const target = useMemo(() => parseReturnTarget(params), [params]);
  const activeQuery = useActiveLoans();
  const locationsQuery = useLocations({ includeArchived: true });
  const today = useToday();
  const navigate = useNavigate();
  const toast = useToast();

  const [returnedOn, setReturnedOn] = useState(today);
  const [drafts, setDrafts] = useState<Record<string, ReturnDraft>>({});
  // 返却処理中は一覧を固定する（書き込みの反映で一覧から消えて「空」に見えないように）
  const [frozen, setFrozen] = useState<{ loans: WithId<Loan>[]; missingCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const selection = useMemo(() => selectReturnLoans(activeQuery.data, target), [activeQuery.data, target]);
  const { loans, missingCount } = frozen ?? selection;

  const locationNames = useMemo(
    () => new Map(locationsQuery.data.map((l) => [l.id, l.name])),
    [locationsQuery.data],
  );
  const locationName = (id: string) => locationNames.get(id) ?? UNKNOWN_LOCATION;

  const draftOf = useCallback((loan: WithId<Loan>) => drafts[loan.id] ?? defaultReturnDraft(loan), [drafts]);
  const updateDraft = (loan: WithId<Loan>, patch: Partial<ReturnDraft>) => {
    setDrafts((prev) => ({ ...prev, [loan.id]: { ...(prev[loan.id] ?? defaultReturnDraft(loan)), ...patch } }));
  };

  const selected = useMemo(() => loans.filter((l) => draftOf(l).checked), [loans, draftOf]);
  const allChecked = selected.length === loans.length;
  const setAllChecked = (checked: boolean) => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const loan of loans) next[loan.id] = { ...(prev[loan.id] ?? defaultReturnDraft(loan)), checked };
      return next;
    });
  };

  const dateError = selected.length > 0 ? validateReturnedOn(returnedOn, selected, today) : null;
  const sharedLocationId = commonLocationId(loans);
  const headerLocationId = target.kind === 'location' ? target.locationId : sharedLocationId;
  const showLocationInRows = sharedLocationId === null;

  const undoAll = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => undoReturn(groupId, id)));
      toast.show(`${ids.length}冊の返却を取り消しました`);
    } catch (e) {
      toast.show(errorText(e, '返却を取り消せませんでした。もう一度お試しください。'), { tone: 'error' });
    }
  };

  const submit = async () => {
    if (busyRef.current) return;
    const items = buildReturnItems(loans, draftOf, returnedOn);
    if (items.length === 0) return;
    const invalid = validateReturnedOn(returnedOn, selected, today);
    if (invalid) {
      toast.show(invalid, { tone: 'error' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFrozen({ loans, missingCount });
    try {
      await returnLoans(groupId, items);
      const ids = items.map((i) => i.loanId);
      toast.show(`${ids.length}冊を返却しました`, {
        tone: 'success',
        action: { label: '取り消す', onClick: () => void undoAll(ids) },
      });
      navigate('/', { replace: true });
    } catch (e) {
      console.error(e);
      toast.show(errorText(e, '返却できませんでした。もう一度お試しください。'), { tone: 'error' });
      setFrozen(null);
      busyRef.current = false;
      setBusy(false);
    }
  };

  const loading = !frozen && (activeQuery.loading || locationsQuery.loading);
  const error = frozen ? null : activeQuery.error ?? locationsQuery.error;

  const title = target.kind === 'location' ? 'まとめて返却' : '返却';
  const subtitle = !loading && headerLocationId ? locationName(headerLocationId) : undefined;

  let body: ReactNode;
  let footer: ReactNode = null;
  if (target.kind === 'none') {
    body = (
      <EmptyState
        icon={<ReturnIcon />}
        title="返却する本が選ばれていません"
        description="ホームの一覧から、返却する本や場所を選んでください。"
        action={<LinkButton to="/">ホームへ</LinkButton>}
      />
    );
  } else if (loading) {
    body = <Spinner center size="lg" label="貸出中の本を読み込んでいます" />;
  } else if (error) {
    body = <ErrorState error={error} onRetry={() => window.location.reload()} />;
  } else if (loans.length === 0) {
    body = (
      <EmptyState
        icon={<ReturnIcon />}
        title={target.kind === 'location' ? 'この場所で借りている本はありません' : '返却する本はありません'}
        description={
          target.kind === 'location'
            ? 'すでに全部返却済みのようです。'
            : 'すでに返却済みか、登録が削除されています。'
        }
        action={<LinkButton to="/">ホームへ</LinkButton>}
      />
    );
  } else {
    body = (
      <>
        <Card className={styles.dateCard}>
          <DateField
            label="返却した日"
            value={returnedOn}
            onChange={setReturnedOn}
            max={today}
            min={latestBorrowedOn(selected) ?? undefined}
            error={dateError}
            disabled={busy}
          />
        </Card>

        {missingCount > 0 ? (
          <p className={styles.note} role="note">
            <InfoIcon size={18} className={styles.noteIcon} />
            {missingCount}冊はすでに返却済みか、見つかりませんでした。
          </p>
        ) : null}

        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>
            {loans.length}冊中 {selected.length}冊を返却
          </h2>
          {loans.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setAllChecked(!allChecked)} disabled={busy}>
              {allChecked ? 'すべて外す' : 'すべて選ぶ'}
            </Button>
          ) : null}
        </div>
        <p className={styles.help}>今回返却しない本は、タップしてチェックを外してください。</p>

        <ul className={styles.items}>
          {loans.map((loan) => (
            <ReturnItem
              key={loan.id}
              loan={loan}
              draft={draftOf(loan)}
              onChange={(patch) => updateDraft(loan, patch)}
              locationName={showLocationInRows ? locationName(loan.locationId) : ''}
              borrowerName={memberName(loan.borrowerUid)}
              today={today}
              disabled={busy}
            />
          ))}
        </ul>
      </>
    );
    footer = (
      <Button
        block
        size="lg"
        icon={<ReturnIcon />}
        loading={busy}
        disabled={selected.length === 0 || dateError !== null}
        onClick={() => void submit()}
      >
        {selected.length === 0 ? '返却する本を選んでください' : `${selected.length}冊を返却する`}
      </Button>
    );
  }

  return (
    <Page
      title={title}
      subtitle={subtitle}
      back="/"
      hideTabBar
      footer={footer ?? undefined}
      contentClassName={styles.content}
    >
      {body}
    </Page>
  );
}

type ReturnItemProps = {
  loan: WithId<Loan>;
  draft: ReturnDraft;
  onChange: (patch: Partial<ReturnDraft>) => void;
  locationName: string;
  borrowerName: string;
  today: string;
  disabled: boolean;
};

function ReturnItem({ loan, draft, onChange, locationName, borrowerName, today, disabled }: ReturnItemProps) {
  const reviewId = useId();
  const filled = hasReviewContent(draft);
  return (
    <li>
      <Card padded={false} className={draft.checked ? undefined : styles.itemOff}>
        <LoanRow
          loan={loan}
          locationName={locationName}
          borrowerName={borrowerName}
          checked={draft.checked}
          onClick={disabled ? undefined : () => onChange({ checked: !draft.checked })}
          today={today}
        />
        {draft.checked ? (
          <div className={styles.itemBody}>
            <ReadStatusPicker
              value={draft.readStatus}
              onChange={(readStatus) => onChange({ readStatus })}
              ariaLabel={`「${loan.book.title}」の読書状況`}
              disabled={disabled}
            />
            <button
              type="button"
              className={styles.reviewToggle}
              aria-expanded={draft.reviewOpen}
              aria-controls={draft.reviewOpen ? reviewId : undefined}
              onClick={() => onChange({ reviewOpen: !draft.reviewOpen })}
              disabled={disabled}
            >
              <EditIcon size={18} />
              <span className={styles.reviewToggleLabel}>
                {filled ? '評価・感想（入力済み）' : '感想を書く'}
                <span className={styles.optional}>（任意）</span>
              </span>
              <ChevronDownIcon size={18} className={draft.reviewOpen ? styles.chevronOpen : styles.chevron} />
            </button>
            {draft.reviewOpen ? (
              <div id={reviewId}>
                <ReviewEditor
                  value={{ rating: draft.rating, review: draft.review }}
                  onChange={(v) => onChange({ rating: v.rating, review: v.review })}
                  disabled={disabled}
                  hideHeading
                />
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.skipped}>今回は返却しません</p>
        )}
      </Card>
    </li>
  );
}
