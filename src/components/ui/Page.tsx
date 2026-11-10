/*
 * 画面の外枠: PageHeader ＋ スクロール領域 ＋（任意で）下部に固定する操作エリア。
 * 高さは親いっぱい（AppLayout / #root が flex の縦並び）。スクロールはこの中の領域で行う。
 * セーフエリア（ノッチ・ホームバー）と下部タブの有無を自動で考慮する。
 * 使い方:
 *   <Page title="履歴" large>…</Page>
 *   <Page title="借りる本の確認" back="/scan?mode=borrow"
 *         footer={<Button block size="lg" onClick={submit}>3冊を登録</Button>}>
 *     …
 *   </Page>
 *   <Page title="スキャン" hideTabBar padded={false}>…</Page>
 */
import { useEffect, type ReactNode } from 'react';
import { useHideTabBar } from '../layout/tabBarVisibility';
import { PageHeader, type BackTarget } from './PageHeader';
import styles from './Page.module.css';

const APP_NAME = 'かりた本ノート';

export type PageProps = {
  /** ヘッダーのタイトル（ブラウザのタイトルにも使う）。header も title も無ければヘッダーなし */
  title?: string;
  subtitle?: ReactNode;
  back?: BackTarget;
  right?: ReactNode;
  /** 大きいタイトルのヘッダー */
  large?: boolean;
  /** ヘッダーを丸ごと差し替える */
  header?: ReactNode;
  /** スクロール領域の下に固定表示する操作エリア（主要ボタンなど） */
  footer?: ReactNode;
  /** スクロール領域の内側の余白（既定 true） */
  padded?: boolean;
  /** この画面では下部タブを隠す */
  hideTabBar?: boolean;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
};

export function Page({
  title,
  subtitle,
  back,
  right,
  large,
  header,
  footer,
  padded = true,
  hideTabBar = false,
  className,
  contentClassName,
  children,
}: PageProps) {
  useHideTabBar(hideTabBar);

  useEffect(() => {
    document.title = title ? `${title} | ${APP_NAME}` : APP_NAME;
  }, [title]);

  const hasHeader = Boolean(header) || Boolean(title) || Boolean(back) || Boolean(right);

  return (
    <div className={[styles.page, className ?? ''].filter(Boolean).join(' ')}>
      {header ??
        (hasHeader ? <PageHeader title={title} subtitle={subtitle} back={back} right={right} large={large} /> : null)}
      {!hasHeader ? <div className={styles.safeTop} /> : null}
      <main
        className={[
          styles.content,
          padded ? styles.padded : '',
          footer ? '' : styles.bottomInset,
          contentClassName ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </main>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}
