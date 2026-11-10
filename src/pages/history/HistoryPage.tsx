/*
 * 履歴（F-60〜62）: 返却済みも含むすべての貸出記録を、借りた日の新しい順に月ごとに表示する。
 *   - タイトル・著者で検索（ひらがな／カタカナ、全角／半角の揺れを吸収。空白区切りで AND）
 *   - 場所・借りた人・期間・状態で絞り込み（URL のクエリに持つので、本の詳細から戻っても保たれる）
 *   - 100 件ずつ表示し「もっと見る」で増やす（表示件数とスクロール位置も戻ったときに復元する）
 *   - 行をタップすると本の詳細へ
 * 読み取りの回数を記録の件数に比例させないため、最初は新しい順に 1 ページ分だけ読み、期間で絞り込めばその期間だけ、
 * 全期間の検索・絞り込み・「もっと見る」・絞り込みシートでは全件を読む（historyScopeFor）。
 */
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DateString, Loan, WithId } from '../../types';
import { useHistoryLoans, type HistoryScope } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { useGroup } from '../../group/GroupProvider';
import { formatDate } from '../../lib/date';
import { BookCover } from '../../components/BookCover';
import { DueBadge } from '../../components/DueBadge';
import {
  Button,
  Card,
  Chips,
  DateField,
  EmptyState,
  ErrorState,
  LinkButton,
  Page,
  SegmentedControl,
  Sheet,
  Spinner,
  StarRating,
  TextField,
} from '../../components/ui';
import type { ChipOption, SegmentOption } from '../../components/ui';
import { ChevronRightIcon, CloseIcon, FilterIcon, HistoryIcon, ScanIcon, SearchIcon } from '../../components/ui/icons';
import { useToday } from '../home/useToday';
import {
  EMPTY_FILTER,
  HISTORY_STATES,
  HISTORY_STATE_LABELS,
  PAGE_SIZE,
  PERIOD_LABELS,
  activeFilterCount,
  applyFilterToParams,
  countBy,
  filterFromParams,
  filterHistory,
  groupByMonth,
  historyScopeFor,
  historyStateOf,
  monthKeyOf,
  needsAllLoans,
  type FilterDimension,
  type HistoryFilter,
  type HistoryState,
  type PeriodKind,
} from './historyLogic';
import { buildSearchText, parseSearchQuery } from './searchText';
import { useListMemory } from './useListMemory';
import styles from './HistoryPage.module.css';

const UNKNOWN_LOCATION = '（不明な場所）';
const EMPTY_LOANS: WithId<Loan>[] = [];

const PERIOD_OPTIONS: SegmentOption<PeriodKind>[] = (['thisYear', 'lastYear', 'all', 'range'] as const).map((value) => ({
  value,
  label: PERIOD_LABELS[value],
}));

type HistoryLoan = WithId<Loan>;

type LoadedLoans = { scope: HistoryScope; data: HistoryLoan[]; error: Error | null };

