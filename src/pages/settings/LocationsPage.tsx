/*
 * 借りる場所の一覧（/settings/locations）。F-10, F-11
 * 表示中の場所と非表示の場所を分けて表示する。行をタップすると編集、右上か下のボタンで追加。
 */
import { useMemo, type ReactNode } from 'react';
import { useActiveLoans } from '../../data/loans';
import { useLocations } from '../../data/locations';
import {
  EmptyState,
  ErrorState,
  IconLinkButton,
  LinkButton,
  ListGroup,
  ListRow,
  Page,
  Spinner,
} from '../../components/ui';
import { LocationIcon, PlusIcon } from '../../components/ui/icons';
import { countByLocation, locationSummary, splitLocations } from './settingsLogic';
import styles from './LocationsPage.module.css';

const NEW_PATH = '/settings/locations/new';

export default function LocationsPage() {
  const locations = useLocations({ includeArchived: true });
  const activeLoans = useActiveLoans();

  const { active, archived } = useMemo(() => splitLocations(locations.data), [locations.data]);
  const loanCounts = useMemo(() => countByLocation(activeLoans.data), [activeLoans.data]);

  const hasAny = locations.data.length > 0;

  let body: ReactNode;
  if (locations.loading) {
    body = <Spinner size="lg" center showLabel label="場所を読み込んでいます" />;
  } else if (locations.error && !hasAny) {
    body = <ErrorState error={locations.error} onRetry={() => window.location.reload()} />;
  } else if (!hasAny) {
    body = (
      <EmptyState
        icon={<LocationIcon />}
        title="借りる場所がまだありません"
        description="図書館・図書室・学校・保育園など、本を借りる場所を登録しましょう。"
      />
    );
  } else {
    const renderRow = (l: (typeof locations.data)[number]) => {
      const count = loanCounts[l.id] ?? 0;
      return (
        <ListRow
          key={l.id}
          leading={<LocationIcon size={22} className={l.archived ? styles.mutedIcon : undefined} />}
          title={l.name}
          subtitle={locationSummary(l)}
          trailing={count > 0 ? <span className={styles.loanCount}>貸出中 {count}冊</span> : null}
          to={`/settings/locations/${l.id}`}
        />
      );
    };
    body = (
      <>
        {active.length > 0 ? (
          <ListGroup title="表示中の場所">
            {active.map(renderRow)}
          </ListGroup>
        ) : (
          <EmptyState
            compact
            icon={<LocationIcon />}
            title="表示中の場所はありません"
            description="新しく追加するか、下の非表示の場所を再表示してください。"
          />
        )}
        {archived.length > 0 ? (
          <ListGroup
            title="非表示の場所"
            footer="非表示の場所は、本を借りるときの選択肢に出ません。これまでの履歴はそのまま残ります。"
            className={styles.archived}
          >
            {archived.map(renderRow)}
          </ListGroup>
        ) : null}
      </>
    );
  }

  return (
    <Page
      title="借りる場所"
      back="/settings"
      right={<IconLinkButton label="場所を追加" icon={<PlusIcon />} to={NEW_PATH} />}
      footer={
        <LinkButton to={NEW_PATH} size="lg" block icon={<PlusIcon />}>
          場所を追加
        </LinkButton>
      }
    >
      {body}
    </Page>
  );
}
