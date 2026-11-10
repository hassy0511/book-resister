/*
 * 貸出の詳細（/loans/:loanId）。
 *   貸出中: 返却日の変更（延長, F-40）、場所・借りた人・借りた日の修正、返却（/return?loans=id へ）、誤登録の削除
 *   返却済み: 返却した日・読書状況の変更、評価と感想の編集（F-91）、返却の取り消し（F-54）
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DateString, Loan, Location, ReadStatus, WithId } from '../../types';
import { deleteLoan, undoReturn, updateLoan, useLoan } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { useRequiredGroup } from '../../group/GroupProvider';
import { formatDate } from '../../lib/date';
import { BookCover } from '../../components/BookCover';
import { DueBadge } from '../../components/DueBadge';
import { READ_STATUS_TEXT, ReadStatusPicker } from '../../components/ReadStatusPicker';
import { ReviewEditor, reviewFromLoan, reviewToPatch, type ReviewValue } from '../../components/ReviewEditor';
import {
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  LinkButton,
  ListGroup,
  ListRow,
  Page,
  Select,
  Sheet,
  Spinner,
  useToast,
} from '../../components/ui';
import type { SelectOption } from '../../components/ui';
import {
  BookIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  EditIcon,
  LocationIcon,
  ReturnIcon,
  TrashIcon,
  UndoIcon,
  UserIcon,
} from '../../components/ui/icons';
import { useToday } from '../home/useToday';
import { dueOptions, errorText, validateBorrowedOn, validateDueOn, validateReturnedOn } from './loanLogic';
import styles from './LoanDetailPage.module.css';

const PAGE_TITLE = '貸出の詳細';
const UNKNOWN_LOCATION = '（不明な場所）';

export default function LoanDetailPage() {
  const { loanId } = useParams();
  const loanQuery = useLoan(loanId);
  const locationsQuery = useLocations({ includeArchived: true });
  // 削除した直後は「見つかりません」を出さずにホームへ移る
  const [leaving, setLeaving] = useState(false);

  const loan = loanQuery.data;
  const loading = loanQuery.loading || locationsQuery.loading;
  const error = loanQuery.error ?? locationsQuery.error;

  if (loading || (leaving && !loan)) {
    return (
      <Page title={PAGE_TITLE} back="/">
        <Spinner center size="lg" />
      </Page>
    );
  }
  if (error) {
    return (
      <Page title={PAGE_TITLE} back="/">
        <ErrorState error={error} onRetry={() => window.location.reload()} />
      </Page>
    );
  }
  if (!loan) {
    return (
      <Page title={PAGE_TITLE} back="/">
        <EmptyState
          icon={<BookIcon />}
          title="この貸出記録は見つかりません"
          description="削除された可能性があります。"
          action={<LinkButton to="/">ホームへ</LinkButton>}
        />
      </Page>
    );
  }
  return <LoanDetailView key={loan.id} loan={loan} locations={locationsQuery.data} onLeaving={setLeaving} />;
}

type SheetKind = 'due' | 'edit' | 'returned';
type ConfirmKind = 'delete' | 'undo';

type LoanDetailViewProps = {
  loan: WithId<Loan>;
  locations: WithId<Location>[];
  onLeaving: (leaving: boolean) => void;
};

function LoanDetailView({ loan, locations, onLeaving }: LoanDetailViewProps) {
  const { groupId, members, memberName } = useRequiredGroup();
  const navigate = useNavigate();
  const toast = useToast();
  const today = useToday();

  const returned = loan.returnedOn !== null;
  const location = locations.find((l) => l.id === loan.locationId) ?? null;
  const locationName = location?.name ?? UNKNOWN_LOCATION;

  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // 各シートの入力中の値（開くときに今の値で初期化する）
  const [dueDraft, setDueDraft] = useState<DateString>(loan.dueOn);
  const [editDraft, setEditDraft] = useState({
    locationId: loan.locationId,
    borrowerUid: loan.borrowerUid,
    borrowedOn: loan.borrowedOn,
  });
  const [returnedDraft, setReturnedDraft] = useState<{ returnedOn: DateString; readStatus: ReadStatus }>({
    returnedOn: loan.returnedOn ?? today,
    readStatus: loan.readStatus ?? 'read',
  });
  // 評価と感想（null = 編集していない。記録の値をそのまま表示する）
  const [reviewDraft, setReviewDraft] = useState<ReviewValue | null>(null);

  /** 書き込みを 1 つずつ実行し、結果をトーストで知らせる。成功したら true */
  const run = async (write: () => Promise<void>, success: string, failure: string): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      await write();
      toast.show(success, { tone: 'success' });
      return true;
    } catch (e) {
      console.error(e);
      toast.show(errorText(e, failure), { tone: 'error' });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const closeSheet = () => {
    if (!savingRef.current) setSheet(null);
  };

  // ---- 返却日の変更（延長） ----
  const openDue = () => {
    setDueDraft(loan.dueOn);
    setSheet('due');
  };
  const dueError = validateDueOn(dueDraft, loan.borrowedOn);
  const quickDue = dueOptions(loan.dueOn, today, location?.defaultLoanDays ?? null);
  const saveDue = async () => {
    if (dueError || dueDraft === loan.dueOn) return;
    const ok = await run(
      () => updateLoan(groupId, loan.id, { dueOn: dueDraft }),
      `返却日を${formatDate(dueDraft)}に変更しました`,
      '返却日を変更できませんでした',
    );
    if (ok) setSheet(null);
  };

  // ---- 場所・借りた人・借りた日の修正 ----
  const openEdit = () => {
    setEditDraft({ locationId: loan.locationId, borrowerUid: loan.borrowerUid, borrowedOn: loan.borrowedOn });
    setSheet('edit');
  };
  const borrowedError = validateBorrowedOn(editDraft.borrowedOn, loan, today);
  const editChanged =
    editDraft.locationId !== loan.locationId ||
    editDraft.borrowerUid !== loan.borrowerUid ||
    editDraft.borrowedOn !== loan.borrowedOn;
  const locationOptions = useMemo<SelectOption[]>(() => {
    const options = locations
      .filter((l) => !l.archived || l.id === loan.locationId)
      .map((l) => ({ value: l.id, label: l.archived ? `${l.name}（非表示）` : l.name }));
    if (!locations.some((l) => l.id === loan.locationId)) {
      options.unshift({ value: loan.locationId, label: UNKNOWN_LOCATION });
    }
    return options;
  }, [locations, loan.locationId]);
  const borrowerOptions = useMemo<SelectOption[]>(() => {
    const options = members.map((m) => ({ value: m.id, label: m.displayName || memberName(m.id) }));
    if (!members.some((m) => m.id === loan.borrowerUid)) {
      options.unshift({ value: loan.borrowerUid, label: memberName(loan.borrowerUid) });
    }
    return options;
  }, [members, memberName, loan.borrowerUid]);
  const saveEdit = async () => {
    if (borrowedError || !editChanged) return;
    const ok = await run(
      () =>
        updateLoan(groupId, loan.id, {
          locationId: editDraft.locationId,
          borrowerUid: editDraft.borrowerUid,
          borrowedOn: editDraft.borrowedOn,
        }),
      '登録内容を修正しました',
      '修正できませんでした',
    );
    if (ok) setSheet(null);
  };

  // ---- 返却した日・読書状況の変更 ----
  const openReturned = () => {
    setReturnedDraft({ returnedOn: loan.returnedOn ?? today, readStatus: loan.readStatus ?? 'read' });
    setSheet('returned');
  };
  const returnedError = validateReturnedOn(returnedDraft.returnedOn, [loan], today);
  const returnedChanged =
    returnedDraft.returnedOn !== loan.returnedOn || returnedDraft.readStatus !== loan.readStatus;
  const saveReturned = async () => {
    if (returnedError || !returnedChanged) return;
    const ok = await run(
      () => updateLoan(groupId, loan.id, returnedDraft),
      '返却の内容を変更しました',
      '変更できませんでした',
    );
    if (ok) setSheet(null);
  };

  // ---- 評価と感想 ----
  const savedReview = reviewFromLoan(loan);
  const reviewValue = reviewDraft ?? savedReview;
  const reviewDirty =
    reviewDraft !== null &&
    (reviewToPatch(reviewDraft).rating !== loan.rating || reviewToPatch(reviewDraft).review !== (loan.review ?? null));
  const saveReview = async () => {
    if (!reviewDraft || !reviewDirty) return;
    const ok = await run(
      () => updateLoan(groupId, loan.id, reviewToPatch(reviewDraft)),
      '評価と感想を保存しました',
      '評価と感想を保存できませんでした',
    );
    if (ok) setReviewDraft(null);
  };
  const showReview = returned || loan.rating != null || loan.review != null;

  // ---- 削除・返却の取り消し ----
  const confirmDelete = async () => {
    onLeaving(true);
    try {
      await deleteLoan(groupId, loan.id);
    } catch (e) {
      onLeaving(false);
      throw e; // ConfirmDialog がトーストを出して開いたままにする
    }
    setConfirm(null);
    toast.show('登録を削除しました', { tone: 'success' });
    navigate('/', { replace: true });
  };
  const confirmUndo = async () => {
    await undoReturn(groupId, loan.id);
    setConfirm(null);
    toast.show('返却を取り消しました。貸出中に戻りました', { tone: 'success' });
  };

  const editableHint = returned
    ? '各項目をタップすると修正できます。'
    : '各項目をタップすると修正できます。返却日を延ばすときは「返却日」をタップしてください。';

  return (
    <Page
      title={PAGE_TITLE}
      back="/"
      contentClassName={styles.content}
      footer={
        returned ? undefined : (
          <Button
            block
            size="lg"
            icon={<ReturnIcon />}
            disabled={saving}
            onClick={() => navigate(`/return?loans=${encodeURIComponent(loan.id)}`)}
          >
            この本を返却する
          </Button>
        )
      }
    >
      {/* 本 */}
      <Card className={styles.bookCard} padded={false}>
        <Link to={`/books/${encodeURIComponent(loan.bookId)}`} className={styles.bookLink}>
          <BookCover title={loan.book.title} coverUrl={loan.book.coverUrl} isbn={loan.book.isbn} size="lg" alt={`${loan.book.title}の表紙`} />
          <span className={styles.bookText}>
            <span className={styles.bookTitle}>{loan.book.title}</span>
            {loan.book.authors.length > 0 ? (
              <span className={styles.bookAuthors}>{loan.book.authors.join('、')}</span>
            ) : null}
            <span className={styles.bookMore}>
              本の詳細
              <ChevronRightIcon size={16} />
            </span>
          </span>
        </Link>
        <div className={styles.statusBar}>
          {returned ? (
            <>
              <span className={`${styles.statePill} ${styles.stateReturned}`}>
                <CheckCircleIcon size={16} />
                返却済み
              </span>
              {loan.readStatus ? (
                <span className={`${styles.readPill} ${styles[loan.readStatus]}`}>{READ_STATUS_TEXT[loan.readStatus]}</span>
              ) : null}
            </>
          ) : (
            <>
              <span className={`${styles.statePill} ${styles.stateActive}`}>
                <BookIcon size={16} />
                貸出中
              </span>
              <DueBadge dueOn={loan.dueOn} today={today} showDate size="md" />
            </>
          )}
        </div>
      </Card>

      {/* 貸出の内容 */}
      <ListGroup title="貸出の内容" footer={editableHint}>
        <InfoRow icon={<LocationIcon size={20} />} label="場所" value={locationName} onClick={openEdit} />
        <InfoRow icon={<UserIcon size={20} />} label="借りた人" value={memberName(loan.borrowerUid)} onClick={openEdit} />
        <InfoRow icon={<CalendarIcon size={20} />} label="借りた日" value={formatDate(loan.borrowedOn)} onClick={openEdit} />
        <InfoRow
          icon={<ClockIcon size={20} />}
          label="返却日"
          value={formatDate(loan.dueOn)}
          onClick={returned ? undefined : openDue}
        />
        {returned ? (
          <>
            <InfoRow
              icon={<ReturnIcon size={20} />}
              label="返却した日"
              value={formatDate(loan.returnedOn ?? '')}
              onClick={openReturned}
            />
            <InfoRow
              icon={<CheckCircleIcon size={20} />}
              label="読書状況"
              value={loan.readStatus ? READ_STATUS_TEXT[loan.readStatus] : '未設定'}
              onClick={openReturned}
            />
          </>
        ) : null}
      </ListGroup>

      {/* 貸出中の操作 */}
      {returned ? null : (
        <div className={styles.actions}>
          <Button variant="secondary" block icon={<CalendarIcon />} onClick={openDue} disabled={saving}>
            返却日を変更（延長）
          </Button>
          <Button variant="secondary" block icon={<EditIcon />} onClick={openEdit} disabled={saving}>
            場所・借りた人・借りた日を修正
          </Button>
        </div>
      )}

      {/* 評価と感想 */}
      {showReview ? (
        <Card title="評価と感想" className={styles.reviewCard}>
          <ReviewEditor value={reviewValue} onChange={setReviewDraft} disabled={saving} hideHeading />
          {reviewDirty ? (
            <div className={styles.reviewActions}>
              <Button variant="secondary" onClick={() => setReviewDraft(null)} disabled={saving}>
                元に戻す
              </Button>
              <Button onClick={() => void saveReview()} loading={saving}>
                保存
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* 取り消し・削除 */}
      <ListGroup>
        {returned ? (
          <ListRow
            leading={<UndoIcon size={20} />}
            title="返却を取り消す"
            subtitle="間違えて返却した場合に、貸出中に戻します"
            onClick={() => setConfirm('undo')}
            chevron={false}
            disabled={saving}
          />
        ) : (
          <ListRow
            leading={<TrashIcon size={20} />}
            title="この登録を削除"
            subtitle="間違えて登録した場合に使います"
            onClick={() => setConfirm('delete')}
            chevron={false}
            danger
            disabled={saving}
          />
        )}
      </ListGroup>

      {/* 返却日の変更 */}
      <Sheet
        open={sheet === 'due'}
        onClose={closeSheet}
        title="返却日を変更"
        dismissible={!saving}
        footer={
          <Button
            block
            size="lg"
            loading={saving}
            disabled={dueError !== null || dueDraft === loan.dueOn}
            onClick={() => void saveDue()}
          >
            {dueError === null && dueDraft !== loan.dueOn ? `${formatDate(dueDraft)}に変更` : '変更する'}
          </Button>
        }
      >
        <div className={styles.sheetBody}>
          <p className={styles.sheetLead}>
            いまの返却日は <strong>{formatDate(loan.dueOn)}</strong> です。
          </p>
          <div className={styles.quick} role="group" aria-label="返却日を延ばす">
            {quickDue.map((o) => (
              <Button
                key={o.key}
                variant={dueDraft === o.value ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setDueDraft(o.value)}
                disabled={saving}
                aria-pressed={dueDraft === o.value}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <DateField
            label="新しい返却日"
            value={dueDraft}
            onChange={setDueDraft}
            min={loan.borrowedOn}
            error={dueError}
            hint="「+7日」「+14日」は、いまの返却日から数えます。"
            disabled={saving}
          />
        </div>
      </Sheet>

      {/* 場所・借りた人・借りた日の修正 */}
      <Sheet
        open={sheet === 'edit'}
        onClose={closeSheet}
        title="登録内容を修正"
        dismissible={!saving}
        footer={
          <Button block size="lg" loading={saving} disabled={borrowedError !== null || !editChanged} onClick={() => void saveEdit()}>
            保存
          </Button>
        }
      >
        <div className={styles.sheetBody}>
          <Select
            label="場所"
            value={editDraft.locationId}
            onChange={(locationId) => setEditDraft((d) => ({ ...d, locationId }))}
            options={locationOptions}
            disabled={saving}
          />
          <Select
            label="借りた人"
            value={editDraft.borrowerUid}
            onChange={(borrowerUid) => setEditDraft((d) => ({ ...d, borrowerUid }))}
            options={borrowerOptions}
            disabled={saving}
          />
          <DateField
            label="借りた日"
            value={editDraft.borrowedOn}
            onChange={(borrowedOn) => setEditDraft((d) => ({ ...d, borrowedOn }))}
            max={today}
            error={borrowedError}
            hint={returned ? undefined : '場所や借りた日を変えても、返却日は変わりません。'}
            disabled={saving}
          />
        </div>
      </Sheet>

      {/* 返却した日・読書状況の変更 */}
      <Sheet
        open={sheet === 'returned'}
        onClose={closeSheet}
        title="返却の内容を変更"
        dismissible={!saving}
        footer={
          <Button
            block
            size="lg"
            loading={saving}
            disabled={returnedError !== null || !returnedChanged}
            onClick={() => void saveReturned()}
          >
            保存
          </Button>
        }
      >
        <div className={styles.sheetBody}>
          <DateField
            label="返却した日"
            value={returnedDraft.returnedOn}
            onChange={(returnedOn) => setReturnedDraft((d) => ({ ...d, returnedOn }))}
            min={loan.borrowedOn}
            max={today}
            error={returnedError}
            disabled={saving}
          />
          <div className={styles.fieldGroup}>
            <p className={styles.fieldLabel}>読書状況</p>
            <ReadStatusPicker
              value={returnedDraft.readStatus}
              onChange={(readStatus) => setReturnedDraft((d) => ({ ...d, readStatus }))}
              disabled={saving}
            />
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirm === 'delete'}
        title="この登録を削除しますか？"
        message={
          <>
            「{loan.book.title}」の貸出記録を削除します。間違えて登録した場合に使ってください。
            <br />
            削除すると元に戻せません。
          </>
        }
        confirmLabel="削除する"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'undo'}
        title="返却を取り消しますか？"
        message="貸出中に戻します。返却した日と読書状況は消えますが、評価と感想は残ります。"
        confirmLabel="取り消す"
        onConfirm={confirmUndo}
        onCancel={() => setConfirm(null)}
      />
    </Page>
  );
}

type InfoRowProps = {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  onClick?: () => void;
};

function InfoRow({ icon, label, value, onClick }: InfoRowProps) {
  return <ListRow leading={icon} title={label} trailing={<span className={styles.infoValue}>{value}</span>} onClick={onClick} />;
}
