/*
 * 整数の入力。iPhone では数字キーボードが出る。空欄は null。全角数字も受け付ける。
 * min / max は入力欄から離れたときに丸める。stepper で −／＋ ボタンを出す。
 * 使い方:
 *   <NumberField label="貸出期間" value={days} onChange={setDays} min={1} max={365} suffix="日" stepper required />
 *   <NumberField label="巻数" value={volume} onChange={setVolume} min={1} suffix="巻" placeholder="なし" />
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { describedBy, Field, fieldStyles } from './Field';
import { MinusIcon, PlusIcon } from './icons';
import styles from './NumberField.module.css';

export type NumberFieldProps = {
  label: ReactNode;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 単位（「日」「巻」など） */
  suffix?: string;
  /** −／＋ ボタン */
  stepper?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  id?: string;
  name?: string;
  className?: string;
  autoFocus?: boolean;
};

function toText(value: number | null): string {
  return value == null || Number.isNaN(value) ? '' : String(value);
}

function parse(text: string): number | null {
  const digits = text.normalize('NFKC').replace(/[^0-9-]/g, '');
  if (digits === '' || digits === '-') return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min?: number, max?: number): number {
  let v = n;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  stepper = false,
  placeholder,
  hint,
  error,
  required,
  disabled,
  hideLabel,
  id: idProp,
  name,
  className,
  autoFocus,
}: NumberFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [text, setText] = useState(() => toText(value));

  // 外から値が変わったら表示を合わせる（入力途中の同じ値は保つ）
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : toText(value)));
  }, [value]);

  const handleChange = (raw: string) => {
    const normalized = raw.normalize('NFKC').replace(/[^0-9]/g, '');
    setText(normalized);
    onChange(parse(normalized));
  };

  const handleBlur = () => {
    const parsed = parse(text);
    if (parsed == null) return;
    const clamped = clamp(parsed, min, max);
    if (clamped !== parsed) onChange(clamped);
    setText(toText(clamped));
  };

  const bump = (delta: number) => {
    // 空欄からは最小値（無ければ 1）で始める
    const next = value == null ? clamp(min ?? 1, min, max) : clamp(value + delta, min, max);
    setText(toText(next));
    onChange(next);
  };

  return (
    <Field id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} required={required} className={className}>
      <div
        className={[fieldStyles.box, error ? fieldStyles.boxInvalid : '', disabled ? fieldStyles.boxDisabled : '']
          .filter(Boolean)
          .join(' ')}
      >
        {stepper ? (
          <button
            type="button"
            className={styles.step}
            onClick={() => bump(-step)}
            disabled={disabled || (value != null && min != null && value <= min)}
            aria-label="1 減らす"
          >
            <MinusIcon size={20} />
          </button>
        ) : null}
        <input
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className={[fieldStyles.control, stepper ? styles.centered : ''].filter(Boolean).join(' ')}
          value={text}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
        />
        {suffix ? <span className={`${fieldStyles.adornment} ${styles.suffix}`}>{suffix}</span> : null}
        {stepper ? (
          <button
            type="button"
            className={styles.step}
            onClick={() => bump(step)}
            disabled={disabled || (value != null && max != null && value >= max)}
            aria-label="1 増やす"
          >
            <PlusIcon size={20} />
          </button>
        ) : null}
      </div>
    </Field>
  );
}
