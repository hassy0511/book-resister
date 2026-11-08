/*
 * スキャンで確認（既読チェック, F-80〜83）の結果シート。登録はしない。
 *   - グループ内に本があれば: 貸出の履歴（いつ・どこで・誰が・読書状況）、いま貸出中か
 *   - 無ければ: 書誌情報（lookupByIsbn）と「まだ借りたことがありません」
 *   - シリーズの本なら: 同じシリーズで借りた巻・まだの巻の要約とシリーズ画面へのリンク
 *     （グループに無い本でも、書誌のシリーズ名が登録済みのシリーズと一致すれば表示する）
 *   - 「この本を借りる」でカートに入れて確認画面へ、「続けて確認する」でカメラに戻る
 * 使い方:
 *   <CheckResultSheet isbn={checkedIsbn} onContinue={() => setCheckedIsbn(null)} />
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookCover } from '../../components/BookCover';
import { ReadStateBadge } from '../../components/ReadStateBadge';
import { Button, ErrorState, LinkButton, Sheet, Spinner, useToast } from '../../components/ui';
import { AlertIcon, BookIcon, CheckCircleIcon, ChevronRightIcon, InfoIcon, PlusIcon, ScanIcon } from '../../components/ui/icons';
import { useBooks } from '../../data/books';
import { useLoansForBook, useLoansForBooks } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { bookReadState } from '../../data/readStatus';
import { useSeriesList } from '../../data/series';
import { useGroup } from '../../group/GroupProvider';
import { lookupByIsbn } from '../../lib/bookLookup';
import { formatDate } from '../../lib/date';
import { bookIdForIsbn, formatIsbn } from '../../lib/isbn';
import { findMatchingSeries } from '../../lib/series';
import { useBorrowCart } from '../../state/borrowCart';
import type { Book, BookCandidate, WithId } from '../../types';
import { READ_STATUS_SHORT, formatFullDate } from '../borrow/borrowLogic';
import { formatVolumeRanges, summarizeSeries } from './scanLogic';
import styles from './CheckResult.module.css';

const UNKNOWN_LOCATION = '（不明な場所）';
const NO_BOOKS: WithId<Book>[] = [];

/** ISBN から書誌情報を取得する（isbn が null の間は何もしない） */
function useIsbnLookup(isbn: string | null): { loading: boolean; candidate: BookCandidate | null } {
  const [result, setResult] = useState<{ isbn: string; candidate: BookCandidate | null } | null>(null);

  useEffect(() => {
    if (!isbn) return undefined;
    const controller = new AbortController();
    lookupByIsbn(isbn, { signal: controller.signal })
      .catch(() => null)
      .then((candidate) => {
        if (!controller.signal.aborted) setResult({ isbn, candidate });
      });
    return () => controller.abort();
  }, [isbn]);

  if (!isbn) return { loading: false, candidate: null };
  if (!result || result.isbn !== isbn) return { loading: true, candidate: null };
  return { loading: false, candidate: result.candidate };
}

export type CheckResultSheetProps = {
  /** 読み取った ISBN-13。null で閉じる */
  isbn: string | null;
  /** 「続けて確認する」・シートを閉じたとき */
  onContinue: () => void;
};

export function CheckResultSheet({ isbn, onContinue }: CheckResultSheetProps) {
  // 閉じるアニメーションの間も前の結果を表示しておく
  const [shownIsbn, setShownIsbn] = useState<string | null>(isbn);
  if (isbn !== null && isbn !== shownIsbn) setShownIsbn(isbn);

  if (!shownIsbn) return null;
  return <CheckResultContent key={shownIsbn} isbn={shownIsbn} open={isbn !== null} onContinue={onContinue} />;
}

