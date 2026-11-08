/*
 * 本の詳細（/books/:bookId, F-63, F-92）。
 *   - 表紙・タイトル・著者・出版社・ISBN、シリーズ（リンクと巻数）、読書状況、借りた回数
 *   - 貸出の記録（いつ・どこで・誰が・返却日・読書状況。タップで貸出の詳細へ）
 *   - 家族の感想（評価・感想がある記録の一覧）
 *   - 「編集」シート（BookEditSheet）、「もう一度借りる」（カートに入れて /borrow/confirm へ）
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Book, DateString, Loan, Series, WithId } from '../../types';
import { useBook } from '../../data/books';
import { useLoansForBook } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { bookReadState } from '../../data/readStatus';
import { useSeries } from '../../data/series';
import { useRequiredGroup } from '../../group/GroupProvider';
import { formatDate } from '../../lib/date';
import { formatIsbn } from '../../lib/isbn';
import { useBorrowCart } from '../../state/borrowCart';
import { BookCover } from '../../components/BookCover';
import { DueBadge } from '../../components/DueBadge';
import { READ_STATUS_TEXT } from '../../components/ReadStatusPicker';
import { ReadStateBadge } from '../../components/ReadStateBadge';
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
  Spinner,
  StarRating,
  useToast,
} from '../../components/ui';
import { BookIcon, ChevronRightIcon, EditIcon, PlusIcon, SeriesIcon, UserIcon } from '../../components/ui/icons';
import { useToday } from '../home/useToday';
import { BookEditSheet } from './BookEditSheet';
import styles from './BookDetailPage.module.css';

const PAGE_TITLE = '本の詳細';
const BACK = '/history';
const UNKNOWN_LOCATION = '（不明な場所）';

export default function BookDetailPage() {
  const { bookId } = useParams();
  // 別の本へ移ったときに編集シートなどの状態を持ち越さない
  return <BookDetail key={bookId ?? ''} bookId={bookId} />;
}

function BookDetail({ bookId }: { bookId: string | undefined }) {
  const bookQuery = useBook(bookId);
  const loansQuery = useLoansForBook(bookId);
  const locationsQuery = useLocations({ includeArchived: true });
  const book = bookQuery.data;
  const seriesQuery = useSeries(book?.seriesId ?? undefined);

  const loading = bookQuery.loading || loansQuery.loading || locationsQuery.loading;
  const error = bookQuery.error ?? loansQuery.error ?? locationsQuery.error;

  if (loading) {
    return (
      <Page title={PAGE_TITLE} back={BACK}>
        <Spinner center size="lg" label="本の情報を読み込んでいます" />
      </Page>
    );
  }
  if (error) {
    return (
      <Page title={PAGE_TITLE} back={BACK}>
        <ErrorState error={error} onRetry={() => window.location.reload()} />
      </Page>
    );
  }
  if (!book) {
    return (
      <Page title={PAGE_TITLE} back={BACK}>
        <EmptyState
          icon={<BookIcon />}
          title="この本は見つかりません"
          description="削除されたか、アドレスが間違っている可能性があります。"
          action={<LinkButton to={BACK}>履歴へ</LinkButton>}
        />
      </Page>
    );
  }
  return (
    <BookDetailView
      book={book}
      loans={loansQuery.data}
      locationNames={new Map(locationsQuery.data.map((l) => [l.id, l.name]))}
      series={seriesQuery.data}
      seriesLoading={seriesQuery.loading}
    />
  );
}

type BookDetailViewProps = {
  book: WithId<Book>;
  loans: WithId<Loan>[];
  locationNames: Map<string, string>;
  series: WithId<Series> | null;
  seriesLoading: boolean;
};

function BookDetailView({ book, loans, locationNames, series, seriesLoading }: BookDetailViewProps) {
  const { groupId, memberName } = useRequiredGroup();
  const navigate = useNavigate();
  const toast = useToast();
  const cart = useBorrowCart();
  const today = useToday();

  // 編集シート（開くたびに key を変えて初期値を作り直す）
  const [editSession, setEditSession] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const openEdit = () => {
    setEditSession((n) => n + 1);
    setEditOpen(true);
  };

  const borrowingRef = useRef(false);
  const borrowAgain = () => {
    if (borrowingRef.current) return;
    borrowingRef.current = true;
    const result = cart.addExistingBook(book);
    if (result === 'duplicate') toast.show('この本はすでに「借りる本」に入っています');
    navigate('/borrow/confirm');
  };

  const state = bookReadState(loans);
  const lastBorrowedOn = loans[0]?.borrowedOn ?? null;
  const authors = book.authors.join('、');
  const locationName = (id: string) => locationNames.get(id) ?? UNKNOWN_LOCATION;

  const reviews = useMemo(() => loans.filter((l) => l.rating != null || (l.review ?? '').trim() !== ''), [loans]);
  const ratings = reviews.map((l) => l.rating).filter((r): r is number => r != null);
  const average = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  // シリーズが設定されているのに見つからない（削除済みなど）
  const seriesMissing = book.seriesId !== null && !seriesLoading && series === null;

  return (
    <Page
      title={PAGE_TITLE}
      back={BACK}
      right={
        <IconButton label="本の情報を編集" icon={<EditIcon />} onClick={openEdit} disabled={seriesLoading} />
      }
      contentClassName={styles.content}
      footer={
        <Button block size="lg" icon={<PlusIcon />} onClick={borrowAgain}>
          {loans.length > 0 ? 'もう一度借りる' : 'この本を借りる'}
        </Button>
      }
    >
      {/* 本 */}
      <Card padded={false}>
        <div className={styles.hero}>
          <BookCover title={book.title} coverUrl={book.coverUrl} size="lg" alt={`${book.title}の表紙`} />
          <div className={styles.heroText}>
            <h2 className={styles.title}>{book.title}</h2>
            {authors ? <p className={styles.authors}>{authors}</p> : null}
            <div className={styles.heroBadges}>
              <ReadStateBadge state={state} size="md" />
            </div>
          </div>
        </div>
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>借りた回数</dt>
            <dd>
              <strong className={styles.statNumber}>{loans.length}</strong>回
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>最後に借りた日</dt>
            <dd>{lastBorrowedOn ? formatDate(lastBorrowedOn) : 'まだ借りていません'}</dd>
          </div>
        </dl>
      </Card>

      {/* シリーズ */}
      <ListGroup>
        {seriesLoading ? (
          <ListRow leading={<SeriesIcon size={20} />} title="シリーズ" trailing={<Spinner size="sm" />} />
        ) : series ? (
          <ListRow
            leading={<SeriesIcon size={20} />}
            title={series.name}
            subtitle={book.volume != null ? `${book.volume}巻` : '巻数なし'}
            trailing="シリーズを見る"
            to={`/series/${encodeURIComponent(series.id)}`}
          />
        ) : (
          <ListRow
            leading={<SeriesIcon size={20} />}
            title={seriesMissing ? 'シリーズが見つかりません' : 'シリーズ未設定'}
            subtitle="「編集」からシリーズ名と巻数を設定できます"
            onClick={openEdit}
          />
        )}
      </ListGroup>

      {/* 書誌 */}
      <Card
        title="本の情報"
        action={
          <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={openEdit} disabled={seriesLoading}>
            編集
          </Button>
        }
      >
        <dl className={styles.info}>
          <InfoItem label="出版社" value={book.publisher} />
          <InfoItem label="ISBN" value={book.isbn ? formatIsbn(book.isbn) : null} empty="なし" />
        </dl>
      </Card>

      {/* 貸出の記録 */}
      <section className={styles.section} aria-labelledby="book-loans-heading">
        <h2 id="book-loans-heading" className={styles.sectionTitle}>
          貸出の記録
          {loans.length > 0 ? <span className={styles.sectionCount}>{loans.length}回</span> : null}
        </h2>
        {loans.length === 0 ? (
          <Card>
            <EmptyState compact title="まだ借りたことはありません" description="下の「この本を借りる」から登録できます。" />
          </Card>
        ) : (
          <ListGroup>
            {loans.map((loan) => (
              <LoanHistoryRow
                key={loan.id}
                loan={loan}
                locationName={locationName(loan.locationId)}
                borrowerName={memberName(loan.borrowerUid)}
                today={today}
              />
            ))}
          </ListGroup>
        )}
      </section>

      {/* 家族の感想 */}
      <section className={styles.section} aria-labelledby="book-reviews-heading">
        <h2 id="book-reviews-heading" className={styles.sectionTitle}>
          家族の感想
          {average !== null ? (
            <span className={styles.average}>
              <StarRating value={Math.round(average)} size="sm" label="平均の評価" />
              <span>
                平均 {average.toFixed(1)}（{ratings.length}件）
              </span>
            </span>
          ) : null}
        </h2>
        {reviews.length === 0 ? (
          <Card>
            <EmptyState
              compact
              title="まだ感想はありません"
              description={
                loans.length > 0
                  ? '返却するときや、貸出の記録から評価と感想を書き込めます。'
                  : '借りて返却するときに、評価と感想を書き込めます。'
              }
            />
          </Card>
        ) : (
          <ul className={styles.reviews}>
            {reviews.map((loan) => (
              <li key={loan.id}>
                <ReviewItem loan={loan} name={memberName(loan.borrowerUid)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {editSession > 0 ? (
        <BookEditSheet
          key={editSession}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          groupId={groupId}
          book={book}
          seriesName={series?.name ?? null}
        />
      ) : null}
    </Page>
  );
}

function InfoItem({ label, value, empty = '—' }: { label: string; value: string | null; empty?: string }) {
  return (
    <div className={styles.infoItem}>
      <dt>{label}</dt>
      <dd className={value ? undefined : styles.infoEmpty}>{value || empty}</dd>
    </div>
  );
}

const READ_CLASS: Record<string, string | undefined> = {
  read: styles.read,
  partial: styles.partial,
  unread: styles.unread,
};

function LoanHistoryRow({
  loan,
  locationName,
  borrowerName,
  today,
}: {
  loan: WithId<Loan>;
  locationName: string;
  borrowerName: string;
  today: DateString;
}) {
  const active = loan.returnedOn === null;
  let statusBadge: ReactNode;
  if (active) {
    statusBadge = <span className={`${styles.pill} ${styles.active}`}>貸出中</span>;
  } else if (loan.readStatus) {
    statusBadge = (
      <span className={`${styles.pill} ${READ_CLASS[loan.readStatus] ?? ''}`}>{READ_STATUS_TEXT[loan.readStatus]}</span>
    );
  } else {
    statusBadge = <span className={`${styles.pill} ${styles.unread}`}>返却済み</span>;
  }

  return (
    <ListRow
      title={`${formatDate(loan.borrowedOn)}に借りた`}
      subtitle={
        <span className={styles.loanSub}>
          <span className={styles.loanMeta}>
            <span>
              <span className="visually-hidden">場所 </span>
              {locationName}
            </span>
            <span>
              <span className="visually-hidden">借りた人 </span>
              {borrowerName}
            </span>
          </span>
          {active ? (
            <span className={styles.loanDue}>
              <DueBadge dueOn={loan.dueOn} today={today} />
              <span>{formatDate(loan.dueOn)}まで</span>
            </span>
          ) : (
            <span className={styles.loanReturned}>{formatDate(loan.returnedOn ?? '')}に返却</span>
          )}
        </span>
      }
      trailing={statusBadge}
      to={`/loans/${encodeURIComponent(loan.id)}`}
    />
  );
}

function ReviewItem({ loan, name }: { loan: WithId<Loan>; name: string }) {
  const review = (loan.review ?? '').trim();
  return (
    <Link to={`/loans/${encodeURIComponent(loan.id)}`} className={styles.review}>
      <div className={styles.reviewHead}>
        <span className={styles.reviewer}>
          <UserIcon size={16} />
          {name}
        </span>
        {loan.rating != null ? <StarRating value={loan.rating} size="sm" /> : null}
        <span className={styles.reviewDate}>{formatDate(loan.returnedOn ?? loan.borrowedOn)}</span>
        <ChevronRightIcon size={16} className={styles.reviewChevron} />
      </div>
      {review ? <p className={styles.reviewText}>{review}</p> : null}
    </Link>
  );
}
