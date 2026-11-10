/*
 * ISBN の手入力欄（BarcodeScanner の内部部品）。
 * normalizeIsbn で ISBN-10/13（ハイフン可）を検証し、ISBN-13 にして onSubmit に渡す。
 *   <ManualIsbnForm onSubmit={(isbn13) => …} submitLabel="決定" inputId={id} />
 */
import { useState, type FormEvent } from 'react';
import { normalizeIsbn } from '../../lib/isbn';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import styles from './BarcodeScanner.module.css';

export type ManualIsbnFormProps = {
  onSubmit: (isbn13: string) => void;
  submitLabel?: string;
  /** 入力欄の id（開いたときにフォーカスするため） */
  inputId?: string;
};

/** ISBN-10 の 9 桁目まで入力済み（最後の 1 文字が X の可能性がある） */
function waitingForCheckChar(value: string): boolean {
  return /^\d{9}$/.test(value.replace(/[\s-]/g, ''));
}

export function ManualIsbnForm({ onSubmit, submitLabel = '決定', inputId }: ManualIsbnFormProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!value.trim()) {
      setError('ISBN を入力してください');
      return;
    }
    const isbn13 = normalizeIsbn(value);
    if (!isbn13) {
      setError('ISBN が正しくありません。桁数（10 桁か 13 桁）と打ち間違いを確認してください');
      return;
    }
    setError(null);
    setValue('');
    onSubmit(isbn13);
  };

  return (
    <form className={styles.manualForm} onSubmit={handleSubmit} noValidate>
      <TextField
        id={inputId}
        className={styles.manualField}
        label="ISBN（10 桁または 13 桁）"
        value={value}
        onChange={(v) => {
          setValue(v);
          if (error) setError(null);
        }}
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder="978から始まる13桁"
        maxLength={20}
        error={error}
        hint="本の裏表紙のバーコード付近にある「ISBN」の数字です。ハイフンは無くてもかまいません。"
        trailing={
          // 数字キーボードに X が無いので、ISBN-10 の末尾用に X を入れるボタンを出す
          waitingForCheckChar(value) ? (
            <button
              type="button"
              className={styles.xKey}
              onClick={() => setValue((v) => `${v}X`)}
              aria-label="末尾に X を入力"
            >
              X
            </button>
          ) : null
        }
      />
      <Button type="submit" className={styles.manualSubmit}>
        {submitLabel}
      </Button>
    </form>
  );
}
