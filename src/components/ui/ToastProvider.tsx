/*
 * トースト（画面下部・タブの上に数秒表示する通知）。App の一番外側に ToastProvider を置く。
 * 使い方:
 *   const toast = useToast();
 *   toast.show('3冊を登録しました');
 *   toast.show('返却しました', { action: { label: '取り消す', onClick: () => undoReturn(groupId, id) } });
 *   toast.show('保存できませんでした', { tone: 'error' });
 * 新しいトーストを出すと前のものは置き換わる。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckCircleIcon, CloseIcon } from './icons';
import styles from './ToastProvider.module.css';

export type ToastTone = 'default' | 'success' | 'error';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  action?: ToastAction;
  tone?: ToastTone;
  /** 表示時間（ミリ秒）。既定 3 秒、action ありは 5 秒、error は 5 秒 */
  duration?: number;
};

export type ToastApi = {
  show(message: string, options?: ToastOptions): void;
  dismiss(): void;
};

type ToastState = {
  id: number;
  message: string;
  options: ToastOptions;
};

const ToastContext = createContext<ToastApi | null>(null);

const EXIT_MS = 200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [visible, setVisible] = useState(false);
  const nextId = useRef(1);
  const hideTimer = useRef<number | undefined>(undefined);
  const removeTimer = useRef<number | undefined>(undefined);

  const clearTimers = () => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(removeTimer.current);
  };

  const dismiss = useCallback(() => {
    clearTimers();
    setVisible(false);
    removeTimer.current = window.setTimeout(() => setToast(null), EXIT_MS);
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      clearTimers();
      const id = nextId.current++;
      setToast({ id, message, options });
      setVisible(true);
      const duration =
        options.duration ?? (options.action || options.tone === 'error' ? 5000 : 3000);
      hideTimer.current = window.setTimeout(dismiss, duration);
    },
    [dismiss],
  );

  useEffect(() => clearTimers, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const tone = toast?.options.tone ?? 'default';

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className={styles.region} role="status" aria-live="polite" aria-atomic="true">
          {toast ? (
            <div
              key={toast.id}
              className={[styles.toast, styles[tone], visible ? '' : styles.leaving].filter(Boolean).join(' ')}
            >
              {tone === 'success' ? <CheckCircleIcon size={20} className={styles.icon} /> : null}
              {tone === 'error' ? <AlertIcon size={20} className={styles.icon} /> : null}
              <p className={styles.message}>{toast.message}</p>
              {toast.options.action ? (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    toast.options.action?.onClick();
                    dismiss();
                  }}
                >
                  {toast.options.action.label}
                </button>
              ) : (
                <button type="button" className={styles.close} onClick={dismiss} aria-label="閉じる">
                  <CloseIcon size={18} />
                </button>
              )}
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

const fallback: ToastApi = {
  show(message) {
    console.warn('[toast] ToastProvider がありません:', message);
  },
  dismiss() {},
};

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? fallback;
}
