/*
 * 確認ダイアログ（Sheet ベース）。onConfirm が Promise を返す間はボタンを処理中にする。
 * 使い方:
 *   <ConfirmDialog
 *     open={confirming}
 *     title="この貸出記録を削除しますか？"
 *     message="削除すると元に戻せません。"
 *     confirmLabel="削除する"
 *     danger
 *     onConfirm={async () => { await deleteLoan(groupId, id); navigate(-1); }}
 *     onCancel={() => setConfirming(false)}
 *   />
 * onConfirm で例外が出たら、そのメッセージをトーストで出してダイアログは開いたままにする
 * （data/* の書き込み関数は日本語メッセージの Error を投げる）。成功時に閉じるのは呼び出し側。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { useToast } from './ToastProvider';
import styles from './ConfirmDialog.module.css';

export type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 確定ボタンを赤くする（削除など） */
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  /** 追加の内容（チェックボックスなど） */
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  danger = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const handleConfirm = async () => {
    if (busy) return;
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setBusy(true);
        await result;
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error && err.message ? err.message : '処理できませんでした。もう一度お試しください。';
      toast.show(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      dismissible={!busy}
      showClose={false}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" block onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} block onClick={handleConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {message ? <div className={styles.message}>{message}</div> : null}
      {children}
    </Sheet>
  );
}
