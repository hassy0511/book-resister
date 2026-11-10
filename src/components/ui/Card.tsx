/*
 * 白い面（角丸＋影）。中身の配置は自由。
 * 使い方:
 *   <Card>…</Card>
 *   <Card title="期限が近い本" padded={false}>…一覧…</Card>
 *   <Card tone="danger">延滞中の本があります</Card>
 */
import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

export type CardProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** 上部の見出し */
  title?: ReactNode;
  /** 見出しの右側（「すべて見る」リンクなど） */
  action?: ReactNode;
  /** 内側の余白（既定 true） */
  padded?: boolean;
  tone?: 'default' | 'primary' | 'warning' | 'danger';
};

export function Card({ title, action, padded = true, tone = 'default', className, children, ...rest }: CardProps) {
  return (
    <div className={[styles.card, styles[tone], className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {title || action ? (
        <div className={styles.header}>
          {title ? <h2 className={styles.title}>{title}</h2> : <span />}
          {action ? <div className={styles.action}>{action}</div> : null}
        </div>
      ) : null}
      <div className={padded ? styles.body : undefined}>{children}</div>
    </div>
  );
}
