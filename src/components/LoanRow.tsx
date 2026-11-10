/*
 * 貸出記録の 1 行（表紙・タイトル・場所名・借りた人・返却日バッジ）。データ取得はしない。
 * 返却済みの記録は返却日と読書状況を表示する。
 * 使い方:
 *   <LoanRow loan={loan} locationName={locationName(loan.locationId)} borrowerName={memberName(loan.borrowerUid)}
 *            to={`/loans/${loan.id}`} />
 *   <LoanRow loan={loan} … onClick={() => openSheet(loan)} showBorrowedOn />
 *   // 一括返却で「外す」チェック付き（checked を渡すとチェックボックスとして振る舞う）
 *   <LoanRow loan={loan} … checked={selected.has(loan.id)} onClick={() => toggle(loan.id)} />
 * 行全体がボタン／リンクになるので、trailing にボタンは置かないこと。
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Loan } from '../types';
import { formatDate } from '../lib/date';
import { BookCover } from './BookCover';
import { DueBadge } from './DueBadge';
import { READ_STATUS_TEXT } from './ReadStatusPicker';
import { StarRating } from './ui/StarRating';
import { CheckIcon, ChevronRightIcon } from './ui/icons';
import styles from './LoanRow.module.css';

export type LoanRowProps = {
  loan: Loan;
  locationName: string;
  borrowerName: string;
  onClick?: () => void;
  /** リンク先（onClick より優先） */
  to?: string;
  /** 貸出中のとき返却日バッジを出す（既定 true） */
  showDue?: boolean;
  /** 借りた日を出す（履歴など） */
  showBorrowedOn?: boolean;
  /** 指定するとチェックボックスとして表示（一括返却の選択など） */
  checked?: boolean;
  /** 右端に追加で置く表示（ボタン以外） */
  trailing?: ReactNode;
  /** 判定の基準日（既定は今日） */
  today?: string;
  className?: string;
};

export function LoanRow({
  loan,
  locationName,
  borrowerName,
  onClick,
  to,
  showDue = true,
  showBorrowedOn = false,
  checked,
  trailing,
  today,
  className,
}: LoanRowProps) {
  const returned = loan.returnedOn != null;
  const selectable = checked !== undefined;
  const cls = [
    styles.row,
    to || onClick ? styles.interactive : '',
    selectable && !checked ? styles.unchecked : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const meta = [locationName, borrowerName].filter(Boolean).join(' · ');

  const content = (
    <>
      {selectable ? (
        <span className={[styles.check, checked ? styles.checkOn : ''].filter(Boolean).join(' ')} aria-hidden="true">
          {checked ? <CheckIcon size={16} strokeWidth={3} /> : null}
        </span>
      ) : null}
      <BookCover title={loan.book.title} coverUrl={loan.book.coverUrl} isbn={loan.book.isbn} size="sm" />
      <span className={styles.main}>
        <span className={styles.title}>{loan.book.title}</span>
        <span className={styles.meta}>
          {meta}
          {showBorrowedOn ? <span className={styles.borrowed}>{formatDate(loan.borrowedOn)}に借りた</span> : null}
        </span>
        {returned ? (
          <span className={styles.status}>
            <span className={styles.returned}>{formatDate(loan.returnedOn ?? '')}に返却</span>
            {loan.readStatus ? (
              <span className={[styles.readStatus, styles[loan.readStatus]].join(' ')}>
                {READ_STATUS_TEXT[loan.readStatus]}
              </span>
            ) : null}
            {loan.rating ? <StarRating value={loan.rating} size="sm" /> : null}
          </span>
        ) : showDue ? (
          <span className={styles.status}>
            <DueBadge dueOn={loan.dueOn} today={today} />
            <span className={styles.dueDate}>{formatDate(loan.dueOn)}まで</span>
          </span>
        ) : null}
      </span>
      {trailing != null && trailing !== false ? <span className={styles.trailing}>{trailing}</span> : null}
      {(to || onClick) && !selectable ? <ChevronRightIcon size={18} className={styles.chevron} /> : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={cls} onClick={onClick}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={onClick}
        role={selectable ? 'checkbox' : undefined}
        aria-checked={selectable ? checked : undefined}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={cls} role={selectable ? 'checkbox' : undefined} aria-checked={selectable ? checked : undefined}>
      {content}
    </div>
  );
}
