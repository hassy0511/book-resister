/*
 * LINE などのアプリ内ブラウザで開いているときの案内（招待リンクを LINE で受け取ったときなど）。
 *   - アプリ内ブラウザでは Google のログインができず、ホーム画面にも追加できない（通知を受け取れない）
 *   - メニューの「Safari で開く」（「ブラウザで開く」）を案内し、見つからなければ今のページのリンクをコピーできる
 * 使い方:
 *   const app = detectInAppBrowser();
 *   {app ? <InAppBrowserNotice appName={app} /> : null}
 * 招待リンクは /join/{code}?openExternalBrowser=1 なので、LINE からは通常 Safari で直接開く。これは
 * それが効かなかった場合（Facebook・Instagram など、LINE の設定や古い版）のための案内。
 */
import { useState } from 'react';
import { Button, Card } from './ui';
import { AlertIcon, CopyIcon } from './ui/icons';
import type { InAppBrowserName } from './inAppBrowser';
import styles from './InAppBrowserNotice.module.css';

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function currentUrl(): string {
  return typeof window !== 'undefined' ? window.location.href : '';
}

export type InAppBrowserNoticeProps = {
  appName: InAppBrowserName;
  className?: string;
};

export function InAppBrowserNotice({ appName, className }: InAppBrowserNoticeProps) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [url] = useState(currentUrl);

  const handleCopy = async () => {
    setCopy((await copyText(url)) ? 'copied' : 'failed');
  };

  return (
    <Card tone="warning" className={className} role="region" aria-label="Safari で開いてください">
      <div className={styles.body}>
        <p className={styles.title}>
          <AlertIcon size={20} className={styles.icon} />
          <span>{appName} の中のブラウザで開いています</span>
        </p>
        <p className={styles.text}>
          このままでは Google でログインできず、ホーム画面に追加して返却日の通知を受け取ることもできません。Safari
          で開き直してください。
        </p>
        <ol className={styles.steps}>
          <li>画面の右下か右上にあるメニュー（「…」や共有のボタン）をタップ</li>
          <li>「Safari で開く」（または「ブラウザで開く」）を選ぶ</li>
        </ol>
        <p className={styles.text}>メニューが見つからないときは、リンクをコピーして Safari のアドレス欄に貼り付けてください。</p>
        <Button variant="secondary" size="sm" icon={<CopyIcon />} onClick={() => void handleCopy()} className={styles.copy}>
          このページのリンクをコピー
        </Button>
        {copy === 'copied' ? (
          <p className={styles.status} role="status">
            コピーしました。Safari を開いて、アドレス欄に貼り付けてください。
          </p>
        ) : copy === 'failed' ? (
          <div className={styles.status} role="status">
            <p>コピーできませんでした。下のリンクを長押ししてコピーしてください。</p>
            <input
              className={styles.url}
              value={url}
              readOnly
              aria-label="このページのリンク"
              onFocus={(e) => e.currentTarget.setSelectionRange(0, e.currentTarget.value.length)}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
