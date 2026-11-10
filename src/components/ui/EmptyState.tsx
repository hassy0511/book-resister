/*
 * 空の状態・エラーの状態の表示。
 * 使い方:
 *   <EmptyState icon={<BookIcon />} title="借りている本はありません"
 *     description="スキャンして借りた本を登録しましょう"
 *     action={<LinkButton to="/scan?mode=borrow">本を借りる</LinkButton>} />
 *   {error ? <ErrorState error={error} onRetry={() => location.reload()} /> : null}
 */
import type { ReactNode } from 'react';
import { Button } from './Button';
import { AlertIcon } from './icons';
import styles from './EmptyState.module.css';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** ボタンなど */
  action?: ReactNode;
  /** 余白を小さくする（カードの中など） */
  compact?: boolean;
  className?: string;
};

export function EmptyState({ icon, title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={[styles.empty, compact ? styles.compact : '', className ?? ''].filter(Boolean).join(' ')}>
      {icon ? (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className={styles.title}>{title}</p>
      {description ? <div className={styles.description}>{description}</div> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

export type ErrorStateProps = {
  error: Error | string | null | undefined;
  title?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
};

/** Firebase の権限エラーなどを利用者向けの文に直す */
export function errorMessage(error: Error | string | null | undefined): string {
  if (!error) return '';
  const raw = typeof error === 'string' ? error : error.message;
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code.includes('permission-denied')) return 'このデータを見る権限がありません。';
  if (code.includes('unavailable') || /network|offline/i.test(raw)) {
    return 'ネットワークにつながっていないようです。電波のよい場所でもう一度お試しください。';
  }
  return raw;
}

export function ErrorState({ error, title = '読み込めませんでした', onRetry, compact, className }: ErrorStateProps) {
  return (
    <div role="alert">
      <EmptyState
        icon={<AlertIcon />}
        title={title}
        description={errorMessage(error) || undefined}
        action={
          onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              もう一度
            </Button>
          ) : undefined
        }
        compact={compact}
        className={[styles.error, className ?? ''].filter(Boolean).join(' ')}
      />
    </div>
  );
}
