/*
 * 起動時（ログイン状態・グループの読み込み中）の全画面表示。
 * 使い方: if (loading) return <SplashScreen />;
 */
import { BookIcon } from '../ui/icons';
import { Spinner } from '../ui/Spinner';
import styles from './SplashScreen.module.css';

export type SplashScreenProps = {
  /** スピナーの下に出す文言（任意） */
  message?: string;
};

export function SplashScreen({ message }: SplashScreenProps) {
  return (
    <div className={styles.splash} aria-busy="true">
      <div className={styles.logo} aria-hidden="true">
        <BookIcon size={40} />
      </div>
      <p className={styles.name}>かりた本ノート</p>
      <Spinner size="md" label={message ?? '読み込み中'} showLabel={Boolean(message)} />
    </div>
  );
}

export default SplashScreen;
