/*
 * 入力欄の共通の枠（ラベル・補足・エラー）。TextField / NumberField / DateField / Select が内部で使う。
 * 独自の入力部品を作るときにも使える:
 *   <Field id={id} label="色" hint="任意">…<input id={id} className={fieldStyles.control} />…</Field>
 */
import type { ReactNode } from 'react';
import styles from './Field.module.css';

export { styles as fieldStyles };

export type FieldProps = {
  id: string;
  label: ReactNode;
  /** ラベルを画面に出さない（読み上げ用には残す） */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

export function hintId(id: string) {
  return `${id}-hint`;
}

export function errorId(id: string) {
  return `${id}-error`;
}

/** aria-describedby に入れる ID */
export function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? hintId(id) : null, error ? errorId(id) : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function Field({ id, label, hideLabel = false, hint, error, required = false, className, children }: FieldProps) {
  return (
    <div className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
        {required ? <span className={styles.required}>必須</span> : null}
      </label>
      {children}
      {error ? (
        <p id={errorId(id)} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId(id)} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
