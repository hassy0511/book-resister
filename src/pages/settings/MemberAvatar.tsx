/*
 * 名前の頭文字を丸の中に出すアバター（設定画面・メンバー一覧で使う）。
 */
import styles from './MemberAvatar.module.css';

export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '？';
}

export function MemberAvatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span className={[styles.avatar, styles[size]].join(' ')} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}
