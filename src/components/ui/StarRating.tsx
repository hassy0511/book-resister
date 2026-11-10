/*
 * ★1〜5 の評価。onChange を渡すと入力、渡さなければ表示のみ。
 * 入力時は同じ★をもう一度押すと未評価（null）に戻る。
 * 使い方:
 *   <StarRating value={rating} onChange={setRating} />
 *   <StarRating value={loan.rating} size="sm" />          // 表示のみ
 */
import { StarFilledIcon, StarIcon } from './icons';
import styles from './StarRating.module.css';

export type StarRatingProps = {
  value: number | null;
  onChange?: (value: number | null) => void;
  size?: 'sm' | 'md' | 'lg';
  /** 読み上げ用のラベル（既定「評価」） */
  label?: string;
  disabled?: boolean;
  className?: string;
};

const STARS = [1, 2, 3, 4, 5] as const;
const ICON_SIZE = { sm: 16, md: 28, lg: 34 } as const;

export function StarRating({ value, onChange, size = 'md', label = '評価', disabled = false, className }: StarRatingProps) {
  const current = value ?? 0;
  const iconSize = ICON_SIZE[size];

  if (!onChange) {
    return (
      <span
        role="img"
        aria-label={value ? `${label} ${value} / 5` : `${label}なし`}
        className={[styles.display, styles[size], className ?? ''].filter(Boolean).join(' ')}
      >
        {STARS.map((n) =>
          n <= current ? (
            <StarFilledIcon key={n} size={iconSize} className={styles.on} />
          ) : (
            <StarIcon key={n} size={iconSize} className={styles.off} />
          ),
        )}
      </span>
    );
  }

  return (
    <div role="radiogroup" aria-label={label} className={[styles.input, styles[size], className ?? ''].filter(Boolean).join(' ')}>
      {STARS.map((n) => {
        const on = n <= current;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`★${n}`}
            disabled={disabled}
            className={styles.star}
            onClick={() => onChange(value === n ? null : n)}
          >
            {on ? (
              <StarFilledIcon size={iconSize} className={styles.on} />
            ) : (
              <StarIcon size={iconSize} className={styles.off} />
            )}
          </button>
        );
      })}
      {value != null && !disabled ? (
        <button type="button" className={styles.clear} onClick={() => onChange(null)}>
          クリア
        </button>
      ) : null}
    </div>
  );
}
