/*
 * シリーズ詳細（/series/:seriesId, F-72〜74）。
 *   - 巻ごとの状態（読んだ / 途中まで / 読んでいない / 貸出中 / まだ借りていない）を色とアイコンで表示
 *     （貸出中でも、前に「読んだ」で返した巻は読んだ印を添える。要約の「読んだ N巻」にも数える）
 *     （マス目と一覧を切り替え。借りた巻はタップで本の詳細へ。同じ巻に複数の本があれば選ぶ）
 *   - 「まだ借りていない巻」（全巻数があるとき）／「抜けている巻」（無いとき）の要約
 *   - 巻数が未設定の本は「巻数なし」に分けて表示
 *   - シリーズ名と全巻数の編集
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Book, Loan, Series, WithId } from '../../types';
import { useBooksInSeries } from '../../data/books';
import { useLoansForBooks } from '../../data/loans';
import type { BookReadState } from '../../data/readStatus';
import { useSeries } from '../../data/series';
import { useRequiredGroup } from '../../group/GroupProvider';
import { formatDate } from '../../lib/date';
import { BookCover } from '../../components/BookCover';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LinkButton,
  ListGroup,
  ListRow,
  Page,
  SegmentedControl,
  Sheet,
  Spinner,
} from '../../components/ui';
import type { SegmentOption } from '../../components/ui';
import {
  BookIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  EditIcon,
  SeriesIcon,
} from '../../components/ui/icons';
import { SeriesEditSheet } from './SeriesEditSheet';
import {
  buildSeriesOverview,
  compressRanges,
  formatVolumeRanges,
  groupLoansByBook,
  type SeriesBookInfo,
  type SeriesOverview,
  type VolumeSlot,
} from './seriesLogic';
import styles from './SeriesDetailPage.module.css';

type SeriesBook = WithId<Book>;
type ViewMode = 'grid' | 'list';

/** 巻の状態の表示名（シリーズ画面では貸出中を「貸出中」と表示する） */
const VOLUME_STATE_TEXT: Record<BookReadState, string> = {
  read: '読んだ',
  partial: '途中まで',
  unread: '読んでいない',
  reading: '貸出中',
  none: 'まだ借りていない',
};

const LEGEND_ORDER: BookReadState[] = ['read', 'partial', 'unread', 'reading', 'none'];

/** 前に「読んだ」で返した巻・本を、読み返すためにもう一度借りている（貸出中の色に読んだ印を添える） */
function rereading(item: { state: BookReadState; everRead: boolean }): boolean {
  return item.state === 'reading' && item.everRead;
}

/** 巻・本の状態の表示名（貸出中でも前に読んでいれば、そのことを添える） */
function stateText(item: { state: BookReadState; everRead: boolean }): string {
  return rereading(item) ? '貸出中（前に読んだ）' : VOLUME_STATE_TEXT[item.state];
}

const STATE_CLASS: Record<BookReadState, string | undefined> = {
  read: styles.stateRead,
  partial: styles.statePartial,
  unread: styles.stateUnread,
  reading: styles.stateReading,
  none: styles.stateNone,
};

const VIEW_OPTIONS: SegmentOption<ViewMode>[] = [
  { value: 'grid', label: 'マス目' },
  { value: 'list', label: '一覧' },
];

const VIEW_STORAGE_KEY = 'seriesVolumeView';

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    // 保存できなくても困らない
  }
}

function StateIcon({ state, size = 16 }: { state: BookReadState; size?: number }) {
  switch (state) {
    case 'read':
      return <CheckIcon size={size} strokeWidth={3} />;
    case 'partial':
      return <ClockIcon size={size} strokeWidth={2.4} />;
    case 'reading':
      return <BookIcon size={size} strokeWidth={2.4} />;
    case 'unread':
      return <CircleIcon size={size} strokeWidth={2.4} />;
    case 'none':
      return null;
  }
}

