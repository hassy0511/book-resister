/*
 * 返却日のバッジ。延滞＝赤、3 日以内（今日〜3 日後）＝オレンジ、それ以外＝灰色。
 * 文言は lib/date の dueLabel（「2日超過」「今日まで」「明日まで」「あと5日」）。
 * 使い方:
 *   <DueBadge dueOn={loan.dueOn} />
 *   <DueBadge dueOn={loan.dueOn} showDate />     // 「11月22日(土) · あと5日」
 */
import type { DateString } from '../types';
import { dueLabel, dueStatus, formatDate } from '../lib/date';
import styles from './DueBadge.module.css';

export type DueBadgeProps = {
  dueOn: DateString;
  /** 判定の基準日（既定は今日） */
  today?: DateString;
  /** 返却日そのものも表示する */
  showDate?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

export function DueBadge({ dueOn, today, showDate = false, size = 'sm', className }: DueBadgeProps) {
  const status = dueStatus(dueOn, today);
  const label = dueLabel(dueOn, today);
  const date = formatDate(dueOn);
  return (
    <span className={[styles.badge, styles[status], styles[size], className ?? ''].filter(Boolean).join(' ')}>
      <span className="visually-hidden">返却日{showDate ? '' : ` ${date}`}</span>
      {showDate ? <span className={styles.date}>{date}</span> : null}
      {showDate ? <span aria-hidden="true">·</span> : null}
      <span className={styles.label}>{label}</span>
    </span>
  );
}