export default function HistoryPage() {
  const { members, memberName } = useGroup();
  const locationsQuery = useLocations({ includeArchived: true });
  const today = useToday();

  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => filterFromParams(searchParams), [searchParams]);

  // 検索欄は手元の状態で持つ（日本語入力の変換中に URL 側の更新で入力が乱れないように）
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const deferredQuery = useDeferredValue(query);
  const terms = useMemo(() => parseSearchQuery(deferredQuery), [deferredQuery]);

  const anchorRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // 読み込みが終わるまで表示件数・スクロール位置の復元を待つ（下の ready）
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useListMemory('history', PAGE_SIZE, anchorRef, ready);

  // ---- 読む範囲（全件を読むのは必要なときだけ。一度読んだらこの画面にいる間は全件のまま） ----
  const wantAll = needsAllLoans({ filter, hasTerms: terms.length > 0, visible, sheetOpen });
  const [allLoaded, setAllLoaded] = useState(false);
  if (wantAll && !allLoaded) setAllLoaded(true);
  const scope = historyScopeFor(filter, today, wantAll || allLoaded);
  const loansQuery = useHistoryLoans(scope);

  // 範囲を切り替えて読み込んでいる間は、前に読んだ内容を表示しておく（検索欄などが消えないように）
  const [loaded, setLoaded] = useState<LoadedLoans | null>(null);
  if (!loansQuery.loading && (loaded === null || loaded.data !== loansQuery.data || loaded.error !== loansQuery.error)) {
    setLoaded({ scope, data: loansQuery.data, error: loansQuery.error });
  }
  const refreshing = loansQuery.loading && loaded !== null;

  const loading = (loansQuery.loading && loaded === null) || locationsQuery.loading;
  const error = (loaded?.error ?? null) ?? locationsQuery.error;
  if (!loading && !ready) setReady(true);

  const loadedScope = loaded?.scope ?? scope;
  const allLoans = loaded?.data ?? EMPTY_LOANS;
  // 新しい順に 1 ページ分＋1 件だけ読んだとき、続きがあるか
  const hasMore = loadedScope.kind === 'recent' && allLoans.length > PAGE_SIZE;
  const loans = useMemo(() => (hasMore ? allLoans.slice(0, PAGE_SIZE) : allLoans), [hasMore, allLoans]);
  const locations = locationsQuery.data;

  const locationNames = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const locationName = useCallback((id: string) => locationNames.get(id) ?? UNKNOWN_LOCATION, [locationNames]);

  // 検索対象の文字列は記録ごとに 1 回だけ作る
  const searchTexts = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of loans) map.set(l.id, buildSearchText([l.book.title, ...l.book.authors]));
    return map;
  }, [loans]);
  const search = useMemo(
    () => ({ terms, textOf: (l: HistoryLoan) => searchTexts.get(l.id) ?? '' }),
    [terms, searchTexts],
  );

  const filtered = useMemo(() => filterHistory(loans, filter, today, search), [loans, filter, today, search]);
  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const groups = useMemo(() => groupByMonth(shown), [shown]);
  const monthCounts = useMemo(() => countBy(filtered, (l) => monthKeyOf(l.borrowedOn)), [filtered]);

  const updateFilter = useCallback(
    (patch: Partial<HistoryFilter>) => {
      setVisible(PAGE_SIZE);
      setSearchParams((prev) => applyFilterToParams(prev, { ...filterFromParams(prev), ...patch }), { replace: true });
    },
    [setSearchParams, setVisible],
  );

  const changeQuery = (value: string) => {
    setQuery(value);
    setVisible(PAGE_SIZE);
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

  // setSearchParams は同じ操作の中で 2 回呼ぶと前の変更が消えるので、1 回にまとめる
  const clearAll = () => {
    setQuery('');
    setVisible(PAGE_SIZE);
    setSearchParams(
      (prev) => {
        const next = applyFilterToParams(prev, EMPTY_FILTER);
        next.delete('q');
        return next;
      },
      { replace: true },
    );
  };

  const onSubmitSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // キーボードを閉じる
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const filterCount = activeFilterCount(filter);
  const hasCondition = filterCount > 0 || terms.length > 0;

  const tags = useMemo(
    () => filterTags(filter, today, locationName, memberName, updateFilter),
    [filter, today, locationName, memberName, updateFilter],
  );

  let body: ReactNode;
  if (loading) {
    body = <Spinner center size="lg" label="履歴を読み込んでいます" />;
  } else if (error) {
    body = <ErrorState error={error} onRetry={() => window.location.reload()} />;
  } else if (loans.length === 0 && loadedScope.kind !== 'range') {
    // 期間だけ読んだときは、その期間に無いだけかもしれないので下の「条件に合う記録はありません」を出す
    body = (
      <EmptyState
        icon={<HistoryIcon />}
        title="まだ貸出の記録はありません"
        description="借りた本を登録すると、返却したあとも記録がここに残ります。"
        action={
          <LinkButton to="/scan?mode=borrow" icon={<ScanIcon />} size="lg">
            スキャンして借りた本を登録
          </LinkButton>
        }
      />
    );
  } else {
    body = (
      <>
        <form role="search" className={styles.searchForm} onSubmit={onSubmitSearch}>
          <TextField
            label="タイトル・著者で検索"
            hideLabel
            type="search"
            leading={<SearchIcon size={20} />}
            clearable
            placeholder="タイトル・著者で検索"
            value={query}
            onChange={changeQuery}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </form>

        <div className={styles.toolbar}>
          <p className={styles.count} aria-live="polite">
            {refreshing ? <Spinner size="sm" label="記録を読み込んでいます" /> : null}
            {hasMore ? (
              // 新しい順に 1 ページ分だけ読んでいる（全体の件数はまだ分からない）
              <>
                最近の<strong>{loans.length}</strong>件
              </>
            ) : loadedScope.kind === 'range' ? (
              // 期間で絞り込んだときは、その期間の記録だけを読んでいる
              <>
                <strong>{filtered.length}</strong>件
              </>
            ) : hasCondition ? (
              <>
                <strong>{filtered.length}</strong>件<span className={styles.countTotal}>／全{loans.length}件</span>
              </>
            ) : (
              <>
                全<strong>{loans.length}</strong>件
              </>
            )}
          </p>
          <Button
            variant={filterCount > 0 ? 'primary' : 'secondary'}
            size="sm"
            icon={<FilterIcon />}
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
          >
            {filterCount > 0 ? `絞り込み（${filterCount}）` : '絞り込み'}
          </Button>
        </div>

        {tags.length > 0 ? (
          <div className={styles.tags} role="group" aria-label="設定中の絞り込み">
            {tags.map((t) => (
              <button
                key={t.key}
                type="button"
                className={styles.tag}
                onClick={t.onRemove}
                aria-label={`「${t.label}」の絞り込みを解除`}
              >
                <span className={styles.tagLabel}>{t.label}</span>
                <CloseIcon size={14} />
              </button>
            ))}
          </div>
        ) : null}

        {filtered.length === 0 && refreshing ? (
          <Spinner center size="lg" label="履歴を読み込んでいます" />
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon={<SearchIcon />}
              title="条件に合う記録はありません"
              description={terms.length > 0 ? '言葉を短くしたり、絞り込みを外したりしてみてください。' : '絞り込みを変えてみてください。'}
              action={
                <Button variant="secondary" onClick={clearAll}>
                  条件をすべてクリア
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {groups.map((g, index) => {
              const headingId = `history-month-${g.key || 'none'}`;
              const count = monthCounts.get(g.key) ?? g.loans.length;
              // 1 ページ分だけ読んだときの最後の月は、まだ読んでいない記録があるかもしれない
              const partial = hasMore && index === groups.length - 1;
              return (
                <section key={g.key} className={styles.month} aria-labelledby={headingId}>
                  <h2 id={headingId} className={styles.monthHeading}>
                    <span>{g.label}</span>
                    <span className={styles.monthCount}>{partial ? `${count}件以上` : `${count}件`}</span>
                  </h2>
                  <Card padded={false}>
                    <ul className={styles.list}>
                      {g.loans.map((loan) => (
                        <li key={loan.id}>
                          <HistoryRow
                            loan={loan}
                            locationName={locationName(loan.locationId)}
                            borrowerName={memberName(loan.borrowerUid)}
                            today={today}
                          />
                        </li>
                      ))}
                    </ul>
                  </Card>
                </section>
              );
            })}
            {hasMore ? (
              // 押すと全件を読む
              <Button variant="secondary" block size="lg" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                もっと見る
              </Button>
            ) : shown.length < filtered.length ? (
              <Button variant="secondary" block size="lg" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                もっと見る（残り{filtered.length - shown.length}件）
              </Button>
            ) : refreshing ? (
              <Spinner center label="履歴を読み込んでいます" />
            ) : (
              <p className={styles.end}>これより前の記録はありません</p>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <Page title="履歴" large contentClassName={styles.content}>
      <div ref={anchorRef} className={styles.anchor} aria-hidden="true" />
      {body}
      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filter={filter}
        onChange={updateFilter}
        loans={loans}
        search={search}
        today={today}
        resultCount={filtered.length}
        locationName={locationName}
        locationOrder={locations.map((l) => l.id)}
        memberOrder={members.map((m) => m.id)}
        memberName={memberName}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// 1 行
// ---------------------------------------------------------------------------

type HistoryRowProps = {
  loan: HistoryLoan;
  locationName: string;
  borrowerName: string;
  today: DateString;
};

const BADGE_CLASS: Record<HistoryState, string | undefined> = {
  active: styles.badgeActive,
  read: styles.badgeRead,
  partial: styles.badgePartial,
  unread: styles.badgeUnread,
};

const HistoryRow = memo(function HistoryRow({ loan, locationName, borrowerName, today }: HistoryRowProps) {
  const state = historyStateOf(loan);
  const authors = loan.book.authors.join('、');
  return (
    <Link to={`/books/${encodeURIComponent(loan.bookId)}`} className={styles.row}>
      <BookCover title={loan.book.title} coverUrl={loan.book.coverUrl} isbn={loan.book.isbn} size="sm" />
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{loan.book.title}</span>
        {authors ? <span className={styles.rowAuthors}>{authors}</span> : null}
        <span className={styles.rowMeta}>
          <span>
            <span className="visually-hidden">借りた日 </span>
            {formatDate(loan.borrowedOn)}
          </span>
          <span>
            <span className="visually-hidden">場所 </span>
            {locationName}
          </span>
          <span>
            <span className="visually-hidden">借りた人 </span>
            {borrowerName}
          </span>
        </span>
        <span className={styles.rowStatus}>
          <span className={[styles.badge, BADGE_CLASS[state]].filter(Boolean).join(' ')}>{HISTORY_STATE_LABELS[state]}</span>
          {state === 'active' ? <DueBadge dueOn={loan.dueOn} today={today} /> : null}
          {loan.rating ? <StarRating value={loan.rating} size="sm" /> : null}
        </span>
      </span>
      <ChevronRightIcon size={18} className={styles.chevron} />
    </Link>
  );
});

// ---------------------------------------------------------------------------
// 設定中の絞り込み（タップで解除）
// ---------------------------------------------------------------------------

type FilterTag = { key: string; label: string; onRemove: () => void };

function periodTagLabel(filter: HistoryFilter, today: DateString): string | null {
  const year = Number(today.slice(0, 4));
  switch (filter.period) {
    case 'thisYear':
      return `今年（${year}年）`;
    case 'lastYear':
      return `去年（${year - 1}年）`;
    case 'range': {
      const opts = { withYear: true } as const;
      if (filter.from && filter.to) {
        const [a, b] = filter.from <= filter.to ? [filter.from, filter.to] : [filter.to, filter.from];
        return `${formatDate(a, opts)}〜${formatDate(b, opts)}`;
      }
      if (filter.from) return `${formatDate(filter.from, opts)}から`;
      if (filter.to) return `${formatDate(filter.to, opts)}まで`;
      return '期間指定（未入力）';
    }
    case 'all':
      return null;
  }
}

function filterTags(
  filter: HistoryFilter,
  today: DateString,
  locationName: (id: string) => string,
  memberName: (uid: string) => string,
  update: (patch: Partial<HistoryFilter>) => void,
): FilterTag[] {
  const tags: FilterTag[] = [];
  const period = periodTagLabel(filter, today);
  if (period) tags.push({ key: 'period', label: period, onRemove: () => update({ period: 'all', from: '', to: '' }) });
  if (filter.state) {
    tags.push({ key: 'state', label: HISTORY_STATE_LABELS[filter.state], onRemove: () => update({ state: null }) });
  }
  if (filter.locationId) {
    tags.push({ key: 'location', label: locationName(filter.locationId), onRemove: () => update({ locationId: null }) });
  }
  if (filter.borrowerUid) {
    tags.push({ key: 'borrower', label: memberName(filter.borrowerUid), onRemove: () => update({ borrowerUid: null }) });
  }
  return tags;
}

// ---------------------------------------------------------------------------
// 絞り込みシート（変更はすぐに一覧へ反映する）
// ---------------------------------------------------------------------------

type FilterSheetProps = {
  open: boolean;
  onClose: () => void;
  filter: HistoryFilter;
  onChange: (patch: Partial<HistoryFilter>) => void;
  loans: HistoryLoan[];
  search: { terms: readonly string[]; textOf: (loan: HistoryLoan) => string };
  today: DateString;
  resultCount: number;
  locationName: (id: string) => string;
  locationOrder: string[];
  memberOrder: string[];
  memberName: (uid: string) => string;
};

/** 記録に出てくる ID を、既知の順（場所の名前順・メンバー順）→ 未知の ID の順に並べる */
function orderedIds(present: Set<string>, knownOrder: string[], selected: string | null): string[] {
  const ids = new Set(present);
  if (selected) ids.add(selected);
  const out = knownOrder.filter((id) => ids.has(id));
  for (const id of ids) if (!knownOrder.includes(id)) out.push(id);
  return out;
}

function FilterSheet({
  open,
  onClose,
  filter,
  onChange,
  loans,
  search,
  today,
  resultCount,
  locationName,
  locationOrder,
  memberOrder,
  memberName,
}: FilterSheetProps) {
  // チップの件数は、その項目以外の条件を当てはめた件数（シートを開いているときだけ数える）
  const counts = useMemo(() => {
    if (!open) return null;
    const by = (dim: FilterDimension, keyOf: (l: HistoryLoan) => string) =>
      countBy(filterHistory(loans, filter, today, search, dim), keyOf);
    return {
      location: by('location', (l) => l.locationId),
      borrower: by('borrower', (l) => l.borrowerUid),
      state: by('state', (l) => historyStateOf(l)),
    };
  }, [open, loans, filter, today, search]);

  const locationOptions = useMemo<ChipOption<string>[]>(() => {
    if (!open) return [];
    const present = new Set(loans.map((l) => l.locationId));
    return orderedIds(present, locationOrder, filter.locationId).map((id) => ({
      value: id,
      label: locationName(id),
      count: counts?.location.get(id) ?? 0,
    }));
  }, [open, loans, locationOrder, filter.locationId, locationName, counts]);

  const borrowerOptions = useMemo<ChipOption<string>[]>(() => {
    if (!open) return [];
    const present = new Set(loans.map((l) => l.borrowerUid));
    return orderedIds(present, memberOrder, filter.borrowerUid).map((id) => ({
      value: id,
      label: memberName(id),
      count: counts?.borrower.get(id) ?? 0,
    }));
  }, [open, loans, memberOrder, filter.borrowerUid, memberName, counts]);

  const stateOptions: ChipOption<HistoryState>[] = HISTORY_STATES.map((s) => ({
    value: s,
    label: HISTORY_STATE_LABELS[s],
    count: counts?.state.get(s) ?? 0,
  }));

  const changePeriod = (period: PeriodKind) => {
    if (period === 'range') {
      // 初めて期間指定にしたときは「今年の 1 月 1 日〜今日」を入れておく
      const from = filter.from || `${today.slice(0, 4)}-01-01`;
      const to = filter.to || today;
      onChange({ period, from, to });
    } else {
      onChange({ period, from: '', to: '' });
    }
  };

  const count = activeFilterCount(filter);
  const rangeReversed = filter.period === 'range' && filter.from !== '' && filter.to !== '' && filter.from > filter.to;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="絞り込み"
      footer={
        <div className={styles.sheetFooter}>
          <Button variant="secondary" onClick={() => onChange(EMPTY_FILTER)} disabled={count === 0}>
            クリア
          </Button>
          <Button onClick={onClose} className={styles.sheetApply}>
            {resultCount}件を表示
          </Button>
        </div>
      }
    >
      <div className={styles.sheetBody}>
        <section className={styles.sheetSection} aria-labelledby="history-filter-period">
          <h3 id="history-filter-period" className={styles.sheetHeading}>
            借りた時期
          </h3>
          <SegmentedControl ariaLabel="借りた時期" value={filter.period} onChange={changePeriod} options={PERIOD_OPTIONS} />
          {filter.period === 'range' ? (
            <div className={styles.rangeFields}>
              <DateField
                label="いつから"
                value={filter.from}
                onChange={(from) => onChange({ from })}
                max={today}
                showFormatted={false}
              />
              <DateField
                label="いつまで"
                value={filter.to}
                onChange={(to) => onChange({ to })}
                showFormatted={false}
                hint={rangeReversed ? '前後を入れ替えて絞り込みます' : undefined}
              />
            </div>
          ) : null}
        </section>

        <section className={styles.sheetSection} aria-labelledby="history-filter-state">
          <h3 id="history-filter-state" className={styles.sheetHeading}>
            状態
          </h3>
          <Chips
            wrap
            ariaLabel="状態で絞り込み"
            allLabel="すべて"
            value={filter.state}
            onChange={(state) => onChange({ state })}
            options={stateOptions}
          />
        </section>

        {locationOptions.length > 0 ? (
          <section className={styles.sheetSection} aria-labelledby="history-filter-location">
            <h3 id="history-filter-location" className={styles.sheetHeading}>
              場所
            </h3>
            <Chips
              wrap
              ariaLabel="場所で絞り込み"
              allLabel="すべての場所"
              value={filter.locationId}
              onChange={(locationId) => onChange({ locationId })}
              options={locationOptions}
            />
          </section>
        ) : null}

        {borrowerOptions.length > 0 ? (
          <section className={styles.sheetSection} aria-labelledby="history-filter-borrower">
            <h3 id="history-filter-borrower" className={styles.sheetHeading}>
              借りた人
            </h3>
            <Chips
              wrap
              ariaLabel="借りた人で絞り込み"
              allLabel="全員"
              value={filter.borrowerUid}
              onChange={(borrowerUid) => onChange({ borrowerUid })}
              options={borrowerOptions}
            />
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
