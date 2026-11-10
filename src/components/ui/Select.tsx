/*
 * 選択欄（ネイティブの <select>。iPhone では下からホイールが出る）。onChange は値を受け取る。
 * 使い方:
 *   <Select label="場所" value={locationId} onChange={setLocationId}
 *           placeholder="選んでください"
 *           options={locations.map((l) => ({ value: l.id, label: l.name }))} />
 */
import { useId, type ReactNode } from 'react';
import { describedBy, Field, fieldStyles } from './Field';
import { ChevronDownIcon } from './icons';
import styles from './Select.module.css';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** 未選択（value === ''）のときの表示。指定すると先頭に空の選択肢を置く */
  placeholder?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  id?: string;
  name?: string;
  className?: string;
};

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  error,
  required,
  disabled,
  hideLabel,
  id: idProp,
  name,
  className,
}: SelectProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <Field id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} required={required} className={className}>
      <div
        className={[fieldStyles.box, error ? fieldStyles.boxInvalid : '', disabled ? fieldStyles.boxDisabled : '']
          .filter(Boolean)
          .join(' ')}
      >
        <select
          id={id}
          name={name}
          className={[fieldStyles.control, styles.select, value === '' ? styles.empty : ''].filter(Boolean).join(' ')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
        >
          {placeholder != null ? (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={20} className={styles.chevron} />
      </div>
    </Field>
  );
}