export default function SeriesDetailPage() {
  const { seriesId } = useParams();
  // 別のシリーズへ移ったときに前のシリーズの状態を持ち越さない
  return <SeriesDetail key={seriesId ?? ''} seriesId={seriesId} />;
}

function SeriesDetail({ seriesId }: { seriesId: string | undefined }) {
  const seriesQuery = useSeries(seriesId);
  const booksQuery = useBooksInSeries(seriesId);
  const books = booksQuery.data;
  const bookIds = useMemo(() => books.map((b) => b.id), [books]);
  const loansQuery = useLoansForBooks(bookIds);

  // 本が増減して貸出記録を読み直す間は、前回の記録を表示し続ける（画面のちらつき防止）
  const fullyLoaded = !seriesQuery.loading && !booksQuery.loading && !loansQuery.loading;
  const [settledLoans, setSettledLoans] = useState<WithId<Loan>[] | null>(null);
  if (fullyLoaded && settledLoans !== loansQuery.data) setSettledLoans(loansQuery.data);
  const loans = fullyLoaded ? loansQuery.data : (settledLoans ?? loansQuery.data);
  const loading = !fullyLoaded && settledLoans === null;
  const error = seriesQuery.error ?? booksQuery.error ?? loansQuery.error;

  const series = seriesQuery.data;

  if (loading) {
    return (
      <Page title="シリーズ" back="/series">
        <Spinner center size="lg" label="シリーズを読み込んでいます" />
      </Page>
    );
  }
  if (error) {
    return (
      <Page title={series?.name ?? 'シリーズ'} back="/series">
        <ErrorState error={error} onRetry={() => window.location.reload()} />
      </Page>
    );
  }
  if (!series) {
    return (
      <Page title="シリーズ" back="/series">
        <EmptyState
          icon={<SeriesIcon />}
          title="このシリーズは見つかりません"
          description="削除されたか、アドレスが間違っている可能性があります。"
          action={<LinkButton to="/series">シリーズの一覧へ</LinkButton>}
        />
      </Page>
    );
  }

  return <SeriesDetailView series={series} books={books} loans={loans} />;
}

type SeriesDetailViewProps = {
  series: WithId<Series>;
  books: SeriesBook[];
  loans: WithId<Loan>[];
};