function CheckResultContent({ isbn, open, onContinue }: { isbn: string; open: boolean; onContinue: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const cart = useBorrowCart();
  const { memberName } = useGroup();

  const booksQuery = useBooks();
  const seriesQuery = useSeriesList();
  const locationsQuery = useLocations({ includeArchived: true });

  const bookId = bookIdForIsbn(isbn);
  const book = useMemo(() => booksQuery.data.find((b) => b.id === bookId) ?? null, [booksQuery.data, bookId]);
  const loansQuery = useLoansForBook(bookId);
  // グループに無い本だけ書誌を調べる
  const lookup = useIsbnLookup(!booksQuery.loading && !book ? isbn : null);
  const candidate = lookup.candidate;

  // シリーズ（本のシリーズ、または書誌のシリーズ名に一致する登録済みのシリーズ）
  const series = useMemo(() => {
    if (book?.seriesId) return seriesQuery.data.find((s) => s.id === book.seriesId) ?? null;
    if (!book && candidate?.seriesName) return findMatchingSeries(candidate.seriesName, seriesQuery.data);
    return null;
  }, [book, candidate, seriesQuery.data]);
  const seriesBooks = useMemo(
    () => (series ? booksQuery.data.filter((b) => b.seriesId === series.id) : NO_BOOKS),
    [series, booksQuery.data],
  );
  const seriesBookIds = useMemo(() => seriesBooks.map((b) => b.id), [seriesBooks]);
  const seriesLoansQuery = useLoansForBooks(seriesBookIds);
  const seriesSummary = useMemo(
    () =>
      series
        ? summarizeSeries({ books: seriesBooks, loans: seriesLoansQuery.data, totalVolumes: series.totalVolumes })
        : null,
    [series, seriesBooks, seriesLoansQuery.data],
  );

  const locationNames = useMemo(
    () => new Map(locationsQuery.data.map((l) => [l.id, l.name])),
    [locationsQuery.data],
  );
  const locationName = (id: string) => locationNames.get(id) ?? UNKNOWN_LOCATION;

  const loans = book ? loansQuery.data : [];
  const currentLoans = loans.filter((l) => l.returnedOn == null);
  const readState = bookReadState(loans);

  const title = book?.title ?? candidate?.title ?? null;
  const authors = book?.authors ?? candidate?.authors ?? [];
  const publisher = book?.publisher ?? candidate?.publisher ?? null;
  const coverUrl = book?.coverUrl ?? candidate?.coverUrl ?? null;
  const volume = book?.volume ?? candidate?.volume ?? null;

  const loading = booksQuery.loading || (book ? loansQuery.loading : lookup.loading);
  const error = booksQuery.error ?? (book ? loansQuery.error : null);

  const handleBorrow = () => {
    const result = book ? cart.addExistingBook(book) : candidate ? cart.addCandidate(candidate) : cart.addIsbn(isbn);
    if (result === 'duplicate') toast.show('この本はすでに借りる本のリストに入っています');
    navigate('/borrow/confirm');
  };

  let body;
  if (loading) {
    body = <Spinner center size="lg" showLabel label="借りたことがあるか確認しています…" />;
  } else if (error) {
    body = <ErrorState error={error} title="確認できませんでした" compact />;
  } else {
    body = (
      <div className={styles.content}>
        <div className={styles.book}>
          <BookCover title={title ?? '？'} coverUrl={coverUrl} size="md" />
          <div className={styles.bookText}>
            {title ? (
              <p className={styles.title}>{title}</p>
            ) : (
              <p className={styles.titleMissing}>本の情報が見つかりませんでした</p>
            )}
            {authors.length > 0 ? <p className={styles.meta}>{authors.join('、')}</p> : null}
            {publisher ? <p className={styles.meta}>{publisher}</p> : null}
            <p className={styles.isbn}>ISBN {formatIsbn(isbn)}</p>
          </div>
        </div>

        {loans.length > 0 ? (
          <div className={`${styles.verdict} ${styles.verdictYes}`}>
            <CheckCircleIcon size={26} className={styles.verdictIcon} />
            <div className={styles.verdictText}>
              <p className={styles.verdictTitle}>借りたことがあります</p>
              <p className={styles.verdictSub}>
                これまでに{loans.length}回 <ReadStateBadge state={readState} />
              </p>
            </div>
          </div>
        ) : (
          <div className={`${styles.verdict} ${styles.verdictNo}`}>
            <InfoIcon size={26} className={styles.verdictIcon} />
            <div className={styles.verdictText}>
              <p className={styles.verdictTitle}>まだ借りたことがありません</p>
              {!book && !candidate ? (
                <p className={styles.verdictSub}>「この本を借りる」からタイトルを入力して登録できます</p>
              ) : null}
            </div>
          </div>
        )}

        {currentLoans.map((l) => (
          <p key={l.id} className={styles.current}>
            <AlertIcon size={18} className={styles.currentIcon} />
            <span>
              いま{memberName(l.borrowerUid)}が{locationName(l.locationId)}で借りています（{formatDate(l.dueOn)}まで）
            </span>
          </p>
        ))}

        {loans.length > 0 ? (
          <section className={styles.section} aria-labelledby="check-history">
            <h3 id="check-history" className={styles.sectionTitle}>
              貸出の履歴
            </h3>
            <ul className={styles.history}>
              {loans.map((l) => (
                <li key={l.id} className={styles.historyRow}>
                  <div className={styles.historyMain}>
                    <span className={styles.historyDate}>{formatFullDate(l.borrowedOn)}</span>
                    <span className={styles.historyMeta}>
                      {locationName(l.locationId)} · {memberName(l.borrowerUid)}
                    </span>
                  </div>
                  {l.returnedOn == null ? (
                    <span className={`${styles.status} ${styles.statusReading}`}>貸出中</span>
                  ) : (
                    <span className={`${styles.status} ${l.readStatus ? styles[l.readStatus] : ''}`}>
                      {l.readStatus ? READ_STATUS_SHORT[l.readStatus] : '返却済み'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {book ? (
              <LinkButton to={`/books/${book.id}`} variant="ghost" size="sm" className={styles.moreLink}>
                本の詳細を見る
                <ChevronRightIcon size={16} />
              </LinkButton>
            ) : null}
          </section>
        ) : null}

        {series && seriesSummary ? (
          <section className={styles.section} aria-labelledby="check-series">
            <h3 id="check-series" className={styles.sectionTitle}>
              シリーズ「{series.name}」
              {volume != null ? <span className={styles.thisVolume}>この本は{volume}巻</span> : null}
            </h3>
            {seriesLoansQuery.loading ? (
              <Spinner size="sm" label="シリーズの状況を読み込んでいます" />
            ) : (
              <dl className={styles.seriesList}>
                <div className={styles.seriesRow}>
                  <dt>借りた巻</dt>
                  <dd>
                    {seriesSummary.borrowedVolumes.length > 0
                      ? `${formatVolumeRanges(seriesSummary.borrowedVolumes)}巻`
                      : seriesSummary.borrowedBookCount > 0
                        ? `${seriesSummary.borrowedBookCount}冊（巻数なし）`
                        : 'まだありません'}
                  </dd>
                </div>
                {seriesSummary.readVolumes.length > 0 ? (
                  <div className={styles.seriesRow}>
                    <dt>読んだ巻</dt>
                    <dd>{formatVolumeRanges(seriesSummary.readVolumes)}巻</dd>
                  </div>
                ) : null}
                {seriesSummary.notFinishedVolumes.length > 0 ? (
                  <div className={styles.seriesRow}>
                    <dt>途中・未読</dt>
                    <dd>{formatVolumeRanges(seriesSummary.notFinishedVolumes)}巻</dd>
                  </div>
                ) : null}
                {seriesSummary.readingVolumes.length > 0 ? (
                  <div className={styles.seriesRow}>
                    <dt>貸出中</dt>
                    <dd>{formatVolumeRanges(seriesSummary.readingVolumes)}巻</dd>
                  </div>
                ) : null}
                {seriesSummary.notBorrowedVolumes.length > 0 ? (
                  <div className={styles.seriesRow}>
                    <dt>まだの巻</dt>
                    <dd>
                      {formatVolumeRanges(seriesSummary.notBorrowedVolumes)}巻
                      <span className={styles.seriesNote}>
                        {seriesSummary.total ? `（全${seriesSummary.total}巻中）` : '（借りた巻の間で抜けている巻）'}
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
            <LinkButton to={`/series/${series.id}`} variant="secondary" size="sm" icon={<BookIcon />} block>
              シリーズの画面を見る
            </LinkButton>
          </section>
        ) : !book && candidate?.seriesName ? (
          <p className={styles.seriesHint}>シリーズ「{candidate.seriesName}」の本は、まだ借りたことがありません</p>
        ) : null}
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onContinue}
      title="確認結果"
      footer={
        <div className={styles.actions}>
          <Button block size="lg" icon={<PlusIcon />} onClick={handleBorrow}>
            この本を借りる
          </Button>
          <Button block variant="secondary" icon={<ScanIcon />} onClick={onContinue}>
            続けて確認する
          </Button>
        </div>
      }
    >
      {body}
    </Sheet>
  );
}
