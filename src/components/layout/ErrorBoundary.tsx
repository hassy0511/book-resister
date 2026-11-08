/*
 * 描画中の予期しないエラーを受け止めて「再読み込み」を案内する。
 * 新しいバージョンの公開後に古い画面ファイル（チャンク）が読めない場合も、再読み込みで直る旨を出す。
 * ルーターの外でも使えるよう、react-router のフックは使わない。
 * 使い方: <ErrorBoundary><App /></ErrorBoundary>
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { AlertIcon } from '../ui/icons';
import styles from './ErrorBoundary.module.css';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** 画面ファイルの読み込み失敗（デプロイ直後・オフライン）か */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|ChunkLoadError/i.test(
    `${error.name} ${error.message}`,
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    window.location.assign('/');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunk = isChunkLoadError(error);
    return (
      <div className={styles.screen} role="alert">
        <div className={styles.icon} aria-hidden="true">
          <AlertIcon size={32} />
        </div>
        <h1 className={styles.title}>{chunk ? '画面を読み込めませんでした' : '問題が発生しました'}</h1>
        <p className={styles.message}>
          {chunk
            ? 'アプリが更新されたか、電波が弱い可能性があります。再読み込みしてください。'
            : '申し訳ありません。再読み込みしても直らない場合は、ホームに戻ってやり直してください。'}
        </p>
        {!chunk && error.message ? <p className={styles.detail}>{error.message}</p> : null}
        <div className={styles.actions}>
          <Button block size="lg" onClick={this.reload}>
            再読み込み
          </Button>
          <Button block variant="secondary" onClick={this.goHome}>
            ホームに戻る
          </Button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
