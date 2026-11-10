/*
 * シリーズ一覧（/series）。
 *   - 名前、借りた巻数／全巻数（分かれば）、読んだ巻数、最後に借りた日
 *   - 最後に借りた日の新しい順（借りていないシリーズは後ろで名前順）
 *   - 名前で検索（ひらがな／カタカナ、全角／半角の揺れを吸収）
 * 本はシリーズに入っている本だけを読む（useSeriesBooks）。貸出記録は全件を読む（最後に借りた日・読んだ巻数の集計に
 * シリーズの本の貸出がほぼすべて要り、本ごとの in クエリに分けるとリスナーが本の冊数に比例して増えるため）。
 */
import { useDeferredValue, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Book, Series, WithId } from '../../types';
import { useSeriesBooks } from '../../data/books';
import { useAllLoans } from '../../data/loans';
import { useSeriesList } from '../../data/series';
import { formatDate } from '../../lib/date';
import { BookCover } from '../../components/BookCover';
import { Button, Card, EmptyState, ErrorState, LinkButton, Page, Spinner, TextField } from '../../components/ui';
import { ChevronRightIcon, HistoryIcon, SearchIcon, SeriesIcon } from '../../components/ui/icons';
import { buildSearchText, matchesTerms, parseSearchQuery } from '../history/searchText';
import { summarizeSeriesList, type SeriesSummary } from './seriesLogic';
import styles from './SeriesListPage.module.css';

type Row = SeriesSummary<WithId<Series>, WithId<Book>>;

export default function SeriesListPage() {
  const seriesQuery = useSeriesList();
  const booksQuery = useSeriesBooks();
  const loansQuery = useAllLoans();

  const [searchParams, setSearchParams] = useSearchParams();
  // 検索欄は手元の状態で持ち、URL にも残す（シリーズ詳細から戻っても保たれる）
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const deferredQuery = useDeferredValue(query);
  const terms = useMemo(() => parseSearchQuery(deferredQuery), [deferredQuery]);

  const loading = seriesQuery.loading || booksQuery.loading || loansQuery.loading;
  const error = seriesQuery.error ?? booksQuery.error ?? loansQuery.error;

  const rows = useMemo(
    () => summarizeSeriesList(seriesQuery.data, booksQuery.data, loansQuery.data),
    [seriesQuery.data, booksQuery.data, loansQuery.data],
  );
  const filtered = useMemo(
    () => (terms.length === 0 ? rows : rows.filter((r) => matchesTerms(buildSearchText([r.series.name]), terms))),
    [rows, terms],
  );

  const changeQuery = (value: string) => {
    setQuery(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value.trim()) next.set('q', value);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  };

  const onSubmitSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  let body: ReactNode;
  if (loading) {
    body = <Spinner center size="lg" label="シリーズを読み込んでいます" />;
  } else if (error) {
    body = <ErrorState error={error} onRetry={() => window.location.reload()} />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={<SeriesIcon />}
        title="シリーズはまだありません"
        description={
          <>
            <p>
              借りた本のタイトルから、シリーズは自動で作られます（例：「おしりたんてい (3)」「かいけつゾロリ 第12巻」）。
            </p>
            <p className={styles.emptyNote}>自動で分からなかった本は、本の詳細の「編集」でシリーズ名と巻数を設定できます。</p>
          </>
        }
        action={
          <LinkButton to="/history" variant="secondary" icon={<HistoryIcon />}>
            履歴から本を選ぶ
          </LinkButton>
        }
      />
    );
  } else {
    body = (
      <>
        <form role="search" onSubmit={onSubmitSearch}>
          <TextField
            label="シリーズ名で検索"
            hideLabel
            type="search"
            leading={<SearchIcon size={20} />}
            clearable
            placeholder="シリーズ名で検索"
            value={query}
            onChange={changeQuery}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </form>
        <p className={styles.count} aria-live="polite">
          {terms.length > 0 ? `${filtered.length}件／全${rows.length}シリーズ` : `${rows.length}シリーズ`}
        </p>
        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon={<SearchIcon />}
              title="条件に合うシリーズはありません"
              description="言葉を短くしてみてください。"
              action={
                <Button variant="secondary" onClick={() => changeQuery('')}>
                  検索をクリア
                </Button>
              }
            />
          </Card>
        ) : (
          <Card padded={false}>
            <ul className={styles.list}>
              {filtered.map((row) => (
                <li key={row.series.id}>
                  <SeriesRow row={row} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </>
    );
  }

  return (
    <Page title="シリーズ" large contentClassName={styles.content}>
      {body}
    </Page>
  );
}

/** 「借りた 7巻／全12巻 · 読んだ 5巻」などの表示 */
function volumeParts(row: Row): string[] {
  const { overview, series, bookCount } = row;
  if (bookCount === 0) return ['本がありません'];
  const parts: string[] = [];
  const hasVolumes = overview.slots.length > 0;
  if (hasVolumes || series.totalVolumes !== null) {
    parts.push(
      series.totalVolumes !== null
        ? `借りた ${overview.borrowedVolumes}巻／全${series.totalVolumes}巻`
        : `借りた ${overview.borrowedVolumes}巻`,
    );
  }
  if (overview.borrowedNoVolume > 0 || (!hasVolumes && overview.noVolume.length > 0)) {
    parts.push(`巻数なし ${overview.noVolume.length}冊`);
  }
  if (hasVolumes) parts.push(`読んだ ${overview.readVolumes}巻`);
  return parts;
}

function SeriesRow({ row }: { row: Row }) {
  const { series, overview, coverBook } = row;
  const total = series.totalVolumes;
  const parts = volumeParts(row);
  return (
    <Link to={`/series/${encodeURIComponent(series.id)}`} className={styles.row}>
      <BookCover title={coverBook?.title ?? series.name} coverUrl={coverBook?.coverUrl ?? null} size="sm" />
      <span className={styles.main}>
        <span className={styles.name}>{series.name}</span>
        <span className={styles.meta}>
          {parts.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </span>
        {total !== null && total > 0 ? (
          <span
            className={styles.progress}
            role="img"
            aria-label={`全${total}巻のうち、借りた巻 ${overview.borrowedVolumes}巻、読んだ巻 ${overview.readVolumes}巻`}
          >
            <span
              className={styles.progressBorrowed}
              style={{ width: `${Math.min(100, (overview.borrowedVolumes / total) * 100)}%` }}
            />
            <span className={styles.progressRead} style={{ width: `${Math.min(100, (overview.readVolumes / total) * 100)}%` }} />
          </span>
        ) : null}
        <span className={styles.last}>
          {overview.lastBorrowedOn ? `最後に借りた日 ${formatDate(overview.lastBorrowedOn)}` : 'まだ借りていません'}
        </span>
      </span>
      <ChevronRightIcon size={18} className={styles.chevron} />
    </Link>
  );
}
