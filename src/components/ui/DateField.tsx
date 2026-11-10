/*
 * 日付の入力（<input type="date">）。値は 'YYYY-MM-DD'。右側に「11月8日(土)」のような曜日付き表示を出す。
 * 使い方:
 *   <DateField label="借りた日" value={borrowedOn} onChange={setBorrowedOn} max={todayString()} />
 *   <DateField label="返却日" value={dueOn} onChange={setDueOn} min={borrowedOn} hint="場所の既定は14日" />
 */
import { useId, type ReactNode } from 'react';
import type { DateString } from '../../types';
import { formatDate } from '../../lib/date';
import { CalendarIcon } from './icons';
import { describedBy, Field, fieldStyles } from './Field';
import styles from './DateField.module.css';

export type DateFieldProps = {
  label: ReactNode;
  /** 'YYYY-MM-DD'（未入力は ''） */
  value: DateString;
  onChange: (value: DateString) => void;
  min?: DateString;
  max?: DateString;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  /** 曜日付きの日付を右側に出す（既定 true） */
  showFormatted?: boolean;
  id?: string;
  name?: string;
  className?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
  error,
  required,
  disabled,
  hideLabel,
  showFormatted = true,
  id: idProp,
  name,
  className,
}: DateFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const formatted = showFormatted && DATE_RE.test(value) ? formatDate(value) : null;

  return (
    <Field id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} required={required} className={className}>
      <div
        className={[fieldStyles.box, error ? fieldStyles.boxInvalid : '', disabled ? fieldStyles.boxDisabled : '']
          .filter(Boolean)
          .join(' ')}
      >
        <span className={`${fieldStyles.adornment} ${fieldStyles.leadingAdornment}`}>
          <CalendarIcon size={20} />
        </span>
        <input
          id={id}
          name={name}
          type="date"
          className={`${fieldStyles.control} ${styles.date}`}
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
        />
        {formatted ? (
          <span className={`${fieldStyles.adornment} ${styles.formatted}`} aria-hidden="true">
            {formatted}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
