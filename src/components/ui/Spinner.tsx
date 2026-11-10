/*
 * 読み込み中のくるくる。
 * 使い方:
 *   <Spinner />                       // インライン
 *   <Spinner center />                // 親の中央（一覧の読み込み中など）
 *   <Spinner size="lg" label="本を探しています" showLabel center />
 */
import styles from './Spinner.module.css';

export type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg';
  /** 読み上げ用の文言（showLabel で画面にも表示） */
  label?: string;
  showLabel?: boolean;
  /** 余白付きで中央に配置する */
  center?: boolean;
  className?: string;
};

export function Spinner({ size = 'md', label = '読み込み中', showLabel = false, center = false, className }: SpinnerProps) {
  const spinner = (
    <span
      role="status"
      aria-live="polite"
      className={[styles.wrap, center ? '' : className ?? ''].filter(Boolean).join(' ')}
    >
      <span className={[styles.spinner, styles[size]].join(' ')} aria-hidden="true" />
      {showLabel ? <span className={styles.label}>{label}</span> : <span className="visually-hidden">{label}</span>}
    </span>
  );
  if (!center) return spinner;
  return <div className={[styles.center, className ?? ''].filter(Boolean).join(' ')}>{spinner}</div>;
}
