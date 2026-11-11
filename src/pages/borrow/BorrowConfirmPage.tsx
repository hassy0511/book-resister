/*
 * 借りる本の確認と登録（F-21, F-24〜28）。
 *   まとめて設定: 借りた場所（必須。前回の場所を覚えておく）・借りた人（既定は自分）・借りた日（既定は今日）・
 *                 返却日（借りた日＋場所の貸出期間で自動計算。手で変えたらその値を保ち、自動計算に戻せる）
 *   本ごと:       表紙・タイトル（見つからなかった本はタイトルを入力）、シリーズ名・巻数、この本だけの返却日、外す
 *   注意の表示:   いま貸出中（F-28）、前に借りたことがある（F-27）、リスト内の重複
 *                 ISBN の本で、ISBN なしで登録した同じタイトルの本がある（バーコードが隠れて手入力した本を
 *                 後でバーコードで読んだ場合など）→「同じ本として借りる」で前の本の貸出として記録できる（自動ではつなげない）
 *                 ISBN なしでタイトルが同じ登録済みの本に結び付けた場合は「別の本として登録」で外せる
 *   登録:         シリーズ名があれば findOrCreateSeries → saveBookFromCandidate（結び付けた本があればその本を使い、
 *                 タイトルで探し直さない）→ createLoans（1 バッチ）
 *                 → カートを空にしてホームへ。途中で失敗したらカートは残す。
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookCover } from '../../components/BookCover';
import { SeriesPicker } from '../../components/SeriesPicker';
import {
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  IconButton,
  LinkButton,
  Page,
  Select,
  Spinner,
  TextField,
  useToast,
  type SelectOption,
} from '../../components/ui';
import {
  AlertIcon,
  BookIcon,
  EditIcon,
  HistoryIcon,
  InfoIcon,
  KeyboardIcon,
  LocationIcon,
  PlusIcon,
  RefreshIcon,
  ScanIcon,
  TrashIcon,
} from '../../components/ui/icons';
import { saveBookFromCandidate, updateBook, useBooksByIds, useBooksWithoutIsbn } from '../../data/books';
import { createLoans, useActiveLoans, useLoansForBooks, type NewLoanInput } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { findOrCreateSeries, useSeriesList } from '../../data/series';
import { useRequiredGroup } from '../../group/GroupProvider';
import { formatDate } from '../../lib/date';
import { formatIsbn } from '../../lib/isbn';
import { findMatchingSeries, guessSeries, normalizeSeriesName } from '../../lib/series';
import { isItemResolved, itemTitle, useBorrowCart, type CartItem, type CartItemPatch } from '../../state/borrowCart';
import type { Book, Loan, Series, WithId } from '../../types';
import { useToday } from '../home/useToday';
import {
  autoDueOn,
  bookIdForCartItem,
  borrowedOnError,
  describeLoan,
  duplicatedBookIds,
  effectiveDueOn,
  existingSeriesPatch,
  isValidDue,
  latestReturnedLoan,
  loadLastLocationId,
  loanSnapshotFor,
  LOOKUP_FAILED_MESSAGE,
  pickDefaultLocationId,
  sameTitleBooksWithoutIsbn,
  saveLastLocationId,
  splitAuthors,
  submitBlockReason,
  volumeForSave,
} from './borrowLogic';
import styles from './BorrowConfirmPage.module.css';

const UNKNOWN_LOCATION = '（不明な場所）';
const NO_LOANS: WithId<Loan>[] = [];
const NO_BOOKS: WithId<Book>[] = [];

/** ISBN なしで登録した同じタイトルの本と、その貸出記録 */
type SameTitleBook = { book: WithId<Book>; loans: WithId<Loan>[]; activeLoans: WithId<Loan>[] };

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : '登録できませんでした。もう一度お試しください。';
}

