/*
 * ホーム: 貸出中の本の一覧（F-30〜33）。
 *   - 上部に要約（延滞／3日以内／貸出中）
 *   - 場所・借りた人で絞り込み（URL の ?location= / ?borrower= に持つので、詳細から戻っても保たれる）
 *   - 「場所ごと」と「返却日順」の表示切替（localStorage に保存）
 *   - 場所ごとの表示では見出しに「まとめて返却」
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Loan, WithId } from '../../types';
import { useActiveLoans } from '../../data/loans';
import { useLocations } from '../../data/locations';
import { useGroup } from '../../group/GroupProvider';
import { dueStatus, type DueStatus } from '../../lib/date';
import { LoanRow } from '../../components/LoanRow';
import { Button, Card, Chips, EmptyState, ErrorState, LinkButton, Page, SegmentedControl, Spinner } from '../../components/ui';
import type { ChipOption, SegmentOption } from '../../components/ui';
import { BookIcon, LocationIcon, PlusIcon, ReturnIcon, ScanIcon } from '../../components/ui/icons';
import {
  bulkReturnPath,
  countBy,
  filterLoans,
  groupByLocation,
  loadViewMode,
  saveViewMode,
  summarizeLoans,
  type HomeFilter,
  type HomeViewMode,
  type LoanSummary,
} from './homeLogic';
import { useToday } from './useToday';
import styles from './HomePage.module.css';

const UNKNOWN_LOCATION = '（不明な場所）';
const SCAN_PATH = '/scan?mode=borrow';

const VIEW_OPTIONS: SegmentOption<HomeViewMode>[] = [
  { value: 'byLocation', label: '場所ごと' },
  { value: 'byDue', label: '返却日順' },
];

const ROW_TONE: Record<DueStatus, string | undefined> = {
  overdue: styles.rowOverdue,
  soon: styles.rowSoon,
  ok: undefined,
};

export default function HomePage() {
  const { members, memberName } = useGroup();
  const loansQuery = useActiveLoans();
  const locationsQuery = useLocations({ includeArchived: true });
  const today = useToday();

  const [searchParams, setSearchParams] = useSearchParams();
  const locationParam = searchParams.get('location') || null;
  const borrowerParam = searchParams.get('borrower') || null;
  const filter = useMemo<HomeFilter>(
    () => ({ locationId: locationParam, borrowerUid: borrowerParam }),
    [locationParam, borrowerParam],
  );

  const [viewMode, setViewModeState] = useState<HomeViewMode>(() => loadViewMode());
  const setViewMode = (mode: HomeViewMode) => {
    setViewModeState(mode);
    saveViewMode(mode);
  };

  const setFilterParam = useCallback(
    (key: 'location' | 'borrower', value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilters = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('location');
        next.delete('borrower');
        return next;
      },
      { replace: true },
    );
  };

  const locations = locationsQuery.data;
  const loans = loansQuery.data;

  const locationNames = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const locationName = useCallback((id: string) => locationNames.get(id) ?? UNKNOWN_LOCATION, [locationNames]);
  const activeLocationCount = useMemo(() => locations.filter((l) => !l.archived).length, [locations]);

  const filtered = useMemo(() => filterLoans(loans, filter), [loans, filter]);
  const summary = useMemo(() => summarizeLoans(filtered, today), [filtered, today]);
  const sections = useMemo(() => groupByLocation(filtered, locationName), [filtered, locationName]);

  // 絞り込みチップ（件数はもう一方の絞り込みを適用した数）
  const locationOptions = useMemo<ChipOption<string>[]>(() => {
    const counts = countBy(filterLoans(loans, { locationId: null, borrowerUid: filter.borrowerUid }), (l) => l.locationId);
    const present = new Set(loans.map((l) => l.locationId));
    if (filter.locationId) present.add(filter.locationId);
    const ordered = locations.map((l) => l.id).filter((id) => present.has(id));
    for (const id of present) if (!locationNames.has(id)) ordered.push(id);
    return ordered.map((id) => ({ value: id, label: locationName(id), count: counts.get(id) ?? 0 }));
  }, [loans, locations, locationNames, locationName, filter.locationId, filter.borrowerUid]);

  const borrowerOptions = useMemo<ChipOption<string>[]>(() => {
    const counts = countBy(filterLoans(loans, { locationId: filter.locationId, borrowerUid: null }), (l) => l.borrowerUid);
    const present = new Set(loans.map((l) => l.borrowerUid));
    if (filter.borrowerUid) present.add(filter.borrowerUid);
    const memberIds = members.map((m) => m.id);
    const ordered = memberIds.filter((id) => present.has(id));
    for (const id of present) if (!memberIds.includes(id)) ordered.push(id);
    return ordered.map((id) => ({ value: id, label: memberName(id), count: counts.get(id) ?? 0 }));
  }, [loans, members, memberName, filter.locationId, filter.borrowerUid]);

  const loading = loansQuery.loading || locationsQuery.loading;
  const error = loansQuery.error ?? locationsQuery.error;
  const showLocationBanner = !locationsQuery.loading && !locationsQuery.error && activeLocationCount === 0;

  const renderRows = (list: WithId<Loan>[], showLocation: boolean) => (
    <ul className={styles.list}>
      {list.map((loan) => (
        <li key={loan.id}>
          <LoanRow
            loan={loan}
            locationName={showLocation ? locationName(loan.locationId) : ''}
            borrowerName={memberName(loan.borrowerUid)}
            to={`/loans/${loan.id}`}
            today={today}
            className={ROW_TONE[dueStatus(loan.dueOn, today)]}
          />
        </li>
      ))}
    </ul>
  );

  let body: ReactNode;
  if (loading) {
    body = <Spinner center size="lg" label="貸出中の本を読み込んでいます" />;
  } else if (error) {
    body = <ErrorState error={error} onRetry={() => window.location.reload()} />;
  } else if (loans.length === 0) {
    body = (
      <EmptyState
        icon={<BookIcon />}
        title="借りている本はありません"
        description="図書館などで借りた本は、バーコードをスキャンするだけで登録できます。"
        action={
          <LinkButton to={SCAN_PATH} icon={<ScanIcon />} size="lg">
            スキャンして借りた本を登録
          </LinkButton>
        }
      />
    );
  } else {
    body = (
      <>
        <SummaryTiles summary={summary} />

        {locationOptions.length >= 2 || filter.locationId ? (
          <Chips
            ariaLabel="場所で絞り込み"
            allLabel="すべての場所"
            value={filter.locationId}
            onChange={(v) => setFilterParam('location', v)}
            options={locationOptions}
          />
        ) : null}
        {borrowerOptions.length >= 2 || filter.borrowerUid ? (
          <Chips
            ariaLabel="借りた人で絞り込み"
            allLabel="全員"
            value={filter.borrowerUid}
            onChange={(v) => setFilterParam('borrower', v)}
            options={borrowerOptions}
          />
        ) : null}

        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              compact
              title="条件に合う本はありません"
              description="絞り込みを変えてみてください。"
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  絞り込みを解除
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <SegmentedControl
              ariaLabel="並べ方"
              value={viewMode}
              onChange={setViewMode}
              options={VIEW_OPTIONS}
              className={styles.viewToggle}
            />

            {viewMode === 'byLocation' ? (
              sections.map((section) => {
                const name = locationName(section.locationId);
                const headingId = `home-section-${section.locationId}`;
                return (
                  <section key={section.locationId} className={styles.section} aria-labelledby={headingId}>
                    <div className={styles.sectionHeader}>
                      <h2 id={headingId} className={styles.sectionTitle}>
                        <LocationIcon size={18} className={styles.sectionIcon} />
                        <span className={styles.sectionName}>{name}</span>
                        <span className={styles.sectionCount}>{section.loans.length}冊</span>
                      </h2>
                      <LinkButton
                        to={bulkReturnPath(section.locationId, section.loans, filter.borrowerUid !== null)}
                        variant="secondary"
                        size="sm"
                        icon={<ReturnIcon />}
                        aria-label={`${name}の${section.loans.length}冊をまとめて返却`}
                      >
                        まとめて返却
                      </LinkButton>
                    </div>
                    <Card padded={false}>{renderRows(section.loans, false)}</Card>
                  </section>
                );
              })
            ) : (
              <Card padded={false}>{renderRows(filtered, true)}</Card>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <Page
      title="借りている本"
      large
      right={
        <LinkButton to={SCAN_PATH} size="sm" icon={<ScanIcon />} aria-label="借りる（スキャン）">
          借りる
        </LinkButton>
      }
      contentClassName={styles.content}
    >
      {showLocationBanner ? (
        <Card tone="primary" className={styles.banner}>
          <div className={styles.bannerBody}>
            <LocationIcon size={28} className={styles.bannerIcon} />
            <div>
              <p className={styles.bannerTitle}>まずは本を借りる場所を登録しましょう</p>
              <p className={styles.bannerText}>図書館・図書室・保育園など。場所ごとの貸出期間から返却日を自動で計算します。</p>
            </div>
          </div>
          <LinkButton to="/settings/locations/new" icon={<PlusIcon />} block>
            場所を登録する
          </LinkButton>
        </Card>
      ) : null}
      {body}
    </Page>
  );
}

/** 上部の要約（0 件の項目は控えめに表示） */
function SummaryTiles({ summary }: { summary: LoanSummary }) {
  const items: { key: string; label: string; count: number; tone: string }[] = [
    { key: 'overdue', label: '延滞', count: summary.overdue, tone: styles.tileOverdue },
    { key: 'soon', label: '3日以内', count: summary.soon, tone: styles.tileSoon },
    { key: 'total', label: '貸出中', count: summary.total, tone: styles.tileTotal },
  ];
  return (
    <ul className={styles.summary} aria-label="貸出の状況">
      {items.map((item) => (
        <li key={item.key} className={[styles.tile, item.count > 0 ? item.tone : styles.tileMuted].join(' ')}>
          <span className="visually-hidden">
            {item.label} {item.count}冊
          </span>
          <span className={styles.tileLabel} aria-hidden="true">
            {item.label}
          </span>
          <span className={styles.tileValue} aria-hidden="true">
            <span className={styles.tileNumber}>{item.count}</span>冊
          </span>
        </li>
      ))}
    </ul>
  );
}
