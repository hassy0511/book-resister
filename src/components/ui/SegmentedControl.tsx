/*
 * 2〜4 択の切り替え（iOS のセグメント）。role="radiogroup"。左右キーでも動く。
 * 使い方:
 *   <SegmentedControl ariaLabel="モード" value={mode} onChange={setMode}
 *     options={[{ value: 'borrow', label: '借りる' }, { value: 'check', label: '確認' }]} />
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './SegmentedControl.module.css';

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** label が文字列でない場合の読み上げ用 */
  ariaLabel?: string;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  ariaLabel: string;
  size?: 'md' | 'lg';
  /** 色付きの選択状態（ReadStatusPicker などで使う） */
  tone?: 'default' | 'primary';
  className?: string;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  tone = 'default',
  className,
  disabled = false,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    for (let i = 1; i <= options.length; i += 1) {
      const next = (index + dir * i + options.length) % options.length;
      if (!options[next].disabled) {
        onChange(options[next].value);
        refs.current[next]?.focus();
        break;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={[styles.group, styles[size], styles[tone], className ?? ''].filter(Boolean).join(' ')}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel}
            tabIndex={selected ? 0 : -1}
            disabled={disabled || o.disabled}
            className={[styles.segment, selected ? styles.selected : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon ? <span className={styles.icon}>{o.icon}</span> : null}
            <span className={styles.label}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
