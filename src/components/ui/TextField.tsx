/*
 * 1 行の文字入力（TextField）と複数行（TextArea）。onChange は「値」を受け取る（イベントではない）。
 * 文字は 16px 以上（iOS の入力時ズーム防止）。
 * 使い方:
 *   <TextField label="名前" value={name} onChange={setName} required />
 *   <TextField label="メールアドレス" type="email" autoComplete="email" value={email} onChange={setEmail} />
 *   <TextField label="検索" hideLabel type="search" leading={<SearchIcon size={20} />} clearable
 *              placeholder="タイトル・著者" value={q} onChange={setQ} />
 *   <TextArea label="メモ" value={memo} onChange={setMemo} rows={3} />
 */
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { describedBy, Field, fieldStyles } from './Field';
import { CloseIcon } from './icons';
import styles from './TextField.module.css';

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size' | 'type'> & {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel';
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
  /** 入力欄の左側（検索アイコンなど） */
  leading?: ReactNode;
  /** 入力欄の右側（単位など） */
  trailing?: ReactNode;
  /** 値があるとき × ボタンで消せる */
  clearable?: boolean;
  /** 外枠の className */
  className?: string;
};

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  hideLabel,
  leading,
  trailing,
  clearable = false,
  required,
  disabled,
  id: idProp,
  className,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <Field id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} required={required} className={className}>
      <div
        className={[fieldStyles.box, error ? fieldStyles.boxInvalid : '', disabled ? fieldStyles.boxDisabled : '']
          .filter(Boolean)
          .join(' ')}
      >
        {leading ? <span className={`${fieldStyles.adornment} ${fieldStyles.leadingAdornment}`}>{leading}</span> : null}
        <input
          id={id}
          type={type}
          className={[fieldStyles.control, type === 'search' ? styles.search : ''].filter(Boolean).join(' ')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          {...rest}
        />
        {clearable && value && !disabled ? (
          <button type="button" className={styles.clear} onClick={() => onChange('')} aria-label="入力を消す">
            <CloseIcon size={16} />
          </button>
        ) : null}
        {trailing ? <span className={fieldStyles.adornment}>{trailing}</span> : null}
      </div>
    </Field>
  );
}

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
  className?: string;
};

export function TextArea({
  label,
  value,
  onChange,
  hint,
  error,
  hideLabel,
  required,
  disabled,
  rows = 4,
  id: idProp,
  className,
  ...rest
}: TextAreaProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <Field id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} required={required} className={className}>
      <div
        className={[fieldStyles.box, error ? fieldStyles.boxInvalid : '', disabled ? fieldStyles.boxDisabled : '']
          .filter(Boolean)
          .join(' ')}
      >
        <textarea
          id={id}
          className={fieldStyles.control}
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          {...rest}
        />
      </div>
    </Field>
  );
}
