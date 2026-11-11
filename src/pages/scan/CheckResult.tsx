/*
 * スキャンで確認（既読チェック, F-80〜83）の結果シート。登録はしない。
 *   - グループ内に本があれば: 貸出の履歴（いつ・どこで・誰が・読書状況）、いま貸出中か
 *   - 無ければ: 「まだ借りたことがありません」を本の一覧の読み込みが終わった時点ですぐ出し、
 *     書誌情報（lookupByIsbn）は取得でき次第あとから表示する（遅い回線でも判定を待たせない。最大 10 秒で打ち切る）。
 *     通信の失敗・時間切れで書誌を確かめられなかった場合は「検索サービスにつながりませんでした」と再取得ボタンを出す
 *   - グループに無い本でも、書誌のタイトルが「ISBN なしで登録した本」（バーコードが隠れて手入力した本など）と
 *     同じなら、同じ本とは決めつけずに「同じタイトルの本があります」としてその本の履歴と詳細へのリンクを出す
 *   - シリーズの本なら: 同じシリーズで借りた巻・まだの巻の要約とシリーズ画面へのリンク
 *     （グループに無い本でも、書誌のシリーズ名が登録済みのシリーズと一致すれば表示する）
 *   - 「この本を借りる」でカートに入れて確認画面へ、「続けて確認する」でカメラに戻る
 * 使い方:
 *   <CheckResultSheet isbn={checkedIsbn} onContinue={() => setCheckedIsbn(null)} />
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookCover } from '../../components/BookCover';
import { ReadStateBadge } from '../../components/ReadStateBadge';
import { Button, ErrorState, LinkButton, Sheet, Spinner, useToast } from '../../components/ui';
import {
  AlertIcon,
  BookIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  InfoIcon,
  PlusIcon,
  RefreshIcon,
  ScanIcon,
} from '../../components/ui/icons';
import { useBook, useBooksInSeries, useBooksWithoutIsbn } from '../../data/books';
import { useLoansForBook, useLoansForBooks } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { bookReadState } from '../../data/readStatus';
import { useSeriesList } from '../../data/series';
import { useGroup } from '../../group/GroupProvider';
import { lookupByIsbnDetailed } from '../../lib/bookLookup';
import { formatDate } from '../../lib/date';
import { bookIdForIsbn, formatIsbn } from '../../lib/isbn';
import { findMatchingSeries } from '../../lib/series';
import { useBorrowCart } from '../../state/borrowCart';
import type { Book, BookCandidate, Loan, WithId } from '../../types';
import { READ_STATUS_SHORT, formatFullDate, sameTitleBooksWithoutIsbn } from '../borrow/borrowLogic';
import { formatVolumeRanges, summarizeSeries } from './scanLogic';
import styles from './CheckResult.module.css';

const UNKNOWN_LOCATION = '（不明な場所）';
const NO_BOOKS: WithId<Book>[] = [];

/**
 * 書誌の取得を待つ最大時間（ミリ秒）。lookupByIsbn は API を順に呼ぶため、応答の無い回線では
 * 1 冊に 20 秒以上かかることがある。超えたら中断し、それまでに得られた結果（無ければ「見つからない」）を表示する。
 */
const CHECK_LOOKUP_CAP_MS = 10_000;

/**
 * 本がこの端末のキャッシュに無く、サーバーの応答も無いとき（オフラインなど）に「未登録」とみなすまでの時間。
 * 本は全件ではなく ID で 1 冊だけ読むため、待ち続けると読み込み中のままになる。
 */
const BOOK_MISSING_AFTER_MS = 3000;

type IsbnLookupState = {
  loading: boolean;
  candidate: BookCandidate | null;
  /** 見つからず、通信の失敗か時間切れで確かめられなかった */
  failed: boolean;
  /** 取り直す */
  retry: () => void;
};

