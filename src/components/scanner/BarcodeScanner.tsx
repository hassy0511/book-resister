/*
 * 書籍バーコードのスキャナ（カメラ映像＋ガイド枠＋ライト切替＋ISBN 手入力）。
 *
 * 使い方:
 *   import { BarcodeScanner } from '../../components/scanner/BarcodeScanner';
 *   <BarcodeScanner onDetect={(isbn13) => cart.addIsbn(isbn13)} active={!sheetOpen} />
 *
 * Props:
 *   onDetect(isbn13)    書籍の ISBN-13（978/979 で始まりチェックディジットが正しいもの）を読み取った／手入力したとき。
 *                       192 で始まる価格コード（2 段目）などは渡さない。同じコードの連続検出は 2.5 秒間抑制する。
 *                       カメラが映り続けている間は 1 回だけ呼ばれる（いったん外れて 2.5 秒たてば再び呼ばれる）。
 *   active              false でカメラを止める（track.stop()）。アンマウント時・ページ非表示時も止め、表示に戻れば再開する。
 *   guideText?          ガイド枠の下の文言（既定「バーコードを枠に合わせてください」）
 *   manualSubmitLabel?  手入力欄のボタンの文言（既定「決定」）
 *   className?          外枠に付ける class。CSS 変数で見た目を変えられる:
 *                         --scanner-aspect（映像の縦横比。既定 4 / 3）、--scanner-max-height（既定 60dvh）、
 *                         --scanner-radius（映像の角丸。既定 0）、--scanner-gutter（案内・手入力欄の左右余白。既定 --page-gutter）
 *                       映像は横幅いっぱいに表示する想定（ページの左右余白の外に置く）。
 *
 * カメラが使えない（許可が拒否された・カメラが無い・非対応）ときは、日本語の案内と ISBN の手入力欄を表示する。
 * 手入力欄はカメラが動いているときも「ISBN を手入力」から開ける。
 */
import { useCallback, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatIsbn } from '../../lib/isbn';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { AlertIcon, CameraIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, KeyboardIcon, RefreshIcon } from '../ui/icons';
import { ManualIsbnForm } from './ManualIsbnForm';
import { computeScanBand } from './scannerLogic';
import { useBarcodeScanner, type ScannerStatus } from './useBarcodeScanner';
import styles from './BarcodeScanner.module.css';

export type BarcodeScannerProps = {
  onDetect: (isbn13: string) => void;
  active: boolean;
  guideText?: string;
  manualSubmitLabel?: string;
  className?: string;
};

/** カメラの代わりに案内を出す状態 */
type HelpStatus = Extract<ScannerStatus, 'denied' | 'no-camera' | 'in-use' | 'unsupported' | 'insecure' | 'error'>;

const HELP_TEXT: Record<HelpStatus, { title: string; body: string; retry: boolean }> = {
  denied: {
    title: 'カメラの使用が許可されていません',
    body: 'バーコードを読み取るには、このアプリにカメラの使用を許可してください。',
    retry: true,
  },
  'no-camera': {
    title: 'カメラが見つかりません',
    body: 'この端末で使えるカメラが見つかりませんでした。下の欄に ISBN を入力してください。',
    retry: true,
  },
  'in-use': {
    title: 'カメラを起動できませんでした',
    body: 'ほかのアプリや画面がカメラを使っている可能性があります。それらを閉じてから「もう一度試す」を押してください。',
    retry: true,
  },
  unsupported: {
    title: 'この画面ではカメラを使えません',
    body: 'お使いのブラウザはカメラでの読み取りに対応していません。iPhone では Safari か、ホーム画面に追加したアプリから開いてください（LINE などのアプリ内で開いた画面では使えないことがあります）。',
    retry: false,
  },
  insecure: {
    title: 'カメラを使うには https での接続が必要です',
    body: 'アドレスが「https://」で始まる URL で開き直してください。',
    retry: false,
  },
  error: {
    title: 'カメラを起動できませんでした',
    body: 'もう一度試してください。直らない場合は、下の欄に ISBN を入力してください。',
    retry: true,
  },
};

function isHelpStatus(s: ScannerStatus): s is HelpStatus {
  return s in HELP_TEXT;
}

/** ライト（懐中電灯）のアイコン */
function TorchIcon({ on }: { on: boolean }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 2h10v4l-2 4v10a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V10L7 6z" fill={on ? 'currentColor' : 'none'} />
      <path d="M7 6h10" />
      {on ? null : <path d="M3 3l18 18" />}
    </svg>
  );
}

