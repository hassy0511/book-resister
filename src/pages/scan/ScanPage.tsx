/*
 * スキャン（F-20, F-21, F-80〜83）。カメラを大きく使うため下部タブは隠す。
 *   ?mode=borrow（既定）… 連続スキャン。読み取るたびにカートへ追加し、上に小さな通知、
 *                         下に読み取った本の表紙を並べる。「次へ（○冊）」で確認画面（/borrow/confirm）へ。
 *   ?mode=check        … 既読チェック。読み取ったらカメラを止めて結果シート（CheckResult）を出す。
 * モードを切り替えてもカメラは止めない（同じ BarcodeScanner を使い続ける）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookCover } from '../../components/BookCover';
import { BarcodeScanner } from '../../components/scanner';
import {
  Button,
  ConfirmDialog,
  IconButton,
  LinkButton,
  Page,
  SegmentedControl,
  Spinner,
  useToast,
  type SegmentOption,
} from '../../components/ui';
import { AlertIcon, CheckCircleIcon, ChevronLeftIcon, InfoIcon, KeyboardIcon } from '../../components/ui/icons';
import { isItemResolved, itemTitle, useBorrowCart, type CartItem } from '../../state/borrowCart';
import { CheckResultSheet } from './CheckResult';
import { parseScanMode, scanNoticeText, type ScanMode, type ScanNoticeKind } from './scanLogic';
import styles from './ScanPage.module.css';

const MODE_OPTIONS: SegmentOption<ScanMode>[] = [
  { value: 'borrow', label: '借りる' },
  { value: 'check', label: '借りたか確認' },
];

/** 通知を出しておく時間（ミリ秒） */
const NOTICE_MS = 3000;
const NOTICE_LOADING_MS = 10000;

/** アプリ内で戻れる履歴があるか（react-router が history.state.idx を持つ） */
function canGoBack(): boolean {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && 'idx' in state) {
    const idx = (state as { idx: unknown }).idx;
    return typeof idx === 'number' && idx > 0;
  }
  return false;
}

function ScanHeader({ mode, onModeChange }: { mode: ScanMode; onModeChange: (mode: ScanMode) => void }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (canGoBack()) navigate(-1);
    else navigate('/', { replace: true });
  };
  return (
    <header className={styles.header}>
      <div className={styles.headerBar}>
        <IconButton label="戻る" icon={<ChevronLeftIcon size={26} />} onClick={goBack} className={styles.back} />
        <h1 className="visually-hidden">スキャン</h1>
        <SegmentedControl
          ariaLabel="スキャンのモード"
          value={mode}
          onChange={onModeChange}
          options={MODE_OPTIONS}
          className={styles.modeSwitch}
        />
        <span className={styles.headerSpacer} aria-hidden="true" />
      </div>
    </header>
  );
}

type NoticeState = { kind: ScanNoticeKind; isbn: string; at: number };

