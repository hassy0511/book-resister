/*
 * 評価（★1〜5）と感想の入力。どちらも任意。保存時は reviewToPatch で Loan の形に直す。
 * 使い方:
 *   const [review, setReview] = useState<ReviewValue>(() => reviewFromLoan(loan));   // 新規なら EMPTY_REVIEW
 *   <ReviewEditor value={review} onChange={setReview} />
 *   await updateLoan(groupId, loan.id, reviewToPatch(review));   // { rating, review: 空なら null }
 */
import { useId } from 'react';
import type { Loan } from '../types';
import { StarRating } from './ui/StarRating';
import { TextArea } from './ui/TextField';
import styles from './ReviewEditor.module.css';

export type ReviewValue = {
  rating: number | null;
  review: string;
};

export const EMPTY_REVIEW: ReviewValue = { rating: null, review: '' };

export function reviewFromLoan(loan: Pick<Loan, 'rating' | 'review'>): ReviewValue {
  return { rating: loan.rating ?? null, review: loan.review ?? '' };
}

/** 保存用（前後の空白を除き、空の感想は null） */
export function reviewToPatch(value: ReviewValue): { rating: number | null; review: string | null } {
  const text = value.review.trim();
  return { rating: value.rating, review: text === '' ? null : text };
}

export type ReviewEditorProps = {
  value: ReviewValue;
  onChange: (value: ReviewValue) => void;
  disabled?: boolean;
  /** 感想欄のプレースホルダ */
  placeholder?: string;
  /** 見出しを出さない（Sheet のタイトルで足りる場合など） */
  hideHeading?: boolean;
  className?: string;
};

export function ReviewEditor({
  value,
  onChange,
  disabled = false,
  placeholder = 'おもしろかったところ、子どもの反応など',
  hideHeading = false,
  className,
}: ReviewEditorProps) {
  const headingId = useId();
  return (
    <div className={[styles.editor, className ?? ''].filter(Boolean).join(' ')} role="group" aria-labelledby={headingId}>
      <p id={headingId} className={hideHeading ? 'visually-hidden' : styles.heading}>
        評価と感想<span className={styles.optional}>（任意）</span>
      </p>
      <StarRating value={value.rating} onChange={(rating) => onChange({ ...value, rating })} disabled={disabled} />
      <TextArea
        label="感想"
        hideLabel
        value={value.review}
        onChange={(review) => onChange({ ...value, review })}
        placeholder={placeholder}
        rows={3}
        maxLength={2000}
        disabled={disabled}
      />
    </div>
  );
}
