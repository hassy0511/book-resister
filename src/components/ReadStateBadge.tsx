/*
 * 本ごとの読書状況のバッジ（bookReadState の結果を表示）。
 *   reading=貸出中 / read=読んだ / partial=途中まで / unread=読んでいない / none=まだ借りていない
 * 使い方:
 *   <ReadStateBadge state={bookReadState(loans)} />
 *   <ReadStateBadge state="none" size="md" />
 */
import type { bookReadState } from '../data/readStatus';
import { BookIcon, CheckIcon, CircleIcon, ClockIcon } from './ui/icons';
import styles from './ReadStateBadge.module.css';

export type BookReadStateValue = ReturnType<typeof bookReadState>;

export const READ_STATE_TEXT: Record<BookReadStateValue, string> = {
  reading: '貸出中',
  read: '読んだ',
  partial: '途中まで',
  unread: '読んでいない',
  none: 'まだ借りていない',
};

export type ReadStateBadgeProps = {
  state: BookReadStateValue;
  size?: 'sm' | 'md';
  /** アイコンを出さない */
  hideIcon?: boolean;
  className?: string;
};

function StateIcon({ state }: { state: BookReadStateValue }) {
  const size = 14;
  switch (state) {
    case 'read':
      return <CheckIcon size={size} strokeWidth={3} />;
    case 'partial':
      return <ClockIcon size={size} strokeWidth={2.4} />;
    case 'reading':
      return <BookIcon size={size} strokeWidth={2.4} />;
    case 'unread':
    case 'none':
      return <CircleIcon size={size} strokeWidth={2.4} />;
  }
}

export function ReadStateBadge({ state, size = 'sm', hideIcon = false, className }: ReadStateBadgeProps) {
  return (
    <span className={[styles.badge, styles[state], styles[size], className ?? ''].filter(Boolean).join(' ')}>
      {hideIcon ? null : <StateIcon state={state} />}
      {READ_STATE_TEXT[state]}
    </span>
  );
}