export default function ScanPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const cart = useBorrowCart();
  const [params, setParams] = useSearchParams();
  const mode = parseScanMode(params.get('mode'));

  // 借りるモード
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CartItem | null>(null);
  // 確認モード
  const [checkIsbn, setCheckIsbn] = useState<string | null>(null);

  const setMode = (next: ScanMode) => {
    if (next === mode) return;
    setNotice(null);
    setCheckIsbn(null);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('mode', next);
        return p;
      },
      { replace: true },
    );
  };

  const { addIsbn } = cart;
  const handleDetect = useCallback(
    (isbn: string) => {
      if (mode === 'check') {
        setCheckIsbn(isbn);
        return;
      }
      const result = addIsbn(isbn);
      setNotice({ kind: result, isbn, at: Date.now() });
    },
    [mode, addIsbn],
  );

  // 通知の内容はカートの本の状態から作る（取得が終わればタイトルに変わる）
  const noticeItem = notice ? (cart.items.find((i) => i.key === notice.isbn || i.isbn === notice.isbn) ?? null) : null;
  const noticeView = notice ? scanNoticeText(notice.kind, noticeItem) : null;
  const noticeMessage = noticeView?.message ?? null;
  const noticeLoading = noticeView?.loading ?? false;
  useEffect(() => {
    if (!noticeMessage) return undefined;
    const timer = window.setTimeout(() => setNotice(null), noticeLoading ? NOTICE_LOADING_MS : NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [noticeMessage, noticeLoading, notice?.at]);

  const active = mode === 'check' ? checkIsbn === null : removeTarget === null;
  const count = cart.items.length;
  // 新しく読み取った本を左に
  const thumbs = [...cart.items].reverse();

  const tray =
    mode === 'borrow' ? (
      <div className={styles.tray}>
        <div className={styles.trayHeader}>
          <p className={styles.trayTitle}>
            読み取った本 <strong className={styles.trayCount}>{count}</strong>冊
          </p>
          <LinkButton to="/borrow/add" variant="ghost" size="sm" icon={<KeyboardIcon />} className={styles.addLink}>
            バーコードがない本はこちら
          </LinkButton>
        </div>
        {count > 0 ? (
          <ul className={styles.thumbs} aria-label="読み取った本（タップでリストから外せます）">
            {thumbs.map((item) => {
              const title = itemTitle(item);
              const unresolved = item.status === 'not-found' && !isItemResolved(item);
              return (
                <li key={item.key} className={styles.thumbItem}>
                  <button
                    type="button"
                    className={styles.thumb}
                    onClick={() => setRemoveTarget(item)}
                    aria-label={`${title ?? (item.status === 'loading' ? '取得中の本' : 'タイトル不明の本')}（タップで外す）`}
                  >
                    <BookCover title={title ?? '本'} coverUrl={item.candidate?.coverUrl} size="sm" />
                    {item.status === 'loading' ? (
                      <span className={styles.thumbOverlay}>
                        <Spinner size="sm" label="取得中" />
                      </span>
                    ) : null}
                    {unresolved ? (
                      <span className={styles.thumbBadge} aria-hidden="true">
                        ?
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.trayEmpty}>本の裏のバーコード（978 で始まる方）を読み取ると、ここに並びます</p>
        )}
        <Button size="lg" block disabled={count === 0} onClick={() => navigate('/borrow/confirm')}>
          次へ（{count}冊）
        </Button>
      </div>
    ) : undefined;

  const removeTitle = removeTarget ? (itemTitle(removeTarget) ?? 'この本') : '';

  return (
    <Page
      title="スキャン"
      header={<ScanHeader mode={mode} onModeChange={setMode} />}
      padded={false}
      hideTabBar
      footer={tray}
      contentClassName={styles.content}
    >
      <div className={styles.cameraArea}>
        <BarcodeScanner
          onDetect={handleDetect}
          active={active}
          className={mode === 'check' ? styles.scannerCheck : styles.scannerBorrow}
          manualSubmitLabel={mode === 'check' ? '確認する' : '追加する'}
        />
        {mode === 'borrow' && noticeView ? (
          <div
            key={notice?.at}
            className={[
              styles.notice,
              noticeView.tone === 'warning' ? styles.noticeWarning : '',
              noticeView.tone === 'info' ? styles.noticeInfo : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="status"
          >
            {noticeView.loading ? (
              <Spinner size="sm" label="取得中" className={styles.noticeIcon} />
            ) : noticeView.tone === 'warning' ? (
              <AlertIcon size={18} className={styles.noticeIcon} />
            ) : noticeView.tone === 'info' ? (
              <InfoIcon size={18} className={styles.noticeIcon} />
            ) : (
              <CheckCircleIcon size={18} className={styles.noticeIcon} />
            )}
            <span className={styles.noticeText}>{noticeView.message}</span>
          </div>
        ) : null}
      </div>

      {mode === 'check' ? (
        <p className={styles.checkHint}>
          <InfoIcon size={18} className={styles.checkHintIcon} />
          <span>書店や図書館の棚で、本の裏のバーコードを読み取ると、家族が借りたことがあるか確認できます（登録はしません）。</span>
        </p>
      ) : null}

      <CheckResultSheet isbn={mode === 'check' ? checkIsbn : null} onContinue={() => setCheckIsbn(null)} />

      <ConfirmDialog
        open={removeTarget !== null}
        title="リストから外しますか？"
        message={`「${removeTitle}」を借りる本のリストから外します。`}
        confirmLabel="外す"
        danger
        onConfirm={() => {
          if (removeTarget) cart.remove(removeTarget.key);
          setRemoveTarget(null);
          toast.show('リストから外しました');
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </Page>
  );
}