function SeriesDetailView({ series, books, loans }: SeriesDetailViewProps) {
  const { groupId } = useRequiredGroup();
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode);
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    saveViewMode(mode);
  };

  const overview = useMemo(
    () => buildSeriesOverview(books, groupLoansByBook(loans), series.totalVolumes),
    [books, loans, series.totalVolumes],
  );
  const maxBookVolume = useMemo(() => books.reduce((m, b) => Math.max(m, b.volume ?? 0), 0), [books]);

  // 編集シート（開くたびに key を変えて初期値を作り直す）
  const [editSession, setEditSession] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const openEdit = () => {
    setEditSession((n) => n + 1);
    setEditOpen(true);
  };

  // 同じ巻に複数の本があるときの選択シート
  // 閉じるアニメーションの間も中身を出しておくため、開閉と巻数は別に持つ。中身は最新のデータから引く
  const [pickOpen, setPickOpen] = useState(false);
  const [pickVolume, setPickVolume] = useState<number | null>(null);
  const pickSlot = pickVolume === null ? null : (overview.slots.find((s) => s.volume === pickVolume) ?? null);
  const openPick = (slot: VolumeSlot<SeriesBook>) => {
    setPickVolume(slot.volume);
    setPickOpen(true);
  };

  const hasVolumes = overview.slots.length > 0;

  return (
    <Page
      title={series.name}
      back="/series"
      right={<IconButton label="シリーズを編集" icon={<EditIcon />} onClick={openEdit} />}
      contentClassName={styles.content}
    >
      {books.length === 0 ? (
        <EmptyState
          icon={<SeriesIcon />}
          title="このシリーズの本はまだありません"
          description="本の詳細の「編集」で、このシリーズ名と巻数を設定すると、ここに並びます。"
          action={
            <Button variant="secondary" icon={<EditIcon />} onClick={openEdit}>
              シリーズ名・全巻数を編集
            </Button>
          }
        />
      ) : (
        <>
          <SummaryCard overview={overview} totalVolumes={series.totalVolumes} onEdit={openEdit} />

          {hasVolumes ? (
            <section className={styles.section} aria-labelledby="series-volumes-heading">
              <div className={styles.sectionHeader}>
                <h2 id="series-volumes-heading" className={styles.sectionTitle}>
                  巻ごとの状況
                </h2>
                <SegmentedControl
                  ariaLabel="表示のしかた"
                  value={viewMode}
                  onChange={setViewMode}
                  options={VIEW_OPTIONS}
                  className={styles.viewToggle}
                />
              </div>
              {viewMode === 'grid' ? (
                <>
                  <VolumeGrid slots={overview.slots} onPick={openPick} />
                  <Legend counts={overview.stateCounts} showRereadNote={overview.slots.some(rereading)} />
                </>
              ) : (
                <VolumeList slots={overview.slots} />
              )}
            </section>
          ) : null}

          {overview.noVolume.length > 0 ? (
            <section className={styles.section} aria-labelledby="series-novolume-heading">
              <h2 id="series-novolume-heading" className={styles.sectionTitle}>
                巻数なし
                <span className={styles.sectionCount}>{overview.noVolume.length}冊</span>
              </h2>
              <ListGroup footer="本の詳細の「編集」で巻数を設定すると、巻ごとの状況に並びます。">
                {overview.noVolume.map((info) => (
                  <BookInfoRow key={info.book.id} info={info} />
                ))}
              </ListGroup>
            </section>
          ) : null}
        </>
      )}

      {editSession > 0 ? (
        <SeriesEditSheet
          key={editSession}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          groupId={groupId}
          series={series}
          maxVolume={maxBookVolume}
        />
      ) : null}

      <Sheet
        open={pickOpen && pickSlot !== null}
        onClose={() => setPickOpen(false)}
        title={pickSlot ? `${pickSlot.volume}巻の本（${pickSlot.books.length}冊）` : undefined}
        padded={false}
      >
        {pickSlot ? (
          <div className={styles.pickList}>
            <p className={styles.pickLead}>同じ巻に、版などが違う本が登録されています。</p>
            <ListGroup>
              {pickSlot.books.map((info) => (
                <BookInfoRow key={info.book.id} info={info} />
              ))}
            </ListGroup>
          </div>
        ) : null}
      </Sheet>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 要約（読んだ巻数・抜け番）
// ---------------------------------------------------------------------------

function SummaryCard({
  overview,
  totalVolumes,
  onEdit,
}: {
  overview: SeriesOverview<SeriesBook>;
  totalVolumes: number | null;
  onEdit: () => void;
}) {
  const { missing, totalKnown, lastVolume, borrowedVolumes, readVolumes } = overview;
  const denominator = totalKnown ? lastVolume : 0;

  let missingText: ReactNode;
  if (lastVolume === 0) {
    missingText = null;
  } else if (missing.length > 0) {
    missingText = (
      <p className={styles.missing}>
        <span className={styles.missingLabel}>{totalKnown ? 'まだ借りていない巻' : '抜けている巻'}：</span>
        <span className={styles.missingValue}>{formatVolumeRanges(missing)}</span>
        <span className="visually-hidden">（{missing.length}巻）</span>
      </p>
    );
  } else {
    missingText = (
      <p className={styles.complete}>
        <CheckIcon size={18} strokeWidth={3} />
        {totalKnown ? `全${lastVolume}巻を借りました` : `1〜${lastVolume}巻まで抜けはありません`}
      </p>
    );
  }

  return (
    <Card className={styles.summary}>
      <dl className={styles.numbers}>
        <div className={styles.number}>
          <dt>読んだ</dt>
          <dd>
            <strong>{readVolumes}</strong>巻
          </dd>
        </div>
        <div className={styles.number}>
          <dt>借りた</dt>
          <dd>
            <strong>{borrowedVolumes}</strong>巻
          </dd>
        </div>
        <div className={styles.number}>
          <dt>全巻数</dt>
          <dd>
            {totalVolumes !== null ? (
              <>
                <strong>{totalVolumes}</strong>巻
              </>
            ) : (
              <span className={styles.unknown}>未設定</span>
            )}
          </dd>
        </div>
      </dl>

      {denominator > 0 ? (
        <div
          className={styles.progress}
          role="img"
          aria-label={`全${denominator}巻のうち、借りた巻 ${borrowedVolumes}巻、読んだ巻 ${readVolumes}巻`}
        >
          <span className={styles.progressBorrowed} style={{ width: `${Math.min(100, (borrowedVolumes / denominator) * 100)}%` }} />
          <span className={styles.progressRead} style={{ width: `${Math.min(100, (readVolumes / denominator) * 100)}%` }} />
        </div>
      ) : null}

      {missingText}

      {!totalKnown && lastVolume > 0 ? (
        <div className={styles.totalHint}>
          <p>全巻数を設定すると、{lastVolume}巻より後の「まだ借りていない巻」も分かります。</p>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            全巻数を設定
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// マス目
// ---------------------------------------------------------------------------

function slotLabel(slot: VolumeSlot<SeriesBook>): string {
  const multi = slot.books.length > 1 ? `、${slot.books.length}冊あります` : '';
  return `${slot.volume}巻 ${stateText(slot)}${multi}`;
}

function VolumeGrid({
  slots,
  onPick,
}: {
  slots: VolumeSlot<SeriesBook>[];
  onPick: (slot: VolumeSlot<SeriesBook>) => void;
}) {
  return (
    <ol className={styles.grid} aria-label="巻ごとの状況">
      {slots.map((slot) => {
        const cls = [styles.cell, STATE_CLASS[slot.state]].filter(Boolean).join(' ');
        const content = (
          <>
            <span className={styles.cellNumber}>{slot.volume}</span>
            <span className={styles.cellIcon} aria-hidden="true">
              <StateIcon state={slot.state} size={14} />
            </span>
            {rereading(slot) ? (
              <span className={styles.cellReadMark} aria-hidden="true">
                <CheckIcon size={12} strokeWidth={3.5} />
              </span>
            ) : null}
            {slot.books.length > 1 ? (
              <span className={styles.cellMulti} aria-hidden="true">
                {slot.books.length}
              </span>
            ) : null}
          </>
        );
        let cell: ReactNode;
        if (slot.books.length === 1) {
          cell = (
            <Link to={`/books/${encodeURIComponent(slot.books[0].book.id)}`} className={cls} aria-label={slotLabel(slot)}>
              {content}
            </Link>
          );
        } else if (slot.books.length > 1) {
          cell = (
            <button type="button" className={cls} aria-label={slotLabel(slot)} onClick={() => onPick(slot)}>
              {content}
            </button>
          );
        } else {
          cell = (
            <span className={cls} role="img" aria-label={slotLabel(slot)}>
              {content}
            </span>
          );
        }
        return <li key={slot.volume}>{cell}</li>;
      })}
    </ol>
  );
}

function Legend({ counts, showRereadNote }: { counts: Record<BookReadState, number>; showRereadNote: boolean }) {
  return (
    <>
      <ul className={styles.legend} aria-label="色の意味と巻数">
        {LEGEND_ORDER.map((state) => (
          <li key={state} className={styles.legendItem}>
            <span className={[styles.swatch, STATE_CLASS[state]].filter(Boolean).join(' ')} aria-hidden="true">
              <StateIcon state={state} size={12} />
            </span>
            {VOLUME_STATE_TEXT[state]}
            <span className={styles.legendCount}>{counts[state]}</span>
          </li>
        ))}
      </ul>
      {showRereadNote ? (
        <p className={styles.legendNote}>
          <span className={styles.legendReadMark} aria-hidden="true">
            <CheckIcon size={10} strokeWidth={3.5} />
          </span>
          の付いた貸出中の巻は、前に読んだ巻です（上の「読んだ」の巻数に入っています）。
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

type ListEntry =
  | { kind: 'book'; volume: number; info: SeriesBookInfo<SeriesBook> }
  | { kind: 'gap'; from: number; to: number };

/** 本のある巻は本ごとの行に、本の無い巻は連続をまとめた 1 行にする */
function listEntries(slots: VolumeSlot<SeriesBook>[]): ListEntry[] {
  const out: ListEntry[] = [];
  const emptyVolumes = slots.filter((s) => s.books.length === 0).map((s) => s.volume);
  const gapStart = new Map(compressRanges(emptyVolumes).map(([a, b]) => [a, b]));
  for (const slot of slots) {
    if (slot.books.length === 0) {
      const end = gapStart.get(slot.volume);
      if (end !== undefined) out.push({ kind: 'gap', from: slot.volume, to: end });
      continue;
    }
    for (const info of slot.books) out.push({ kind: 'book', volume: slot.volume, info });
  }
  return out;
}

function VolumeList({ slots }: { slots: VolumeSlot<SeriesBook>[] }) {
  const entries = useMemo(() => listEntries(slots), [slots]);
  return (
    <Card padded={false}>
      <ul className={styles.volList} aria-label="巻ごとの状況">
        {entries.map((e) =>
          e.kind === 'gap' ? (
            <li key={`gap-${e.from}`} className={styles.gapRow}>
              <span className={`${styles.volNo} ${styles.volNoGap}`}>{e.from === e.to ? e.from : `${e.from}〜${e.to}`}</span>
              <span>まだ借りていない</span>
            </li>
          ) : (
            <li key={`book-${e.info.book.id}`}>
              <Link to={`/books/${encodeURIComponent(e.info.book.id)}`} className={styles.volRow}>
                <span className={styles.volNo}>{e.volume}</span>
                <BookCover title={e.info.book.title} coverUrl={e.info.book.coverUrl} size="sm" />
                <span className={styles.volMain}>
                  <span className={styles.volTitle}>{e.info.book.title}</span>
                  <span className={styles.volSub}>
                    <StateBadge state={e.info.state} everRead={e.info.everRead} />
                    {e.info.lastBorrowedOn ? <span>{formatDate(e.info.lastBorrowedOn)}に借りた</span> : null}
                  </span>
                </span>
                <ChevronRightIcon size={18} className={styles.chevron} />
              </Link>
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}

function StateBadge({ state, everRead }: { state: BookReadState; everRead: boolean }) {
  const item = { state, everRead };
  return (
    <span className={[styles.stateBadge, STATE_CLASS[state]].filter(Boolean).join(' ')}>
      <StateIcon state={state} size={12} />
      {stateText(item)}
      {rereading(item) ? <CheckIcon size={12} strokeWidth={3} /> : null}
    </span>
  );
}

function BookInfoRow({ info }: { info: SeriesBookInfo<SeriesBook> }) {
  return (
    <ListRow
      leading={<BookCover title={info.book.title} coverUrl={info.book.coverUrl} size="sm" />}
      title={info.book.title}
      subtitle={
        <span className={styles.volSub}>
          <StateBadge state={info.state} everRead={info.everRead} />
          {info.lastBorrowedOn ? <span>{formatDate(info.lastBorrowedOn)}に借りた</span> : null}
        </span>
      }
      to={`/books/${encodeURIComponent(info.book.id)}`}
    />
  );
}
