/*
 * 画面上部のヘッダー（セーフエリア対応）。通常は Page 経由で使う。
 * back:
 *   true          … 履歴を 1 つ戻る（アプリ内の履歴が無ければ "/" へ）
 *   "/settings"   … 履歴を 1 つ戻る（アプリ内の履歴が無ければこの URL へ）
 *   () => void    … 戻るボタンで呼ぶ
 * 使い方:
 *   <PageHeader title="場所の管理" back="/settings" right={<IconButton label="追加" icon={<PlusIcon />} />} />
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeftIcon } from './icons';
import styles from './PageHeader.module.css';

export type BackTarget = boolean | string | (() => void);

export type PageHeaderProps = {
  title?: ReactNode;
  /** タイトルの下の小さい文字 */
  subtitle?: ReactNode;
  back?: BackTarget;
  /** 戻るボタンの文言（読み上げ用。既定「戻る」） */
  backLabel?: string;
  /** 右側（IconButton・Button など） */
  right?: ReactNode;
  /** 大きいタイトル（ホームなどタブ直下の画面向け） */
  large?: boolean;
  className?: string;
};

/** アプリ内で戻れる履歴があるか（react-router が history.state.idx を持つ） */
function canGoBack(): boolean {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && 'idx' in state) {
    const idx = (state as { idx: unknown }).idx;
    return typeof idx === 'number' && idx > 0;
  }
  return false;
}

export function PageHeader({ title, subtitle, back, backLabel = '戻る', right, large = false, className }: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (typeof back === 'function') {
      back();
      return;
    }
    if (canGoBack()) {
      navigate(-1);
    } else {
      navigate(typeof back === 'string' ? back : '/', { replace: true });
    }
  };

  return (
    <header className={[styles.header, large ? styles.large : '', className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.bar}>
        {back ? (
          <button type="button" className={styles.back} onClick={handleBack} aria-label={backLabel}>
            <ChevronLeftIcon size={26} />
          </button>
        ) : (
          <span className={styles.spacer} />
        )}
        <div className={styles.titles}>
          {title ? <h1 className={styles.title}>{title}</h1> : null}
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        {right ? <div className={styles.right}>{right}</div> : null}
      </div>
    </header>
  );
}