function CameraHelp({ status, onRetry }: { status: HelpStatus; onRetry: () => void }) {
  const text = HELP_TEXT[status];
  return (
    <div className={styles.help} role="alert">
      <div className={styles.helpHeader}>
        <AlertIcon size={22} className={styles.helpIcon} />
        <h2 className={styles.helpTitle}>{text.title}</h2>
      </div>
      <p className={styles.helpBody}>{text.body}</p>
      {status === 'denied' ? (
        <>
          <p className={styles.helpSubTitle}>iPhone の場合</p>
          <ol className={styles.helpSteps}>
            <li>「設定」アプリを開き、「Safari」を開きます（iOS 18 以降は「アプリ」→「Safari」）。</li>
            <li>「Web サイトの設定」の「カメラ」をタップし、「確認」または「許可」を選びます。</li>
            <li>このアプリに戻って「もう一度試す」を押します。カメラの確認が出ないときは「再読み込み」を押してください。</li>
          </ol>
          <p className={styles.helpNote}>
            Safari で開いている場合は、アドレスバーの左端のボタン（「ぁあ」）→「Web サイトの設定」→「カメラ」を「許可」にしても変更できます。
          </p>
        </>
      ) : null}
      {text.retry ? (
        <div className={styles.helpActions}>
          <Button variant="secondary" icon={<CameraIcon />} onClick={onRetry}>
            もう一度試す
          </Button>
          {status === 'denied' ? (
            <Button variant="ghost" icon={<RefreshIcon />} onClick={() => window.location.reload()}>
              再読み込み
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BarcodeScanner({
  onDetect,
  active,
  guideText = 'バーコードを枠に合わせてください',
  manualSubmitLabel = '決定',
  className,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const guideRef = useRef<HTMLDivElement | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const manualInputId = useId();

  // 画面上のガイド枠に対応するフレームの行だけを読む
  const getScanBand = useCallback((frameWidth: number, frameHeight: number) => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide) return null;
    return computeScanBand({
      frameWidth,
      frameHeight,
      viewport: video.getBoundingClientRect(),
      guide: guide.getBoundingClientRect(),
    });
  }, []);

  const { status, torch, feedback, restart } = useBarcodeScanner({ active, onDetect, videoRef, getScanBand });

  // iOS は muted 属性が無いと自動再生しないことがあるため、属性としても付ける
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) {
      el.muted = true;
      el.setAttribute('muted', '');
      el.setAttribute('playsinline', '');
    }
  }, []);

  const help = isHelpStatus(status) ? status : null;
  const scanning = status === 'scanning';
  const showManual = help !== null || manualOpen;

  const openManual = () => {
    // iOS でキーボードを出すため、タップの処理の中で描画してフォーカスする
    flushSync(() => setManualOpen(true));
    document.getElementById(manualInputId)?.focus();
  };

  return (
    <div className={[styles.root, className ?? ''].filter(Boolean).join(' ')}>
      <div className={[styles.viewport, help ? styles.viewportHidden : ''].filter(Boolean).join(' ')}>
        <video ref={setVideo} className={styles.video} playsInline muted autoPlay disablePictureInPicture aria-hidden="true" />

        <div className={styles.overlay}>
          <div
            ref={guideRef}
            className={[styles.guide, feedback?.flashing ? styles.guideDetected : ''].filter(Boolean).join(' ')}
          >
            <span aria-hidden="true" className={`${styles.corner} ${styles.cornerTL}`} />
            <span aria-hidden="true" className={`${styles.corner} ${styles.cornerTR}`} />
            <span aria-hidden="true" className={`${styles.corner} ${styles.cornerBL}`} />
            <span aria-hidden="true" className={`${styles.corner} ${styles.cornerBR}`} />
            {scanning && !feedback?.flashing ? <span aria-hidden="true" className={styles.scanLine} /> : null}
            {feedback?.flashing ? <span aria-hidden="true" key={`flash-${feedback.count}`} className={styles.flash} /> : null}
            {/* 読み取った直後は案内文の位置に結果を出す */}
            {feedback && scanning ? (
              <p key={`label-${feedback.count}`} className={`${styles.guideText} ${styles.detectedLabel}`} aria-hidden="true">
                <CheckIcon size={16} />
                読み取りました：{formatIsbn(feedback.code)}
              </p>
            ) : scanning ? (
              <p className={styles.guideText}>{guideText}</p>
            ) : null}
          </div>
        </div>

        {status === 'starting' ? (
          <div className={styles.statusLayer}>
            <Spinner size="lg" label="カメラを起動しています" />
            <p aria-hidden="true">カメラを起動しています…</p>
          </div>
        ) : null}
        {status === 'idle' ? (
          <div className={styles.statusLayer}>
            <CameraIcon size={32} />
            <p>カメラは一時停止中です</p>
          </div>
        ) : null}
        {status === 'interrupted' ? (
          <div className={styles.statusLayer}>
            <p>カメラが止まりました</p>
            <Button variant="secondary" size="sm" icon={<CameraIcon />} onClick={restart}>
              カメラを再開
            </Button>
          </div>
        ) : null}

        {torch.supported ? (
          <button
            type="button"
            className={[styles.torchButton, torch.on ? styles.torchOn : ''].filter(Boolean).join(' ')}
            onClick={torch.toggle}
            aria-pressed={torch.on}
            aria-label={torch.on ? 'ライトを消す' : 'ライトをつける'}
          >
            <TorchIcon on={torch.on} />
          </button>
        ) : null}

        {/* 読み上げ用 */}
        <div className="visually-hidden" role="status" aria-live="polite">
          {feedback ? `読み取りました：${formatIsbn(feedback.code)}` : ''}
        </div>
      </div>

      {help ? <CameraHelp status={help} onRetry={restart} /> : null}

      <div className={[styles.manual, help ? styles.manualProminent : ''].filter(Boolean).join(' ')}>
        {help ? (
          <p className={styles.manualTitle}>
            <KeyboardIcon size={20} />
            ISBN を手入力
          </p>
        ) : (
          <button
            type="button"
            className={styles.manualToggle}
            aria-expanded={manualOpen}
            onClick={() => (manualOpen ? setManualOpen(false) : openManual())}
          >
            <KeyboardIcon size={20} />
            <span>ISBN を手入力</span>
            {manualOpen ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
          </button>
        )}
        {showManual ? <ManualIsbnForm onSubmit={onDetect} submitLabel={manualSubmitLabel} inputId={manualInputId} /> : null}
      </div>
    </div>
  );
}

export default BarcodeScanner;