export default function BorrowConfirmPage() {
  const { groupId, uid, members, memberName } = useRequiredGroup();
  const cart = useBorrowCart();
  const navigate = useNavigate();
  const toast = useToast();
  const today = useToday();

  const locationsQuery = useLocations({ includeArchived: true });
  const activeLoansQuery = useActiveLoans();
  const seriesQuery = useSeriesList();

  const items = cart.items;
  // 本は全件ではなく、カートの本と ISBN なしで登録した本だけを読む（読み取りの回数を件数に比例させない）
  const cartBookIds = useMemo(
    () => items.map((i) => bookIdForCartItem(i)).filter((id): id is string => id !== null),
    [items],
  );
  const cartBooksQuery = useBooksByIds(cartBookIds);
  const hasIsbnItem = items.some((i) => i.isbn !== null && !i.existingBookId);
  const noIsbnBooksQuery = useBooksWithoutIsbn(hasIsbnItem);
  const booksById = useMemo(() => new Map(cartBooksQuery.data.map((b) => [b.id, b])), [cartBooksQuery.data]);
  // ISBN の本なのに ISBN の ID の本が無く、ISBN なしで登録した同じタイトルの本がある（同じ本かもしれない）
  const sameTitleByKey = useMemo(() => {
    const map = new Map<string, WithId<Book>[]>();
    if (cartBooksQuery.loading) return map;
    for (const item of items) {
      if (!item.isbn || item.status === 'loading' || item.existingBookId) continue;
      const id = bookIdForCartItem(item);
      if (id && booksById.has(id)) continue;
      const matches = sameTitleBooksWithoutIsbn(noIsbnBooksQuery.data, item.candidate?.title);
      if (matches.length > 0) map.set(item.key, matches);
    }
    return map;
  }, [items, booksById, cartBooksQuery.loading, noIsbnBooksQuery.data]);
  const bookIds = useMemo(() => {
    const ids = items.map((i) => bookIdForCartItem(i)).filter((id): id is string => id !== null);
    for (const books of sameTitleByKey.values()) ids.push(...books.map((b) => b.id));
    return ids;
  }, [items, sameTitleByKey]);
  const bookLoansQuery = useLoansForBooks(bookIds);

  // ---- まとめて設定 ----
  const activeLocations = useMemo(() => locationsQuery.data.filter((l) => !l.archived), [locationsQuery.data]);
  const locationNames = useMemo(
    () => new Map(locationsQuery.data.map((l) => [l.id, l.name])),
    [locationsQuery.data],
  );
  const locationName = (id: string) => locationNames.get(id) ?? UNKNOWN_LOCATION;

  const [lastLocationId] = useState(() => loadLastLocationId());
  const [locationChoice, setLocationChoice] = useState<string | null>(null);
  const locationId =
    locationChoice && activeLocations.some((l) => l.id === locationChoice)
      ? locationChoice
      : pickDefaultLocationId(activeLocations, lastLocationId);
  const location = activeLocations.find((l) => l.id === locationId) ?? null;

  const [borrowerChoice, setBorrowerChoice] = useState<string | null>(null);
  const borrowerUid = borrowerChoice ?? uid;

  const [borrowedChoice, setBorrowedChoice] = useState<string | null>(null);
  const borrowedOn = borrowedChoice ?? today;

  const autoDue = autoDueOn(borrowedOn, location?.defaultLoanDays);
  // 手で変えた返却日（null なら自動計算）
  const [dueManual, setDueManual] = useState<string | null>(null);
  const bulkDueOn = dueManual ?? autoDue ?? '';

  const borrowerOptions = useMemo<SelectOption[]>(() => {
    const list = members.map((m) => ({ value: m.id, label: m.id === uid ? `${m.displayName}（自分）` : m.displayName }));
    if (!members.some((m) => m.id === uid)) list.unshift({ value: uid, label: `${memberName(uid)}（自分）` });
    return list;
  }, [members, uid, memberName]);

  const locationOptions = useMemo<SelectOption[]>(
    () => activeLocations.map((l) => ({ value: l.id, label: `${l.name}（${l.defaultLoanDays}日）` })),
    [activeLocations],
  );

  // ---- 注意の表示に使う情報 ----
  const activeByBook = useMemo(() => {
    const map = new Map<string, WithId<Loan>[]>();
    for (const l of activeLoansQuery.data) {
      const list = map.get(l.bookId);
      if (list) list.push(l);
      else map.set(l.bookId, [l]);
    }
    return map;
  }, [activeLoansQuery.data]);
  const loansByBook = useMemo(() => {
    const map = new Map<string, WithId<Loan>[]>();
    for (const l of bookLoansQuery.data) {
      const list = map.get(l.bookId);
      if (list) list.push(l);
      else map.set(l.bookId, [l]);
    }
    return map;
  }, [bookLoansQuery.data]);
  const duplicates = useMemo(() => duplicatedBookIds(items), [items]);

  /**
   * ISBN の本を、ISBN なしで登録した既存の本として借りる（利用者が「同じ本」と確かめたとき）。
   * 既存の本の貸出として記録し、本の ID と ISBN（null）は変えない。この本だけの返却日と、
   * 既存の本にシリーズが無ければ書誌のシリーズ・巻数を引き継ぐ。
   */
  const linkToExistingBook = (item: CartItem, target: WithId<Book>) => {
    cart.remove(item.key);
    if (cart.addExistingBook(target) === 'duplicate') {
      toast.show('この本はすでに借りる本のリストに入っています');
      return;
    }
    const patch: CartItemPatch = {};
    if (item.dueOnOverride) patch.dueOnOverride = item.dueOnOverride;
    if (!target.seriesId && item.seriesName) {
      patch.seriesName = item.seriesName;
      patch.volume = target.volume ?? item.volume;
    }
    // ISBN の無い本のカートのキーは本の ID
    if (Object.keys(patch).length > 0) cart.update(target.id, patch);
    toast.show(`前に登録した「${target.title}」として借ります`, { tone: 'success' });
  };

  // ---- 登録 ----
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CartItem | null>(null);

  const blockReason = submitBlockReason({ items, locationId, borrowerUid, borrowedOn, bulkDueOn, today });

  const submit = async () => {
    if (busyRef.current || blockReason) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);
    const targets = cart.items;
    try {
      const seriesIds = new Map<string, string>();
      const inputs: NewLoanInput[] = [];
      for (const item of targets) {
        const base = item.candidate;
        if (!base || !isItemResolved(item)) throw new Error('タイトルが入っていない本があります');
        const seriesName = item.seriesName?.trim() || null;
        let seriesId: string | null = null;
        if (seriesName) {
          const key = normalizeSeriesName(seriesName);
          seriesId = seriesIds.get(key) ?? (await findOrCreateSeries(groupId, seriesName));
          seriesIds.set(key, seriesId);
        }
        // 上・中・下の「下」は、同じシリーズの「中」をいっしょに借りるときだけ 3 巻にする
        const volume = volumeForSave(item, targets);
        const candidate = { ...base, isbn: base.isbn ?? item.isbn, seriesName, volume };
        // 結び付けた本（ISBN・タイトル・利用者が選んだ本）があれば、タイトルで探し直さずにその本を使う
        const { id: bookId, existing } = await saveBookFromCandidate(
          groupId,
          candidate,
          { seriesId, volume },
          { bookId: item.existingBookId, forceNew: item.forceNew },
        );
        // 既存の本のシリーズ・巻数をこの画面で変えた場合は、本のほうも合わせる
        const patch = existingSeriesPatch(existing, { seriesId, volume });
        if (Object.keys(patch).length > 0) await updateBook(groupId, bookId, patch);
        inputs.push({
          bookId,
          book: loanSnapshotFor(existing, candidate),
          locationId,
          borrowerUid,
          borrowedOn,
          dueOn: effectiveDueOn(item, bulkDueOn),
        });
      }
      await createLoans(groupId, uid, inputs);
      saveLastLocationId(locationId);
      toast.show(`${inputs.length}冊を登録しました`, { tone: 'success' });
      navigate('/', { replace: true });
      cart.clear();
    } catch (e) {
      console.error('[borrow] 登録できませんでした', e);
      const message = errorText(e);
      setSubmitError(message);
      toast.show(message, { tone: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // ---- 表示 ----

  if (items.length === 0) {
    return (
      <Page title="借りる本の確認" back="/scan?mode=borrow" hideTabBar>
        <EmptyState
          icon={<BookIcon />}
          title="借りる本がまだありません"
          description="本のバーコードを読み取るか、タイトルで探して追加してください。"
          action={
            <div className={styles.emptyActions}>
              <LinkButton to="/scan?mode=borrow" icon={<ScanIcon />} block>
                バーコードを読み取る
              </LinkButton>
              <LinkButton to="/borrow/add" variant="secondary" icon={<KeyboardIcon />} block>
                バーコードがない本を追加
              </LinkButton>
            </div>
          }
        />
      </Page>
    );
  }

  let locationField;
  if (locationsQuery.loading) {
    locationField = (
      <Select label="借りた場所" required value="" onChange={() => undefined} options={[]} placeholder="読み込み中…" disabled />
    );
  } else if (locationsQuery.error) {
    locationField = (
      <Select
        label="借りた場所"
        required
        value=""
        onChange={() => undefined}
        options={[]}
        placeholder="読み込めませんでした"
        error="場所を読み込めませんでした。電波のよい場所で開き直してください。"
        disabled
      />
    );
  } else if (activeLocations.length === 0) {
    locationField = (
      <div className={styles.noLocation}>
        <p className={styles.noLocationText}>
          <LocationIcon size={20} className={styles.noLocationIcon} />
          借りた場所（図書館など）がまだ登録されていません。先に場所を登録してください。
        </p>
        <LinkButton to="/settings/locations/new" variant="secondary" icon={<PlusIcon />} block>
          場所を登録する
        </LinkButton>
      </div>
    );
  } else {
    locationField = (
      <Select
        label="借りた場所"
        required
        value={locationId}
        onChange={setLocationChoice}
        options={locationOptions}
        placeholder="選んでください"
        disabled={busy}
      />
    );
  }

  let dueHint;
  if (dueManual !== null) {
    dueHint = autoDue ? `手で変更しています（自動計算では ${formatDate(autoDue)}）` : '手で変更しています';
  } else if (location) {
    dueHint = `${location.name}の貸出期間（${location.defaultLoanDays}日）で自動計算しています`;
  } else {
    dueHint = '場所を選ぶと、場所の貸出期間から自動で計算します';
  }

  const loadingCount = items.filter((i) => i.status === 'loading').length;

  return (
    <Page
      title="借りる本の確認"
      back="/scan?mode=borrow"
      hideTabBar
      footer={
        <>
          {blockReason ? (
            <p className={styles.reason} role="status">
              {loadingCount > 0 ? <Spinner size="sm" label="取得中" /> : <InfoIcon size={18} className={styles.reasonIcon} />}
              <span>{blockReason}</span>
            </p>
          ) : null}
          <Button block size="lg" onClick={submit} loading={busy} disabled={blockReason !== null}>
            {items.length}冊を登録する
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        {submitError ? (
          <div className={styles.errorBox} role="alert">
            <AlertIcon size={20} className={styles.errorIcon} />
            <div>
              <p className={styles.errorTitle}>登録できませんでした</p>
              <p className={styles.errorText}>{submitError}</p>
              <p className={styles.errorText}>リストはそのまま残っています。もう一度「登録する」を押してください。</p>
            </div>
          </div>
        ) : null}

        <Card title="まとめて設定">
          <div className={styles.settings}>
            {locationField}
            <Select
              label="借りた人"
              required
              value={borrowerUid}
              onChange={setBorrowerChoice}
              options={borrowerOptions}
              disabled={busy}
            />
            <div className={styles.dates}>
              <DateField
                label="借りた日"
                required
                value={borrowedOn}
                onChange={(v) => setBorrowedChoice(v)}
                max={today}
                error={borrowedOnError(borrowedOn, today) ?? undefined}
                disabled={busy}
              />
              <DateField
                label="返却日"
                required
                value={bulkDueOn}
                onChange={(v) => setDueManual(v === autoDue ? null : v)}
                min={borrowedOn}
                hint={dueHint}
                error={bulkDueOn && !isValidDue(bulkDueOn, borrowedOn) ? '借りた日以降にしてください' : undefined}
                disabled={busy}
              />
              {dueManual !== null && autoDue ? (
                <Button variant="ghost" size="sm" onClick={() => setDueManual(null)} className={styles.inlineAction} disabled={busy}>
                  自動計算（{formatDate(autoDue)}）に戻す
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>借りる本 {items.length}冊</h2>
          <LinkButton to="/scan?mode=borrow" variant="ghost" size="sm" icon={<ScanIcon />}>
            続けてスキャン
          </LinkButton>
        </div>

        <ul className={styles.items}>
          {items.map((item) => {
            const bookId = bookIdForCartItem(item);
            return (
              <li key={item.key}>
                <CartItemCard
                  item={item}
                  borrowedOn={borrowedOn}
                  bulkDueOn={bulkDueOn}
                  busy={busy}
                  existing={bookId ? (booksById.get(bookId) ?? null) : null}
                  seriesList={seriesQuery.data}
                  activeLoans={bookId ? (activeByBook.get(bookId) ?? NO_LOANS) : NO_LOANS}
                  pastLoans={bookId ? (loansByBook.get(bookId) ?? NO_LOANS) : NO_LOANS}
                  sameTitleBooks={(sameTitleByKey.get(item.key) ?? NO_BOOKS).map((b) => ({
                    book: b,
                    loans: loansByBook.get(b.id) ?? NO_LOANS,
                    activeLoans: activeByBook.get(b.id) ?? NO_LOANS,
                  }))}
                  onLinkBook={(target) => linkToExistingBook(item, target)}
                  duplicated={bookId !== null && duplicates.has(bookId)}
                  locationName={locationName}
                  memberName={memberName}
                  onUpdate={(patch) => cart.update(item.key, patch)}
                  onRetry={() => cart.retry(item.key)}
                  onRemove={() => setRemoveTarget(item)}
                />
              </li>
            );
          })}
        </ul>

        <LinkButton to="/borrow/add" variant="secondary" icon={<KeyboardIcon />} block>
          バーコードがない本を追加
        </LinkButton>
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title="リストから外しますか？"
        message={`「${removeTarget ? (itemTitle(removeTarget) ?? 'この本') : ''}」を借りる本のリストから外します。`}
        confirmLabel="外す"
        danger
        onConfirm={() => {
          if (removeTarget) cart.remove(removeTarget.key);
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 本ごとのカード
// ---------------------------------------------------------------------------

type CartItemCardProps = {
  item: CartItem;
  borrowedOn: string;
  bulkDueOn: string;
  busy: boolean;
  /** グループ内の既存の本（読み込み済みなら） */
  existing: WithId<Book> | null;
  seriesList: WithId<Series>[];
  activeLoans: WithId<Loan>[];
  /** この本の貸出記録（貸出中も含む） */
  pastLoans: WithId<Loan>[];
  /** ISBN なしで登録した同じタイトルの本（同じ本かもしれない） */
  sameTitleBooks: SameTitleBook[];
  onLinkBook: (book: WithId<Book>) => void;
  duplicated: boolean;
  locationName: (id: string) => string;
  memberName: (uid: string) => string;
  onUpdate: (patch: CartItemPatch) => void;
  /** 通信の失敗で取れなかった書誌を取り直す */
  onRetry: () => void;
  onRemove: () => void;
};

function CartItemCard({
  item,
  borrowedOn,
  bulkDueOn,
  busy,
  existing,
  seriesList,
  activeLoans,
  pastLoans,
  sameTitleBooks,
  onLinkBook,
  duplicated,
  locationName,
  memberName,
  onUpdate,
  onRetry,
  onRemove,
}: CartItemCardProps) {
  // 「別の本」を選んだら、この画面にいる間は聞き直さない
  const [sameTitleDismissed, setSameTitleDismissed] = useState(false);
  const loading = item.status === 'loading';
  // 通信の失敗（error）も、見つからなかった本と同じくタイトルを入力できる（再取得もできる）
  const lookupFailed = item.status === 'error';
  const notFound = item.status === 'not-found' || lookupFailed;
  const title = itemTitle(item);
  const candidate = item.candidate;
  const [authorText, setAuthorText] = useState(() => candidate?.authors.join('、') ?? '');

  // 見つからなかった本のタイトル・著者の手入力
  const setManual = (next: { title?: string; authors?: string[] }) => {
    onUpdate({
      candidate: {
        isbn: item.isbn,
        title: next.title ?? candidate?.title ?? '',
        authors: next.authors ?? candidate?.authors ?? [],
        publisher: candidate?.publisher ?? null,
        coverUrl: candidate?.coverUrl ?? null,
        seriesName: null,
        volume: null,
        source: 'manual',
      },
    });
  };

  const guessFromTitle = () => {
    if (item.seriesName || !title) return;
    const g = guessSeries(title);
    if (g.seriesName) onUpdate({ seriesName: g.seriesName, volume: g.volume });
  };

  const latestPast = latestReturnedLoan(pastLoans);
  const returnedCount = pastLoans.filter((l) => l.returnedOn != null).length;

  // 既存の本がシリーズに入っていて、ここで別のシリーズを選んでいる
  const existingSeries = existing?.seriesId ? (seriesList.find((s) => s.id === existing.seriesId) ?? null) : null;
  const chosenSeries = item.seriesName ? findMatchingSeries(item.seriesName, seriesList) : null;
  const seriesChanged = existingSeries !== null && item.seriesName !== null && chosenSeries?.id !== existingSeries.id;

  const dueOn = effectiveDueOn(item, bulkDueOn);
  const overrideInvalid = item.dueOnOverride !== null && !isValidDue(item.dueOnOverride, borrowedOn);

  const authors = candidate?.authors.join('、') ?? '';

  return (
    <Card className={styles.itemCard}>
      <div className={styles.itemHead}>
        <BookCover title={title ?? '本'} coverUrl={candidate?.coverUrl} isbn={candidate?.isbn ?? item.isbn} size="md" />
        <div className={styles.itemText}>
          {loading ? (
            <p className={styles.itemLoading}>
              <Spinner size="sm" label="本の情報を取得しています" />
              <span>本の情報を取得しています…</span>
            </p>
          ) : lookupFailed ? (
            <p className={styles.itemMissing}>検索サービスにつながりませんでした</p>
          ) : notFound || !title ? (
            <p className={styles.itemMissing}>本の情報が見つかりませんでした</p>
          ) : (
            <p className={styles.itemTitle}>{title}</p>
          )}
          {!notFound && authors ? <p className={styles.itemMeta}>{authors}</p> : null}
          {item.isbn ? <p className={styles.itemIsbn}>ISBN {formatIsbn(item.isbn)}</p> : null}
          {item.existingBookId ? (
            <span className={styles.existingBadge}>
              {item.matchedBy === 'title' ? '同じタイトルの登録済みの本' : '登録済みの本'}
            </span>
          ) : null}
        </div>
        <IconButton
          label={`${title ?? 'この本'}をリストから外す`}
          icon={<TrashIcon size={20} />}
          onClick={onRemove}
          disabled={busy}
          className={styles.removeButton}
        />
      </div>

      {notFound ? (
        <div className={styles.manualFields}>
          {lookupFailed ? (
            <Button variant="secondary" size="sm" icon={<RefreshIcon />} onClick={onRetry} disabled={busy}>
              本の情報を再取得
            </Button>
          ) : null}
          <TextField
            label="タイトル"
            required
            value={candidate?.title ?? ''}
            onChange={(v) => setManual({ title: v })}
            onBlur={guessFromTitle}
            hint={
              lookupFailed
                ? LOOKUP_FAILED_MESSAGE
                : '本の情報が見つからなかったので、表紙を見てタイトルを入力してください'
            }
            error={!title ? 'タイトルを入力してください' : undefined}
            autoComplete="off"
            disabled={busy}
          />
          <TextField
            label="著者（任意）"
            value={authorText}
            onChange={(v) => {
              setAuthorText(v);
              setManual({ authors: splitAuthors(v) });
            }}
            autoComplete="off"
            disabled={busy}
          />
        </div>
      ) : null}

      {activeLoans.map((l) => (
        <p key={l.id} className={`${styles.notice} ${styles.noticeDanger}`}>
          <AlertIcon size={18} className={styles.noticeIcon} />
          <span>
            この本はいま貸出中です（{memberName(l.borrowerUid)}・{locationName(l.locationId)}・{formatDate(l.dueOn)}
            まで）。同じ本を二重に登録していないか確認してください。
          </span>
        </p>
      ))}
      {latestPast ? (
        <p className={`${styles.notice} ${styles.noticeInfo}`}>
          <HistoryIcon size={18} className={styles.noticeIcon} />
          <span>
            借りたことがあります。前回：
            {describeLoan(latestPast, locationName(latestPast.locationId), memberName(latestPast.borrowerUid))}
            {returnedCount > 1 ? `（これまでに${returnedCount}回）` : ''}
          </span>
        </p>
      ) : null}
      {item.matchedBy === 'title' && item.existingBookId ? (
        <div className={`${styles.notice} ${styles.noticeInfo}`} role="group" aria-label="タイトルで結び付けた本">
          <InfoIcon size={18} className={styles.noticeIcon} />
          <div className={styles.sameTitle}>
            <p className={styles.sameTitleLead}>
              ISBN が無いので、タイトルが同じ登録済みの本として借ります。別の版や別の号など、違う本なら外してください。
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate({ forceNew: true })}
              disabled={busy}
              className={styles.sameTitleNo}
            >
              別の本として登録
            </Button>
          </div>
        </div>
      ) : null}
      {item.forceNew && !item.existingBookId ? (
        <p className={styles.seriesNote}>同じタイトルの登録済みの本とは別の本として、新しく登録します。</p>
      ) : null}
      {sameTitleBooks.length > 0 && !sameTitleDismissed ? (
        <div className={`${styles.notice} ${styles.noticeInfo}`} role="group" aria-label="同じタイトルの本の確認">
          <InfoIcon size={18} className={styles.noticeIcon} />
          <div className={styles.sameTitle}>
            <p className={styles.sameTitleLead}>ISBN なしで登録した同じタイトルの本があります。同じ本ですか？</p>
            {sameTitleBooks.map(({ book, loans, activeLoans: bookActive }) => {
              const latest = latestReturnedLoan(loans);
              let detail: string;
              if (bookActive.length > 0) {
                const l = bookActive[0];
                detail = `いま貸出中（${memberName(l.borrowerUid)}・${locationName(l.locationId)}・${formatDate(l.dueOn)}まで）`;
              } else if (latest) {
                detail = `前回：${describeLoan(latest, locationName(latest.locationId), memberName(latest.borrowerUid))}`;
              } else {
                detail = '貸出の記録はありません';
              }
              return (
                <div key={book.id} className={styles.sameTitleBook}>
                  <p>
                    <span className={styles.sameTitleName}>「{book.title}」</span>
                    {book.authors.length > 0 ? <span className={styles.sameTitleMeta}>{book.authors.join('、')}</span> : null}
                    <span className={styles.sameTitleMeta}>{detail}</span>
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onLinkBook(book)}
                    disabled={busy}
                    aria-label={`「${book.title}」と同じ本として借りる`}
                  >
                    同じ本として借りる
                  </Button>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" onClick={() => setSameTitleDismissed(true)} disabled={busy} className={styles.sameTitleNo}>
              別の本（このまま新しく登録する）
            </Button>
            <p className={styles.sameTitleHelp}>
              「同じ本として借りる」を選ぶと、前に登録した本の貸出として記録します（前の本に ISBN は付きません）。
            </p>
          </div>
        </div>
      ) : null}
      {duplicated ? (
        <p className={`${styles.notice} ${styles.noticeWarning}`}>
          <AlertIcon size={18} className={styles.noticeIcon} />
          <span>同じ本がリストに 2 回以上入っています。不要なほうを外してください。</span>
        </p>
      ) : null}

      <SeriesPicker
        seriesName={item.seriesName}
        volume={item.volume}
        onChange={({ seriesName, volume }) => onUpdate({ seriesName, volume })}
        disabled={busy || loading}
      />
      {seriesChanged && existingSeries ? (
        <p className={styles.seriesNote}>
          この本は今「{existingSeries.name}」に入っています。登録すると本のシリーズも変更します。
        </p>
      ) : null}

      <div className={styles.due}>
        {item.dueOnOverride !== null ? (
          <>
            <DateField
              label="返却日（この本だけ）"
              value={item.dueOnOverride}
              onChange={(v) => onUpdate({ dueOnOverride: v || null })}
              min={borrowedOn}
              error={overrideInvalid ? '借りた日以降にしてください' : undefined}
              disabled={busy}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate({ dueOnOverride: null })}
              className={styles.inlineAction}
              disabled={busy}
            >
              まとめて設定した返却日に戻す
            </Button>
          </>
        ) : (
          <div className={styles.dueRow}>
            <span className={styles.dueLabel}>返却日</span>
            <span className={styles.dueValue}>{dueOn ? formatDate(dueOn) : '未設定'}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={<EditIcon />}
              onClick={() => onUpdate({ dueOnOverride: bulkDueOn || borrowedOn })}
              disabled={busy}
            >
              この本だけ変更
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
