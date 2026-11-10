/*
 * 一覧の 1 行（最小 44px、左に画像・アイコン、右に値や矢印）。
 * to を渡すとリンク、onClick を渡すとボタン、どちらも無ければただの行。
 * ListGroup で囲むと角丸の面＋区切り線になる（設定画面など）。
 * 使い方:
 *   <ListGroup title="場所">
 *     <ListRow title="中央図書館" subtitle="14日" to="/settings/locations/abc" />
 *     <ListRow leading={<BellIcon />} title="通知" trailing="オン" onClick={...} />
 *     <ListRow title="ログアウト" danger onClick={signOut} chevron={false} />
 *   </ListGroup>
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from './icons';
import styles from './ListRow.module.css';

export type ListRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 左側（アイコン・表紙など） */
  leading?: ReactNode;
  /** 右側（値・バッジなど） */
  trailing?: ReactNode;
  to?: string;
  /** to と一緒に使う場合は state を渡せる */
  state?: unknown;
  onClick?: () => void;
  /** 右端の「>」。既定は to / onClick があるとき表示 */
  chevron?: boolean;
  /** 赤い文字（削除・ログアウトなど） */
  danger?: boolean;
  disabled?: boolean;
  className?: string;
  /** 読み上げ用ラベル（title が文字列でない場合など） */
  ariaLabel?: string;
};

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  to,
  state,
  onClick,
  chevron,
  danger = false,
  disabled = false,
  className,
  ariaLabel,
}: ListRowProps) {
  const interactive = Boolean(to || onClick) && !disabled;
  const showChevron = chevron ?? Boolean(to || onClick);
  const cls = [
    styles.row,
    interactive ? styles.interactive : '',
    danger ? styles.danger : '',
    disabled ? styles.disabled : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <span className={styles.main}>
        <span className={styles.title}>{title}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {trailing != null && trailing !== false ? <span className={styles.trailing}>{trailing}</span> : null}
      {showChevron ? <ChevronRightIcon className={styles.chevron} size={18} /> : null}
    </>
  );

  if (to && !disabled) {
    return (
      <Link to={to} state={state} className={cls} aria-label={ariaLabel} onClick={onClick}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
        {content}
      </button>
    );
  }
  return (
    <div className={cls} aria-label={ariaLabel}>
      {content}
    </div>
  );
}

export type ListGroupProps = {
  /** 面の上の小見出し */
  title?: ReactNode;
  /** 面の下の注記 */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ListGroup({ title, footer, children, className }: ListGroupProps) {
  return (
    <section className={[styles.group, className ?? ''].filter(Boolean).join(' ')}>
      {title ? <h2 className={styles.groupTitle}>{title}</h2> : null}
      <div className={styles.groupBody}>{children}</div>
      {footer ? <p className={styles.groupFooter}>{footer}</p> : null}
    </section>
  );
}