/** ISBN から書誌情報を取得する（isbn が null の間は何もしない） */
function useIsbnLookup(isbn: string | null): IsbnLookupState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    isbn: string;
    attempt: number;
    candidate: BookCandidate | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!isbn) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    let capped = false;
    // 時間切れの中断では、lookupByIsbn がそれまでの結果を返すので表示に使う
    const timer = window.setTimeout(() => {
      capped = true;
      controller.abort();
    }, CHECK_LOOKUP_CAP_MS);
    lookupByIsbnDetailed(isbn, { signal: controller.signal })
      .catch(() => ({ candidate: null, failed: true }))
      .then(({ candidate, failed }) => {
        window.clearTimeout(timer);
        // 時間切れで何も取れなかった場合も、「見つからない」ではなく「確かめられなかった」として扱う
        if (!cancelled) setResult({ isbn, attempt, candidate, failed: candidate === null && (failed || capped) });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isbn, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (!isbn) return { loading: false, candidate: null, failed: false, retry };
  if (!result || result.isbn !== isbn || result.attempt !== attempt) {
    return { loading: true, candidate: null, failed: false, retry };
  }
  return { loading: false, candidate: result.candidate, failed: result.failed, retry };
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

  // 本は全件を読まず、ISBN から決まる ID の 1 冊・同じシリーズの本・ISBN なしの本だけを読む
  const bookId = bookIdForIsbn(isbn);
  const bookQuery = useBook(bookId, { missingAfterMs: BOOK_MISSING_AFTER_MS });
  const seriesQuery = useSeriesList();
  const locationsQuery = useLocations({ includeArchived: true });

  const book = bookQuery.data;
  const loansQuery = useLoansForBook(bookId);
  const notRegistered = !bookQuery.loading && !book;
  // グループに無い本だけ書誌を調べる
  const lookup = useIsbnLookup(notRegistered ? isbn : null);
  const candidate = lookup.candidate;
  const lookupPending = !book && lookup.loading;

  // ISBN なしで登録した、書誌のタイトルと同じタイトルの本（同じ本かもしれない）
  const noIsbnBooksQuery = useBooksWithoutIsbn(notRegistered);
  const sameTitleBooks = useMemo(
    () => (book ? NO_BOOKS : sameTitleBooksWithoutIsbn(noIsbnBooksQuery.data, candidate?.title)),
    [book, noIsbnBooksQuery.data, candidate],
  );
  const sameTitleIds = useMemo(() => sameTitleBooks.map((b) => b.id), [sameTitleBooks]);
  const sameTitleLoansQuery = useLoansForBooks(sameTitleIds);

  // シリーズ（本のシリーズ、または書誌のシリーズ名に一致する登録済みのシリーズ）
  const series = useMemo(() => {
    if (book?.seriesId) return seriesQuery.data.find((s) => s.id === book.seriesId) ?? null;
    if (!book && candidate?.seriesName) return findMatchingSeries(candidate.seriesName, seriesQuery.data);
    return null;
  }, [book, candidate, seriesQuery.data]);
  const seriesBooksQuery = useBooksInSeries(series?.id);
  const seriesBooks = series ? seriesBooksQuery.data : NO_BOOKS;
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

  // 「借りたことがあるか」はグループの本と貸出記録だけで決まるので、書誌の取得は待たない
  const loading = bookQuery.loading || (book ? loansQuery.loading : false);
  const error = bookQuery.error ?? (book ? loansQuery.error : null);

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
          <BookCover title={title ?? '？'} coverUrl={coverUrl} isbn={isbn} size="md" />
          <div className={styles.bookText}>
            {title ? (
              <p className={styles.title}>{title}</p>
            ) : lookupPending ? (
              <p className={styles.titleLoading}>
                <Spinner size="sm" label="本の情報を取得しています" />
                <span>本の情報を取得しています…</span>
              </p>
            ) : lookup.failed ? (
              <>
                <p className={styles.titleMissing}>検索サービスにつながりませんでした</p>
                <p className={styles.meta}>電波のよい場所で再取得するか、「この本を借りる」からタイトルを手入力してください</p>
                <Button variant="secondary" size="sm" icon={<RefreshIcon />} onClick={lookup.retry}>
                  本の情報を再取得
                </Button>
              </>
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
              {sameTitleBooks.length > 0 ? (
                <p className={styles.verdictSub}>ただし、ISBN なしで登録した同じタイトルの本があります（下に表示）</p>
              ) : !book && !candidate && !lookup.loading ? (
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
            <LoanHistoryList loans={loans} locationName={locationName} memberName={memberName} />
            {book ? (
              <LinkButton to={`/books/${book.id}`} variant="ghost" size="sm" className={styles.moreLink}>
                本の詳細を見る
                <ChevronRightIcon size={16} />
              </LinkButton>
            ) : null}
          </section>
        ) : null}

        {sameTitleBooks.length > 0 ? (
          <section className={styles.section} aria-labelledby="check-same-title">
            <h3 id="check-same-title" className={styles.sectionTitle}>
              ISBN なしで登録した同じタイトルの本
            </h3>
            <p className={styles.sameTitleNote}>
              バーコードを読まずに（手入力で）登録した本です。同じ本かどうか、表紙や貸出の履歴で確かめてください。
            </p>
            {sameTitleLoansQuery.loading ? (
              <Spinner size="sm" label="同じタイトルの本の履歴を読み込んでいます" />
            ) : (
              sameTitleBooks.map((b) => {
                const bookLoans = sameTitleLoansQuery.data.filter((l) => l.bookId === b.id);
                return (
                  <div key={b.id} className={styles.sameTitleBook}>
                    <div className={styles.sameTitleHead}>
                      <BookCover title={b.title} coverUrl={b.coverUrl} isbn={b.isbn} size="sm" />
                      <div className={styles.bookText}>
                        <p className={styles.sameTitleTitle}>{b.title}</p>
                        <p className={styles.verdictSub}>
                          {bookLoans.length > 0 ? `これまでに${bookLoans.length}回` : 'まだ貸出の記録はありません'}
                          {bookLoans.length > 0 ? <ReadStateBadge state={bookReadState(bookLoans)} /> : null}
                        </p>
                      </div>
                    </div>
                    {bookLoans
                      .filter((l) => l.returnedOn == null)
                      .map((l) => (
                        <p key={l.id} className={styles.current}>
                          <AlertIcon size={18} className={styles.currentIcon} />
                          <span>
                            いま{memberName(l.borrowerUid)}が{locationName(l.locationId)}で借りています（{formatDate(l.dueOn)}まで）
                          </span>
                        </p>
                      ))}
                    {bookLoans.length > 0 ? (
                      <LoanHistoryList loans={bookLoans} locationName={locationName} memberName={memberName} />
                    ) : null}
                    <LinkButton
                      to={`/books/${encodeURIComponent(b.id)}`}
                      variant="ghost"
                      size="sm"
                      className={styles.moreLink}
                    >
                      この本の詳細を見る
                      <ChevronRightIcon size={16} />
                    </LinkButton>
                  </div>
                );
              })
            )}
          </section>
        ) : null}

        {series && seriesSummary ? (
          <section className={styles.section} aria-labelledby="check-series">
            <h3 id="check-series" className={styles.sectionTitle}>
              シリーズ「{series.name}」
              {volume != null ? <span className={styles.thisVolume}>この本は{volume}巻</span> : null}
            </h3>
            {seriesBooksQuery.loading || seriesLoansQuery.loading ? (
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

/** 貸出の履歴（新しい順）。いつ・どこで・誰が・読書状況 */
function LoanHistoryList({
  loans,
  locationName,
  memberName,
}: {
  loans: readonly WithId<Loan>[];
  locationName: (id: string) => string;
  memberName: (uid: string) => string;
}) {
  return (
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
  );
}
