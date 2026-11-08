/*
 * 下から出るモーダル（ボトムシート）。背景タップ・Esc で閉じる。表示中は背面のスクロールを止める。
 * 使い方:
 *   <Sheet open={open} onClose={() => setOpen(false)} title="返却日を変更"
 *          footer={<Button block onClick={save}>保存</Button>}>
 *     <DateField label="返却日" value={due} onChange={setDue} />
 *   </Sheet>
 * dismissible={false} にすると背景タップ・Esc では閉じない（処理中など）。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';
import styles from './Sheet.module.css';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** 読み上げ用ラベル（title が無い場合） */
  ariaLabel?: string;
  /** 下部に固定する操作エリア */
  footer?: ReactNode;
  /** 背景タップ・Esc・× で閉じられるか（既定 true） */
  dismissible?: boolean;
  /** 右上の × ボタン（既定 true） */
  showClose?: boolean;
  /** 中身の余白（既定 true） */
  padded?: boolean;
  /** 開いたときに中の最初の入力欄へフォーカスするか（既定 false。キーボードが勝手に出ないように） */
  autoFocusFirstField?: boolean;
  className?: string;
  children?: ReactNode;
};

const EXIT_MS = 220;

// 複数のシートが重なっても body のスクロール固定を正しく戻すためのカウンタ
let scrollLockCount = 0;
let savedOverflow = '';

function lockBodyScroll(): () => void {
  if (scrollLockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
  return () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) document.body.style.overflow = savedOverflow;
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  ariaLabel,
  footer,
  dismissible = true,
  showClose = true,
  padded = true,
  autoFocusFirstField = false,
  className,
  children,
}: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  // 開閉（表示は CSS のアニメーションで行い、閉じるときは終わるまで待ってから外す）
  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // スクロール固定・フォーカス移動・Esc
  useEffect(() => {
    if (!open) return;
    const unlock = lockBodyScroll();
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (autoFocusFirstField) {
        const field = panel.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select');
        if (field) {
          field.focus();
          return;
        }
      }
      panel.focus({ preventScroll: true });
    }, 30);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissibleRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key === 'Tab') {
        // フォーカスをシートの中に閉じ込める
        const panel = panelRef.current;
        if (!panel) return;
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (items.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      unlock();
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, autoFocusFirstField]);

  if (!mounted) return null;

  const handleBackdrop = () => {
    if (dismissible) onClose();
  };

  return createPortal(
    <div className={[styles.root, open ? '' : styles.closing].filter(Boolean).join(' ')}>
      <div className={styles.backdrop} onClick={handleBackdrop} aria-hidden="true" />
      <div
        ref={panelRef}
        className={[styles.panel, className ?? ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
      >
        <div className={styles.grabber} aria-hidden="true" />
        {title || (showClose && dismissible) ? (
          <div className={styles.header}>
            {title ? (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            ) : (
              <span />
            )}
            {showClose && dismissible ? (
              <button type="button" className={styles.close} onClick={onClose} aria-label="閉じる">
                <CloseIcon size={22} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={[styles.body, padded ? styles.padded : ''].filter(Boolean).join(' ')}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : <div className={styles.bottomSafe} />}
      </div>
    </div>,
    document.body,
  );
}
