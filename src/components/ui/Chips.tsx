/*
 * 絞り込み用のチップ（横スクロール、単一選択）。選択中のチップをもう一度押すと解除（null）。
 * allLabel を渡すと先頭に「すべて」チップを置く（value === null で選択状態）。
 * 使い方:
 *   <Chips ariaLabel="場所で絞り込み" allLabel="すべての場所"
 *     value={locationId} onChange={setLocationId}
 *     options={locations.map((l) => ({ value: l.id, label: l.name, count: countByLocation[l.id] }))} />
 */
import type { ReactNode } from 'react';
import styles from './Chips.module.css';

export type ChipOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** 件数バッジ */
  count?: number;
};

export type ChipsProps<T extends string> = {
  options: ChipOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  ariaLabel: string;
  /** 「すべて」チップの文言（指定時のみ表示） */
  allLabel?: string;
  /** 折り返して並べる（既定は横スクロール） */
  wrap?: boolean;
  className?: string;
};

export function Chips<T extends string>({ options, value, onChange, ariaLabel, allLabel, wrap = false, className }: ChipsProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={[styles.chips, wrap ? styles.wrap : styles.scroll, className ?? ''].filter(Boolean).join(' ')}
    >
      {allLabel ? (
        <button
          type="button"
          className={[styles.chip, value === null ? styles.selected : ''].filter(Boolean).join(' ')}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          {allLabel}
        </button>
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={[styles.chip, selected ? styles.selected : ''].filter(Boolean).join(' ')}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : o.value)}
          >
            <span className={styles.label}>{o.label}</span>
            {o.count != null ? <span className={styles.count}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
